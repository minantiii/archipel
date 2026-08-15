import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Idioma } from '@shared/types'
import { obterIdiomaEscolhido } from './vault/config'

/**
 * Os textos que o processo principal mostra: diálogos do sistema e mensagens de
 * erro que sobem para a tela.
 *
 * O português é a fonte da verdade e o inglês é tipado a partir dele, então
 * esquecer uma chave na tradução não compila. Sem isso, a falta só apareceria
 * como `undefined` no meio de uma frase, e provavelmente só depois de publicado.
 *
 * O idioma fica num módulo em vez de ser passado adiante: ele muda uma vez por
 * sessão e enfiá-lo como parâmetro em cada função de disco só espalharia ruído
 * por código que não tem nada a ver com idioma.
 */

const PT = {
  nenhumMapaAberto: 'Nenhum mapa aberto.',
  pastaForaDoMapa: (id: string) => `Pasta "${id}" não está no mapa.`,
  pastaSumiuDoDisco: (id: string) => `A pasta "${id}" não existe no disco.`,
  pastaJaNaoEstaNoDisco: (id: string) => `A pasta "${id}" já não está no disco.`,

  escolherRaizTitulo: 'Escolha a pasta que será o mapa',
  escolherRaizBotao: 'Usar como mapa',
  escolherPastasTitulo: 'Escolha as pastas que vão entrar no mapa',
  escolherPastasBotao: 'Selecionar',
  escolherDestinoTitulo: 'Para onde mover a pasta?',
  escolherDestinoBotao: 'Mover para cá',

  cancelar: 'Cancelar',
  mover: 'Mover',

  apagarTitulo: 'Apagar pasta',
  apagarPergunta: (id: string) => `Apagar "${id}" e todo o conteúdo dela?`,
  apagarDetalhe: (caminho: string) =>
    `Vai para a Lixeira:\n${caminho}\n\n` +
    'Nada é destruído de imediato — a pasta vai para a Lixeira do sistema e dá para ' +
    'restaurar por lá. As tags e o diário ficam guardados em .organizador/removidos.',
  apagarBotao: 'Apagar',

  tirarDoMapaTitulo: 'Tirar pasta do mapa',
  tirarDoMapaPergunta: (id: string) => `Tirar "${id}" do mapa?`,
  tirarDoMapaDetalhe: (de: string, para: string) =>
    `A pasta sai de:\n${de}\n\nE vai para:\n${para}\n\n` +
    'As tags e o diário vão para .organizador/removidos, caso você queira de volta.',

  semMovimentacao: 'Não há movimentação recente para desfazer.',
  desfazerTitulo: 'Desfazer movimentação',
  desfazerPergunta: (nome: string) => `Devolver "${nome}" para onde estava?`,
  desfazerDetalhe: (de: string, para: string) => `De volta de:\n${de}\n\nPara:\n${para}`,
  desfazerBotao: 'Desfazer',

  semVsCode: 'Não encontrei o VS Code. Confira se o comando "code" está no PATH.',
  soNoWindows: (ferramenta: string) =>
    `Abrir ${ferramenta} só está implementado no Windows por enquanto.`,
  oTerminal: 'o terminal'
}

