import { forceCollide, forceX, forceY } from 'd3-force'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import type { Mapa, Ilha } from '@shared/types'
import { useTamanho } from '../hooks/useTamanho'
import { posicaoLivre, raioDaIlha } from '../lib/colisao'
import { diasSemUso, frescor } from '../lib/datas'
import { IconeEnquadrar } from './Icones'
import { TIPO_ARRASTE } from './Sidebar'

/**
 * O palco: o mapa desenhado, com as ilhas se acomodando por força-dirigida.
 *
 * Detalhe que faz toda a diferença: os objetos de ilha são **reaproveitados**
 * entre recarregamentos. O d3-force guarda posição e velocidade dentro deles,
 * então recriar a lista a cada carregamento faria o mapa inteiro pular e se
 * reorganizar do zero toda vez que um `.md` mudasse.
 */

// Cinzas neutros, do mesmo tom do fundo — ilha sem tag não deve puxar para cor
// nenhuma, senão parece que tem um significado que não tem.
const COR_NEUTRA = '#6b6b78'
const COR_AUSENTE = '#4a4a55'
const COR_PONTE = '#3a3a45'
const COR_ROTULO = '#d8d8e0'
const COR_ROTULO_AUSENTE = '#7a7a86'

/** Intervalo máximo entre dois cliques na mesma ilha para contar como duplo. */
const JANELA_DUPLO_MS = 400

/** Opacidade de uma ilha apagada pelo hover ou pelo filtro. */
const ALPHA_APAGADO = 0.13

/**
 * Teto de zoom do enquadramento e a folga deixada nas bordas, em pixels.
 *
 * O teto existe porque num mapa de poucas pastas o ajuste perfeito aproxima
 * demais — as ilhas saem gigantes e o desenho perde a cara de mapa.
 */
const ZOOM_MAXIMO = 1.6
const MARGEM_ENQUADRAMENTO = 80

/**
 * Fração do caminho percorrida por quadro **a 60 Hz**.
 *
 * A referência é 60 Hz e não "por quadro" porque `aproximar` converte isso para
 * o tempo real decorrido. Antes era literal por quadro, e num monitor de 144 Hz
 * tudo corria 2,4× mais rápido — o mesmo hover parecia seco numa máquina e
 * arrastado na outra.
 */
const PASSO = 0.16
const QUADRO_MS = 1000 / 60

/**
 * Mola do realce: `RIGIDEZ` puxa em direção ao alvo, `AMORTECIMENTO` segura.
 *
 * Estes dois passam um pouco do alvo antes de assentar, e é esse exagero curto
 * que faz o destaque parecer que acendeu em vez de só aparecer. É a mesma
 * sensação da curva `--mola` do CSS, para o canvas não destoar do resto.
 */
const RIGIDEZ_REALCE = 0.19
const AMORTECIMENTO_REALCE = 0.74

/** Faixa de zoom em que o rótulo aparece, em vez de piscar num limiar seco. */
const ROTULO_INICIO = 0.35
const ROTULO_FIM = 0.62

interface IlhaVisual {
  id: string
  dados: Ilha
  cor: string
  grau: number
  x?: number
  y?: number
  fx?: number
  fy?: number
  /**
   * Estado visual animado, guardado na própria ilha porque estes objetos
   * sobrevivem aos recarregamentos (veja o comentário do topo). Assim acender e
   * apagar viram transições em vez de saltos.
   */
  alpha?: number
  realce?: number
  /** Velocidade da mola do realce. Sem ela não há mola, só suavização. */
  realceVel?: number
  /** 0 → 1 na estreia da ilha, para ela crescer no lugar em vez de aparecer pronta. */
  nascimento?: number
  /**
   * Quanto a ilha ainda brilha, pelo tempo sem uso. Calculado no carregamento e
   * não a cada quadro: só muda quando o `.md` muda, que é quando o mapa recarrega.
   */
  frescor?: number
}

/**
 * Caminha `atual` na direção de `alvo` — a interpolação da maioria das animações.
 *
 * `passos` é quantos quadros de 60 Hz couberam no último frame real, e é ele que
 * torna a suavização independente da taxa de atualização do monitor.
 */
function aproximar(atual: number, alvo: number, passos: number): number {
  const fator = 1 - Math.pow(1 - PASSO, passos)
  const proximo = atual + (alvo - atual) * fator
  return Math.abs(alvo - proximo) < 0.002 ? alvo : proximo
}

