import { app, BrowserWindow, ipcMain } from 'electron'
import { watch, type FSWatcher } from 'chokidar'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { CANAIS, type Agente, type Resultado, type Time } from '@shared/types'
import { obterRaiz } from '../vault/config'
import { escreverAtomico } from '../vault/io'
import {
  apagarAgente,
  caminhoAgentes,
  carregarTime,
  listarAgentes,
  listarConversas,
  marcarParada,
  pastaDaIlha,
  processoVivo,
  salvarAgente
} from './disco'
import { comandoInterativo, promptDoTime, type Comando } from './motores'

/**
 * O lado do app do time de agentes: carregar e salvar os `.md`, observar a
 * pasta (o `delegar` grava as conversas por fora) e montar o comando e o
 * ambiente de um agente aberto no terminal embutido.
 */

async function raizObrigatoria(): Promise<string> {
  const raiz = await obterRaiz()
  if (!raiz) throw new Error('Nenhum mapa aberto.')
  return raiz
}

async function tentar(acao: () => Promise<Time>): Promise<Resultado<Time>> {
  try {
    return { ok: true, dados: await acao() }
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) }
  }
}

// --- O comando `delegar` ------------------------------------------------------

/**
 * Onde está o script do `delegar` compilado. Empacotado, ele mora dentro do
 * `app.asar`; o Electron em modo Node lê de lá normalmente.
 */
function scriptDelegar(): string {
  return join(__dirname, 'delegar.js')
}

/**
 * Grava `userData/delegar.cmd`, o atalho que os agentes chamam.
 *
 * Um `.cmd` e não `.ps1`: o Bash do Claude Code e o PowerShell rodam `.cmd`
 * direto, o stdin passa intacto (acentos inclusos) e o `ELECTRON_RUN_AS_NODE`
 * fica só neste processo — no ambiente do terminal ele faria qualquer outro app
 * Electron aberto dali (VS Code) subir como Node.
 */
async function gravarAtalhoDelegar(): Promise<string> {
  const destino = join(app.getPath('userData'), 'delegar.cmd')
  const conteudo = [
    '@echo off',
    'setlocal',
    'set ELECTRON_RUN_AS_NODE=1',
    `"${process.execPath}" "${scriptDelegar()}" %*`,
    ''
  ].join('\r\n')
  const atual = await fs.readFile(destino, 'utf8').catch(() => '')
  if (atual !== conteudo) await escreverAtomico(destino, conteudo)
  return destino
}

let atalho: Promise<string> | null = null

function caminhoDoAtalho(): Promise<string> {
  atalho ??= gravarAtalhoDelegar()
  return atalho
}

/** Variáveis que todo terminal do Archipel recebe, para o `delegar` funcionar de qualquer aba. */
export async function ambienteDoArchipel(agente: string | null): Promise<Record<string, string>> {
  const raiz = await obterRaiz()
  const ambiente: Record<string, string> = {}
  if (!raiz) return ambiente
  try {
    ambiente.ARCHIPEL_DELEGAR = await caminhoDoAtalho()
  } catch {
    return ambiente
  }
  ambiente.ARCHIPEL_MAPA = raiz
  if (agente) ambiente.ARCHIPEL_AGENTE = agente
  return ambiente
}

/** Comando e pasta para abrir um agente numa aba do terminal embutido. */
export async function sessaoDoAgente(
  nome: string,
  sessao: string | null = null
): Promise<{ comando: Comando; pasta: string; agente: Agente }> {
  const raiz = await raizObrigatoria()
  const agentes = await listarAgentes(raiz)
  const agente = agentes.find((a) => a.nome === nome)
  if (!agente) throw new Error(`Agente "${nome}" não encontrado.`)
  const delegar = await caminhoDoAtalho().catch(() => null)
  return {
    agente,
    comando: comandoInterativo(agente, promptDoTime(agente, agentes, delegar), sessao),
    pasta: await pastaDaIlha(raiz, agente.ilha)
  }
}

// --- Observador ---------------------------------------------------------------

let observador: FSWatcher | null = null
let raizObservada: string | null = null

