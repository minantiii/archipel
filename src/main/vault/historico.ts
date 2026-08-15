import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Movimentacao } from '@shared/types'
import { mesmoCaminho } from './caminhos'
import { escreverAtomico } from './io'

/**
 * Histórico de movimentações: o que o `Ctrl` + `Z` desfaz.
 *
 * Mora em `userData`, junto do `config.json`, e **não dentro do mapa**. O mapa é
 * uma pasta de trabalho da pessoa, e histórico de movimentação é estado do app,
 * não conteúdo do mapa — um arquivo crescendo lá dentro para sempre é sujeira
 * que ela nunca pediu.
 *
 * Por isso também tem teto: passou de `LIMITE` registros, o mais velho cai fora.
 * A pergunta que o app faz é sempre "qual foi a última?"; o resto é rastro para
 * entender o que aconteceu quando algo dá errado.
 *
 * Cada registro carrega a raiz a que pertence, porque o arquivo é um só para
 * todos os mapas que a pessoa abrir.
 */

const ARQUIVO = 'movimentos.json'
const LIMITE = 50

/**
 * Estado de um registro.
 *
 * - `iniciada`  — gravado antes de tocar no disco.
 * - `concluida` — confirmado depois que a pasta mudou de lugar.
 * - `falhou`    — a movimentação foi abortada e o disco não mudou.
 *
 * Uma `iniciada` que nunca ganhou desfecho continua valendo como movimentação a
 * desfazer: ou o app morreu no meio, ou só a confirmação não foi gravada. Quem
 * decide se ela realmente aconteceu é o disco, na validação do `desfazerUltima`.
 */
export type EstadoMovimentacao = 'iniciada' | 'concluida' | 'falhou'

export type TipoMovimentacao = 'mover' | 'desfazer'

export interface Registro extends Movimentacao {
  raiz: string
  tipo: TipoMovimentacao
  estado: EstadoMovimentacao
}

function caminhoHistorico(): string {
  return join(app.getPath('userData'), ARQUIVO)
}

/**
 * Lê o conteúdo do `movimentos.json`. Nunca lança: arquivo estragado vira
 * histórico vazio, que é o mesmo que "não há o que desfazer".
 *
 * Registro individual sem `de` e `para` é descartado sozinho, sem levar os
 * outros junto — perder o histórico inteiro por causa de uma linha estranha
 * seria uma troca ruim.
 */
export function interpretarHistorico(bruto: string): Registro[] {
  let dados: unknown
  try {
    dados = JSON.parse(bruto.replace(/^﻿/, ''))
  } catch {
    return []
  }
  if (!Array.isArray(dados)) return []

  const registros: Registro[] = []
  for (const item of dados) {
    if (typeof item !== 'object' || item === null) continue
    const { raiz, de, para, em, tipo, estado } = item as Record<string, unknown>
    if (typeof raiz !== 'string' || typeof de !== 'string' || typeof para !== 'string') continue

    registros.push({
      raiz,
      de,
      para,
      em: typeof em === 'string' ? em : '',
      tipo: tipo === 'desfazer' ? 'desfazer' : 'mover',
      estado: estado === 'iniciada' || estado === 'falhou' ? estado : 'concluida'
    })
  }
  return registros
}

async function ler(): Promise<Registro[]> {
  try {
    return interpretarHistorico(await fs.readFile(caminhoHistorico(), 'utf8'))
  } catch {
    // Arquivo ausente na primeira execução: ninguém moveu nada ainda.
    return []
  }
}

async function gravar(registros: readonly Registro[]): Promise<void> {
  await escreverAtomico(
    caminhoHistorico(),
    `${JSON.stringify(registros.slice(-LIMITE), null, 2)}\n`
  )
}

/**
 * Anota a intenção **antes** de o disco mudar.
 *
 * Deixa a falha subir de propósito: uma movimentação que não pode ser
 * registrada é uma movimentação que não pode ser desfeita, e mover sem rede de
 * segurança é pior do que não mover.
 */
export async function registrarInicio(
  raiz: string,
  movimentacao: Movimentacao,
  tipo: TipoMovimentacao
): Promise<void> {
  const registros = await ler()
  registros.push({ ...movimentacao, raiz, tipo, estado: 'iniciada' })
  await gravar(registros)
}

/**
 * Fecha o registro aberto pelo `registrarInicio`, em silêncio.
 *
 * Só é chamado depois que o disco já respondeu, e aí transformar uma falha de
 * gravação em exceção faria a tela dizer que nada aconteceu quando aconteceu.
 * O registro é atualizado no lugar em vez de virar uma segunda entrada: assim a
 * última posição da lista é sempre uma operação, nunca uma confirmação.
 */
export async function registrarDesfecho(
  raiz: string,
  movimentacao: Movimentacao,
  tipo: TipoMovimentacao,
  estado: Exclude<EstadoMovimentacao, 'iniciada'>
): Promise<void> {
  try {
    const registros = await ler()
    const alvo = registros.findLastIndex(
      (registro) =>
        registro.estado === 'iniciada' &&
        registro.tipo === tipo &&
        registro.de === movimentacao.de &&
        registro.para === movimentacao.para &&
        mesmoCaminho(registro.raiz, raiz)
    )
    if (alvo < 0) return

    registros[alvo] = { ...registros[alvo], estado }
    await gravar(registros)
  } catch {
    /* histórico é rastro; o que valia foi gravado antes de mover */
  }
}

/**
 * A movimentação que o `Ctrl` + `Z` reverteria neste mapa, ou `null`.
 *
 * Se a última operação já é um "desfazer", não há o que desfazer — senão o
 * atalho viraria um ping-pong movendo a pasta de um lado para o outro sem fim.
 * Operações abortadas somem daqui: elas não chegaram a mudar o disco.
 */
export async function ultimaMovimentacao(raiz: string): Promise<Movimentacao | null> {
  const doMapa = (await ler()).filter(
    (registro) => registro.estado !== 'falhou' && mesmoCaminho(registro.raiz, raiz)
  )

  const ultima = doMapa.at(-1)
  if (!ultima || ultima.tipo === 'desfazer') return null
  return { em: ultima.em, de: ultima.de, para: ultima.para }
}
