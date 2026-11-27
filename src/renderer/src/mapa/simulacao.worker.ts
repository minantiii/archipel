import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from 'd3-force'
import type { DaSimulacao, NoDaSimulacao, ParaSimulacao } from './protocolo'

/**
 * A física do mapa, fora da linha da tela.
 *
 * Os números são os mesmos que o mapa usava com a `react-force-graph`, para o
 * arranjo continuar com a mesma cara: o que muda é onde a conta roda.
 */

/**
 * O pedaço do escopo do worker que usamos. Declarado à mão porque o projeto
 * compila com os tipos do DOM, e misturar com os de `webworker` dá conflito.
 */
const escopo = self as unknown as {
  postMessage(mensagem: unknown, transferir: Transferable[]): void
  onmessage: ((evento: MessageEvent<ParaSimulacao>) => void) | null
  requestAnimationFrame?: (fn: () => void) => number
}

interface No extends SimulationNodeDatum {
  id: string
  colisao: number
}

type Ligacao = SimulationLinkDatum<No>

/**
 * Quantos ticks a simulação ainda roda depois do último empurrão.
 *
 * Arrastar zera a contagem. Com o `alphaDecay` abaixo a simulação já esfriou
 * bem antes disso, então o teto corta o rabo morto, não o movimento útil.
 */
const TICKS_DE_ESFRIAMENTO = 90

/** Reaquecimento durante o arraste, igual ao `alphaTarget(0.3)` padrão do d3. */
const ALVO_NO_ARRASTE = 0.3

const simulacao = forceSimulation<No, Ligacao>([])
  .alphaDecay(0.045)
  .velocityDecay(0.4)
  .force('charge', forceManyBody<No>().strength(-190).distanceMax(520))
  .force('link', forceLink<No, Ligacao>([]).distance(70).strength(0.75))
  .force('x', forceX<No>(0).strength(0.055))
  .force('y', forceY<No>(0).strength(0.055))
  .force(
    'collide',
    forceCollide<No>((no) => no.colisao)
  )
  // O laço é nosso: o timer do d3 não sabe pausar quando a janela some.
  .stop()

const porId = new Map<string, No>()
let versao = 0
let ticksRestantes = 0
let rodando = false
let pausado = false

const proximoQuadro: (fn: () => void) => void =
  typeof escopo.requestAnimationFrame === 'function'
    ? (fn) => escopo.requestAnimationFrame?.(fn)
    : (fn) => setTimeout(fn, 16)

function enviar(mensagem: DaSimulacao, transferir: Transferable[] = []): void {
  escopo.postMessage(mensagem, transferir)
}

function publicarPosicoes(): void {
  const nos = simulacao.nodes()
  const buffer = new Float32Array(nos.length * 2)
  for (let i = 0; i < nos.length; i++) {
    buffer[i * 2] = nos[i].x ?? 0
    buffer[i * 2 + 1] = nos[i].y ?? 0
  }
  enviar({ tipo: 'posicoes', versao, buffer }, [buffer.buffer])
}

function quadro(): void {
  if (pausado) {
    rodando = false
    return
  }

  const arrastando = simulacao.alphaTarget() > 0
  if (ticksRestantes <= 0 && !arrastando) {
    rodando = false
    enviar({ tipo: 'parou', versao })
    return
  }

  simulacao.tick()
  ticksRestantes--
  publicarPosicoes()
  proximoQuadro(quadro)
}

function acordar(): void {
  ticksRestantes = TICKS_DE_ESFRIAMENTO
  if (rodando || pausado) return
  rodando = true
  proximoQuadro(quadro)
}

function aplicarGrafo(nos: NoDaSimulacao[], pontes: [number, number][], aquecer: number): void {
  const vivos = new Set(nos.map((n) => n.id))
  for (const id of porId.keys()) if (!vivos.has(id)) porId.delete(id)

  // Reaproveita o objeto de cada ilha: é nele que o d3 guarda a velocidade, e
  // recriar faria o mapa todo dar um tranco a cada recarga.
  const lista = nos.map((dado) => {
    const no = porId.get(dado.id) ?? { id: dado.id, colisao: dado.colisao }
    no.colisao = dado.colisao
    if (dado.x !== undefined && dado.y !== undefined && no.x === undefined) {
      no.x = dado.x
      no.y = dado.y
    }
    if (dado.fx !== undefined && dado.fy !== undefined) {
      no.fx = dado.fx
      no.fy = dado.fy
      no.x = dado.fx
      no.y = dado.fy
    } else {
      no.fx = null
      no.fy = null
    }
    porId.set(dado.id, no)
    return no
  })

  simulacao.nodes(lista)
  simulacao
    .force<ReturnType<typeof forceLink<No, Ligacao>>>('link')
    ?.links(pontes.map(([a, b]) => ({ source: lista[a], target: lista[b] })))
  // O raio de colisão é lido no `initialize`; sem isso ilha nova colidiria com raio velho.
  simulacao.force<ReturnType<typeof forceCollide<No>>>('collide')?.radius((no) => no.colisao)

  simulacao.alpha(Math.max(simulacao.alpha(), aquecer))
  publicarPosicoes()
  acordar()
}

escopo.onmessage = (evento: MessageEvent<ParaSimulacao>): void => {
  const msg = evento.data

  switch (msg.tipo) {
    case 'grafo':
      versao = msg.versao
      aplicarGrafo(msg.nos, msg.pontes, msg.aquecer)
      return

    case 'arrastar': {
      const no = porId.get(msg.id)
      if (!no) return
      no.fx = msg.x
      no.fy = msg.y
      simulacao.alphaTarget(ALVO_NO_ARRASTE)
      acordar()
      return
    }

    case 'fimArraste': {
      const no = porId.get(msg.id)
      simulacao.alphaTarget(0)
      if (no) {
        no.fx = msg.fixo?.x ?? null
        no.fy = msg.fixo?.y ?? null
        if (msg.fixo) {
          no.x = msg.fixo.x
          no.y = msg.fixo.y
        }
      }
      acordar()
      return
    }

    case 'fixar': {
      const no = porId.get(msg.id)
      if (!no) return
      no.fx = no.x = msg.x
      no.fy = no.y = msg.y
      // As vizinhas precisam saber que alguém chegou e abrir espaço.
      simulacao.alpha(Math.max(simulacao.alpha(), 0.3))
      acordar()
      return
    }

    case 'soltar': {
      const no = porId.get(msg.id)
      if (!no) return
      no.fx = null
      no.fy = null
      // Solta e deixa a física levar a ilha de volta ao lugar natural dela.
      simulacao.alpha(1)
      acordar()
      return
    }

    case 'pausar':
      pausado = msg.pausado
      if (!pausado && ticksRestantes > 0) acordar()
      return
  }
}