/**
 * Avança o realce por uma mola, guardando posição e velocidade na própria ilha.
 *
 * Integra em sub-passos de um quadro porque mola não escala por multiplicação
 * como a suavização exponencial: dobrar o passo de uma vez muda o overshoot e,
 * num quadro longo, faz a mola explodir em vez de desacelerar.
 */
function molejarRealce(ilha: IlhaVisual, alvo: number, passos: number): void {
  let pos = ilha.realce ?? 0
  let vel = ilha.realceVel ?? 0

  for (let restante = passos; restante > 0; restante -= 1) {
    const p = Math.min(1, restante)
    vel = (vel + (alvo - pos) * RIGIDEZ_REALCE * p) * Math.pow(AMORTECIMENTO_REALCE, p)
    pos += vel * p
  }

  if (Math.abs(alvo - pos) < 0.001 && Math.abs(vel) < 0.001) {
    pos = alvo
    vel = 0
  }

  ilha.realce = pos
  ilha.realceVel = vel
}

interface PonteVisual {
  source: string | IlhaVisual
  target: string | IlhaVisual
}

function idDe(ponta: string | IlhaVisual): string {
  return typeof ponta === 'string' ? ponta : ponta.id
}

interface Props {
  mapa: Mapa
  selecionado: string | null
  /** Ilhas que passam pela busca/filtro. `null` = sem filtro, todas acesas. */
  destacados: Set<string> | null
  /** Primeira ponta escolhida no modo conexão. */
  conectandoDe: string | null
  onSelecionar: (id: string | null) => void
  onAbrir: (id: string) => void
  onFixar: (id: string, pos: { x: number; y: number } | null) => void
  onMenu: (id: string, x: number, y: number) => void
  /** Clique direito no vazio. `pos` é o ponto do mapa, para a pasta nova nascer ali. */
  onMenuDoFundo: (x: number, y: number, pos: { x: number; y: number }) => void
}

