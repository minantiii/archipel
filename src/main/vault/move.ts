import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Movimentacao } from '@shared/types'
import { contem } from './caminhos'
import {
  registrarDesfecho,
  registrarInicio,
  ultimaMovimentacao,
  type TipoMovimentacao
} from './historico'
import { ehDiretorio, existe } from './io'

/**
 * Movimentação de pastas de projeto.
 *
 * Este é o único lugar do app que pode destruir trabalho do usuário, então cada
 * passo é conservador: valida antes, tenta o caminho barato (`rename`), e só
 * remove a origem depois de conferir que a cópia chegou inteira. Tudo fica
 * registrado no `historico` para dar pra auditar e desfazer.
 */

export class ErroDeMovimentacao extends Error {}

interface Medida {
  arquivos: number
  bytes: number
}

/** Conta arquivos e bytes de uma árvore, para conferir se a cópia saiu completa. */
async function medirArvore(raiz: string): Promise<Medida> {
  const medida: Medida = { arquivos: 0, bytes: 0 }
  const pilha = [raiz]

  while (pilha.length > 0) {
    const atual = pilha.pop() as string
    const entradas = await fs.readdir(atual, { withFileTypes: true })

    for (const entrada of entradas) {
      const caminho = join(atual, entrada.name)
      if (entrada.isDirectory()) {
        pilha.push(caminho)
      } else {
        medida.arquivos++
        // `lstat` e não `stat`: link simbólico é medido como link dos dois lados,
        // senão a verificação acusaria diferença por causa do alvo.
        medida.bytes += (await fs.lstat(caminho)).size
      }
    }
  }

  return medida
}

/**
 * Move um diretório. Tenta `rename` e, se origem e destino estiverem em volumes
 * diferentes (`EXDEV`), copia, confere e só então apaga a origem.
 *
 * Devolve um aviso quando a movimentação deu certo mas deixou sobra para trás.
 */
async function moverDiretorio(origem: string, destino: string): Promise<string | null> {
  try {
    await fs.rename(origem, destino)
    // Mesmo volume: o `rename` é atômico. Ou aconteceu, ou não aconteceu —
    // nunca existe um estado pela metade para alguém encontrar depois.
    return null
  } catch (erro) {
    const codigo = (erro as NodeJS.ErrnoException).code
    if (codigo !== 'EXDEV') throw erro
  }

  return copiarVerificarERemover(origem, destino)
}

/** Apaga sem deixar a falha da limpeza mascarar o erro que a motivou. */
async function limpar(caminho: string): Promise<void> {
  await fs.rm(caminho, { recursive: true, force: true }).catch(() => undefined)
}

/** Exportado para o teste conseguir exercitar o caminho de volumes diferentes. */
export async function copiarVerificarERemover(
  origem: string,
  destino: string
): Promise<string | null> {
  const antes = await medirArvore(origem)

  try {
    await fs.cp(origem, destino, { recursive: true, errorOnExist: true, force: false })
  } catch (erro) {
    // Cópia parcial não pode ficar para trás fingindo que deu certo.
    await limpar(destino)
    throw erro
  }

  const depois = await medirArvore(destino)
  if (depois.arquivos !== antes.arquivos || depois.bytes !== antes.bytes) {
    await limpar(destino)
    throw new ErroDeMovimentacao(
      `A cópia saiu diferente da origem (${antes.arquivos} arquivos/${antes.bytes} bytes contra ` +
        `${depois.arquivos}/${depois.bytes}). Nada foi apagado — a pasta continua em "${origem}".`
    )
  }

  // Daqui em diante a movimentação DEU CERTO: o conteúdo está inteiro e
  // conferido no destino. Não conseguir limpar a origem — um arquivo travado
  // por outro programa, por exemplo — é uma sobra a comunicar, não um motivo
  // para dizer que falhou. Dizer "falhou" mandaria o usuário procurar a pasta
  // no lugar errado, e ela está no lugar certo.
  try {
    await fs.rm(origem, { recursive: true, force: true })
    return null
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro)
    return (
      `A pasta chegou inteira e conferida em "${destino}", mas não deu para remover tudo da ` +
      `origem "${origem}" (${motivo}). O conteúdo no destino está completo — confira e apague ` +
      `a sobra à mão, de preferência fechando antes o programa que esteja usando esses arquivos.`
    )
  }
}

/** O que uma movimentação devolve: o registro e, se houver, a ressalva a mostrar. */
export interface ResultadoMovimentacao {
  movimentacao: Movimentacao
  /** Preenchido quando a pasta chegou inteira mas sobrou algo na origem. */
  aviso: string | null
}

