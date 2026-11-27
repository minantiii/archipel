import { Container, Graphics, Text } from 'pixi.js'
import type { Barco, Rota, StatusAgente } from '../lib/agentes'
import type { PaletaDoMapa, TemaId } from '../lib/tema'

/**
 * Os barcos do time de agentes, desenhados por cima das ilhas.
 *
 * Cada agente é um *oshiokuri-bune*, o barco comprido e estreito de remadores
 * curvados de "A Grande Onda de Kanagawa" (Hokusai, ~1831): proa erguida em
 * ponta, uma fileira de remadores com os remos na água, e a espuma da proa
 * quebrando em "garras", como a crista da onda. O estado vai numa bandeirola
 * (*nobori*) na popa. Uma tarefa em andamento entre dois agentes vira uma rota
 * tracejada que anda de quem pediu para quem está fazendo.
 *
 * Fica fora do `motor.ts` porque não participa da física: os barcos seguem as
 * ilhas, mas não empurram nem são empurrados por elas.
 */

/** Distância da borda da ilha até o barco, por estado. */
const AFASTAMENTO: Record<StatusAgente, number> = {
  parado: 34,
  sessao: 17,
  trabalhando: 15,
  terminou: 24,
  falhou: 24
}

/**
 * Tinta do barco em cada tema. Nos temas de gravura as cores são as da
 * xilogravura: casco de madeira clara com contorno de nanquim, remadores em
 * azul da Prússia, espuma branca, e bandeirolas nas tintas da paleta (ocre,
 * azul, verde-musgo, vermelho de carimbo).
 */
interface EstiloDoBarco {
  casco: string
  /** Faixa de madeira ao longo do casco. */
  faixa: string
  contorno: string
  /** Espessura do contorno: traço de entalhe nas gravuras, fino no padrão. */
  traco: number
  remadores: string
  remos: string
  espuma: string
  /** Contorno da espuma: na gravura a espuma branca tem borda azul. `null` = sem borda. */
  bordaEspuma: string | null
  /** Pinceladas de água sob o casco. */
  agua: string
  /** Cor da bandeirola por estado. `null` = sem bandeirola (parado). */
  bandeira: Record<StatusAgente, string | null>
  rota: string
}

const ESTILOS: Record<TemaId, EstiloDoBarco> = {
  padrao: {
    casco: '#3a4558',
    faixa: '#566479',
    contorno: '#a9b6c8',
    traco: 0.7,
    remadores: '#d3dbe6',
    remos: '#8d99ab',
    espuma: '#e9eef5',
    bordaEspuma: null,
    agua: '#7f93ad',
    bandeira: {
      parado: null,
      sessao: '#68a0e3',
      trabalhando: '#ffb454',
      terminou: '#51cf66',
      falhou: '#ff6b81'
    },
    rota: '#ffb454'
  },
  kanagawa: {
    casco: '#e3cf9f',
    faixa: '#b08a55',
    contorno: '#1d2633',
    traco: 0.9,
    remadores: '#1f3b63',
    remos: '#1d2633',
    espuma: '#ffffff',
    bordaEspuma: '#1f3b63',
    agua: '#3d6b99',
    bandeira: {
      parado: null,
      sessao: '#3d6b99',
      trabalhando: '#c9933a',
      terminou: '#6f7d45',
      falhou: '#b8402e'
    },
    rota: '#b8402e'
  },
  'kanagawa-noite': {
    casco: '#c9b48a',
    faixa: '#8f7350',
    contorno: '#0d1a2b',
    traco: 0.9,
    remadores: '#9fc2de',
    remos: '#d9e4ea',
    espuma: '#eef4f7',
    bordaEspuma: '#6f9ccc',
    agua: '#6f9ccc',
    bandeira: {
      parado: null,
      sessao: '#9fc2de',
      trabalhando: '#e2b45a',
      terminou: '#9aae68',
      falhou: '#e0644c'
    },
    rota: '#e2b45a'
  }
}

/** Posição dos remadores ao longo do casco (a proa fica em +x). */
const REMADORES = [-9, -4.5, 0, 4.5, 9]

