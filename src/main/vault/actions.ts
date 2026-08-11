import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { t } from '../textos'

/**
 * Abertura de uma pasta nas ferramentas do sistema.
 *
 * Todo comando aqui roda com `cwd` na pasta alvo e **nunca** recebe o caminho
 * como argumento. Isso resolve de uma vez o problema de aspas em caminhos com
 * espaço e colchetes — e o usuário tem pastas assim ("Demandas - [Cache]").
 */

const executar = promisify(execFile)

interface Comando {
  exe: string
  args: string[]
}

function ehWindows(): boolean {
  return process.platform === 'win32'
}

function disparar(comando: Comando, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const processo = spawn(comando.exe, comando.args, {
      cwd,
      detached: true,
      stdio: 'ignore'
    })

    processo.once('error', reject)
    processo.once('spawn', () => {
      processo.unref()
      resolve()
    })
  })
}

/**
 * Abre um programa de console numa janela nova e visível.
 *
 * O `cmd /c start` parece rodeio, mas é obrigatório: o main do Electron é um
 * processo *sem console*, e o `spawn` com `detached` usa `DETACHED_PROCESS` no
 * Windows. O filho então nasce sem console nenhum e com o stdin em NUL — um
 * `powershell -NoExit` recebe EOF na hora e morre calado, sem nunca aparecer.
 * O `start` é o que aloca o console de verdade.
 */
function abrirEmNovoConsole(comando: Comando, cwd: string): Promise<void> {
  // O `''` é o argumento de título do `start`; sem ele o `start` interpretaria
  // o executável como título e não abriria nada.
  return disparar({ exe: 'cmd.exe', args: ['/c', 'start', '', comando.exe, ...comando.args] }, cwd)
}

const cacheDoPath = new Map<string, boolean>()

/**
 * Diz se um executável existe no PATH.
 *
 * Precisa ser checado *antes* de montar o comando: passando pelo `start`, um
 * executável inexistente falha lá dentro sem o `spawn` reclamar, então não dá
 * para descobrir isso pelo evento `error` como se fazia antes.
 */
async function existeNoPath(exe: string): Promise<boolean> {
  const emCache = cacheDoPath.get(exe)
  if (emCache !== undefined) return emCache

  let existe = false
  try {
    await executar('where', [exe])
    existe = true
  } catch {
    existe = false
  }

  cacheDoPath.set(exe, existe)
  return existe
}

/** Windows Terminal quando houver; PowerShell puro no Windows 10 sem ele. */
async function comandoDeTerminal(): Promise<Comando> {
  if (await existeNoPath('wt.exe')) {
    return { exe: 'wt.exe', args: ['-d', '.', 'powershell.exe', '-NoExit'] }
  }
  return { exe: 'powershell.exe', args: ['-NoExit'] }
}

function exigirWindows(ferramenta: string): void {
  if (!ehWindows()) {
    throw new Error(t().soNoWindows(ferramenta))
  }
}

export async function abrirNoVsCode(caminho: string): Promise<void> {
  if (!ehWindows()) {
    await disparar({ exe: 'code', args: ['.'] }, caminho)
    return
  }

  if (!(await existeNoPath('code'))) {
    throw new Error(t().semVsCode)
  }

  // O VS Code é um app gráfico: abre a própria janela, não precisa de console.
  await disparar({ exe: 'cmd.exe', args: ['/c', 'code', '.'] }, caminho)
}

export async function abrirTerminal(caminho: string): Promise<void> {
  exigirWindows(t().oTerminal)
  await abrirEmNovoConsole(await comandoDeTerminal(), caminho)
}
