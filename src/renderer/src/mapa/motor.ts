// Sem isto o PixiJS gera código com `new Function`, que a CSP do app barra.
import 'pixi.js/unsafe-eval'
import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js'
import type { Ilha, Mapa } from '@shared/types'
import { posicaoLivre, raioDaIlha } from '../lib/colisao'
import { diasSemUso, frescor } from '../lib/datas'
import { corNoTema, PALETAS, type PaletaDoMapa, type TemaId } from '../lib/tema'
import type { Barco, Rota } from '../lib/agentes'
import { CamadaDeBarcos } from './barcos'
import type { DaSimulacao, NoDaSimulacao, ParaSimulacao } from './protocolo'
import SimulacaoWorker from './simulacao.worker?worker&inline'

/**
 * O motor do mapa: desenho, câmera e mouse, sem React no caminho.
 *
 * A divisão é a mesma do grafo do Obsidian:
 * - a **física** roda num Web Worker (`simulacao.worker.ts`) e devolve só as
 *   posições, então uma conta pesada atrasa o worker, nunca o mouse;
 * - o **desenho** é WebGL (PixiJS): cada ilha é um objeto que a placa de vídeo
 *   desenha em lote, em vez de o processador repintar um canvas 2D inteiro;
 * - o **laço** é nosso: pinta enquanto algo se move e dorme quando o mapa
 *   para. Hover, seleção e filtro mudam o desenho sem passar pelo React.
 *
 * O que o mapa fazia antes continua igual: mola do realce, halo, sonar do modo
 * conexão, partículas nas pontes do hover, esmaecer pasta sem uso, arrastar para
 * fixar, Alt+clique para soltar, duplo clique para abrir.
 */

// As cores vêm do tema (`lib/tema.ts`): o WebGL não lê variável CSS.

/** Lado, em pixels, do ladrilho do padrão de ondas (seigaiha). */
const LADO_ONDAS = 96
/** Quanto o mar anda com a câmera: menos que as ilhas, para parecer mais fundo. */
const PARALAXE_ONDAS = 0.55
/** Deriva lenta do mar, em pixels por segundo. */
const DERIVA_ONDAS = 4

// --- Tempo e animação --------------------------------------------------------

/** Intervalo máximo entre dois cliques na mesma ilha para contar como duplo. */
const JANELA_DUPLO_MS = 400
/** Opacidade de uma ilha apagada pelo hover ou pelo filtro. */
const ALPHA_APAGADO = 0.13
/** Fração do caminho percorrida por quadro a 60 Hz (convertida para o tempo real). */
const PASSO = 0.16
const QUADRO_MS = 1000 / 60
/** Mola do realce: passa um pouco do alvo, e é isso que faz parecer que acendeu. */
const RIGIDEZ_REALCE = 0.19
const AMORTECIMENTO_REALCE = 0.74
/** Acima disso o laço esteve parado, e o silêncio não conta como tempo de animação. */
const PAUSA_MS = 100
/** Diferença, em unidades do mapa, abaixo da qual duas posições são a mesma. */
const FOLGA_POSICAO = 0.5
/** Distância, em pixels, que separa um clique de um arraste. */
const LIMIAR_ARRASTE = 3

// --- Câmera ------------------------------------------------------------------

/** Teto de zoom do enquadramento: num mapa pequeno o ajuste perfeito aproxima demais. */
const ZOOM_ENQUADRAMENTO = 1.6
const MARGEM_ENQUADRAMENTO = 80
const ZOOM_MINIMO = 0.05
const ZOOM_MAXIMO = 12
/** Quanto da distância até o alvo a câmera anda por quadro de 60 Hz. */
const SUAVIDADE_CAMERA = 0.2

// --- Flutuação ---------------------------------------------------------------

/**
 * Quanto cada ilha boia em volta do próprio lugar, em unidades do mapa.
 *
 * É só desenho: a posição da física, a fixada e a gravada no `.md` não mudam.
 * Pequeno o bastante para o mapa continuar com cada ilha no seu canto, grande o
 * bastante para ele parecer vivo em vez de impresso.
 */
const AMPLITUDE_FLUTUACAO = 3
/** Período de uma volta, em ms. Cada ilha sorteia o seu nessa faixa, pelo nome. */
const PERIODO_MIN_MS = 5000
const PERIODO_MAX_MS = 9000
/** Com só a flutuação se mexendo, ~30 quadros por segundo bastam e gastam metade. */
const INTERVALO_SO_FLUTUANDO_MS = 32
/** Quanto da velocidade do arraste do palco sobra por quadro de 60 Hz, depois de soltar. */
const ATRITO_INERCIA = 0.9

// --- Rótulos -----------------------------------------------------------------

/** Faixa de zoom em que o rótulo aparece, em vez de piscar num limiar seco. */
const ROTULO_INICIO = 0.35
const ROTULO_FIM = 0.62
/** Tamanho em que o texto é rasterizado; a escala do objeto faz o resto. */
const FONTE_BASE = 15

// --- Partículas ---------------------------------------------------------------

/** Fração da ponte percorrida por milissegundo (0,006 por quadro de 60 Hz). */
const VELOCIDADE_PARTICULA = 0.006 / QUADRO_MS
const PARTICULAS_POR_PONTE = 2

/** Raio, em pixels, das texturas geradas. A escala do sprite leva ao tamanho real. */
const RAIO_TEXTURA = 64
/** Raio do círculo desenhado no `Graphics` do corpo; a escala leva ao raio real. */
const RAIO_CORPO = 10

export interface EstadoDoPalco {
  selecionado: string | null
  /** Ilhas que passam pela busca/filtro. `null` = sem filtro, todas acesas. */
  destacados: Set<string> | null
  /** Primeira ponta escolhida no modo conexão. */
  conectandoDe: string | null
}

export interface AcoesDoPalco {
  onClicar: (id: string) => void
  onSelecionar: (id: string | null) => void
  onAbrir: (id: string) => void
  onFixar: (id: string, pos: { x: number; y: number } | null) => void
  onMenu: (id: string, x: number, y: number) => void
  onMenuDoFundo: (x: number, y: number, pos: { x: number; y: number }) => void
  /** Clique num barco do time de agentes. */
  onBarco: (nome: string) => void
}

interface IlhaVisual {
  id: string
  dados: Ilha
  cor: string
  grau: number
  x?: number
  y?: number
  fx?: number
  fy?: number
  alpha: number
  realce: number
  realceVel: number
  /** 0 → 1 na estreia, para a ilha crescer no lugar em vez de aparecer pronta. */
  nascimento: number
  /** 0 → 1: quanto a ilha está boiando agora. Some no hover e no arraste. */
  flutuacao: number
  /** Ritmo próprio da flutuação, tirado do nome para não mudar entre aberturas. */
  ondas: { fx: number; fy: number; px: number; py: number }
  /** Quanto a ilha ainda brilha pelo tempo sem uso. Muda só quando o `.md` muda. */
  frescor: number
  halo: Sprite
  corpo: Graphics
  rotulo: Text
  /** O que está desenhado no `corpo` agora, para só redesenhar quando muda. */
  corpoDesenhado: string
  pesoRotulo: string
}

interface PonteVisual {
  chave: string
  a: IlhaVisual
  b: IlhaVisual
  /** 0 → 1: a ponte toca a ilha sob o cursor. */
  foco: number
  /** 0 → 1: há hover e a ponte não tem nada a ver com ele. */
  apagado: number
}

type Arraste =
  | {
      tipo: 'ilha'
      ilha: IlhaVisual
      inicioX: number
      inicioY: number
      moveu: boolean
      /** Onde a ilha estava presa antes, para devolver se o gesto virar clique. */
      fixoAntes: { x: number; y: number } | null
    }
  | {
      tipo: 'palco'
      inicioX: number
      inicioY: number
      ultimoX: number
      ultimoY: number
      ultimoEm: number
      vx: number
      vy: number
      moveu: boolean
    }

