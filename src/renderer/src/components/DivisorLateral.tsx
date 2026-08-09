import { useEffect, useRef, useState } from 'react'

export const LARGURA_PADRAO = 232
export const LARGURA_MIN = 168
export const LARGURA_MAX = 520

/** Quanto cada seta do teclado mexe na largura. */
const PASSO = 16

interface Props {
  largura: number
  onLargura: (largura: number) => void
}

export function limitarLargura(valor: number): number {
  return Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, Math.round(valor)))
}

/**
 * Alça entre a lista e o mapa.
 *
 * O arraste é por delta (posição inicial do ponteiro + largura inicial) e não
 * pelo `clientX` absoluto: assim a alça não "pula" para debaixo do cursor quando
 * o clique cai numa borda, e o cálculo não depende de onde o corpo começa.
 */
export default function DivisorLateral({ largura, onLargura }: Props): React.JSX.Element {
  const [arrastando, setArrastando] = useState(false)
  const inicio = useRef({ x: 0, largura: 0 })

  // Enquanto arrasta, o cursor precisa continuar de redimensionamento mesmo
  // passando por cima do canvas, e o texto da lista não pode ser selecionado.
  useEffect(() => {
    if (!arrastando) return
    document.body.classList.add('redimensionando')
    return () => document.body.classList.remove('redimensionando')
  }, [arrastando])

  return (
    <div
      className={arrastando ? 'divisor-lateral ativo' : 'divisor-lateral'}
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar a barra lateral"
      aria-valuenow={largura}
      aria-valuemin={LARGURA_MIN}
      aria-valuemax={LARGURA_MAX}
      tabIndex={0}
      title="Arraste para redimensionar · duplo clique volta ao padrão"
      onPointerDown={(evento) => {
        // Sem o preventDefault o arraste vira seleção de texto da lista.
        evento.preventDefault()
        inicio.current = { x: evento.clientX, largura }
        evento.currentTarget.setPointerCapture(evento.pointerId)
        setArrastando(true)
      }}
      onPointerMove={(evento) => {
        if (!arrastando) return
        onLargura(limitarLargura(inicio.current.largura + evento.clientX - inicio.current.x))
      }}
      onPointerUp={(evento) => {
        if (!arrastando) return
        evento.currentTarget.releasePointerCapture(evento.pointerId)
        setArrastando(false)
      }}
      onPointerCancel={() => setArrastando(false)}
      onDoubleClick={() => onLargura(LARGURA_PADRAO)}
      onKeyDown={(evento) => {
        if (evento.key === 'ArrowLeft') {
          evento.preventDefault()
          onLargura(limitarLargura(largura - PASSO))
        }
        if (evento.key === 'ArrowRight') {
          evento.preventDefault()
          onLargura(limitarLargura(largura + PASSO))
        }
      }}
    />
  )
}
