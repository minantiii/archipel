import { basename, join } from 'node:path'
import type { Idioma } from '@shared/types'
import type { RelatorioDoLote } from './vault/move'

/**
 * Os textos que o usuário lê antes e depois de mover pastas para o mapa.
 *
 * Fora do `ipc.ts` porque lá dentro nada disto seria testável: aquele módulo
 * importa `electron`, que não existe fora do app. Aqui é só texto a partir de
 * dados, e o plural e a contagem passam a ter teste — é o tipo de coisa que sai
 * errada em silêncio e ninguém percebe até ver "1 pastas entraram".
 *
 * O idioma entra por parâmetro, e não pelo módulo de idioma do main, justamente
 * para o teste conseguir exercitar os dois sem mexer em estado global.
 */

const FRASES = {
  pt: {
    conferido:
      'O conteúdo é conferido antes da origem ser removida, e dá para desfazer depois.',
    seAlgumaFalhar:
      'Se alguma não puder entrar, as demais seguem e você recebe a lista no fim.',
    moverUmaTitulo: 'Mover pasta para o mapa',
    moverUmaPergunta: (nome: string) => `Mover "${nome}" para o mapa?`,
    saiDe: 'A pasta sai de:',
    passaAViverEm: 'E passa a viver em:',
    moverBotao: 'Mover',
    moverVariasTitulo: 'Mover pastas para o mapa',
    moverVariasPergunta: (n: number) => `Mover ${n} pastas para o mapa?`,
    todasPassamAViverEm: 'Todas passam a viver em:',
    eMais: (n: number) => `  … e mais ${n}`,
    moverVariasBotao: (n: number) => `Mover ${n}`,
    entraram: (n: number) =>
      n === 1 ? '1 pasta entrou no mapa' : `${n} pastas entraram no mapa`,
    ficaramDeFora: (n: number) => (n === 1 ? '1 ficou de fora' : `${n} ficaram de fora`),
    continuamOndeEstavam: 'As que ficaram de fora continuam onde estavam.'
  },
  en: {
    conferido: 'Contents are verified before the source is removed, and this can be undone.',
    seAlgumaFalhar: "If one can't make it in, the rest continue and you get the list at the end.",
    moverUmaTitulo: 'Move folder to the map',
    moverUmaPergunta: (nome: string) => `Move "${nome}" to the map?`,
    saiDe: 'The folder leaves:',
    passaAViverEm: 'And will live in:',
    moverBotao: 'Move',
    moverVariasTitulo: 'Move folders to the map',
    moverVariasPergunta: (n: number) => `Move ${n} folders to the map?`,
    todasPassamAViverEm: 'All of them will live in:',
    eMais: (n: number) => `  … and ${n} more`,
    moverVariasBotao: (n: number) => `Move ${n}`,
    entraram: (n: number) =>
      n === 1 ? '1 folder joined the map' : `${n} folders joined the map`,
    ficaramDeFora: (n: number) => (n === 1 ? '1 stayed out' : `${n} stayed out`),
    continuamOndeEstavam: 'The ones that stayed out are still where they were.'
  }
}

/** Teto da listagem: com quarenta pastas a modal passaria da tela e o botão sairia do alcance. */
const TETO_DA_LISTA = 12

export interface TextoDeConfirmacao {
  titulo: string
  mensagem: string
  detalhe: string
  botao: string
}

/**
 * A confirmação de "adicionar pasta", que muda de tom conforme o tamanho.
 *
 * Para uma pasta, mostra os dois caminhos inteiros — é a conferência que o
 * usuário faz antes de autorizar. Para várias, caminho completo vira parede de
 * texto que ninguém lê, então lista os nomes e diz para onde todos vão.
 */
export function confirmacaoDoLote(
  raiz: string,
  origens: readonly string[],
  idioma: Idioma = 'pt'
): TextoDeConfirmacao {
  const f = FRASES[idioma]

  if (origens.length === 1) {
    const origem = origens[0]
    return {
      titulo: f.moverUmaTitulo,
      mensagem: f.moverUmaPergunta(basename(origem)),
      detalhe:
        `${f.saiDe}\n${origem}\n\n` +
        `${f.passaAViverEm}\n${join(raiz, basename(origem))}\n\n${f.conferido}`,
      botao: f.moverBotao
    }
  }

  const nomes = origens.slice(0, TETO_DA_LISTA).map((o) => `  • ${basename(o)}`)
  const resto = origens.length - TETO_DA_LISTA
  const lista = [...nomes, ...(resto > 0 ? [f.eMais(resto)] : [])].join('\n')

  return {
    titulo: f.moverVariasTitulo,
    mensagem: f.moverVariasPergunta(origens.length),
    detalhe:
      `${lista}\n\n${f.todasPassamAViverEm}\n${raiz}\n\n${f.conferido}\n\n${f.seAlgumaFalhar}`,
    botao: f.moverVariasBotao(origens.length)
  }
}

/**
 * O que aconteceu no lote, ou `null` quando não há o que ressalvar.
 *
 * Silêncio no caso bom é proposital: o mapa redesenhado já é a confirmação, e um
 * aviso de "deu tudo certo" para fechar toda vez vira ruído que se aprende a
 * dispensar sem ler — justamente o hábito que faz o aviso importante passar batido.
 */
export function relatarLote(relatorio: RelatorioDoLote, idioma: Idioma = 'pt'): string | null {
  const { movidas, falhas, avisos } = relatorio
  if (falhas.length === 0 && avisos.length === 0) return null

  const f = FRASES[idioma]
  const partes: string[] = []

  if (falhas.length > 0) {
    partes.push(`${f.entraram(movidas.length)}, ${f.ficaramDeFora(falhas.length)}:`)
    partes.push(...falhas.map((x) => `• ${basename(x.origem)} — ${x.motivo}`))
    // Dito com todas as letras porque é a dúvida imediata de quem lê a lista.
    partes.push(f.continuamOndeEstavam)
  }

  partes.push(...avisos)
  return partes.join('\n')
}
