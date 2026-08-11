import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Idioma } from '@shared/types'
import { escreverAtomico } from './io'

/**
 * Preferências do app (não do mapa): basicamente onde fica a raiz escolhida.
 *
 * Mora em `userData`, fora do mapa — o mapa precisa continuar sendo uma pasta
 * comum, copiável e versionável, sem estado do app grudado nele.
 */

export interface ConfigApp {
  raiz: string | null
  /** `null` enquanto o usuário não escolheu: aí vale o idioma do sistema. */
  idioma: Idioma | null
}

const PADRAO: ConfigApp = { raiz: null, idioma: null }

let cache: ConfigApp | null = null

function caminhoConfig(): string {
  return join(app.getPath('userData'), 'config.json')
}

/**
 * Lê o conteúdo do `config.json`. Nunca lança: arquivo estragado vira o padrão.
 *
 * O BOM merece linha própria porque é invisível e derruba o `JSON.parse`. O app
 * escreve este arquivo e nunca põe um, mas basta alguém abrir no Bloco de Notas
 * e salvar como "UTF-8 com BOM" para o mapa sumir: sem raiz, a próxima abertura
 * cai na tela de boas-vindas como se nenhum mapa jamais tivesse sido escolhido,
 * e nada na tela explica o porquê. O `yaml` do `config.yaml` e o `gray-matter`
 * dos `.md` já toleram BOM por conta própria; só o JSON não.
 */
export function interpretarConfig(bruto: string): ConfigApp {
  try {
    const dados = JSON.parse(bruto.replace(/^﻿/, '')) as Partial<ConfigApp>
    return {
      raiz: typeof dados.raiz === 'string' ? dados.raiz : null,
      idioma: dados.idioma === 'pt' || dados.idioma === 'en' ? dados.idioma : null
    }
  } catch {
    return { ...PADRAO }
  }
}

async function ler(): Promise<ConfigApp> {
  if (cache) return cache
  try {
    cache = interpretarConfig(await fs.readFile(caminhoConfig(), 'utf8'))
  } catch {
    // Arquivo ausente na primeira execução: o padrão já é "nenhum mapa".
    cache = { ...PADRAO }
  }
  return cache
}

async function gravar(config: ConfigApp): Promise<void> {
  cache = config
  await escreverAtomico(caminhoConfig(), `${JSON.stringify(config, null, 2)}\n`)
}

export async function obterRaiz(): Promise<string | null> {
  return (await ler()).raiz
}

export async function definirRaiz(raiz: string | null): Promise<void> {
  await gravar({ ...(await ler()), raiz })
}

/**
 * Idioma escolhido, ou `null` enquanto o usuário nunca escolheu.
 *
 * `null` não é "português": é "ainda não sei", e quem resolve é o idioma do
 * sistema. Guardar a escolha explícita separada do palpite importa porque um
 * brasileiro com Windows em inglês pode querer o app em português, e essa
 * escolha não pode ser sobrescrita pelo palpite na próxima abertura.
 */
export async function obterIdiomaEscolhido(): Promise<Idioma | null> {
  return (await ler()).idioma
}

export async function definirIdioma(idioma: Idioma): Promise<void> {
  await gravar({ ...(await ler()), idioma })
}
