import { basename, join } from 'node:path'
import type { RelatorioDoLote } from './vault/move'

/**
 * Os textos que o usuário lê antes e depois de mover pastas para o mapa.
 *
 * Fora do `ipc.ts` porque lá dentro nada disto seria testável: aquele módulo
 * importa `electron`, que não existe fora do app. Aqui é só texto a partir de
 * dados, e o plural e a contagem passam a ter teste — é o tipo de coisa que sai
 * errada em silêncio e ninguém percebe até ver "1 pastas entraram".
 */

const CONFERIDO =
  'O conteúdo é conferido antes da origem ser removida, e dá para desfazer depois.'

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
  origens: readonly string[]
): TextoDeConfirmacao {
  if (origens.length === 1) {
    const origem = origens[0]
    return {
      titulo: 'Mover pasta para o mapa',
      mensagem: `Mover "${basename(origem)}" para o mapa?`,
      detalhe:
        `A pasta sai de:\n${origem}\n\n` +
        `E passa a viver em:\n${join(raiz, basename(origem))}\n\n${CONFERIDO}`,
      botao: 'Mover'
    }
  }

  const nomes = origens.slice(0, TETO_DA_LISTA).map((o) => `  • ${basename(o)}`)
  const resto = origens.length - TETO_DA_LISTA
  const lista = [...nomes, ...(resto > 0 ? [`  … e mais ${resto}`] : [])].join('\n')

  return {
    titulo: 'Mover pastas para o mapa',
    mensagem: `Mover ${origens.length} pastas para o mapa?`,
    detalhe:
      `${lista}\n\nTodas passam a viver em:\n${raiz}\n\n${CONFERIDO}\n\n` +
      'Se alguma não puder entrar, as demais seguem e você recebe a lista no fim.',
    botao: `Mover ${origens.length}`
  }
}

/**
 * O que aconteceu no lote, ou `null` quando não há o que ressalvar.
 *
 * Silêncio no caso bom é proposital: o mapa redesenhado já é a confirmação, e um
 * aviso de "deu tudo certo" para fechar toda vez vira ruído que se aprende a
 * dispensar sem ler — justamente o hábito que faz o aviso importante passar batido.
 */
export function relatarLote(relatorio: RelatorioDoLote): string | null {
  const { movidas, falhas, avisos } = relatorio
  if (falhas.length === 0 && avisos.length === 0) return null

  const partes: string[] = []

  if (falhas.length > 0) {
    const entraram =
      movidas.length === 1 ? '1 pasta entrou no mapa' : `${movidas.length} pastas entraram no mapa`
    const ficaram = falhas.length === 1 ? '1 ficou de fora' : `${falhas.length} ficaram de fora`

    partes.push(`${entraram}, ${ficaram}:`)
    partes.push(...falhas.map((f) => `• ${basename(f.origem)} — ${f.motivo}`))
    // Dito com todas as letras porque é a dúvida imediata de quem lê a lista.
    partes.push('As que ficaram de fora continuam onde estavam.')
  }

  partes.push(...avisos)
  return partes.join('\n')
}