/**
 * Executa uma movimentação já validada, cercada pelo registro.
 *
 * A ordem aqui é a garantia central do app: **o registro vem antes de qualquer
 * mudança no disco**. Se não der para gravar, nada é movido — uma movimentação
 * que não pode ser registrada é uma movimentação que não pode ser desfeita, e
 * mover sem rede de segurança é pior do que não mover.
 */
async function executar(
  raiz: string,
  origem: string,
  destino: string,
  tipo: TipoMovimentacao
): Promise<ResultadoMovimentacao> {
  const movimentacao: Movimentacao = { em: new Date().toISOString(), de: origem, para: destino }

  await fs.mkdir(dirname(destino), { recursive: true })
  await registrarInicio(raiz, movimentacao, tipo)

  let aviso: string | null
  try {
    aviso = await moverDiretorio(origem, destino)
  } catch (erro) {
    await registrarDesfecho(raiz, movimentacao, tipo, 'falhou')
    throw erro
  }

  await registrarDesfecho(raiz, movimentacao, tipo, 'concluida')
  return { movimentacao, aviso }
}

/** Valida e move uma pasta, registrando no log. Não pergunta nada — quem confirma é a UI. */
export async function moverPasta(
  raiz: string,
  origem: string,
  destino: string
): Promise<ResultadoMovimentacao> {
  if (!(await ehDiretorio(origem))) {
    throw new ErroDeMovimentacao(`"${origem}" não existe ou não é uma pasta.`)
  }
  if (contem(origem, raiz)) {
    throw new ErroDeMovimentacao(
      `"${origem}" contém o próprio mapa. Mover essa pasta colocaria o mapa dentro dele mesmo.`
    )
  }
  if (await existe(destino)) {
    throw new ErroDeMovimentacao(`Já existe "${basename(destino)}" no destino.`)
  }
  if (contem(origem, destino)) {
    throw new ErroDeMovimentacao('O destino está dentro da pasta de origem.')
  }

  return executar(raiz, origem, destino, 'mover')
}

/** Uma pasta do lote que não entrou, e o motivo em linguagem de gente. */
export interface FalhaDoLote {
  origem: string
  motivo: string
}

export interface RelatorioDoLote {
  movidas: Movimentacao[]
  falhas: FalhaDoLote[]
  /** Ressalvas de pastas que chegaram inteiras mas deixaram sobra na origem. */
  avisos: string[]
}

/**
 * Move várias pastas para o mapa, uma de cada vez.
 *
 * **Uma falha não interrompe o lote.** Cada movimentação é validada e executada
 * por conta própria, então um nome já ocupado ou uma pasta travada por outro
 * programa não diz nada sobre a próxima da fila. Parar no meio deixaria o
 * usuário no pior dos mundos: metade movida, e ele tendo que descobrir sozinho
 * onde foi a fronteira. Seguir e relatar no fim é mais honesto e mais fácil de
 * conferir.
 *
 * Não há transação: o que já foi movido continua movido. É o que o log permite
 * desfazer, uma pasta por vez, na ordem inversa.
 */
export async function moverVarias(
  raiz: string,
  origens: readonly string[]
): Promise<RelatorioDoLote> {
  const relatorio: RelatorioDoLote = { movidas: [], falhas: [], avisos: [] }

  for (const origem of origens) {
    try {
      // O destino é recalculado a cada volta de propósito: se duas pastas
      // escolhidas tiverem o mesmo nome, a segunda encontra a primeira já lá e
      // falha com "já existe", que é a verdade do disco naquele instante.
      const { movimentacao, aviso } = await moverPasta(raiz, origem, join(raiz, basename(origem)))
      relatorio.movidas.push(movimentacao)
      if (aviso) relatorio.avisos.push(aviso)
    } catch (erro) {
      relatorio.falhas.push({
        origem,
        motivo: erro instanceof Error ? erro.message : String(erro)
      })
    }
  }

  return relatorio
}

/** Desfaz a última movimentação, devolvendo a pasta para onde ela estava. */
export async function desfazerUltima(raiz: string): Promise<ResultadoMovimentacao> {
  const ultima = await ultimaMovimentacao(raiz)
  if (!ultima) throw new ErroDeMovimentacao('Não há movimentação recente para desfazer.')

  if (!(await ehDiretorio(ultima.para))) {
    throw new ErroDeMovimentacao(
      `A pasta não está mais em "${ultima.para}" — alguém a moveu por fora. Nada foi feito.`
    )
  }
  if (await existe(ultima.de)) {
    throw new ErroDeMovimentacao(`Já existe algo em "${ultima.de}". Nada foi feito.`)
  }

  return executar(raiz, ultima.para, ultima.de, 'desfazer')
}
