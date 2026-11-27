import { useEffect, useRef } from 'react'
import { PALETAS, TEMAS } from '../lib/tema'
import { useStore } from '../state/store'

/**
 * Painel de configurações, aberto pela engrenagem do topo.
 *
 * Por enquanto só o tema. Cada opção mostra uma amostra das cores dela, para a
 * escolha ser pelo que se vê e não pelo nome.
 */
export default function Configuracoes({ onFechar }: { onFechar: () => void }): React.JSX.Element {
  const t = useStore((e) => e.t)
  const tema = useStore((e) => e.tema)
  const definirTema = useStore((e) => e.definirTema)
  const caixa = useRef<HTMLDivElement | null>(null)

  // Fecha com Esc ou clicando fora, como o menu de contexto.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') onFechar()
    }
    const aoClicar = (evento: PointerEvent): void => {
      const alvo = evento.target as Node
      if (caixa.current?.contains(alvo)) return
      if ((alvo as HTMLElement).closest?.('.botao-configuracoes')) return
      onFechar()
    }
    window.addEventListener('keydown', aoTeclar)
    window.addEventListener('pointerdown', aoClicar)
    return () => {
      window.removeEventListener('keydown', aoTeclar)
      window.removeEventListener('pointerdown', aoClicar)
    }
  }, [onFechar])

  return (
    <div className="configuracoes" ref={caixa} role="dialog" aria-label={t.configuracoes}>
      <h2>{t.configuracoes}</h2>
      <h3>{t.tema}</h3>
      <div className="lista-temas" role="radiogroup" aria-label={t.tema}>
        {TEMAS.map((id) => {
          const paleta = PALETAS[id]
          const fundo = paleta.ondas?.fundo ?? '#141416'
          return (
            <button
              key={id}
              role="radio"
              aria-checked={tema === id}
              className={tema === id ? 'opcao-tema ativo' : 'opcao-tema'}
              onClick={() => definirTema(id)}
            >
              <span className={`amostra-tema amostra-${id}`} style={{ background: fundo }}>
                {(paleta.tintas ?? ['#2570cc', '#22d3ee', '#ffb454']).slice(0, 4).map((cor) => (
                  <i key={cor} style={{ background: cor, borderColor: paleta.nanquim ?? cor }} />
                ))}
              </span>
              <span className="opcao-tema-texto">
                <strong>{t.temas[id].nome}</strong>
                <small>{t.temas[id].descricao}</small>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
