import { useEffect, useRef, useState } from 'react'

export interface Tamanho {
  largura: number
  altura: number
}

/**
 * Mede um elemento e reage a redimensionamentos.
 *
 * O canvas do mapa precisa de largura e altura em pixels — ele não se adapta
 * sozinho a um container flexível.
 */
export function useTamanho<T extends HTMLElement>(): [React.RefObject<T | null>, Tamanho] {
  const ref = useRef<T | null>(null)
  const [tamanho, setTamanho] = useState<Tamanho>({ largura: 0, altura: 0 })

  useEffect(() => {
    const alvo = ref.current
    if (!alvo) return

    const observador = new ResizeObserver(([entrada]) => {
      const { width, height } = entrada.contentRect
      setTamanho({ largura: Math.round(width), altura: Math.round(height) })
    })

    observador.observe(alvo)
    return () => observador.disconnect()
  }, [])

  return [ref, tamanho]
}
