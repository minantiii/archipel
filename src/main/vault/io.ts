import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Escreve um arquivo de forma atômica: grava num `.tmp` vizinho e só então
 * renomeia por cima do destino.
 *
 * Sem isso, fechar o app no meio de uma gravação deixaria um `.md` truncado —
 * e como os `.md` são a única fonte de metadados, isso seria perda de dados.
 */
export async function escreverAtomico(caminho: string, conteudo: string): Promise<void> {
  const temporario = join(dirname(caminho), `.${randomBytes(6).toString('hex')}.tmp`)
  await fs.writeFile(temporario, conteudo, 'utf8')
  try {
    await fs.rename(temporario, caminho)
  } catch (erro) {
    await fs.rm(temporario, { force: true })
    throw erro
  }
}

export async function existe(caminho: string): Promise<boolean> {
  try {
    await fs.access(caminho)
    return true
  } catch {
    return false
  }
}

export async function ehDiretorio(caminho: string): Promise<boolean> {
  try {
    return (await fs.stat(caminho)).isDirectory()
  } catch {
    return false
  }
}
