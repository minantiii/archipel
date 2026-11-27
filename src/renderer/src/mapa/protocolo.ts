/**
 * Mensagens trocadas entre o motor do mapa (tela) e a simulação (worker).
 *
 * A física roda num Web Worker para nunca disputar a linha da tela: o motor só
 * desenha, e quando a simulação pesa é o worker que atrasa, não o mouse. É o
 * mesmo desenho do grafo do Obsidian (simulação num worker, desenho em WebGL).
 *
 * As ilhas viajam por **índice**, na ordem do último `grafo` enviado. As
 * posições voltam num `Float32Array` transferido (sem cópia) com `x, y` por
 * ilha, e a `versao` deixa o motor descartar um buffer que ainda era do grafo
 * anterior.
 */

export interface NoDaSimulacao {
  id: string
  x?: number
  y?: number
  /** Posição fixada. Ilha fixada não se move, mas empurra as vizinhas. */
  fx?: number
  fy?: number
  /** Raio de colisão: o círculo mais a meia-largura estimada do rótulo. */
  colisao: number
}

export type ParaSimulacao =
  | {
      tipo: 'grafo'
      versao: number
      nos: NoDaSimulacao[]
      /** Pares de índices em `nos`. */
      pontes: [number, number][]
      /** Quanto reaquecer: 1 quando entra ou sai ilha, menos quando só muda ponte ou fixação. */
      aquecer: number
    }
  /** A ilha está sendo arrastada: fica presa ao mouse e as vizinhas abrem espaço. */
  | { tipo: 'arrastar'; id: string; x: number; y: number }
  /** Fim do arraste. `fixo` é onde ela fica presa; `null` devolve a ilha à física. */
  | { tipo: 'fimArraste'; id: string; fixo: { x: number; y: number } | null }
  | { tipo: 'fixar'; id: string; x: number; y: number }
  | { tipo: 'soltar'; id: string }
  | { tipo: 'pausar'; pausado: boolean }

export type DaSimulacao =
  | { tipo: 'posicoes'; versao: number; buffer: Float32Array }
  /** A simulação esfriou e parou de mandar posições. */
  | { tipo: 'parou'; versao: number }
