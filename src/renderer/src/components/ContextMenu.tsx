import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ItemMenu {
  rotulo: string
  acao: () => void
  perigoso?: boolean
  desabilitado?: boolean
}

interface Props {
  x: number
  y: number
  titulo: string
  itens: ItemMenu[]
  onFechar: () => void
}

export default function ContextMenu({ x, y, titulo, itens, onFechar }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [posicao, setPosicao] = useState({ x, y })

  // Fecha em qualquer clique fora, rolagem ou Esc — o comportamento que todo
  // menu de contexto tem e que se sente na falta quando não existe.
  //
  // Os ouvintes vão na fase de CAPTURA, e isso não é detalhe: o d3-zoom, que
  // cuida do arrastar e do zoom do mapa, chama `stopImmediatePropagation()` no
  // `mousedown` do canvas. Ele só faz isso quando o filtro dele aceita o evento,
  // e o filtro rejeita o botão direito — resultado: na fase de bolha o clique
  // direito chegava aqui e o esquerdo não, então o menu só fechava com o direito.
  // Na captura a janela vê o evento antes do canvas, e os dois funcionam.
  useEffect(() => {
    const aoClicar = (evento: MouseEvent): void => {
      if (!ref.current?.contains(evento.target as Node)) onFechar()
    }
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') onFechar()
    }

    window.addEventListener('mousedown', aoClicar, true)
    window.addEventListener('keydown', aoTeclar, true)
    window.addEventListener('wheel', onFechar, { passive: true, capture: true })
    return () => {
      window.removeEventListener('mousedown', aoClicar, true)
      window.removeEventListener('keydown', aoTeclar, true)
      window.removeEventListener('wheel', onFechar, true)
    }
  }, [onFechar])

  // Clicar perto da borda não pode jogar metade do menu para fora da janela.
  useLayoutEffect(() => {
    const elemento = ref.current
    if (!elemento) return

    const { width, height } = elemento.getBoundingClientRect()
    setPosicao({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8)
    })
  }, [x, y])

  return (
    <div ref={ref} className="menu-contexto" style={{ left: posicao.x, top: posicao.y }}>
      <div className="menu-titulo" title={titulo}>
        {titulo}
      </div>
      {itens.map((item) => (
        <button
          key={item.rotulo}
          className={item.perigoso ? 'menu-item perigoso' : 'menu-item'}
          disabled={item.desabilitado}
          onClick={() => {
            item.acao()
            onFechar()
          }}
        >
          {item.rotulo}
        </button>
      ))}
    </div>
  )
}
