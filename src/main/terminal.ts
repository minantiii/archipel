import { ipcMain, type WebContents } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, delimiter, extname, join } from 'node:path'
import { spawn, type IPty } from 'node-pty'
import { CANAIS } from '@shared/types'
import { obterRaiz } from './vault/config'
import { existeNoPath } from './vault/actions'
import { ambienteDoArchipel, sessaoDoAgente } from './agentes/ipc'

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

/**
 * Caminho completo de um programa no PATH. O `node-pty` não procura sozinho, e
 * `claude`/`agy` instalados por usuário moram em pastas como `~/.local/bin`.
 */
async function acharNoPath(programa: string): Promise<string | null> {
  const extensoes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']
  for (const pasta of (process.env.PATH ?? '').split(delimiter)) {
    if (!pasta) continue
    for (const ext of extensoes) {
      const caminho = join(pasta, programa + ext)
      try {
        if ((await fs.stat(caminho)).isFile()) return caminho
      } catch {
        // Próximo.
      }
    }
  }
  return null
}

/**
 * O ambiente do app sem as marcas de uma sessão do Claude Code. Se o Archipel
 * foi aberto de dentro de uma (pelo terminal dela), o `claude` das abas se
 * acharia uma sessão filha e não guardaria as conversas.
 */
export function ambienteLimpo(): NodeJS.ProcessEnv {
  const ambiente = { ...process.env }
  for (const chave of Object.keys(ambiente)) {
    if (chave === 'CLAUDECODE' || chave.startsWith('CLAUDE_CODE_CHILD')) delete ambiente[chave]
  }
  return ambiente
}

/** O que a aba roda: o shell padrão, ou o motor de um agente. */
async function programaDaAba(
  ilha: string | null,
  agente: string | null,
  sessao: string | null
): Promise<{ arquivo: string; args: string[]; cwd: string }> {
  if (!agente) return { arquivo: await shellPadrao(), args: [], cwd: await pastaInicial(ilha) }

  const { comando, pasta } = await sessaoDoAgente(agente, sessao)
  const caminho = await acharNoPath(comando.programa)
  if (!caminho) {
    // Sem o motor instalado, a aba abre um shell explicando, em vez de sumir.
    const aviso = `Não encontrei "${comando.programa}" no PATH. Instale-o para usar o agente ${agente}.`
    return {
      arquivo: await shellPadrao(),
      args: process.platform === 'win32' ? ['-NoExit', '-Command', `Write-Host '${aviso}'`] : [],
      cwd: pasta
    }
  }
  // `.cmd` não roda direto pelo ConPTY: passa pelo `cmd.exe`.
  if (['.cmd', '.bat'].includes(extname(caminho).toLowerCase())) {
    return { arquivo: 'cmd.exe', args: ['/d', '/c', caminho, ...comando.args], cwd: pasta }
  }
  return { arquivo: caminho, args: comando.args, cwd: pasta }
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
    async (
      evento,
      ilha: unknown,
      colunas: unknown,
      linhas: unknown,
      agente: unknown,
      sessao: unknown
    ) => {
      const nomeAgente = typeof agente === 'string' && agente ? agente : null
      // Id de sessão vai como argumento do motor: só letras, números e traços.
      const idSessao = typeof sessao === 'string' && /^[\w-]{1,100}$/.test(sessao) ? sessao : null
      const { arquivo, args, cwd } = await programaDaAba(
        typeof ilha === 'string' ? ilha : null,
        nomeAgente,
        idSessao
      )
      const cols = typeof colunas === 'number' && colunas > 0 ? Math.floor(colunas) : 80
      const rows = typeof linhas === 'number' && linhas > 0 ? Math.floor(linhas) : 24

      const pty = spawn(arquivo, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...ambienteLimpo(),
          COLORTERM: 'truecolor',
          // Qualquer aba consegue passar tarefa a um agente com o `delegar`.
          ...(await ambienteDoArchipel(nomeAgente))
        } as Record<string, string>,
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