export default function Palco({
  mapa,
  selecionado,
  destacados,
  conectandoDe,
  onSelecionar,
  onAbrir,
  onFixar,
  onMenu,
  onMenuDoFundo
}: Props): React.JSX.Element {
  const [container, tamanho] = useTamanho<HTMLDivElement>()
  const metodos = useRef<ForceGraphMethods<IlhaVisual, PonteVisual> | undefined>(undefined)
  const ilhasPorId = useRef(new Map<string, IlhaVisual>())
  const jaEnquadrou = useRef(false)
  const forcasConfiguradas = useRef(false)
  const arrastouDeVerdade = useRef(false)
  const ultimoClique = useRef({ id: '', em: 0 })
  /** Instante do quadro atual, carimbado uma vez por frame para o pulso ficar em fase. */
  const relogio = useRef(0)
  /** Duração do último quadro, em múltiplos de um quadro de 60 Hz. */
  const passosDoQuadro = useRef(1)
  /** Quem desligou animação no sistema não recebe nenhuma — nem no canvas. */
  const semAnimacao = useRef(false)
  const [hover, setHover] = useState<string | null>(null)
  /** `true` só enquanto o botão esquerdo está pressionado sobre o palco. */
  const [arrastando, setArrastando] = useState(false)

  const corPorTag = useMemo(
    () => new Map(mapa.tags.map((t) => [t.nome, t.cor])),
    [mapa.tags]
  )

  const dados = useMemo(() => {
    const grau = new Map<string, number>()
    for (const ponte of mapa.pontes) {
      grau.set(ponte.origem, (grau.get(ponte.origem) ?? 0) + 1)
      grau.set(ponte.destino, (grau.get(ponte.destino) ?? 0) + 1)
    }

    const vivas = new Set(mapa.ilhas.map((i) => i.id))
    for (const id of ilhasPorId.current.keys()) {
      if (!vivas.has(id)) ilhasPorId.current.delete(id)
    }

    const desenhadas = mapa.ilhas.map((dadosIlha) => {
      const existente = ilhasPorId.current.get(dadosIlha.id)
      const ilha: IlhaVisual = existente ?? {
        id: dadosIlha.id,
        dados: dadosIlha,
        cor: COR_NEUTRA,
        grau: 0
      }

      ilha.dados = dadosIlha
      ilha.grau = grau.get(dadosIlha.id) ?? 0
      ilha.cor = dadosIlha.ausente
        ? COR_AUSENTE
        : (dadosIlha.cor ?? corPorTag.get(dadosIlha.tags[0] ?? '') ?? COR_NEUTRA)
      ilha.frescor = frescor(diasSemUso(dadosIlha))

      // `pos` no frontmatter é a posição fixada pelo usuário; sem ela, a ilha flutua.
      if (dadosIlha.pos) {
        ilha.fx = dadosIlha.pos.x
        ilha.fy = dadosIlha.pos.y
        ilha.x ??= dadosIlha.pos.x
        ilha.y ??= dadosIlha.pos.y
      } else {
        delete ilha.fx
        delete ilha.fy
      }

      ilhasPorId.current.set(dadosIlha.id, ilha)
      return ilha
    })

    const links: PonteVisual[] = mapa.pontes.map((p) => ({ source: p.origem, target: p.destino }))
    // `nodes` e `links` são os nomes que a `react-force-graph` exige no
    // `graphData` — é a fronteira com a biblioteca, não vocabulário nosso.
    return { nodes: desenhadas, links }
  }, [mapa, corPorTag])

  /** Vizinhos da ilha sob o cursor — usados para escurecer o resto. */
  const vizinhos = useMemo(() => {
    if (!hover) return null
    const perto = new Set<string>([hover])
    for (const ponte of mapa.pontes) {
      if (ponte.origem === hover) perto.add(ponte.destino)
      if (ponte.destino === hover) perto.add(ponte.origem)
    }
    return perto
  }, [hover, mapa.pontes])

  /**
   * Traz a câmera de volta para onde as ilhas estão.
   *
   * Serve a dois papéis: o enquadramento inicial e o resgate de quem afastou o
   * zoom, arrastou o palco e se perdeu no vazio — daí ela ser um botão, e não
   * só um efeito de estreia. O alvo sai do bbox das ilhas, então é impossível ela
   * parar num lugar onde não há nada para ver.
   */
  const enquadrar = useCallback(
    (duracao = 400) => {
      const fg = metodos.current
      if (!fg) return

      const bbox = fg.getGraphBbox()
      if (!bbox) return

      // É a conta do `zoomToFit` da lib, com o teto embutido. Chamar `zoomToFit`
      // e corrigir o zoom logo depois também chega no lugar certo, mas com um
      // solavanco à vista: a câmera aproximava até o ajuste natural — num mapa
      // pequeno isso passa fácil de 2× — e só então recuava até o teto. Num
      // botão de usar a toda hora, esse vaivém lê como defeito.
      const k = Math.max(
        0.01,
        Math.min(
          ZOOM_MAXIMO,
          (tamanho.largura - MARGEM_ENQUADRAMENTO * 2) / (bbox.x[1] - bbox.x[0]),
          (tamanho.altura - MARGEM_ENQUADRAMENTO * 2) / (bbox.y[1] - bbox.y[0])
        )
      )

      fg.centerAt((bbox.x[0] + bbox.x[1]) / 2, (bbox.y[0] + bbox.y[1]) / 2, duracao)
      fg.zoom(k, duracao)
    },
    [tamanho.largura, tamanho.altura]
  )

  // Enquadra o mapa inteiro na primeira vez que ele assenta, e só nela:
  // reenquadrar a cada recarga tiraria o usuário do lugar onde ele estava olhando.
  const aoParar = useCallback(() => {
    if (jaEnquadrou.current) return
    jaEnquadrou.current = true
    enquadrar()
  }, [enquadrar])

  // `Home` faz o mesmo que o botão: quem se perdeu quer a visão de volta sem
  // ter de achar um alvo de 30px com o mouse. Fora dos campos de texto, onde
  // `Home` é do cursor.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Home') return
      if (evento.ctrlKey || evento.altKey || evento.metaKey) return
      if ((evento.target as HTMLElement | null)?.matches('input, textarea')) return
      evento.preventDefault()
      enquadrar()
    }

    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [enquadrar])

  useEffect(() => {
    jaEnquadrou.current = false
  }, [mapa.raiz])

  /**
   * Espelha a preferência de "reduzir movimento" do sistema.
   *
   * O CSS já a respeita; o canvas não tem como, porque as transições dele são
   * desenhadas à mão. Num ref e não num estado: quem lê isso é o laço de
   * desenho, e virar re-render a cada mudança não traria nada.
   */
  useEffect(() => {
    const consulta = window.matchMedia('(prefers-reduced-motion: reduce)')
    const aplicar = (): void => {
      semAnimacao.current = consulta.matches
    }

    aplicar()
    consulta.addEventListener('change', aplicar)
    return () => consulta.removeEventListener('change', aplicar)
  }, [])

  /**
   * Impede o d3-zoom de sequestrar o duplo clique.
   *
   * O d3 registra `dblclick.zoom` no canvas para dar zoom, o que brigava com o
   * duplo clique que abre a pasta: a pasta abria e o mapa pulava junto. Um
   * ouvinte na fase de captura do container corta o evento antes de ele chegar
   * ao canvas. O clique simples (`click`) é outro evento e continua intacto,
   * que é por onde a abertura é detectada.
   */
  useEffect(() => {
    const elemento = container.current
    if (!elemento) return

    const bloquear = (evento: MouseEvent): void => evento.stopPropagation()
    elemento.addEventListener('dblclick', bloquear, { capture: true })
    return () => elemento.removeEventListener('dblclick', bloquear, { capture: true })
  }, [container, tamanho.largura])

  /**
   * Marca quando o palco está realmente sendo arrastado.
   *
   * O CSS fazia isso com `:active`, que não distingue botão: clicar com o
   * direito para abrir o menu já mostrava a mãozinha fechada, dizendo que algo
   * estava sendo movido quando nada estava. Só o esquerdo arrasta e dá zoom.
   *
   * Os ouvintes vão na fase de captura porque o d3-zoom corta a propagação do
   * `mousedown` no canvas — o mesmo motivo do menu de contexto.
   */
  useEffect(() => {
    const elemento = container.current
    if (!elemento) return

    const aoPressionar = (evento: MouseEvent): void => {
      if (evento.button !== 0) return
      if (!elemento.contains(evento.target as Node)) return
      setArrastando(true)
    }
    // Soltar o botão fora da janela também encerra: senão o cursor ficava preso
    // em "agarrando" até o próximo clique.
    const aoSoltar = (): void => setArrastando(false)

    window.addEventListener('mousedown', aoPressionar, true)
    window.addEventListener('mouseup', aoSoltar, true)
    window.addEventListener('blur', aoSoltar)
    return () => {
      window.removeEventListener('mousedown', aoPressionar, true)
      window.removeEventListener('mouseup', aoSoltar, true)
      window.removeEventListener('blur', aoSoltar)
    }
  }, [container])

  /** Solta uma ilha vinda da lista lateral no ponto exato onde o cursor largou. */
  const aoSoltar = useCallback(
    (evento: React.DragEvent<HTMLDivElement>) => {
      evento.preventDefault()

      const id = evento.dataTransfer.getData(TIPO_ARRASTE)
      const fg = metodos.current
      const elemento = container.current
      if (!id || !fg || !elemento) return

      const area = elemento.getBoundingClientRect()
      const bruto = fg.screen2GraphCoords(evento.clientX - area.left, evento.clientY - area.top)

      const ilha = ilhasPorId.current.get(id)
      if (!ilha) return

      // Soltar em cima de uma ilha já fixada esconderia uma dentro da outra.
      const ponto = posicaoLivre(ilha, bruto.x, bruto.y, ilhasPorId.current.values())

      // Move na hora para o ponto solto, sem esperar o disco responder.
      ilha.x = ponto.x
      ilha.y = ponto.y
      ilha.fx = ponto.x
      ilha.fy = ponto.y

      onSelecionar(id)
      onFixar(id, ponto)
    },
    [container, onFixar, onSelecionar]
  )

  /**
   * Ajuste das forças do d3.
   *
   * O padrão do componente espalha demais: pastas sem conexão nenhuma — que aqui
   * são a maioria no começo — saem voando para longe e espremem o cluster
   * conectado num cantinho ilegível. `forceX`/`forceY` puxam tudo de volta para o
   * centro e `forceCollide` garante que ilha e rótulo não se sobreponham.
   */
  useEffect(() => {
    // Configura uma vez só. Rodar de novo a cada mudança de largura fazia o
    // `d3ReheatSimulation` reaquecer a simulação sempre que o painel de detalhes
    // abria e encolhia o palco — as ilhas saíam andando debaixo do cursor, e um
    // duplo clique nunca chegava a acontecer na mesma ilha.
    if (forcasConfiguradas.current) return

    const fg = metodos.current
    if (!fg) return
    forcasConfiguradas.current = true

    fg.d3Force('charge')?.strength(-190).distanceMax(520)
    fg.d3Force('link')?.distance(70).strength(0.75)
    fg.d3Force('center', null)
    fg.d3Force('x', forceX<IlhaVisual>(0).strength(0.055))
    fg.d3Force('y', forceY<IlhaVisual>(0).strength(0.055))
    // O raio de colisão considera o rótulo, não só o círculo: senão duas ilhas
    // próximas ficam legíveis como bolinhas mas com os nomes escritos por cima
    // uns dos outros. É uma estimativa da meia-largura do texto pelo nº de letras.
    fg.d3Force(
      'collide',
      forceCollide<IlhaVisual>((ilha) => Math.max(raioDaIlha(ilha) + 16, ilha.id.length * 3.1))
    )
    fg.d3ReheatSimulation()
    // Depende da largura porque o ForceGraph2D só monta depois que o
    // ResizeObserver mede o container — antes disso `metodos.current` é undefined.
  }, [tamanho.largura])

  const desenharIlha = useCallback(
    (ilha: IlhaVisual, ctx: CanvasRenderingContext2D, escala: number) => {
      if (ilha.x === undefined || ilha.y === undefined) return

      // Duas razões para apagar uma ilha: ela está longe do que o cursor aponta,
      // ou ficou de fora da busca/filtro ativo.
      const foraDoHover = vizinhos !== null && !vizinhos.has(ilha.id)
      const foraDoFiltro = destacados !== null && !destacados.has(ilha.id)
      const ehSelecionado = ilha.id === selecionado
      const ehHover = ilha.id === hover
      const ehOrigem = ilha.id === conectandoDe

      const alvoAlpha = foraDoHover || foraDoFiltro ? ALPHA_APAGADO : 1
      const alvoRealce = ehHover || ehSelecionado || ehOrigem ? 1 : 0
      const passos = passosDoQuadro.current

      if (semAnimacao.current) {
        ilha.alpha = alvoAlpha
        ilha.realce = alvoRealce
        ilha.realceVel = 0
        ilha.nascimento = 1
      } else {
        // Acender e apagar são transições, não interruptores: sem isto o mapa
        // inteiro pisca a cada movimento do mouse. O realce vai de mola, os
        // outros de suavização — só ele ganha com o exagero de passar do alvo.
        ilha.alpha = aproximar(ilha.alpha ?? 1, alvoAlpha, passos)
        ilha.nascimento = aproximar(ilha.nascimento ?? 0, 1, passos)
        molejarRealce(ilha, alvoRealce, passos)
      }

      // Locais para o resto do desenho: o realce passa de 1 na ida (é a mola) e
      // pode ficar um triz negativo na volta, então quem precisa de 0..1 recorta.
      const realce = ilha.realce ?? 0
      const realceRecortado = Math.min(1, Math.max(0, realce))
      const surgindo = ilha.nascimento ?? 1
      const base = raioDaIlha(ilha)
      // A ilha nasce pequena e cresce até o tamanho real. Some junto com a
      // opacidade, senão a estreia vira um ponto sólido saltando do nada.
      const raio = base * (0.45 + 0.55 * surgindo) * (1 + 0.16 * realce)

      /*
       * Pasta parada há meses vai apagando — é como o mapa mostra o que já não
       * serve para nada sem esconder nada.
       *
       * Multiplica a opacidade em vez de disputá-la: o apagar do hover e do filtro
       * continuam mandando por cima, e uma ilha esquecida *e* fora do filtro fica
       * mais apagada que cada caso sozinho, que é o que faz sentido.
       *
       * O realce cancela o esmaecimento. Apontar para a ilha é dizer "esta aqui me
       * interessa agora", e ela volta à cor cheia acompanhando a mola — sem isso, a
       * pasta que você foi olhar continuaria pálida justo na hora de lê-la.
       */
      const brilho = ilha.frescor ?? 1
      const opacidade = ilha.alpha * surgindo * (brilho + (1 - brilho) * realceRecortado)
      const aceso = ilha.dados.ausente ? COR_AUSENTE : ilha.cor

      ctx.globalAlpha = opacidade

      // Halo: um degradê radial que vaza para fora do círculo. É o que faz a ilha
      // sob o cursor parecer acesa em vez de só maior. O alcance cresce junto com
      // o realce — halo de tamanho fixo só mudando de opacidade lê como piscada.
      if (realce > 0.01) {
        const alcance = raio * (2.1 + 1.4 * realceRecortado)
        const halo = ctx.createRadialGradient(ilha.x, ilha.y, raio, ilha.x, ilha.y, alcance)
        halo.addColorStop(0, aceso)
        halo.addColorStop(1, 'transparent')
        ctx.globalAlpha = opacidade * 0.3 * realceRecortado
        ctx.beginPath()
        ctx.arc(ilha.x, ilha.y, alcance, 0, 2 * Math.PI)
        ctx.fillStyle = halo
        ctx.fill()
        ctx.globalAlpha = opacidade
      }

      ctx.beginPath()
      ctx.arc(ilha.x, ilha.y, raio, 0, 2 * Math.PI)

      if (ilha.dados.ausente) {
        // Ilha ausente é contorno tracejado: existe no mapa, não existe no disco.
        ctx.setLineDash([2, 2])
        ctx.strokeStyle = ilha.cor
        ctx.lineWidth = 1.2
        ctx.stroke()
        ctx.setLineDash([])
      } else {
        ctx.fillStyle = ilha.cor
        ctx.fill()
      }

      if (ehOrigem) {
        // Ponta de origem no modo conexão: em vez de um anel respirando parado,
        // um sonar — o anel parte da borda, se abre e some. Diz "estou esperando
        // a outra ponta" com direção, que é o que o modo pede.
        const ciclo = (relogio.current % 1400) / 1400
        const avanco = 1 - Math.pow(1 - ciclo, 2) // desacelera ao se abrir
        ctx.beginPath()
        ctx.arc(ilha.x, ilha.y, raio + 3 + avanco * 14, 0, 2 * Math.PI)
        ctx.strokeStyle = '#a48dff'
        ctx.lineWidth = 2.5 * (1 - avanco * 0.6)
        ctx.globalAlpha = opacidade * (1 - avanco)
        ctx.stroke()

        // O anel fixo continua embaixo, senão entre um sonar e outro a ponta
        // escolhida fica sem marca nenhuma.
        ctx.beginPath()
        ctx.arc(ilha.x, ilha.y, raio + 3, 0, 2 * Math.PI)
        ctx.globalAlpha = opacidade
        ctx.lineWidth = 2
        ctx.stroke()
      } else if (ehSelecionado) {
        // O anel acompanha a mola do realce: acende junto com a ilha em vez de
        // aparecer inteiro de uma vez.
        ctx.beginPath()
        ctx.arc(ilha.x, ilha.y, raio + 2.5 + 1.5 * realceRecortado, 0, 2 * Math.PI)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.globalAlpha = opacidade * (0.45 + 0.55 * realceRecortado)
        ctx.stroke()
        ctx.globalAlpha = opacidade
      } else if (ilha.fx !== undefined) {
        // Anel discreto marcando que a posição está fixada.
        ctx.beginPath()
        ctx.arc(ilha.x, ilha.y, raio + 2.5, 0, 2 * Math.PI)
        ctx.strokeStyle = 'rgba(255,255,255,0.28)'
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // Com muito zoom-out o texto vira borrão. Some numa faixa em vez de num
      // limiar: no limiar seco, uma rolagem lenta do zoom fazia a legenda inteira
      // do mapa piscar de uma vez. Quem está sob o cursor ou selecionado mantém
      // o rótulo em qualquer zoom.
      const visibilidadeRotulo = Math.max(
        ehSelecionado || ehHover ? 1 : 0,
        Math.min(1, Math.max(0, (escala - ROTULO_INICIO) / (ROTULO_FIM - ROTULO_INICIO)))
      )

      if (visibilidadeRotulo > 0.01) {
        const tamanhoFonte = Math.min(13, 11 / escala)
        const peso = 400 + Math.round(realceRecortado * 200)
        ctx.font = `${peso} ${tamanhoFonte}px 'Segoe UI', system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = ilha.dados.ausente ? COR_ROTULO_AUSENTE : COR_ROTULO
        ctx.globalAlpha = opacidade * visibilidadeRotulo
        ctx.fillText(ilha.id, ilha.x, ilha.y + raio + 4)
      }

      ctx.globalAlpha = 1
    },
    [vizinhos, destacados, selecionado, conectandoDe, hover]
  )

  // Área de clique: sem isso o hit-testing usaria um raio padrão que não bate
  // com o círculo desenhado.
  const areaDeClique = useCallback(
    (ilha: IlhaVisual, cor: string, ctx: CanvasRenderingContext2D) => {
      if (ilha.x === undefined || ilha.y === undefined) return
      ctx.fillStyle = cor
      ctx.beginPath()
      ctx.arc(ilha.x, ilha.y, raioDaIlha(ilha) + 4, 0, 2 * Math.PI)
      ctx.fill()
    },
    []
  )

  /** `true` quando a ponte toca a ilha sob o cursor. */
  const naVizinhanca = useCallback(
    (ponte: PonteVisual) =>
      vizinhos !== null &&
      vizinhos.has(idDe(ponte.source)) &&
      vizinhos.has(idDe(ponte.target)),
    [vizinhos]
  )

  const corDaPonte = useCallback(
    (ponte: PonteVisual) => {
      if (!vizinhos) return COR_PONTE
      return naVizinhanca(ponte) ? '#8c7bff' : 'rgba(58,58,69,0.2)'
    },
    [vizinhos, naVizinhanca]
  )

  const larguraDaPonte = useCallback(
    (ponte: PonteVisual) => (naVizinhanca(ponte) ? 1.8 : 1),
    [naVizinhanca]
  )

  /**
   * Partículas correndo pelas pontes da ilha sob o cursor.
   *
   * É a única animação que conta algo novo: mostra quais pontes saem dali sem
   * precisar ler rótulo nenhum. Fora do hover, zero — o mapa parado fica parado.
   */
  const particulasDaPonte = useCallback(
    (ponte: PonteVisual) => (naVizinhanca(ponte) ? 2 : 0),
    [naVizinhanca]
  )

  return (
    <div
      ref={container}
      // As duas classes são o que faz o cursor dizer a verdade: `sobre-ilha`
      // devolve a mãozinha só sobre uma ilha (a lib acende `pointer` no canvas
      // inteiro), e `arrastando` mostra a mão fechada só quando algo está
      // mesmo sendo movido. Veja o CSS.
      className={['palco', hover && 'sobre-ilha', arrastando && 'arrastando']
        .filter(Boolean)
        .join(' ')}
      onDragOver={(evento) => {
        // Só aceita o que veio da lista lateral; sem o preventDefault o drop nem acontece.
        if (!evento.dataTransfer.types.includes(TIPO_ARRASTE)) return
        evento.preventDefault()
        evento.dataTransfer.dropEffect = 'move'
      }}
      onDrop={aoSoltar}
    >
      {tamanho.largura > 0 && (
        <ForceGraph2D<IlhaVisual, PonteVisual>
          ref={metodos}
          width={tamanho.largura}
          height={tamanho.altura}
          graphData={dados}
          backgroundColor="transparent"
          nodeRelSize={1}
          nodeCanvasObject={desenharIlha}
          nodePointerAreaPaint={areaDeClique}
          linkColor={corDaPonte}
          linkWidth={larguraDaPonte}
          linkDirectionalParticles={particulasDaPonte}
          linkDirectionalParticleSpeed={0.006}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleColor={() => '#a48dff'}
          // Por padrão a lib para de repintar quando a simulação esfria — e aí
          // halo, pulso e transições congelariam no meio. O custo é um canvas
          // repintando a 60fps, que para um mapa de dezenas de pastas não pesa.
          autoPauseRedraw={false}
          // Um carimbo de tempo por quadro: assim todos as ilhas pulsam em fase,
          // e a diferença para o quadro anterior dá o passo de tempo das animações.
          onRenderFramePre={() => {
            const agora = performance.now()
            const anterior = relogio.current
            relogio.current = agora
            // O teto de 3 quadros cobre o primeiro frame e a volta de segundo
            // plano, quando o intervalo é enorme: sem ele a animação teleportaria
            // para o fim em vez de continuar de onde parou.
            passosDoQuadro.current = anterior === 0 ? 1 : Math.min(3, (agora - anterior) / QUADRO_MS)
          }}
          /*
           * Quanto tempo o mapa continua se acomodando depois de um arraste.
           *
           * Arrastar uma ilha zera esta contagem, então ela é literalmente o tempo
           * que se espera para o mapa parar. Com os 180 originais dava quase 4
           * segundos de vizinhas andando — tempo em que clicar numa delas vira
           * perseguição. Com o `alphaDecay` abaixo, a simulação já esfriou bem antes
           * de 90 ticks, então este teto corta o rabo morto, não o movimento útil.
           *
           * **Não troque isto por `d3AlphaMin`.** Ele parece o controle certo — parar
           * quando a simulação esfriou — mas o `layoutTick` da biblioteca compara o
           * alpha *antes* de avançar a simulação. O alpha congela logo abaixo do
           * mínimo, e a partir daí todo reaquecimento morre no mesmo quadro em que
           * nasce, sem nunca tickar: arrastar uma ilha deixa de afastar as vizinhas.
           */
          cooldownTicks={90}
          d3AlphaDecay={0.045}
          d3VelocityDecay={0.4}
          onEngineStop={aoParar}
          onNodeHover={(ilha) => setHover(ilha?.id ?? null)}
          onNodeClick={(ilha, evento) => {
            if (evento.altKey) {
              delete ilha.fx
              delete ilha.fy
              onFixar(ilha.id, null)
              return
            }

            // O duplo clique é medido à mão porque o componente entrega um
            // `pointerup`, e não um `click`: em PointerEvent o `detail` é sempre
            // 0, então contar cliques por ele nunca funcionaria.
            const agora = Date.now()
            const ehDuplo =
              ultimoClique.current.id === ilha.id && agora - ultimoClique.current.em < JANELA_DUPLO_MS

            // Zera o instante após abrir, senão um terceiro clique abriria de novo.
            ultimoClique.current = { id: ilha.id, em: ehDuplo ? 0 : agora }

            if (ehDuplo) {
              onAbrir(ilha.id)
              return
            }
            onSelecionar(ilha.id)
          }}
          onNodeRightClick={(ilha, evento) => {
            onSelecionar(ilha.id)
            onMenu(ilha.id, evento.clientX, evento.clientY)
          }}
          onBackgroundClick={() => onSelecionar(null)}
          onBackgroundRightClick={(evento) => {
            const fg = metodos.current
            const elemento = container.current
            if (!fg || !elemento) return

            // Converte o pixel da tela para coordenada do mapa, do mesmo jeito
            // que o soltar da lista lateral faz: a pasta nova nasce exatamente
            // onde o usuário apontou, não num canto qualquer.
            const area = elemento.getBoundingClientRect()
            const ponto = fg.screen2GraphCoords(
              evento.clientX - area.left,
              evento.clientY - area.top
            )
            onMenuDoFundo(evento.clientX, evento.clientY, { x: ponto.x, y: ponto.y })
          }}
          onNodeDrag={(_no, deslocamento) => {
            if (Math.hypot(deslocamento.x, deslocamento.y) > 3) arrastouDeVerdade.current = true
          }}
          onNodeDragEnd={(ilha) => {
            // Um duplo clique também conta como arraste de deslocamento zero.
            // Sem esta guarda, abrir a pasta fixava a ilha sem querer.
            const moveu = arrastouDeVerdade.current
            arrastouDeVerdade.current = false
            if (!moveu) return

            // Arrastar fixa: o layout automático não pode roubar de volta a pasta
            // que o usuário acabou de colocar num canto de propósito.
            if (ilha.x === undefined || ilha.y === undefined) return

            // Largar em cima de outra fixada empilharia as duas: quem chega é
            // que sai do caminho, para o resto do arranjo continuar onde estava.
            const ponto = posicaoLivre(ilha, ilha.x, ilha.y, ilhasPorId.current.values())
            ilha.x = ponto.x
            ilha.y = ponto.y
            ilha.fx = ponto.x
            ilha.fy = ponto.y
            onFixar(ilha.id, ponto)
          }}
        />
      )}

      {/* Só aparece havenda ilha para enquadrar: num mapa vazio o botão não teria
          para onde levar, e um controle que não faz nada é pior que ausência. */}
      {mapa.ilhas.length > 0 && (
        <button
          type="button"
          className="botao-enquadrar"
          onClick={() => enquadrar()}
          title="Centralizar a visão nas ilhas (Home)"
          aria-label="Centralizar a visão nas ilhas"
        >
          <IconeEnquadrar tamanho={17} />
        </button>
      )}

      <div className="dica-mapa">
        arraste uma ilha para fixá-la · <kbd>Alt</kbd> + clique solta · duplo clique abre a pasta ·
        arraste da lista para posicionar
      </div>
    </div>
  )
}