/** Quanto do caminho até o alvo o barco anda por quadro de 60 Hz. */
const VELOCIDADE = 0.045
/** O mesmo, passeando: devagar, deslizando, desacelerando ao chegar. */
const VELOCIDADE_PASSEIO = 0.007

/**
 * Passeio do barco parado: a cada trecho ele escolhe um ponto do mar em volta
 * da ilha e rema até lá. O ponto sai do nome e do número do trecho, então é
 * sempre o mesmo para o mesmo instante, sem guardar estado nenhum.
 */
const PASSEIO_MIN_MS = 9000
const PASSEIO_MAX_MS = 16000
const PASSEIO_PERTO = 26
const PASSEIO_LONGE = 80

function sorteio(nome: string, trecho: number, n: number): number {
  let h = 2166136261 ^ (trecho * 2654435761) ^ (n * 40503)
  for (let i = 0; i < nome.length; i++) h = Math.imul(h ^ nome.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}
/** Raio de clique em volta do barco, em pixels de tela. */
const RAIO_CLIQUE = 16

interface BarcoVisual {
  dados: Barco
  x: number
  y: number
  /** Ainda não recebeu posição: nasce já navegando de fora para o lugar. */
  novo: boolean
  fase: number
  /** 1 = proa para a direita. Fica como estava quando o barco para. */
  direcao: number
  corpo: Graphics
  rotulo: Text
  desenhado: string
}

export interface ReferenciaDeIlha {
  x: number
  y: number
  raio: number
}

function fase(nome: string): number {
  let h = 0
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}

export class CamadaDeBarcos {
  readonly container = new Container()
  private readonly rotasG = new Graphics()
  private readonly barcos = new Map<string, BarcoVisual>()
  private rotas: Rota[] = []
  private hover: string | null = null

  constructor(private paleta: PaletaDoMapa) {
    this.container.addChild(this.rotasG)
  }

  definirPaleta(paleta: PaletaDoMapa): void {
    this.paleta = paleta
    for (const barco of this.barcos.values()) {
      barco.desenhado = ''
      barco.rotulo.style.fill = paleta.rotulo
      barco.rotulo.style.fontFamily = paleta.fonte
      barco.rotulo.style.stroke = paleta.rotuloContorno
        ? { color: paleta.rotuloContorno, width: 3, join: 'round' }
        : { width: 0 }
    }
  }

  definir(barcos: readonly Barco[], rotas: readonly Rota[]): void {
    const vivos = new Set(barcos.map((b) => b.nome))
    for (const [nome, barco] of this.barcos) {
      if (vivos.has(nome)) continue
      barco.corpo.destroy()
      barco.rotulo.destroy()
      this.barcos.delete(nome)
    }
    for (const dados of barcos) {
      const atual = this.barcos.get(dados.nome)
      if (atual) {
        atual.dados = dados
        continue
      }
      const corpo = new Graphics()
      const rotulo = new Text({
        text: dados.nome,
        style: {
          fontFamily: this.paleta.fonte,
          fontSize: 10,
          fill: this.paleta.rotulo,
          stroke: this.paleta.rotuloContorno
            ? { color: this.paleta.rotuloContorno, width: 3, join: 'round' }
            : { width: 0 }
        },
        resolution: Math.max(2, window.devicePixelRatio || 1)
      })
      rotulo.anchor.set(0, 0.5)
      this.container.addChild(corpo, rotulo)
      this.barcos.set(dados.nome, {
        dados,
        x: 0,
        y: 0,
        novo: true,
        fase: fase(dados.nome),
        direcao: 1,
        corpo,
        rotulo,
        desenhado: ''
      })
    }
    this.rotas = [...rotas]
  }

  definirHover(nome: string | null): void {
    this.hover = nome
  }

  /** Onde cada barco quer estar: em volta da ilha dele, espalhados para não se empilharem. */
  private alvos(
    posDaIlha: (id: string) => ReferenciaDeIlha | null,
    centro: { x: number; y: number },
    agora: number,
    semAnimacao: boolean
  ): Map<string, { x: number; y: number; passeando: boolean }> {
    const porIlha = new Map<string, BarcoVisual[]>()
    for (const barco of this.barcos.values()) {
      const chave = barco.dados.ilha ?? ''
      porIlha.set(chave, [...(porIlha.get(chave) ?? []), barco])
    }
    const alvos = new Map<string, { x: number; y: number; passeando: boolean }>()
    for (const [chave, grupo] of porIlha) {
      const ref = (chave && posDaIlha(chave)) || { ...centro, raio: 6 }
      grupo.sort((a, b) => a.dados.nome.localeCompare(b.dados.nome))
      grupo.forEach((barco, i) => {
        const nome = barco.dados.nome
        if (barco.dados.status === 'parado' && !semAnimacao) {
          // Sem nada para fazer, passeia pelo mar em volta da ilha.
          const duracao = PASSEIO_MIN_MS + (PASSEIO_MAX_MS - PASSEIO_MIN_MS) * barco.fase
          const trecho = Math.floor((agora + barco.fase * duracao) / duracao)
          const angulo = sorteio(nome, trecho, 1) * Math.PI * 2
          const distancia =
            ref.raio + PASSEIO_PERTO + (PASSEIO_LONGE - PASSEIO_PERTO) * sorteio(nome, trecho, 2)
          alvos.set(nome, {
            x: ref.x + Math.cos(angulo) * distancia,
            // Achatado na vertical: o barco passeia mais para os lados que por cima da ilha.
            y: ref.y + Math.sin(angulo) * distancia * 0.7,
            passeando: true
          })
          return
        }
        // Trabalhando ou em sessão: encosta. Começa no alto à direita (embaixo
        // fica o nome da ilha) e vai abrindo o leque por cima dela.
        const angulo = -0.45 - i * 0.75
        const distancia = ref.raio + AFASTAMENTO[barco.dados.status]
        alvos.set(nome, {
          x: ref.x + Math.cos(angulo) * distancia,
          y: ref.y + Math.sin(angulo) * distancia,
          passeando: false
        })
      })
    }
    return alvos
  }

  /** Avança e desenha. Devolve `true` se algum barco ainda está navegando. */
  atualizar(
    passos: number,
    agora: number,
    k: number,
    posDaIlha: (id: string) => ReferenciaDeIlha | null,
    centro: { x: number; y: number },
    semAnimacao: boolean
  ): boolean {
    if (this.barcos.size === 0) {
      this.rotasG.clear()
      return false
    }
    const alvos = this.alvos(posDaIlha, centro, agora, semAnimacao)
    // De longe os barcos não somem; de perto não viram navios.
    const escala = Math.min(1.15, Math.max(0.5, 0.85 / Math.sqrt(Math.max(k, 0.01))))
    const fator = 1 - Math.pow(1 - VELOCIDADE, passos)
    const fatorPasseio = 1 - Math.pow(1 - VELOCIDADE_PASSEIO, passos)
    let navegando = false

    for (const barco of this.barcos.values()) {
      const alvo = alvos.get(barco.dados.nome)
      if (!alvo) continue
      if (barco.novo) {
        // Chega navegando de fora, em vez de surgir do nada.
        barco.novo = false
        barco.x = semAnimacao ? alvo.x : alvo.x + 70
        barco.y = semAnimacao ? alvo.y : alvo.y + 40
      }
      const dx = alvo.x - barco.x
      const dy = alvo.y - barco.y
      const distancia = Math.hypot(dx, dy)
      // Velocidade em unidades do mapa por quadro de 60 Hz: decide remo e espuma.
      let velocidade = 0
      if (semAnimacao || distancia < 0.2) {
        barco.x = alvo.x
        barco.y = alvo.y
      } else {
        const f = alvo.passeando ? fatorPasseio : fator
        barco.x += dx * f
        barco.y += dy * f
        velocidade = (distancia * f) / Math.max(passos, 0.01)
        // O passeio não acorda o laço a 60 fps: a flutuação já pinta o mapa
        // devagar, e o barco desliza nela.
        if (!alvo.passeando) navegando = true
      }

      const balanco = semAnimacao ? 0 : Math.sin(agora / 900 + barco.fase * 6.28) * 1.1
      const inclinacao = semAnimacao ? 0 : Math.sin(agora / 1300 + barco.fase * 6.28) * 0.06
      this.desenharBarco(barco, agora, velocidade, semAnimacao)
      barco.corpo.position.set(barco.x, barco.y + balanco)
      barco.corpo.rotation = inclinacao
      // Virado para onde navega: o casco é desenhado apontando para a direita.
      if (Math.abs(dx) > 1) barco.direcao = Math.sign(dx)
      barco.corpo.scale.set(escala * barco.direcao, escala)

      const status = barco.dados.status
      barco.rotulo.visible = k > 0.55 || status !== 'parado' || this.hover === barco.dados.nome
      // Ao lado do barco, e não embaixo: embaixo fica o nome da ilha.
      barco.rotulo.position.set(barco.x + 23 * escala, barco.y + balanco - 3 * escala)
      // O nome fica do tamanho dos nomes das ilhas, em vez de crescer com o zoom.
      barco.rotulo.scale.set(Math.min(escala, 1.05 / Math.max(k, 0.01)))
      barco.rotulo.alpha = status === 'parado' && this.hover !== barco.dados.nome ? 0.7 : 1
    }

    this.desenharRotas(agora, escala, semAnimacao)
    return navegando
  }

  private desenharBarco(
    barco: BarcoVisual,
    agora: number,
    velocidade: number,
    semAnimacao: boolean
  ): void {
    // Remando com qualquer movimento; espuma só com o barco andando rápido.
    const emMovimento = !semAnimacao && velocidade > 0.03
    const espumando = !semAnimacao && velocidade > 0.35
    const status = barco.dados.status
    const estilo = ESTILOS[this.paleta.id]
    const bandeira = estilo.bandeira[status]
    const remando = !semAnimacao && (status === 'trabalhando' || emMovimento)
    // Remada em 6 quadros: redesenha só quando o remo muda de posição.
    const remada = remando ? Math.round(((agora / 140 + barco.fase * 6) % 6)) % 6 : 0
    const realce = this.hover === barco.dados.nome
    const assinatura = `${this.paleta.id}:${status}:${remada}:${realce}:${espumando}`
    if (assinatura === barco.desenhado) return
    barco.desenhado = assinatura

    const g = barco.corpo
    g.clear()
    const contorno = { width: estilo.traco, color: estilo.contorno, alpha: 0.95 }

    if (realce) g.ellipse(1, 0, 24, 9).fill({ color: estilo.espuma, alpha: 0.14 })

    // Água: duas pinceladas curtas sob o casco, como as linhas da gravura.
    g.moveTo(-17, 5.2).quadraticCurveTo(-12, 3.6, -7, 5.2)
    g.moveTo(-3, 5.6).quadraticCurveTo(3, 4, 9, 5.6)
    g.stroke({ width: 0.8, color: estilo.agua, alpha: 0.7 })

    // Remos: da mão de cada remador até a água, para trás. Animados ao remar.
    const balanco = remando ? Math.sin((remada / 6) * Math.PI * 2) * 2.2 : 0
    for (const x of REMADORES) {
      g.moveTo(x + 0.8, -2.2).lineTo(x - 4.5 + balanco, 6)
    }
    g.stroke({ width: 0.55, color: estilo.remos, alpha: 0.85 })

    // Remadores: curvados, cabeça baixa, como na gravura.
    for (const x of REMADORES) {
      const curva = remando ? balanco * 0.18 : 0
      g.ellipse(x + curva, -2.4, 1.9, 1.5).fill(estilo.remadores)
      g.circle(x + 1.2 + curva, -3.9, 1).fill(estilo.remadores)
    }

    // Casco: comprido e baixo, popa curta e proa subindo em ponta.
    g.moveTo(-15.5, -1.6)
      .lineTo(12, -1.2)
      .quadraticCurveTo(16, -1.6, 19.5, -6)
      .quadraticCurveTo(18, 0.5, 12.5, 3.4)
      .lineTo(-11.5, 3.4)
      .quadraticCurveTo(-15, 2.6, -15.5, -1.6)
      .closePath()
      .fill(estilo.casco)
      .stroke(contorno)
    // Faixa de madeira ao longo do costado.
    g.moveTo(-13.5, 0.9).lineTo(13.5, 1.1).stroke({ width: 1.1, color: estilo.faixa, alpha: 0.9 })

    // Nobori na popa: a cor diz o estado. Parado não leva bandeira.
    if (bandeira) {
      // O mastro na cor dos remos: em nanquim ele sumia no mar escuro do tema noite.
      g.moveTo(-13.6, -1.6).lineTo(-13.6, -14.5).stroke({ width: 0.7, color: estilo.remos })
      const tremula = semAnimacao ? 0 : Math.sin(agora / 300 + barco.fase * 6) * 0.6
      g.moveTo(-13.2, -14.2)
        .lineTo(-9.2 + tremula, -13.8)
        .lineTo(-9.4 + tremula, -7.6)
        .lineTo(-13.2, -8)
        .closePath()
        .fill(bandeira)
        .stroke({ width: 0.5, color: estilo.contorno, alpha: 0.8 })
    }

    // Espuma da proa quebrando em garras, como a crista da Grande Onda.
    if (espumando || status === 'trabalhando') {
      // A crista: uma lâmina de espuma que sobe da linha d'água e enrola na ponta.
      g.moveTo(12, 4.2)
        .quadraticCurveTo(21, 5.4, 24, 0.2)
        .quadraticCurveTo(25, -2.6, 22.6, -3.2)
        .quadraticCurveTo(23.6, -0.6, 21.2, 1.6)
        .quadraticCurveTo(17, 3.4, 12, 4.2)
        .closePath()
        .fill(estilo.espuma)
      if (estilo.bordaEspuma) g.stroke({ width: 0.5, color: estilo.bordaEspuma, alpha: 0.9 })
      // As garras: gotas soltas na frente da crista.
      const garras: Array<[number, number, number]> = [
        [25.4, -3.4, 0.75],
        [24.2, -4.8, 0.6],
        [26.4, -1.4, 0.55],
        [22.4, -4.9, 0.45]
      ]
      for (const [x, y, r] of garras) {
        g.circle(x, y, r).fill(estilo.espuma)
        if (estilo.bordaEspuma) g.stroke({ width: 0.35, color: estilo.bordaEspuma, alpha: 0.9 })
      }
    }
  }

  private desenharRotas(agora: number, escala: number, semAnimacao: boolean): void {
    const g = this.rotasG
    g.clear()
    for (const rota of this.rotas) {
      const de = this.barcos.get(rota.de)
      const para = this.barcos.get(rota.para)
      if (!de || !para) continue
      const dx = para.x - de.x
      const dy = para.y - de.y
      const comprimento = Math.hypot(dx, dy)
      if (comprimento < 4) continue
      // Tracejado que anda de quem pediu para quem faz.
      const traco = 5 * escala
      const vao = 4 * escala
      const passo = traco + vao
      const deslocamento = semAnimacao ? 0 : ((agora / 40) * escala) % passo
      for (let s = deslocamento - passo; s < comprimento; s += passo) {
        const a = Math.max(0, s)
        const b = Math.min(comprimento, s + traco)
        if (b <= a) continue
        g.moveTo(de.x + (dx * a) / comprimento, de.y + (dy * a) / comprimento)
        g.lineTo(de.x + (dx * b) / comprimento, de.y + (dy * b) / comprimento)
      }
      g.stroke({ width: 1.3 * escala, color: ESTILOS[this.paleta.id].rota, alpha: 0.85 })
    }
  }

  /** O barco sob o ponto do mapa, ou `null`. */
  barcoEm(x: number, y: number, k: number): string | null {
    const raio = RAIO_CLIQUE / Math.max(k, 0.01)
    let melhor: string | null = null
    let melhorDistancia = Infinity
    for (const barco of this.barcos.values()) {
      // O desenho fica acima do ponto de ancoragem: mira no meio da vela.
      const d = Math.hypot(barco.x + 2 - x, barco.y - 3 - y)
      if (d < raio && d < melhorDistancia) {
        melhor = barco.dados.nome
        melhorDistancia = d
      }
    }
    return melhor
  }

  temBarcos(): boolean {
    return this.barcos.size > 0
  }

  destruir(): void {
    this.container.destroy({ children: true })
    this.barcos.clear()
  }
}