async function observar(raiz: string): Promise<void> {
  if (raizObservada === raiz) return
  raizObservada = raiz
  await observador?.close()
  const pasta = caminhoAgentes(raiz)
  await fs.mkdir(pasta, { recursive: true }).catch(() => undefined)

  let agendado: NodeJS.Timeout | null = null
  const avisar = (): void => {
    if (agendado) clearTimeout(agendado)
    agendado = setTimeout(() => {
      agendado = null
      for (const janela of BrowserWindow.getAllWindows()) janela.webContents.send(CANAIS.agentesMudou)
    }, 250)
  }

  observador = watch(pasta, {
    // O agente na raiz e as conversas um nível abaixo.
    depth: 1,
    ignoreInitial: true,
    ignored: (caminho, stats) => Boolean(stats?.isFile() && !caminho.endsWith('.md')),
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
  })
  observador.on('all', avisar)
  observador.on('error', () => undefined)
}

export async function pararObservadorDeAgentes(): Promise<void> {
  await observador?.close()
  observador = null
  raizObservada = null
}

// --- Parar uma tarefa ---------------------------------------------------------

const executar = promisify(execFile)

/**
 * `true` se o processo é mesmo um `delegar`: o executável do próprio Archipel.
 * O pid vem de um arquivo que qualquer um edita, e o Windows reaproveita pids;
 * sem esta conferência, "parar" podia matar um programa qualquer.
 */
async function ehNossoProcesso(pid: number): Promise<boolean> {
  if (!processoVivo(pid)) return false
  if (process.platform !== 'win32') return true
  try {
    const { stdout } = await executar('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true
    })
    const imagem = stdout.split(',')[0]?.replace(/"/g, '').trim().toLowerCase()
    return imagem === basename(process.execPath).toLowerCase()
  } catch {
    return false
  }
}

/** Mata o `delegar` e tudo que ele abriu (o `claude`/`agy` e o que eles rodarem). */
async function matarArvore(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await executar('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(
      () => undefined
    )
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Já tinha saído.
    }
  }
}

// --- IPC ----------------------------------------------------------------------

function agenteDoRenderer(valor: unknown): Agente {
  const v = (valor ?? {}) as Record<string, unknown>
  const textoOuNulo = (x: unknown): string | null =>
    typeof x === 'string' && x.trim().length > 0 ? x.trim() : null
  return {
    nome: typeof v.nome === 'string' ? v.nome.trim() : '',
    motor: v.motor === 'gemini' ? 'gemini' : 'claude',
    modelo: textoOuNulo(v.modelo),
    ilha: textoOuNulo(v.ilha),
    funcao: typeof v.funcao === 'string' ? v.funcao : ''
  }
}

export function registrarAgentes(): void {
  ipcMain.handle(CANAIS.agentesCarregar, async (): Promise<Time> => {
    const raiz = await obterRaiz()
    if (!raiz) return { agentes: [], conversas: [] }
    await observar(raiz)
    return carregarTime(raiz)
  })

  ipcMain.handle(
    CANAIS.agentesSalvar,
    async (_evento, agente: unknown, nomeAntigo: unknown): Promise<Resultado<Time>> =>
      tentar(async () => {
        const raiz = await raizObrigatoria()
        await salvarAgente(
          raiz,
          agenteDoRenderer(agente),
          typeof nomeAntigo === 'string' && nomeAntigo ? nomeAntigo : null
        )
        return carregarTime(raiz)
      })
  )

  ipcMain.handle(
    CANAIS.agentesApagar,
    async (_evento, nome: unknown): Promise<Resultado<Time>> =>
      tentar(async () => {
        const raiz = await raizObrigatoria()
        await apagarAgente(raiz, String(nome))
        return carregarTime(raiz)
      })
  )

  ipcMain.handle(
    CANAIS.agentesParar,
    async (_evento, id: unknown): Promise<Resultado<Time>> =>
      tentar(async () => {
        const raiz = await raizObrigatoria()
        const conversa = (await listarConversas(raiz, 400)).find((c) => c.id === id)
        if (!conversa) throw new Error('Conversa não encontrada.')
        if (conversa.status === 'trabalhando') {
          if (conversa.pid && (await ehNossoProcesso(conversa.pid))) await matarArvore(conversa.pid)
          await marcarParada(raiz, conversa.id)
        }
        return carregarTime(raiz)
      })
  )

  // Grava o atalho já na abertura: o primeiro terminal não precisa esperar.
  void caminhoDoAtalho().catch(() => undefined)
}
