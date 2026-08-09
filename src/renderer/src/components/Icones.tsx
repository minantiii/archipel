/**
 * Ícones do app, em SVG inline.
 *
 * Inline e não uma biblioteca: são poucos, e um pacote de ícones acrescentaria
 * centenas de KB ao bundle para usar dois desenhos. Todos herdam a cor do texto
 * via `currentColor`, então acompanham hover e estado ativo sem regra extra.
 *
 * `stroke-width` fica em 1.6 e o traço é arredondado para casar com o peso da
 * tipografia da barra — ícone muito fino some no tema escuro, muito grosso vira
 * mancha ao lado de um texto de 13px.
 */

interface Props {
  /** Lado do quadrado em pixels. */
  tamanho?: number
}

const comuns = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

/** Seta circular: recarregar. A falha no anel é o que faz ler como "girar". */
export function IconeRecarregar({ tamanho = 16 }: Props): React.JSX.Element {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true" {...comuns}>
      <path d="M20 11a8 8 0 1 0-.6 4" />
      <polyline points="20 4.5 20 11 13.8 11" />
    </svg>
  )
}

/**
 * Modo conexão: duas ilhas ligadas por um fio.
 *
 * Escolhido no lugar de uma tomada porque é literalmente o que o modo faz —
 * unir duas ilhas do mapa. Uma tomada em 16px vira um borrão e puxa a leitura
 * para "energia" em vez de "ligação".
 */
export function IconeConexao({ tamanho = 16 }: Props): React.JSX.Element {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true" {...comuns}>
      <line x1="8.6" y1="15.4" x2="15.4" y2="8.6" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="6" r="3" />
    </svg>
  )
}

/**
 * Enquadrar o mapa: quatro cantos de visor com um alvo no meio.
 *
 * Os cantos dizem "moldura" e o ponto no centro diz que algo vai para dentro
 * dela. Uma lupa prometeria zoom (que não é bem o que o botão faz) e uma
 * casinha prometeria "voltar ao início", que é outra coisa.
 */
export function IconeEnquadrar({ tamanho = 16 }: Props): React.JSX.Element {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true" {...comuns}>
      <path d="M4 9V5.6A1.6 1.6 0 0 1 5.6 4H9" />
      <path d="M15 4h3.4A1.6 1.6 0 0 1 20 5.6V9" />
      <path d="M20 15v3.4a1.6 1.6 0 0 1-1.6 1.6H15" />
      <path d="M9 20H5.6A1.6 1.6 0 0 1 4 18.4V15" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  )
}
