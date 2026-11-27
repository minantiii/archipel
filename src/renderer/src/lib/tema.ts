/**
 * Temas visuais do app.
 *
 * A interface (HTML) troca de cara pelo atributo `data-tema` no `<html>`, com as
 * variáveis do `styles.css`. O mapa é WebGL e não lê CSS, então cada tema também
 * carrega a paleta que o `MotorDoMapa` usa para desenhar.
 *
 * Os dois temas Kanagawa vêm da xilogravura japonesa (ukiyo-e), no espírito de
 * "A Grande Onda de Kanagawa" (Hokusai, ~1831): azul da Prússia, papel creme,
 * contorno de nanquim, traço de pincel e o padrão de ondas no mar.
 */

export type TemaId = 'padrao' | 'kanagawa' | 'kanagawa-noite'

export const TEMAS: TemaId[] = ['padrao', 'kanagawa', 'kanagawa-noite']

type Rgb = [number, number, number]

export interface PaletaDoMapa {
  id: TemaId
  neutra: string
  ausente: string
  rotulo: string
  rotuloAusente: string
  /** Contorno do rótulo, para o texto não sumir em cima do padrão de ondas. */
  rotuloContorno: string | null
  destaque: string
  ponte: Rgb
  ponteAcesa: Rgb
  /** Anel da ilha selecionada e da fixada. */
  anel: string
  /** Contorno de nanquim em volta da ilha. `null` = sem contorno. */
  nanquim: string | null
  /** Pontes como traço de pincel (grosso no meio, fino nas pontas). */
  pincel: boolean
  /** Padrão de ondas no fundo do mapa. `null` = fundo liso. */
  ondas: { cor: string; fundo: string; alpha: number } | null
  fonte: string
  /** Cores das tags trocadas pela tinta mais próxima da paleta do tema. */
  tintas: string[] | null
  /** Cor e símbolos dos botões de janela do Windows, por cima do topo. */
  topo: { cor: string; simbolos: string }
}

const FONTE_PADRAO = "'Segoe UI', system-ui, sans-serif"
const FONTE_GRAVURA = "'Palatino Linotype', 'Book Antiqua', Georgia, 'Yu Mincho', serif"

/** Tintas de uma gravura ukiyo-e: azuis da onda, vermelho de carimbo, ocre, verde-musgo. */
const TINTAS_GRAVURA = [
  '#1f3b63', // azul da Prússia
  '#3d6b99', // azul médio
  '#7fa6c4', // azul claro da espuma
  '#b8402e', // vermelho de carimbo (shu)
  '#c9933a', // ocre
  '#6f7d45', // verde-musgo
  '#a35a70', // ameixa
  '#8a6a4a', // madeira
  '#4b4a45' // nanquim diluído
]

const TINTAS_GRAVURA_NOITE = [
  '#6f9ccc',
  '#9fc2de',
  '#d9e4ea',
  '#e0644c',
  '#e2b45a',
  '#9aae68',
  '#cf8aa0',
  '#b8936c',
  '#a8a49a'
]

export const PALETAS: Record<TemaId, PaletaDoMapa> = {
  padrao: {
    id: 'padrao',
    neutra: '#6b6b78',
    ausente: '#4a4a55',
    rotulo: '#d8d8e0',
    rotuloAusente: '#7a7a86',
    rotuloContorno: null,
    destaque: '#68a0e3',
    ponte: [0x3a, 0x3a, 0x45],
    ponteAcesa: [0x46, 0x88, 0xd7],
    anel: '#ffffff',
    nanquim: null,
    pincel: false,
    ondas: null,
    fonte: FONTE_PADRAO,
    tintas: null,
    topo: { cor: '#1e1e23', simbolos: '#e6e6ea' }
  },
  kanagawa: {
    id: 'kanagawa',
    neutra: '#8a8270',
    ausente: '#b9ae95',
    rotulo: '#1d2633',
    rotuloAusente: '#8a8270',
    rotuloContorno: '#efe4cc',
    destaque: '#b8402e',
    ponte: [0x5b, 0x6b, 0x7e],
    ponteAcesa: [0x1f, 0x3b, 0x63],
    anel: '#b8402e',
    nanquim: '#1d2633',
    pincel: true,
    ondas: { cor: '#3d6b99', fundo: '#efe4cc', alpha: 0.1 },
    fonte: FONTE_GRAVURA,
    tintas: TINTAS_GRAVURA,
    topo: { cor: '#e6d8bb', simbolos: '#1d2633' }
  },
  'kanagawa-noite': {
    id: 'kanagawa-noite',
    neutra: '#7d8794',
    ausente: '#3f4a5a',
    rotulo: '#ece2cc',
    rotuloAusente: '#7d8794',
    rotuloContorno: '#0f1a2b',
    destaque: '#e0644c',
    ponte: [0x3a, 0x50, 0x6c],
    ponteAcesa: [0x9f, 0xc2, 0xde],
    anel: '#ece2cc',
    nanquim: '#0a1220',
    pincel: true,
    ondas: { cor: '#9fc2de', fundo: '#0f1a2b', alpha: 0.09 },
    fonte: FONTE_GRAVURA,
    tintas: TINTAS_GRAVURA_NOITE,
    topo: { cor: '#14223a', simbolos: '#ece2cc' }
  }
}

const CHAVE = 'archipel:tema'

export function temaSalvo(): TemaId {
  // Sem `localStorage` (testes em Node), fica o padrão.
  const salvo = globalThis.localStorage?.getItem(CHAVE)
  return TEMAS.includes(salvo as TemaId) ? (salvo as TemaId) : 'padrao'
}

/** Liga o tema na interface e guarda a escolha. A paleta do mapa vai à parte. */
export function aplicarTema(tema: TemaId): void {
  localStorage.setItem(CHAVE, tema)
  document.documentElement.dataset.tema = tema
  const { cor, simbolos } = PALETAS[tema].topo
  window.api?.sistema?.corDoTopo?.(cor, simbolos)
}

function paraRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]
  const n = parseInt(h, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Matiz (0–360), saturação e luminosidade (0–1). */
function paraHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [h * 60, s, l]
}

const cache = new Map<string, string>()

/**
 * A cor que uma tag ou ilha mostra no tema.
 *
 * No padrão é a própria cor. Nos temas de gravura vira a tinta mais parecida,
 * para o mapa não ficar com um verde-neon no meio de um papel de 1831. A escolha
 * é pelo matiz, então tags de cores diferentes continuam diferentes.
 */
export function corNoTema(cor: string, tema: TemaId): string {
  const tintas = PALETAS[tema].tintas
  if (!tintas) return cor
  const chave = `${tema}|${cor}`
  const pronta = cache.get(chave)
  if (pronta) return pronta

  const rgb = paraRgb(cor)
  if (!rgb) return cor
  const [h, s, l] = paraHsl(rgb)
  let melhor = tintas[0]
  let menor = Infinity
  for (const tinta of tintas) {
    const outra = paraRgb(tinta) as Rgb
    const [th, ts, tl] = paraHsl(outra)
    const dh = Math.min(Math.abs(h - th), 360 - Math.abs(h - th)) / 180
    // Cor quase cinza não tem matiz que preste: compara só pela saturação e luz.
    const pesoMatiz = Math.min(s, ts) < 0.12 ? 0 : 2.2
    const distancia = pesoMatiz * dh + Math.abs(s - ts) + 1.2 * Math.abs(l - tl)
    if (distancia < menor) {
      menor = distancia
      melhor = tinta
    }
  }
  cache.set(chave, melhor)
  return melhor
}