interface Camera {
  x: number
  y: number
  k: number
}

function aproximar(atual: number, alvo: number, passos: number, passo = PASSO): number {
  const fator = 1 - Math.pow(1 - passo, passos)
  const proximo = atual + (alvo - atual) * fator
  return Math.abs(alvo - proximo) < 0.002 ? alvo : proximo
}

/** Mola em sub-passos de um quadro: num quadro longo ela desacelera em vez de explodir. */
function molejarRealce(ilha: IlhaVisual, alvo: number, passos: number): void {
  let pos = ilha.realce
  let vel = ilha.realceVel
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

function misturar(a: [number, number, number], b: [number, number, number], t: number): number {
  const r = Math.round(a[0] + (b[0] - a[0]) * t)
  const g = Math.round(a[1] + (b[1] - a[1]) * t)
  const bl = Math.round(a[2] + (b[2] - a[2]) * t)
  return (r << 16) | (g << 8) | bl
}

/** Raio de colisão: considera o rótulo, senão os nomes se escrevem uns por cima dos outros. */
function raioDeColisao(ilha: IlhaVisual): number {
  return Math.max(raioDaIlha(ilha) + 18, ilha.id.length * 3.7)
}

/** Frequências e fases da flutuação, derivadas do nome: cada ilha boia no seu ritmo. */
function ondasDe(id: string): IlhaVisual['ondas'] {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0
  const sorteio = (n: number): number => ((h >>> (n * 8)) & 0xff) / 255
  const periodo = (t: number): number => PERIODO_MIN_MS + (PERIODO_MAX_MS - PERIODO_MIN_MS) * t
  return {
    fx: (2 * Math.PI) / periodo(sorteio(0)),
    fy: (2 * Math.PI) / periodo(sorteio(1)),
    px: sorteio(2) * 2 * Math.PI,
    py: sorteio(3) * 2 * Math.PI
  }
}

/** Onde a ilha está desenhada agora: a posição da física mais a flutuação. */
function posicaoDesenhada(ilha: IlhaVisual, agora: number): { x: number; y: number } {
  const x = ilha.x ?? 0
  const y = ilha.y ?? 0
  if (ilha.flutuacao === 0) return { x, y }
  const a = AMPLITUDE_FLUTUACAO * ilha.flutuacao
  const { fx, fy, px, py } = ilha.ondas
  return { x: x + a * Math.sin(agora * fx + px), y: y + a * Math.sin(agora * fy + py) }
}

/** Degradê branco para o halo: sólido até ~1/3 do raio e some até a borda. */
function criarTexturaHalo(): Texture {
  const tela = document.createElement('canvas')
  tela.width = tela.height = RAIO_TEXTURA * 2
  const ctx = tela.getContext('2d') as CanvasRenderingContext2D
  const degrade = ctx.createRadialGradient(
    RAIO_TEXTURA,
    RAIO_TEXTURA,
    RAIO_TEXTURA * 0.35,
    RAIO_TEXTURA,
    RAIO_TEXTURA,
    RAIO_TEXTURA
  )
  degrade.addColorStop(0, 'rgba(255,255,255,1)')
  degrade.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = degrade
  ctx.fillRect(0, 0, tela.width, tela.height)
  return Texture.from(tela)
}

/**
 * Ladrilho do seigaiha, o padrão de ondas das gravuras japonesas: leques de
 * arcos concêntricos, cada fileira deslocada meio leque da anterior.
 */
function criarTexturaOndas(cor: string, fundo: string): Texture {
  const lado = LADO_ONDAS
  const tela = document.createElement('canvas')
  tela.width = tela.height = lado
  const ctx = tela.getContext('2d') as CanvasRenderingContext2D
  const r = lado / 4
  const leque = (cx: number, cy: number): void => {
    ctx.fillStyle = fundo
    ctx.beginPath()
    ctx.arc(cx, cy, r * 2, Math.PI, 2 * Math.PI)
    ctx.fill()
    ctx.strokeStyle = cor
    for (let i = 1; i <= 4; i++) {
      ctx.lineWidth = i === 4 ? 2 : 1.2
      ctx.beginPath()
      ctx.arc(cx, cy, (r * 2 * i) / 4 - 1, Math.PI, 2 * Math.PI)
      ctx.stroke()
    }
  }
  // De cima para baixo: cada fileira cobre a metade de baixo da anterior.
  for (let fileira = 0; fileira <= 4; fileira++) {
    const y = fileira * r
    const deslocamento = fileira % 2 === 0 ? 0 : r * 2
    for (let x = -lado; x <= lado * 2; x += r * 4) leque(x + deslocamento, y)
  }
  return Texture.from(tela)
}

export class MotorDoMapa {
  private readonly app = new Application()
  private readonly mundo = new Container()
  private readonly camadaPontes = new Graphics()
  private readonly camadaParticulas = new Graphics()
  private readonly camadaHalos = new Container()
  private readonly camadaCorpos = new Container()
  private readonly camadaAneis = new Graphics()
  private readonly camadaRotulos = new Container()
  private readonly barcos = new CamadaDeBarcos(PALETAS.padrao)
  /** Barco sob o botão esquerdo, esperando o soltar para virar clique. */
  private barcoPressionado: string | null = null
  private texturaHalo: Texture | null = null
  /** Mar de ondas atrás do mapa, só nos temas de gravura. */
  private ondas: TilingSprite | null = null
  private paleta: PaletaDoMapa = PALETAS.padrao
  private corPorTag = new Map<string, string>()

  private worker: Worker | null = null
  private observador: ResizeObserver | null = null
  private consultaMovimento: MediaQueryList | null = null

  private readonly ilhas = new Map<string, IlhaVisual>()
  private ordem: IlhaVisual[] = []
  private pontes: PonteVisual[] = []
  private assinaturaPontes = ''
  private vizinhosPorId = new Map<string, Set<string>>()
  private vizinhos: Set<string> | null = null
  private hover: string | null = null

  private versao = 0
  private bufferPendente: Float32Array | null = null
  private simulando = false
  private emArraste: string | null = null
  private arraste: Arraste | null = null
  private ultimoClique = { id: '', em: 0 }

  private camera: Camera = { x: 0, y: 0, k: 1 }
  private alvo: Camera = { x: 0, y: 0, k: 1 }
  /** Ponto da tela que fica parado durante o zoom pela roda do mouse. */
  private ancora: { x: number; y: number } | null = null
  private inercia = { vx: 0, vy: 0 }
  private largura = 0
  private altura = 0

  private relogio = 0
  private ultimaPintura = 0
  private agendado = false
  /** O último quadro só tinha a flutuação se mexendo. */
  private soFlutuando = false
  private destruido = false
  private semAnimacao = false
  private jaEnquadrou = false
  private raizAtual = ''
  private resolucaoRotulos = 0

  private estado: EstadoDoPalco = { selecionado: null, destacados: null, conectandoDe: null }

  private constructor(
    private readonly elemento: HTMLElement,
    private acoes: AcoesDoPalco
  ) {}

  /**
   * Cria o motor dentro de `elemento`. Assíncrono porque o PixiJS 8 inicia o
   * WebGL de forma assíncrona; quem chama precisa tratar o caso de o componente
   * ter sido desmontado antes de a promessa resolver.
   */
  static async criar(elemento: HTMLElement, acoes: AcoesDoPalco): Promise<MotorDoMapa> {
    const motor = new MotorDoMapa(elemento, acoes)
    await motor.iniciar()
    return motor
  }

  private async iniciar(): Promise<void> {
    const area = this.elemento.getBoundingClientRect()
    this.largura = Math.max(1, Math.round(area.width))
    this.altura = Math.max(1, Math.round(area.height))

    await this.app.init({
      width: this.largura,
      height: this.altura,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      autoStart: false,
      sharedTicker: false,
      preference: 'webgl',
      // O mouse é todo do motor. Ligado, o sistema de eventos do PixiJS escreve
      // `cursor` direto no estilo do canvas a cada movimento, e isso passa por
      // cima do CSS: a mão de "agarrando" do arraste virava seta.
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false }
    })
    this.app.stage.eventMode = 'none'
    // Mesmo sem esses eventos, o PixiJS ainda reescreve o cursor no clique e ao
    // soltar. Quem manda no cursor é o CSS (`sobre-ilha`, `arrastando`).
    this.app.renderer.events.setCursor = () => {}
    // Quem decide quando pintar é o nosso laço, não o ticker do PixiJS.
    this.app.ticker.stop()

    const tela = this.app.canvas
    tela.style.display = 'block'
    tela.style.touchAction = 'none'
    tela.style.cursor = ''
    // Antes do botão de enquadrar e da dica, que ficam por cima.
    this.elemento.prepend(tela)

    this.texturaHalo = criarTexturaHalo()
    this.mundo.addChild(
      this.camadaPontes,
      this.camadaParticulas,
      this.camadaHalos,
      this.camadaCorpos,
      this.camadaAneis,
      this.camadaRotulos,
      this.barcos.container
    )
    this.app.stage.addChild(this.mundo)
    this.montarOndas()

    // A origem do mapa começa no centro do palco, como na biblioteca antiga.
    this.camera = { x: this.largura / 2, y: this.altura / 2, k: 1 }
    this.alvo = { ...this.camera }

    this.worker = new SimulacaoWorker()
    this.worker.onmessage = (evento: MessageEvent<DaSimulacao>) => this.aoReceber(evento.data)

    this.observador = new ResizeObserver(([entrada]) => {
      const { width, height } = entrada.contentRect
      this.redimensionar(Math.round(width), Math.round(height))
    })
    this.observador.observe(this.elemento)

    this.consultaMovimento = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.semAnimacao = this.consultaMovimento.matches
    this.consultaMovimento.addEventListener('change', this.aoMudarMovimento)

    tela.addEventListener('pointerdown', this.aoPressionar)
    tela.addEventListener('pointermove', this.aoMover)
    tela.addEventListener('pointerup', this.aoSoltar)
    tela.addEventListener('pointercancel', this.aoCancelar)
    tela.addEventListener('pointerleave', this.aoSair)
    tela.addEventListener('contextmenu', this.aoMenu)
    tela.addEventListener('wheel', this.aoRolar, { passive: false })
    window.addEventListener('blur', this.aoCancelar)
    document.addEventListener('visibilitychange', this.aoMudarVisibilidade)

    this.agendar()
  }

  destruir(): void {
    if (this.destruido) return
    this.destruido = true

    const tela = this.app.canvas
    tela.removeEventListener('pointerdown', this.aoPressionar)
    tela.removeEventListener('pointermove', this.aoMover)
    tela.removeEventListener('pointerup', this.aoSoltar)
    tela.removeEventListener('pointercancel', this.aoCancelar)
    tela.removeEventListener('pointerleave', this.aoSair)
    tela.removeEventListener('contextmenu', this.aoMenu)
    tela.removeEventListener('wheel', this.aoRolar)
    window.removeEventListener('blur', this.aoCancelar)
    document.removeEventListener('visibilitychange', this.aoMudarVisibilidade)
    this.consultaMovimento?.removeEventListener('change', this.aoMudarMovimento)

    this.observador?.disconnect()
    this.worker?.terminate()
    this.worker = null
    this.app.destroy({ removeView: true }, { children: true, texture: true })
    this.texturaHalo?.destroy(true)
    this.texturaHalo = null
  }

  /**
   * Troca a paleta do mapa. Só desenho: posições, câmera e física não mudam,
   * então o mapa troca de roupa sem se mexer.
   */
  definirTema(tema: TemaId): void {
    if (this.paleta.id === tema) return
    this.paleta = PALETAS[tema]
    this.barcos.definirPaleta(this.paleta)
    for (const ilha of this.ilhas.values()) {
      this.pintarIlha(ilha)
      this.estilizarRotulo(ilha)
    }
    this.montarOndas()
    this.agendar()
  }

  private montarOndas(): void {
    if (this.destruido) return
    const anterior = this.ondas
    if (anterior) {
      this.app.stage.removeChild(anterior)
      anterior.destroy({ texture: true, textureSource: true })
      this.ondas = null
    }
    const config = this.paleta.ondas
    if (!config) return
    const ondas = new TilingSprite({
      texture: criarTexturaOndas(config.cor, config.fundo),
      width: this.largura,
      height: this.altura
    })
    ondas.alpha = config.alpha
    this.app.stage.addChildAt(ondas, 0)
    this.ondas = ondas
  }

  /** A cor da ilha no tema atual: a dela, a da primeira tag, ou a neutra. */
  private pintarIlha(ilha: IlhaVisual): void {
    const dados = ilha.dados
    const bruta = dados.cor ?? this.corPorTag.get(dados.tags[0] ?? '')
    ilha.cor = dados.ausente
      ? this.paleta.ausente
      : bruta
        ? corNoTema(bruta, this.paleta.id)
        : this.paleta.neutra
    this.desenharCorpo(ilha)
  }

  private estilizarRotulo(ilha: IlhaVisual): void {
    const estilo = ilha.rotulo.style
    estilo.fill = ilha.dados.ausente ? this.paleta.rotuloAusente : this.paleta.rotulo
    estilo.fontFamily = this.paleta.fonte
    estilo.stroke = this.paleta.rotuloContorno
      ? { color: this.paleta.rotuloContorno, width: 3, join: 'round' }
      : { width: 0 }
  }

  // --- Entrada de dados vinda do React ----------------------------------------

  definirAcoes(acoes: AcoesDoPalco): void {
    this.acoes = acoes
  }

  /** Os agentes do time, como barcos em volta das ilhas onde trabalham. */
  definirBarcos(barcos: readonly Barco[], rotas: readonly Rota[]): void {
    this.barcos.definir(barcos, rotas)
    this.agendar()
  }

  definirEstado(estado: EstadoDoPalco): void {
    this.estado = estado
    this.agendar()
  }

  /**
   * Sincroniza as ilhas com o mapa lido do disco.
   *
   * Os objetos de ilha são reaproveitados entre recargas: é neles que vivem
   * posição e animação. A simulação só é avisada quando muda o **arranjo**
   * (ilha que entra ou sai, ponte, fixação); tag, cor e diário mudam o
   * desenho e mais nada, então o mapa não sai andando a cada `.md` salvo.
   */
  definirMapa(mapa: Mapa): void {
    if (mapa.raiz !== this.raizAtual) {
      this.raizAtual = mapa.raiz
      this.jaEnquadrou = false
    }

    this.corPorTag = new Map(mapa.tags.map((t) => [t.nome, t.cor]))
    const grau = new Map<string, number>()
    for (const ponte of mapa.pontes) {
      grau.set(ponte.origem, (grau.get(ponte.origem) ?? 0) + 1)
      grau.set(ponte.destino, (grau.get(ponte.destino) ?? 0) + 1)
    }

    let arranjoMudou = false
    let entrouOuSaiu = false

    const vivas = new Set(mapa.ilhas.map((i) => i.id))
    for (const [id, ilha] of this.ilhas) {
      if (vivas.has(id)) continue
      ilha.halo.destroy()
      ilha.corpo.destroy()
      ilha.rotulo.destroy()
      this.ilhas.delete(id)
      arranjoMudou = entrouOuSaiu = true
    }

    this.ordem = mapa.ilhas.map((dados) => {
      let ilha = this.ilhas.get(dados.id)
      if (!ilha) {
        ilha = this.criarIlha(dados)
        this.ilhas.set(dados.id, ilha)
        arranjoMudou = entrouOuSaiu = true
      }

      ilha.dados = dados
      ilha.grau = grau.get(dados.id) ?? 0
      ilha.frescor = frescor(diasSemUso(dados))
      this.pintarIlha(ilha)
      this.estilizarRotulo(ilha)

      // Quem está sendo arrastada fica de fora: a posição dela é do mouse, e uma
      // recarga no meio do gesto arrancaria a ilha da mão do usuário.
      if (this.emArraste === dados.id) {
        // O fim do arraste grava a posição nova.
      } else if (dados.pos) {
        const noLugar =
          ilha.fx !== undefined &&
          ilha.fy !== undefined &&
          Math.abs(ilha.fx - dados.pos.x) < FOLGA_POSICAO &&
          Math.abs(ilha.fy - dados.pos.y) < FOLGA_POSICAO
        if (!noLugar) {
          ilha.fx = dados.pos.x
          ilha.fy = dados.pos.y
          arranjoMudou = true
        }
        ilha.x ??= dados.pos.x
        ilha.y ??= dados.pos.y
      } else if (ilha.fx !== undefined || ilha.fy !== undefined) {
        delete ilha.fx
        delete ilha.fy
        arranjoMudou = true
      }

      return ilha
    })

    // O separador é o mesmo `\0` da varredura: não cabe em nome de pasta.
    const assinatura = mapa.pontes.map((p) => `${p.origem}\0${p.destino}`).join('\n')
    if (assinatura !== this.assinaturaPontes) {
      this.assinaturaPontes = assinatura
      arranjoMudou = true
    }

    // Pontes guardam a animação do foco, então também são reaproveitadas.
    const anteriores = new Map(this.pontes.map((p) => [p.chave, p]))
    this.pontes = []
    this.vizinhosPorId = new Map()
    for (const ponte of mapa.pontes) {
      const a = this.ilhas.get(ponte.origem)
      const b = this.ilhas.get(ponte.destino)
      if (!a || !b) continue
      const chave = `${ponte.origem}\0${ponte.destino}`
      const antiga = anteriores.get(chave)
      this.pontes.push(antiga ? { ...antiga, a, b } : { chave, a, b, foco: 0, apagado: 0 })
      if (!this.vizinhosPorId.has(a.id)) this.vizinhosPorId.set(a.id, new Set())
      if (!this.vizinhosPorId.has(b.id)) this.vizinhosPorId.set(b.id, new Set())
      this.vizinhosPorId.get(a.id)?.add(b.id)
      this.vizinhosPorId.get(b.id)?.add(a.id)
    }

    if (this.hover && !this.ilhas.has(this.hover)) this.definirHover(null)
    else this.recalcularVizinhos()

    if (arranjoMudou) this.enviarGrafo(entrouOuSaiu ? 1 : 0.3)
    this.agendar()
  }

  /** Converte um ponto da janela (clientX/Y) para coordenadas do mapa. */
  paraMundo(clientX: number, clientY: number): { x: number; y: number } {
    const area = this.app.canvas.getBoundingClientRect()
    return {
      x: (clientX - area.left - this.camera.x) / this.camera.k,
      y: (clientY - area.top - this.camera.y) / this.camera.k
    }
  }

  /** Solta uma ilha vinda da lista lateral no ponto exato onde o cursor largou. */
  soltarDaLista(id: string, clientX: number, clientY: number): { x: number; y: number } | null {
    const ilha = this.ilhas.get(id)
    if (!ilha) return null
    const bruto = this.paraMundo(clientX, clientY)
    // Soltar em cima de uma ilha já fixada esconderia uma dentro da outra.
    const ponto = posicaoLivre(ilha, bruto.x, bruto.y, this.ilhas.values())
    ilha.x = ilha.fx = ponto.x
    ilha.y = ilha.fy = ponto.y
    this.enviar({ tipo: 'fixar', id, x: ponto.x, y: ponto.y })
    this.agendar()
    return ponto
  }

  /**
   * Traz a câmera de volta para onde as ilhas estão: o enquadramento inicial e o
   * resgate de quem se perdeu no vazio. O alvo sai do retângulo das ilhas, então
   * é impossível parar num lugar sem nada para ver.
   */
  enquadrar(): void {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const ilha of this.ordem) {
      if (ilha.x === undefined || ilha.y === undefined) continue
      minX = Math.min(minX, ilha.x)
      maxX = Math.max(maxX, ilha.x)
      minY = Math.min(minY, ilha.y)
      maxY = Math.max(maxY, ilha.y)
    }
    if (minX === Infinity) return

    const k = Math.max(
      0.01,
      Math.min(
        ZOOM_ENQUADRAMENTO,
        (this.largura - MARGEM_ENQUADRAMENTO * 2) / Math.max(1, maxX - minX),
        (this.altura - MARGEM_ENQUADRAMENTO * 2) / Math.max(1, maxY - minY)
      )
    )

    this.ancora = null
    this.inercia = { vx: 0, vy: 0 }
    this.alvo = {
      k,
      x: this.largura / 2 - ((minX + maxX) / 2) * k,
      y: this.altura / 2 - ((minY + maxY) / 2) * k
    }
    this.agendar()
  }

  // --- Simulação --------------------------------------------------------------

  private enviar(mensagem: ParaSimulacao): void {
    this.worker?.postMessage(mensagem)
  }

  private enviarGrafo(aquecer: number): void {
    this.versao++
    const indice = new Map(this.ordem.map((ilha, i) => [ilha.id, i]))
    const nos: NoDaSimulacao[] = this.ordem.map((ilha) => ({
      id: ilha.id,
      x: ilha.x,
      y: ilha.y,
      fx: ilha.fx,
      fy: ilha.fy,
      colisao: raioDeColisao(ilha)
    }))
    const pontes: [number, number][] = this.pontes.map((p) => [
      indice.get(p.a.id) as number,
      indice.get(p.b.id) as number
    ])
    this.simulando = true
    this.enviar({ tipo: 'grafo', versao: this.versao, nos, pontes, aquecer })
  }

  private aoReceber(msg: DaSimulacao): void {
    if (this.destruido || msg.versao !== this.versao) return

    if (msg.tipo === 'posicoes') {
      this.bufferPendente = msg.buffer
      this.simulando = true
      this.agendar()
      return
    }

    this.simulando = false
    // Enquadra o mapa na primeira vez que ele assenta, e só nela: reenquadrar a
    // cada recarga tiraria o usuário do lugar onde ele estava olhando.
    if (!this.jaEnquadrou) {
      this.jaEnquadrou = true
      this.enquadrar()
    }
    this.agendar()
  }

  private aplicarPosicoes(buffer: Float32Array): void {
    const total = Math.min(this.ordem.length, buffer.length / 2)
    for (let i = 0; i < total; i++) {
      const ilha = this.ordem[i]
      if (ilha.id === this.emArraste) continue
      ilha.x = buffer[i * 2]
      ilha.y = buffer[i * 2 + 1]
    }
  }

  // --- Ilhas ------------------------------------------------------------------

  private criarIlha(dados: Ilha): IlhaVisual {
    const halo = new Sprite(this.texturaHalo ?? Texture.WHITE)
    halo.anchor.set(0.5)
    halo.visible = false

    const corpo = new Graphics()

    const rotulo = new Text({
      text: dados.id,
      style: {
        fontFamily: this.paleta.fonte,
        fontSize: FONTE_BASE,
        fontWeight: '400',
        fill: this.paleta.rotulo
      },
      resolution: this.resolucaoAtual()
    })
    rotulo.anchor.set(0.5, 0)
    rotulo.visible = false

    this.camadaHalos.addChild(halo)
    this.camadaCorpos.addChild(corpo)
    this.camadaRotulos.addChild(rotulo)

    return {
      id: dados.id,
      dados,
      cor: this.paleta.neutra,
      grau: 0,
      alpha: 1,
      realce: 0,
      realceVel: 0,
      nascimento: this.semAnimacao ? 1 : 0,
      frescor: 1,
      halo,
      corpo,
      rotulo,
      corpoDesenhado: '',
      pesoRotulo: '400',
      flutuacao: 0,
      ondas: ondasDe(dados.id)
    }
  }

  /**
   * Desenha o círculo já na cor da ilha; o tamanho vem da escala. Só redesenha
   * quando cor, tema ou estado mudam. Nos temas de gravura a ilha ganha contorno
   * de nanquim, como as figuras da xilogravura.
   * Ilha ausente é contorno tracejado: existe no mapa, não existe no disco.
   */
  private desenharCorpo(ilha: IlhaVisual): void {
    const base = raioDaIlha(ilha)
    const nanquim = this.paleta.nanquim
    const assinatura = ilha.dados.ausente
      ? `ausente:${base}:${ilha.cor}`
      : `cheio:${ilha.cor}:${nanquim ?? ''}`
    if (assinatura === ilha.corpoDesenhado) return
    ilha.corpoDesenhado = assinatura

    const g = ilha.corpo
    g.clear()
    if (!ilha.dados.ausente) {
      g.circle(0, 0, RAIO_CORPO).fill(ilha.cor)
      if (nanquim) {
        // Contorno proporcional ao corpo, como o traço do entalhe.
        g.circle(0, 0, RAIO_CORPO - 0.6).stroke({ width: 1.3, color: nanquim, alpha: 0.9 })
        // Brilho de papel no alto: a cor chapada ganha um degrau de luz.
        g.arc(0, 0, RAIO_CORPO * 0.62, Math.PI * 1.1, Math.PI * 1.55).stroke({
          width: 1.1,
          color: 0xffffff,
          alpha: 0.45
        })
      }
      return
    }

    // Traços de ~2 unidades com vãos de ~2, como o `setLineDash([2, 2])` de antes.
    const segmentos = Math.max(6, Math.round((2 * Math.PI * base) / 4))
    const passo = (2 * Math.PI) / segmentos
    for (let i = 0; i < segmentos; i++) {
      const inicio = i * passo
      g.moveTo(Math.cos(inicio) * RAIO_CORPO, Math.sin(inicio) * RAIO_CORPO)
      g.arc(0, 0, RAIO_CORPO, inicio, inicio + passo / 2)
    }
    // A espessura é no espaço do círculo de raio 10; convertida para 1,2 no mapa.
    g.stroke({ width: (1.2 * RAIO_CORPO) / base, color: ilha.cor })
  }

  /** Avança as animações das ilhas e posiciona tudo. Devolve `true` se algo ainda se move. */
  private atualizarIlhas(passos: number, agora: number): boolean {
    const { selecionado, destacados, conectandoDe } = this.estado
    const k = this.camera.k
    const aneis = this.camadaAneis
    aneis.clear()
    let inquieto = false

    // Fonte constante de 13,5 px na tela até o zoom passar de ~0,9; depois cresce até 15 no mapa.
    const tamanhoFonte = Math.min(FONTE_BASE, 13.5 / k)
    const escalaRotulo = tamanhoFonte / FONTE_BASE
    const rotuloPorZoom = Math.min(1, Math.max(0, (k - ROTULO_INICIO) / (ROTULO_FIM - ROTULO_INICIO)))

    for (const ilha of this.ordem) {
      if (ilha.x === undefined || ilha.y === undefined) {
        ilha.corpo.visible = ilha.halo.visible = ilha.rotulo.visible = false
        continue
      }

      const foraDoHover = this.vizinhos !== null && !this.vizinhos.has(ilha.id)
      const foraDoFiltro = destacados !== null && !destacados.has(ilha.id)
      const ehSelecionado = ilha.id === selecionado
      const ehHover = ilha.id === this.hover
      const ehOrigem = ilha.id === conectandoDe

      // Quem está sob o cursor ou na mão para de boiar: alvo que foge do mouse
      // é irritante de clicar.
      const alvoFlutuacao = this.semAnimacao || ehHover || ilha.id === this.emArraste ? 0 : 1
      ilha.flutuacao = this.semAnimacao
        ? alvoFlutuacao
        : aproximar(ilha.flutuacao, alvoFlutuacao, passos, 0.06)
      if (ilha.flutuacao !== alvoFlutuacao) inquieto = true
      const { x: ix, y: iy } = posicaoDesenhada(ilha, agora)

      const alvoAlpha = foraDoHover || foraDoFiltro ? ALPHA_APAGADO : 1
      const alvoRealce = ehHover || ehSelecionado || ehOrigem ? 1 : 0

      if (this.semAnimacao) {
        ilha.alpha = alvoAlpha
        ilha.realce = alvoRealce
        ilha.realceVel = 0
        ilha.nascimento = 1
      } else {
        ilha.alpha = aproximar(ilha.alpha, alvoAlpha, passos)
        ilha.nascimento = aproximar(ilha.nascimento, 1, passos)
        molejarRealce(ilha, alvoRealce, passos)
      }

      if (
        ehOrigem ||
        ilha.alpha !== alvoAlpha ||
        ilha.nascimento !== 1 ||
        ilha.realce !== alvoRealce ||
        ilha.realceVel !== 0
      ) {
        inquieto = true
      }

      const realce = ilha.realce
      const realceRecortado = Math.min(1, Math.max(0, realce))
      const surgindo = ilha.nascimento
      const raio = raioDaIlha(ilha) * (0.45 + 0.55 * surgindo) * (1 + 0.16 * realce)

      // Pasta parada há meses vai apagando; o realce devolve a cor cheia na hora
      // em que você aponta para ela.
      const brilho = ilha.frescor
      const opacidade = ilha.alpha * surgindo * (brilho + (1 - brilho) * realceRecortado)

      const corpo = ilha.corpo
      corpo.visible = true
      corpo.position.set(ix, iy)
      corpo.scale.set(raio / RAIO_CORPO)
      corpo.alpha = opacidade

      // Halo: o alcance cresce junto com o realce; tamanho fixo só mudando de
      // opacidade lê como piscada.
      const halo = ilha.halo
      if (realce > 0.01) {
        const alcance = raio * (2.1 + 1.4 * realceRecortado)
        halo.visible = true
        halo.position.set(ix, iy)
        halo.scale.set(alcance / RAIO_TEXTURA)
        halo.tint = ilha.cor
        halo.alpha = opacidade * 0.3 * realceRecortado
      } else {
        halo.visible = false
      }

      if (ehOrigem) {
        // Sonar: o anel parte da borda, se abre e some. Diz "estou esperando a
        // outra ponta" com direção, que é o que o modo conexão pede.
        const ciclo = (agora % 1400) / 1400
        const avanco = 1 - Math.pow(1 - ciclo, 2)
        aneis
          .circle(ix, iy, raio + 3 + avanco * 14)
          .stroke({
            width: 2.5 * (1 - avanco * 0.6),
            color: this.paleta.destaque,
            alpha: opacidade * (1 - avanco)
          })
        aneis
          .circle(ix, iy, raio + 3)
          .stroke({ width: 2, color: this.paleta.destaque, alpha: opacidade })
      } else if (ehSelecionado) {
        aneis.circle(ix, iy, raio + 2.5 + 1.5 * realceRecortado).stroke({
          width: 1.5,
          color: this.paleta.anel,
          alpha: opacidade * (0.45 + 0.55 * realceRecortado)
        })
      } else if (ilha.fx !== undefined) {
        // Anel discreto marcando que a posição está fixada.
        aneis
          .circle(ix, iy, raio + 2.5)
          .stroke({ width: 1, color: this.paleta.anel, alpha: 0.28 * opacidade })
      }

      // Com muito zoom-out o texto vira borrão: some numa faixa, não num limiar.
      // Quem está sob o cursor ou selecionado mantém o rótulo em qualquer zoom.
      const visibilidade = Math.max(ehSelecionado || ehHover ? 1 : 0, rotuloPorZoom)
      const rotulo = ilha.rotulo
      if (visibilidade > 0.01) {
        rotulo.visible = true
        rotulo.position.set(ix, iy + raio + 4)
        rotulo.scale.set(escalaRotulo)
        rotulo.alpha = opacidade * visibilidade
        const peso = realceRecortado > 0.5 ? '600' : '400'
        if (peso !== ilha.pesoRotulo) {
          ilha.pesoRotulo = peso
          rotulo.style.fontWeight = peso
        }
      } else {
        rotulo.visible = false
      }
    }

    return inquieto
  }

  /** Pontes e partículas. Devolve `true` se algo ainda se move. */
  private desenharPontes(passos: number, agora: number): boolean {
    const g = this.camadaPontes
    const particulas = this.camadaParticulas
    g.clear()
    particulas.clear()

    const k = this.camera.k
    const raioParticula = 1 / Math.sqrt(k)
    let inquieto = false

    for (const ponte of this.pontes) {
      const { a, b } = ponte
      if (a.x === undefined || a.y === undefined || b.x === undefined || b.y === undefined) continue

      const pa = posicaoDesenhada(a, agora)
      const pb = posicaoDesenhada(b, agora)
      const naVizinhanca =
        this.vizinhos !== null && this.vizinhos.has(a.id) && this.vizinhos.has(b.id)
      const alvoFoco = naVizinhanca ? 1 : 0
      const alvoApagado = this.vizinhos !== null && !naVizinhanca ? 1 : 0

      if (this.semAnimacao) {
        ponte.foco = alvoFoco
        ponte.apagado = alvoApagado
      } else {
        ponte.foco = aproximar(ponte.foco, alvoFoco, passos, 0.25)
        ponte.apagado = aproximar(ponte.apagado, alvoApagado, passos, 0.25)
      }
      if (ponte.foco !== alvoFoco || ponte.apagado !== alvoApagado) inquieto = true

      const cor = misturar(this.paleta.ponte, this.paleta.ponteAcesa, ponte.foco)
      const alpha = 1 - 0.8 * ponte.apagado
      if (this.paleta.pincel) {
        this.pincelar(g, pa, pb, (2.2 + 1.4 * ponte.foco) / k, cor, alpha)
      } else {
        // Espessura em pixels de tela, como antes: não engorda com o zoom.
        g.moveTo(pa.x, pa.y)
          .lineTo(pb.x, pb.y)
          .stroke({ width: (1 + 0.8 * ponte.foco) / k, color: cor, alpha })
      }

      // Partículas correndo pelas pontes do hover: mostram quais pontes saem
      // dali sem precisar ler rótulo nenhum. Fora do hover, nada se move.
      if (ponte.foco > 0.01) {
        inquieto = true
        for (let i = 0; i < PARTICULAS_POR_PONTE; i++) {
          const t = (agora * VELOCIDADE_PARTICULA + i / PARTICULAS_POR_PONTE) % 1
          particulas
            .circle(pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t, raioParticula)
            .fill({ color: this.paleta.destaque, alpha: ponte.foco })
        }
      }
    }

    return inquieto
  }

  /**
   * Ponte como pincelada: um fuso que engrossa no meio e afina nas pontas, com
   * uma leve curva, como o traço de pincel da gravura. `largura` é a do meio.
   */
  private pincelar(
    g: Graphics,
    pa: { x: number; y: number },
    pb: { x: number; y: number },
    largura: number,
    cor: number,
    alpha: number
  ): void {
    const dx = pb.x - pa.x
    const dy = pb.y - pa.y
    const comprimento = Math.hypot(dx, dy)
    if (comprimento < 1) return
    // Normal unitária: para onde o traço engorda.
    const nx = -dy / comprimento
    const ny = dx / comprimento
    // A curva vai sempre para o mesmo lado da ponte, então não "vira" entre quadros.
    const curva = Math.min(10, comprimento * 0.06)
    const mx = (pa.x + pb.x) / 2 + nx * curva
    const my = (pa.y + pb.y) / 2 + ny * curva
    const meia = largura / 2
    const ponta = meia * 0.18
    g.moveTo(pa.x + nx * ponta, pa.y + ny * ponta)
      .quadraticCurveTo(mx + nx * meia * 2, my + ny * meia * 2, pb.x + nx * ponta, pb.y + ny * ponta)
      .lineTo(pb.x - nx * ponta, pb.y - ny * ponta)
      .quadraticCurveTo(mx - nx * meia * 2, my - ny * meia * 2, pa.x - nx * ponta, pa.y - ny * ponta)
      .closePath()
      .fill({ color: cor, alpha })
  }

  /** O mar acompanha a câmera mais devagar que as ilhas e deriva bem de leve. */
  private moverOndas(agora: number): void {
    const ondas = this.ondas
    if (!ondas) return
    if (ondas.width !== this.largura || ondas.height !== this.altura) {
      ondas.width = this.largura
      ondas.height = this.altura
    }
    // O ladrilho cresce e encolhe com o zoom, mas pouco: de longe o padrão vira
    // textura, de perto não vira um borrão gigante.
    const escala = Math.min(1.8, Math.max(0.6, Math.pow(this.camera.k, 0.35)))
    ondas.tileScale.set(escala)
    const deriva = this.semAnimacao ? 0 : (agora / 1000) * DERIVA_ONDAS
    ondas.tilePosition.set(this.camera.x * PARALAXE_ONDAS + deriva, this.camera.y * PARALAXE_ONDAS)
  }

  // --- Câmera -----------------------------------------------------------------

  /** Leva a câmera em direção ao alvo. Devolve `true` se ela ainda está andando. */
  private atualizarCamera(passos: number): boolean {
    let andando = false

    // Inércia do arraste do palco: o mapa desliza um pouco depois de soltar.
    if (this.arraste?.tipo !== 'palco' && Math.hypot(this.inercia.vx, this.inercia.vy) > 0.05) {
      const dx = this.inercia.vx * passos
      const dy = this.inercia.vy * passos
      this.camera.x += dx
      this.camera.y += dy
      this.alvo.x += dx
      this.alvo.y += dy
      const atrito = Math.pow(ATRITO_INERCIA, passos)
      this.inercia.vx *= atrito
      this.inercia.vy *= atrito
      andando = true
    }

    const c = this.camera
    const a = this.alvo
    if (this.semAnimacao) {
      c.x = a.x
      c.y = a.y
      c.k = a.k
    } else if (Math.abs(c.k - a.k) > 1e-4 || Math.abs(c.x - a.x) > 0.1 || Math.abs(c.y - a.y) > 0.1) {
      const fator = 1 - Math.pow(1 - SUAVIDADE_CAMERA, passos)
      if (this.ancora) {
        // Zoom pela roda: interpola o zoom e mantém parado o ponto sob o cursor.
        const mundoX = (this.ancora.x - a.x) / a.k
        const mundoY = (this.ancora.y - a.y) / a.k
        c.k = Math.exp(Math.log(c.k) + (Math.log(a.k) - Math.log(c.k)) * fator)
        c.x = this.ancora.x - mundoX * c.k
        c.y = this.ancora.y - mundoY * c.k
      } else {
        c.k = Math.exp(Math.log(c.k) + (Math.log(a.k) - Math.log(c.k)) * fator)
        c.x += (a.x - c.x) * fator
        c.y += (a.y - c.y) * fator
      }
      andando = true
    } else {
      c.x = a.x
      c.y = a.y
      c.k = a.k
      this.ancora = null
    }

    this.mundo.position.set(c.x, c.y)
    this.mundo.scale.set(c.k)
    return andando
  }

  /**
   * Resolução dos rótulos acompanha o zoom em degraus, para o texto não borrar
   * de perto. Só troca com a câmera parada: re-rasterizar no meio do zoom pesa.
   */
  private resolucaoAtual(): number {
    const base = window.devicePixelRatio || 1
    const ampliacao = Math.max(1, this.camera.k)
    return base * Math.min(4, Math.pow(2, Math.ceil(Math.log2(ampliacao))))
  }

  private ajustarNitidez(): void {
    const alvo = this.resolucaoAtual()
    if (alvo === this.resolucaoRotulos) return
    this.resolucaoRotulos = alvo
    for (const ilha of this.ilhas.values()) ilha.rotulo.resolution = alvo
  }

  private redimensionar(largura: number, altura: number): void {
    if (largura <= 0 || altura <= 0 || this.destruido) return
    // Mantém o centro da vista no mesmo ponto do mapa quando o palco muda de tamanho.
    const dx = (largura - this.largura) / 2
    const dy = (altura - this.altura) / 2
    this.camera.x += dx
    this.camera.y += dy
    this.alvo.x += dx
    this.alvo.y += dy
    this.largura = largura
    this.altura = altura
    this.app.renderer.resize(largura, altura)
    // Mudar o tamanho do canvas apaga o que estava desenhado. Esperar o próximo
    // quadro deixava um quadro vazio a cada passo do arraste da lista ou do
    // terminal: o fundo piscava e as ilhas sumiam. Pinta já, na mesma hora.
    this.mundo.position.set(this.camera.x, this.camera.y)
    this.mundo.scale.set(this.camera.k)
    this.moverOndas(performance.now())
    this.app.render()
    this.agendar()
  }

  // --- Laço de desenho --------------------------------------------------------

  /** Pede um quadro. Chamar várias vezes no mesmo quadro não custa nada. */
  private agendar(): void {
    if (this.agendado || this.destruido) return
    this.agendado = true
    requestAnimationFrame(this.quadro)
  }

  private readonly quadro = (agora: number): void => {
    this.agendado = false
    if (this.destruido) return

    // Só a flutuação se mexendo: pinta a ~30 fps. Ela é lenta o bastante para
    // não se notar a diferença, e o mapa parado gasta metade.
    if (this.soFlutuando && agora - this.ultimaPintura < INTERVALO_SO_FLUTUANDO_MS) {
      this.agendar()
      return
    }
    this.ultimaPintura = agora

    const intervalo = agora - this.relogio
    const retomando = this.relogio === 0 || intervalo > PAUSA_MS
    this.relogio = agora
    // Voltando de uma pausa, o quadro vale um passo só; fora disso, o teto de 3
    // cobre o quadro que engasgou sem teleportar a transição para o fim.
    const passos = retomando ? 1 : Math.min(3, intervalo / QUADRO_MS)

    if (this.bufferPendente) {
      this.aplicarPosicoes(this.bufferPendente)
      this.bufferPendente = null
    }

    let inquieto = this.atualizarCamera(passos)
    inquieto = this.atualizarIlhas(passos, agora) || inquieto
    inquieto = this.desenharPontes(passos, agora) || inquieto
    inquieto = this.atualizarBarcos(passos, agora) || inquieto
    this.moverOndas(agora)
    if (!inquieto) this.ajustarNitidez()

    this.app.render()

    // Mapa parado, ninguém mexendo: o laço dorme até o próximo evento.
    const flutuando = !this.semAnimacao && (this.ordem.length > 0 || this.barcos.temBarcos())
    this.soFlutuando = flutuando && !inquieto && !this.simulando && !this.arraste
    if (inquieto || this.simulando || this.arraste || flutuando) this.agendar()
  }

  private atualizarBarcos(passos: number, agora: number): boolean {
    let somaX = 0
    let somaY = 0
    let n = 0
    for (const ilha of this.ordem) {
      if (ilha.x === undefined || ilha.y === undefined) continue
      somaX += ilha.x
      somaY += ilha.y
      n += 1
    }
    // Agente sem ilha ancora no meio do arquipélago.
    const centro = n > 0 ? { x: somaX / n, y: somaY / n } : { x: 0, y: 0 }
    return this.barcos.atualizar(
      passos,
      agora,
      this.camera.k,
      (id) => {
        const ilha = this.ilhas.get(id)
        if (!ilha || ilha.x === undefined || ilha.y === undefined) return null
        return { ...posicaoDesenhada(ilha, agora), raio: raioDaIlha(ilha) }
      },
      centro,
      this.semAnimacao
    )
  }

  // --- Mouse ------------------------------------------------------------------

  private pontoNaTela(evento: { clientX: number; clientY: number }): { x: number; y: number } {
    const area = this.app.canvas.getBoundingClientRect()
    return { x: evento.clientX - area.left, y: evento.clientY - area.top }
  }

  /** A ilha sob o ponto (em coordenadas do mapa), ou `null`. A mais próxima vence. */
  private ilhaEm(x: number, y: number): IlhaVisual | null {
    let melhor: IlhaVisual | null = null
    let melhorDistancia = Infinity
    for (const ilha of this.ordem) {
      if (ilha.x === undefined || ilha.y === undefined) continue
      const desenhada = posicaoDesenhada(ilha, performance.now())
      const distancia = Math.hypot(desenhada.x - x, desenhada.y - y)
      if (distancia <= raioDaIlha(ilha) + 4 && distancia < melhorDistancia) {
        melhor = ilha
        melhorDistancia = distancia
      }
    }
    return melhor
  }

  private definirHover(id: string | null): void {
    if (id === this.hover) return
    this.hover = id
    // A mãozinha só sobre uma ilha; no vazio, a seta.
    this.elemento.classList.toggle('sobre-ilha', id !== null)
    this.recalcularVizinhos()
    this.agendar()
  }

  private recalcularVizinhos(): void {
    if (!this.hover) {
      this.vizinhos = null
      return
    }
    this.vizinhos = new Set([this.hover, ...(this.vizinhosPorId.get(this.hover) ?? [])])
  }

  private readonly aoPressionar = (evento: PointerEvent): void => {
    if (evento.button !== 0) return
    this.app.canvas.setPointerCapture(evento.pointerId)
    // Mão fechada só enquanto o botão esquerdo está pressionado.
    this.elemento.classList.add('arrastando')

    const tela = this.pontoNaTela(evento)
    const mundo = this.paraMundo(evento.clientX, evento.clientY)

    // O barco fica por cima da ilha, então é ele quem recebe o clique.
    const barco = this.barcos.barcoEm(mundo.x, mundo.y, this.camera.k)
    if (barco) {
      this.barcoPressionado = barco
      return
    }

    const ilha = this.ilhaEm(mundo.x, mundo.y)

    if (ilha) {
      this.arraste = {
        tipo: 'ilha',
        ilha,
        inicioX: tela.x,
        inicioY: tela.y,
        moveu: false,
        fixoAntes:
          ilha.fx !== undefined && ilha.fy !== undefined ? { x: ilha.fx, y: ilha.fy } : null
      }
    } else {
      this.inercia = { vx: 0, vy: 0 }
      this.ancora = null
      this.arraste = {
        tipo: 'palco',
        inicioX: tela.x,
        inicioY: tela.y,
        ultimoX: tela.x,
        ultimoY: tela.y,
        ultimoEm: performance.now(),
        vx: 0,
        vy: 0,
        moveu: false
      }
    }
    this.agendar()
  }

  private readonly aoMover = (evento: PointerEvent): void => {
    const tela = this.pontoNaTela(evento)
    const arraste = this.arraste

    if (!arraste) {
      if (this.barcoPressionado) return
      const mundo = this.paraMundo(evento.clientX, evento.clientY)
      const barco = this.barcos.barcoEm(mundo.x, mundo.y, this.camera.k)
      this.barcos.definirHover(barco)
      this.definirHover(barco ? null : (this.ilhaEm(mundo.x, mundo.y)?.id ?? null))
      // A mãozinha também sobre um barco.
      if (barco) this.elemento.classList.add('sobre-ilha')
      this.agendar()
      return
    }

    if (!arraste.moveu && Math.hypot(tela.x - arraste.inicioX, tela.y - arraste.inicioY) > LIMIAR_ARRASTE) {
      arraste.moveu = true
    }

    if (arraste.tipo === 'ilha') {
      if (!arraste.moveu) return
      const { ilha } = arraste
      const mundo = this.paraMundo(evento.clientX, evento.clientY)
      this.emArraste = ilha.id
      ilha.x = ilha.fx = mundo.x
      ilha.y = ilha.fy = mundo.y
      this.enviar({ tipo: 'arrastar', id: ilha.id, x: mundo.x, y: mundo.y })
      this.agendar()
      return
    }

    // Arrastar o palco: a câmera acompanha o mouse 1:1, sem suavização.
    const dx = tela.x - arraste.ultimoX
    const dy = tela.y - arraste.ultimoY
    const agora = performance.now()
    const decorrido = Math.max(1, agora - arraste.ultimoEm)
    // Velocidade em pixels por quadro de 60 Hz, suavizada para um tremor no fim
    // do gesto não virar um arremesso.
    arraste.vx = arraste.vx * 0.6 + ((dx / decorrido) * QUADRO_MS) * 0.4
    arraste.vy = arraste.vy * 0.6 + ((dy / decorrido) * QUADRO_MS) * 0.4
    arraste.ultimoX = tela.x
    arraste.ultimoY = tela.y
    arraste.ultimoEm = agora

    this.camera.x += dx
    this.camera.y += dy
    this.alvo.x += dx
    this.alvo.y += dy
    this.agendar()
  }

  private readonly aoSoltar = (evento: PointerEvent): void => {
    if (evento.button === 0 && this.barcoPressionado) {
      if (this.app.canvas.hasPointerCapture(evento.pointerId)) {
        this.app.canvas.releasePointerCapture(evento.pointerId)
      }
      this.elemento.classList.remove('arrastando')
      const nome = this.barcoPressionado
      this.barcoPressionado = null
      const mundo = this.paraMundo(evento.clientX, evento.clientY)
      // Só é clique se soltou em cima do mesmo barco.
      if (this.barcos.barcoEm(mundo.x, mundo.y, this.camera.k) === nome) this.acoes.onBarco(nome)
      this.agendar()
      return
    }
    if (evento.button !== 0 || !this.arraste) return
    if (this.app.canvas.hasPointerCapture(evento.pointerId)) {
      this.app.canvas.releasePointerCapture(evento.pointerId)
    }
    this.elemento.classList.remove('arrastando')

    const arraste = this.arraste
    this.arraste = null

    if (arraste.tipo === 'palco') {
      if (!arraste.moveu) {
        this.acoes.onSelecionar(null)
      } else if (performance.now() - arraste.ultimoEm < 80) {
        // Só desliza quem soltou em movimento; parar e soltar não arremessa.
        this.inercia = { vx: arraste.vx, vy: arraste.vy }
      }
      this.agendar()
      return
    }

    const { ilha } = arraste

    if (arraste.moveu) {
      this.emArraste = null
      if (ilha.x === undefined || ilha.y === undefined) return
      // Arrastar fixa. Largar em cima de outra fixada empilharia as duas: quem
      // chega é que sai do caminho.
      const ponto = posicaoLivre(ilha, ilha.x, ilha.y, this.ilhas.values())
      ilha.x = ilha.fx = ponto.x
      ilha.y = ilha.fy = ponto.y
      this.enviar({ tipo: 'fimArraste', id: ilha.id, fixo: ponto })
      this.acoes.onFixar(ilha.id, ponto)
      this.agendar()
      return
    }

    // Foi um clique.
    if (evento.altKey) {
      delete ilha.fx
      delete ilha.fy
      this.enviar({ tipo: 'soltar', id: ilha.id })
      this.acoes.onFixar(ilha.id, null)
      this.agendar()
      return
    }

    const agora = Date.now()
    const ehDuplo =
      this.ultimoClique.id === ilha.id && agora - this.ultimoClique.em < JANELA_DUPLO_MS
    // Zera o instante depois de abrir, senão um terceiro clique abriria de novo.
    this.ultimoClique = { id: ilha.id, em: ehDuplo ? 0 : agora }

    if (ehDuplo) this.acoes.onAbrir(ilha.id)
    else this.acoes.onClicar(ilha.id)
    this.agendar()
  }

  /** Gesto interrompido (janela perdeu o foco, sistema cancelou o ponteiro). */
  private readonly aoCancelar = (): void => {
    this.barcoPressionado = null
    this.elemento.classList.remove('arrastando')
    const arraste = this.arraste
    this.arraste = null
    if (arraste?.tipo === 'ilha' && arraste.moveu) {
      // Devolve a ilha ao estado de antes do gesto, sem gravar nada.
      this.emArraste = null
      const { ilha, fixoAntes } = arraste
      if (fixoAntes) {
        ilha.fx = fixoAntes.x
        ilha.fy = fixoAntes.y
      } else {
        delete ilha.fx
        delete ilha.fy
      }
      this.enviar({ tipo: 'fimArraste', id: ilha.id, fixo: fixoAntes })
    }
    this.agendar()
  }

  private readonly aoSair = (): void => {
    if (!this.arraste) this.definirHover(null)
  }

  private readonly aoMenu = (evento: MouseEvent): void => {
    evento.preventDefault()
    const mundo = this.paraMundo(evento.clientX, evento.clientY)
    const ilha = this.ilhaEm(mundo.x, mundo.y)
    if (ilha) {
      this.acoes.onSelecionar(ilha.id)
      this.acoes.onMenu(ilha.id, evento.clientX, evento.clientY)
    } else {
      // A pasta nova nasce exatamente onde o usuário apontou.
      this.acoes.onMenuDoFundo(evento.clientX, evento.clientY, mundo)
    }
  }

  /** Zoom pela roda, ancorado no cursor. A conta é a mesma do d3-zoom. */
  private readonly aoRolar = (evento: WheelEvent): void => {
    evento.preventDefault()
    const delta =
      -evento.deltaY *
      (evento.deltaMode === 1 ? 0.05 : evento.deltaMode ? 1 : 0.002) *
      // Pinça do touchpad chega como roda com Ctrl, e com deltas pequenos.
      (evento.ctrlKey ? 10 : 1)

    const tela = this.pontoNaTela(evento)
    const k = Math.min(ZOOM_MAXIMO, Math.max(ZOOM_MINIMO, this.alvo.k * Math.pow(2, delta)))
    const mundoX = (tela.x - this.alvo.x) / this.alvo.k
    const mundoY = (tela.y - this.alvo.y) / this.alvo.k

    this.inercia = { vx: 0, vy: 0 }
    this.ancora = tela
    this.alvo = { k, x: tela.x - mundoX * k, y: tela.y - mundoY * k }
    this.agendar()
  }

  private readonly aoMudarMovimento = (evento: MediaQueryListEvent): void => {
    this.semAnimacao = evento.matches
    this.agendar()
  }

  /** Janela escondida: a física também descansa. */
  private readonly aoMudarVisibilidade = (): void => {
    this.enviar({ tipo: 'pausar', pausado: document.hidden })
    if (!document.hidden) this.agendar()
  }
}
