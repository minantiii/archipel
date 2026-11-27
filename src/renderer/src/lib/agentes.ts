import type { Agente, Conversa, MotorAgente, Time } from '@shared/types'

/**
 * O estado de cada agente, como o mapa mostra: deriva das conversas no disco e
 * das abas abertas no terminal. Puro, para testar sem tela.
 */

export type StatusAgente = 'parado' | 'sessao' | 'trabalhando' | 'terminou' | 'falhou'

/** Por quanto tempo um "terminou"/"falhou" fica aceso no barco. */
export const RECENTE_MS = 10 * 60 * 1000

export interface Barco {
  nome: string
  motor: MotorAgente
  /** Ilha onde ancora. `null` = no centro do mapa. */
  ilha: string | null
  status: StatusAgente
}

/** Tarefa em andamento, desenhada como uma linha de um barco até o outro. */
export interface Rota {
  de: string
  para: string
}

function statusDe(
  agente: Agente,
  conversas: readonly Conversa[],
  abertos: ReadonlySet<string>,
  agora: number
): StatusAgente {
  const recebidas = conversas.filter((c) => c.para === agente.nome)
  if (recebidas.some((c) => c.status === 'trabalhando')) return 'trabalhando'
  if (abertos.has(agente.nome)) return 'sessao'
  // As conversas vêm da mais nova para a mais velha.
  const ultima = recebidas[0]
  if (ultima && ultima.status !== 'trabalhando') {
    const fim = Date.parse(ultima.fim ?? ultima.inicio)
    if (Number.isFinite(fim) && agora - fim < RECENTE_MS) return ultima.status
  }
  return 'parado'
}

export function barcosDoTime(
  time: Time | null,
  abertos: ReadonlySet<string>,
  ilhasExistentes: ReadonlySet<string>,
  agora = Date.now()
): Barco[] {
  if (!time) return []
  return time.agentes.map((agente) => ({
    nome: agente.nome,
    motor: agente.motor,
    ilha: agente.ilha && ilhasExistentes.has(agente.ilha) ? agente.ilha : null,
    status: statusDe(agente, time.conversas, abertos, agora)
  }))
}

/** Tarefas em andamento entre dois agentes que existem (quem pediu pode ser você, num terminal). */
export function rotasDoTime(time: Time | null): Rota[] {
  if (!time) return []
  const nomes = new Set(time.agentes.map((a) => a.nome))
  return time.conversas
    .filter((c) => c.status === 'trabalhando' && nomes.has(c.de) && nomes.has(c.para))
    .map((c) => ({ de: c.de, para: c.para }))
}