const EN: typeof PT = {
  nenhumMapaAberto: 'No map is open.',
  pastaForaDoMapa: (id: string) => `The folder "${id}" is not on the map.`,
  pastaSumiuDoDisco: (id: string) => `The folder "${id}" does not exist on disk.`,
  pastaJaNaoEstaNoDisco: (id: string) => `The folder "${id}" is no longer on disk.`,

  escolherRaizTitulo: 'Choose the folder that will be the map',
  escolherRaizBotao: 'Use as map',
  escolherPastasTitulo: 'Choose the folders to add to the map',
  escolherPastasBotao: 'Select',
  escolherDestinoTitulo: 'Where should the folder go?',
  escolherDestinoBotao: 'Move here',

  cancelar: 'Cancel',
  mover: 'Move',

  apagarTitulo: 'Delete folder',
  apagarPergunta: (id: string) => `Delete "${id}" and everything inside it?`,
  apagarDetalhe: (caminho: string) =>
    `Goes to the Recycle Bin:\n${caminho}\n\n` +
    'Nothing is destroyed right away — the folder goes to the system Recycle Bin and can be ' +
    'restored from there. Tags and journal are kept in .organizador/removidos.',
  apagarBotao: 'Delete',

  tirarDoMapaTitulo: 'Remove folder from the map',
  tirarDoMapaPergunta: (id: string) => `Remove "${id}" from the map?`,
  tirarDoMapaDetalhe: (de: string, para: string) =>
    `The folder leaves:\n${de}\n\nAnd goes to:\n${para}\n\n` +
    'Tags and journal move to .organizador/removidos, in case you want them back.',

  semMovimentacao: 'There is no recent move to undo.',
  desfazerTitulo: 'Undo move',
  desfazerPergunta: (nome: string) => `Put "${nome}" back where it was?`,
  desfazerDetalhe: (de: string, para: string) => `Back from:\n${de}\n\nTo:\n${para}`,
  desfazerBotao: 'Undo',

  semVsCode: `Couldn't find VS Code. Check that the "code" command is on your PATH.`,
  soNoWindows: (ferramenta: string) => `Opening ${ferramenta} is Windows-only for now.`,
  oTerminal: 'the terminal'
}

const TRADUCOES = { pt: PT, en: EN }

/**
 * O que o sistema sugere quando o usuário nunca escolheu.
 *
 * Qualquer variante de português cai em português — `pt-BR`, `pt-PT`, `pt`.
 * Todo o resto do mundo recebe inglês, que é a escolha menos errada para quem
 * não fala nenhum dos dois.
 */
export function idiomaDoSistema(): Idioma {
  return app.getLocale().toLowerCase().startsWith('pt') ? 'pt' : 'en'
}

/**
 * Lê o que o instalador gravou. Qualquer outra coisa vira `null`.
 *
 * O arquivo é escrito por `build/instalador.nsh` e nunca pelo app, então
 * conteúdo estranho significa alguém mexendo com o Bloco de Notas — daí o
 * `trim` e o BOM, que são invisíveis e sozinhos derrubariam a comparação.
 */
export function interpretarIdiomaGravado(bruto: string): Idioma | null {
  const limpo = bruto.replace(/^﻿/, '').trim().toLowerCase()
  return limpo === 'pt' || limpo === 'en' ? limpo : null
}

/**
 * A escolha feita na primeira tela do assistente de instalação.
 *
 * Mora ao lado do `config.json`, em `userData`, e não na pasta de instalação: o
 * atualizador apaga aquela pasta inteira a cada versão nova.
 */
async function idiomaDoInstalador(): Promise<Idioma | null> {
  try {
    const bruto = await fs.readFile(join(app.getPath('userData'), 'idioma.txt'), 'utf8')
    return interpretarIdiomaGravado(bruto)
  } catch {
    // Não existe: `npm run dev`, ou uma instalação anterior a esta versão.
    return null
  }
}

let atual: Idioma = 'pt'

/**
 * Resolve o idioma da sessão. Chamado uma vez, na abertura.
 *
 * Na ordem: o que o instalador gravou; o que o antigo botão da interface deixou
 * no `config.json`, para quem já tinha escolhido antes desta versão; e por fim
 * o palpite do sistema.
 */
export async function carregarIdioma(): Promise<Idioma> {
  atual = (await idiomaDoInstalador()) ?? (await obterIdiomaEscolhido()) ?? idiomaDoSistema()
  return atual
}

export function idiomaAtual(): Idioma {
  return atual
}

/** Os textos do idioma em vigor. */
export function t(): typeof PT {
  return TRADUCOES[atual]
}
