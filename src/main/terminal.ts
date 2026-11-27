import { ipcMain, type WebContents } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { spawn, type IPty } from 'node-pty'
import { CANAIS } from '@shared/types'
import { obterRaiz } from './vault/config'
import { existeNoPath } from './vault/actions'

/**
 * O terminal embutido do Archipel: um shell de verdade (via `node-pty`), que o
 * renderer desenha com o xterm.js no painel embaixo do mapa.
 *
 * O renderer nunca escolhe caminho nem programa: pede "abra na ilha X" e quem
 * resolve a pasta, sempre dentro da raiz do mapa, é este lado.
 */

interface Sessao {
  pty: IPty
  dono: WebContents
}

const sessoes = new Map<number, Sessao>()
let proximoId = 1

/** PowerShell 7 quando instalado; senão o Windows PowerShell que vem com o sistema. */
async function shellPadrao(): Promise<string> {
  if (process.platform !== 'win32') return process.env.SHELL ?? '/bin/bash'
  return (await existeNoPath('pwsh.exe')) ? 'pwsh.exe' : 'powershell.exe'
}

/**
 * A pasta onde o shell nasce: a da ilha, se ela existir dentro da raiz; senão
 * a própria raiz. O `basename` impede que um id como `..\..\Windows` saia do mapa.
 */
async function pastaInicial(ilha: string | null): Promise<string> {
  const raiz = await obterRaiz()
  if (!raiz) return process.env.USERPROFILE ?? process.cwd()
  if (!ilha || basename(ilha) !== ilha) return raiz
  const caminho = join(raiz, ilha)
  try {
    if ((await fs.stat(caminho)).isDirectory()) return caminho
  } catch {
    // Ilha ausente no disco: cai na raiz em vez de falhar.
  }
  return raiz
}

function fechar(id: number): void {
  const sessao = sessoes.get(id)
  if (!sessao) return
  sessoes.delete(id)
  try {
    sessao.pty.kill()
  } catch {
    // O processo já tinha saído.
  }
}

/** Mata todos os shells: ao fechar o app, nenhum fica órfão rodando escondido. */
export function fecharTerminais(): void {
  for (const id of [...sessoes.keys()]) fechar(id)
}

export function registrarTerminal(): void {
  ipcMain.handle(
    CANAIS.terminalAbrir,
    async (evento, ilha: unknown, colunas: unknown, linhas: unknown) => {
      const cwd = await pastaInicial(typeof ilha === 'string' ? ilha : null)
      const cols = typeof colunas === 'number' && colunas > 0 ? Math.floor(colunas) : 80
      const rows = typeof linhas === 'number' && linhas > 0 ? Math.floor(linhas) : 24

      const pty = spawn(await shellPadrao(), [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, COLORTERM: 'truecolor' } as Record<string, string>,
        useConpty: true
      })

      const id = proximoId++
      const dono = evento.sender
      sessoes.set(id, { pty, dono })

      pty.onData((dados) => {
        if (!dono.isDestroyed()) dono.send(CANAIS.terminalDados, id, dados)
      })
      pty.onExit(({ exitCode }) => {
        sessoes.delete(id)
        if (!dono.isDestroyed()) dono.send(CANAIS.terminalSaiu, id, exitCode)
      })
      // Recarregar ou fechar a janela leva junto os shells dela.
      dono.once('destroyed', () => fechar(id))

      return { id, pasta: cwd }
    }
  )

  ipcMain.on(CANAIS.terminalEscrever, (_evento, id: unknown, dados: unknown) => {
    if (typeof id !== 'number' || typeof dados !== 'string') return
    sessoes.get(id)?.pty.write(dados)
  })

  ipcMain.on(
    CANAIS.terminalRedimensionar,
    (_evento, id: unknown, colunas: unknown, linhas: unknown) => {
      if (typeof id !== 'number' || typeof colunas !== 'number' || typeof linhas !== 'number')
        return
      if (colunas < 2 || linhas < 1) return
      try {
        sessoes.get(id)?.pty.resize(Math.floor(colunas), Math.floor(linhas))
      } catch {
        // Redimensionar um shell que acabou de sair lança; não há o que fazer.
      }
    }
  )

  ipcMain.on(CANAIS.terminalFechar, (_evento, id: unknown) => {
    if (typeof id === 'number') fechar(id)
  })
}
