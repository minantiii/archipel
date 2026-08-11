import { useMemo, useState } from 'react'
import type { Mapa, Ilha } from '@shared/types'
import { useStore } from '../state/store'

/** Tipo de dado do arrastar, usado para o mapa saber que a origem foi a lista. */
export const TIPO_ARRASTE = 'application/x-organizador-pasta'

interface Props {
  mapa: Mapa
  /** Largura em pixels, controlada pelo divisor que fica ao lado. */
  largura: number
  busca: string
  filtroTag: string | null
  selecionado: string | null
  onBusca: (texto: string) => void
  onFiltroTag: (tag: string | null) => void
  onSelecionar: (id: string) => void
  onAbrir: (id: string) => void
  onReordenar: (ids: string[]) => void
}

/** Normaliza para busca tolerante a acento e caixa ("telemetria" acha "ApiTelemetria"). */
function normalizar(texto: string): string {
  // ̀-ͯ é a faixa de acentos combinantes que o NFD separa das letras.
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Aplica a ordem manual do `config.yaml`.
 *
 * Quem não está na lista vai para o fim em ordem alfabética — assim uma pasta
 * recém-chegada aparece no rodapé em vez de sumir ou embaralhar o resto.
 */
function ordenar(ilhas: Ilha[], ordem: string[]): Ilha[] {
  const posicao = new Map(ordem.map((id, indice) => [id, indice]))
  return [...ilhas].sort((a, b) => {
    const pa = posicao.get(a.id)
    const pb = posicao.get(b.id)
    if (pa !== undefined && pb !== undefined) return pa - pb
    if (pa !== undefined) return -1
    if (pb !== undefined) return 1
    return a.id.localeCompare(b.id, 'pt-BR')
  })
}

export default function Sidebar({
  mapa,
  largura,
  busca,
  filtroTag,
  selecionado,
  onBusca,
  onFiltroTag,
  onSelecionar,
  onAbrir,
  onReordenar
}: Props): React.JSX.Element {
  const t = useStore((e) => e.t)
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [alvo, setAlvo] = useState<string | null>(null)

  const ordenados = useMemo(() => ordenar(mapa.ilhas, mapa.ordem), [mapa.ilhas, mapa.ordem])

  const visiveis = useMemo(() => {
    const texto = normalizar(busca.trim())
    return ordenados.filter((ilha) => {
      if (filtroTag && !ilha.tags.includes(filtroTag)) return false
      if (texto.length === 0) return true
      // Procura no nome e na diario: às vezes você lembra do que a pasta faz,
      // não de como ela se chama.
      return normalizar(ilha.id).includes(texto) || normalizar(ilha.diario).includes(texto)
    })
  }, [ordenados, busca, filtroTag])

  const contagemPorTag = useMemo(() => {
    const contagem = new Map<string, number>()
    for (const ilha of mapa.ilhas) {
      for (const tag of ilha.tags) contagem.set(tag, (contagem.get(tag) ?? 0) + 1)
    }
    return contagem
  }, [mapa.ilhas])

  /** Reordena sobre a lista completa, não sobre a filtrada. */
  const soltarSobre = (destino: string): void => {
    if (!arrastando || arrastando === destino) return

    const ids = ordenados.map((n) => n.id)
    const de = ids.indexOf(arrastando)
    const para = ids.indexOf(destino)
    if (de < 0 || para < 0) return

    ids.splice(de, 1)
    ids.splice(para, 0, arrastando)
    onReordenar(ids)
  }

  const reordenacaoAtiva = busca.trim().length === 0 && !filtroTag

  return (
    <aside className="lateral" style={{ width: largura }}>
      <input
        className="campo-busca"
        type="search"
        value={busca}
        placeholder={t.buscar}
        onChange={(evento) => onBusca(evento.target.value)}
      />

      {mapa.tags.length > 0 && (
        <div className="tags-filtro">
          {mapa.tags.map((tag) => (
            <button
              key={tag.nome}
              className={filtroTag === tag.nome ? 'chip-tag ativo' : 'chip-tag'}
              style={{ '--cor-tag': tag.cor } as React.CSSProperties}
              onClick={() => onFiltroTag(tag.nome)}
              title={t.pastasComATag(contagemPorTag.get(tag.nome) ?? 0)}
            >
              {tag.nome}
            </button>
          ))}
        </div>
      )}

      <div className="lista-pastas" onDragLeave={() => setAlvo(null)}>
        {visiveis.length === 0 && <p className="lista-vazia">{t.nadaEncontrado}</p>}

        {visiveis.map((ilha) => (
          <div
            key={ilha.id}
            className={
              'item-pasta' +
              (ilha.id === selecionado ? ' ativo' : '') +
              (ilha.ausente ? ' ausente' : '') +
              (ilha.id === arrastando ? ' arrastando' : '') +
              (ilha.id === alvo ? ' alvo' : '')
            }
            role="button"
            tabIndex={0}
            draggable
            title={
              ilha.ausente
                ? t.pastaSumiu
                : t.dicaDoItem(ilha.caminho)
            }
            onClick={() => onSelecionar(ilha.id)}
            onDoubleClick={() => onAbrir(ilha.id)}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter') onAbrir(ilha.id)
              if (evento.key === ' ') {
                evento.preventDefault()
                onSelecionar(ilha.id)
              }
            }}
            onDragStart={(evento) => {
              setArrastando(ilha.id)
              evento.dataTransfer.effectAllowed = 'move'
              // Dois formatos: o próprio para o mapa reconhecer a origem, e
              // text/plain para o arraste não parecer inválido no Windows.
              evento.dataTransfer.setData(TIPO_ARRASTE, ilha.id)
              evento.dataTransfer.setData('text/plain', ilha.id)
            }}
            onDragEnd={() => {
              setArrastando(null)
              setAlvo(null)
            }}
            onDragOver={(evento) => {
              if (!arrastando || !reordenacaoAtiva) return
              // Sem o preventDefault o navegador recusa o drop.
              evento.preventDefault()
              evento.dataTransfer.dropEffect = 'move'
              if (ilha.id !== alvo) setAlvo(ilha.id)
            }}
            onDrop={(evento) => {
              if (!reordenacaoAtiva) return
              evento.preventDefault()
              soltarSobre(ilha.id)
              setAlvo(null)
            }}
          >
            <span
              className="ponto-cor"
              style={{
                background:
                  ilha.cor ?? mapa.tags.find((t) => t.nome === ilha.tags[0])?.cor ?? '#6b6b78'
              }}
            />
            <span className="item-nome">{ilha.id}</span>
            {ilha.ausente && <span className="selo-ausente">{t.seloAusente}</span>}
          </div>
        ))}
      </div>

      <footer className="lateral-rodape">
        {t.contagemLista(visiveis.length, mapa.ilhas.length)}
        {!reordenacaoAtiva && <span className="aviso-ordem">{t.limpeParaReordenar}</span>}
      </footer>
    </aside>
  )
}
