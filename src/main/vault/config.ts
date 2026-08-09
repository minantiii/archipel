import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { escreverAtomico } from './io'

/**
 * Preferências do app (não do mapa): basicamente onde fica a raiz escolhida.
 *
 * Mora em `userData`, fora do mapa — o mapa precisa continuar sendo uma pasta
 * comum, copiável e versionável, sem estado do app grudado nele.
 */

interface ConfigApp {
  raiz: string | null
}

const PADRAO: ConfigApp = { raiz: null }

let cache: ConfigApp | null = null

function caminhoConfig(): string {
  return join(app.getPath('userData'), 'config.json')
}

async function ler(): Promise<ConfigApp> {
  if (cache) return cache
  try {
    const bruto = await fs.readFile(caminhoConfig(), 'utf8')
    const dados = JSON.parse(bruto) as Partial<ConfigApp>
    cache = { raiz: typeof dados.raiz === 'string' ? dados.raiz : null }
  } catch {
    cache = { ...PADRAO }
  }
  return cache
}

export async function obterRaiz(): Promise<string | null> {
  return (await ler()).raiz
}

export async function definirRaiz(raiz: string | null): Promise<void> {
  const config: ConfigApp = { raiz }
  cache = config
  await escreverAtomico(caminhoConfig(), `${JSON.stringify(config, null, 2)}\n`)
}
