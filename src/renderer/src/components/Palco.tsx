import { useEffect, useRef } from 'react'
import type { Mapa } from '@shared/types'
import { MotorDoMapa, type AcoesDoPalco } from '../mapa/motor'
import { useStore } from '../state/store'
import { IconeEnquadrar } from './Icones'
import { TIPO_ARRASTE } from './Sidebar'

/**
 * O palco: só a casca React do mapa.
 *
 * Quem desenha, anima e ouve o mouse é o `MotorDoMapa` (PixiJS + física num
 * Web Worker). Este componente cria o motor uma vez e repassa a ele o que vem
 * do React. Hover, arraste e zoom não passam por aqui, então mexer no mapa não
 * re-renderiza componente nenhum.
 */

interface Props {
  mapa: Mapa
  selecionado: string | null
  /** Ilhas que passam pela busca/filtro. `null` = sem filtro, todas acesas. */
  destacados: Set<string> | null
  /** Primeira ponta escolhida no modo conexão. */
  conectandoDe: string | null
  /** Clique numa ilha. Separado da seleção porque no modo conexão ele liga pontas. */
  onClicar: (id: string) => void
  /** Seleção que não veio de um clique: menu, soltar da lista, clique no vazio. */
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
  onClicar,
  onSelecionar,
  onAbrir,
  onFixar,
  onMenu,
  onMenuDoFundo
}: Props): React.JSX.Element {
  const t = useStore((e) => e.t)
  const container = useRef<HTMLDivElement | null>(null)
  const motor = useRef<MotorDoMapa | null>(null)

  // As ações e os dados mais recentes, lidos pelo motor quando ele fica pronto.
  // Num ref porque o motor nasce de forma assíncrona e não pode perder o que
  // chegou enquanto ele subia.
  const acoes: AcoesDoPalco = { onClicar, onSelecionar, onAbrir, onFixar, onMenu, onMenuDoFundo }
  const ultimo = useRef({ mapa, acoes, estado: { selecionado, destacados, conectandoDe } })
  ultimo.current = { mapa, acoes, estado: { selecionado, destacados, conectandoDe } }

  useEffect(() => {
    const elemento = container.current
    if (!elemento) return

    // No StrictMode o efeito monta, desmonta e monta de novo: o motor que
    // terminar de subir depois de desmontado é destruído na hora.
    let cancelado = false
    void MotorDoMapa.criar(elemento, ultimo.current.acoes).then((criado) => {
      if (cancelado) {
        criado.destruir()
        return
      }
      motor.current = criado
      criado.definirEstado(ultimo.current.estado)
      criado.definirMapa(ultimo.current.mapa)
    })

    return () => {
      cancelado = true
      motor.current?.destruir()
      motor.current = null
    }
  }, [])

  useEffect(() => {
    motor.current?.definirMapa(mapa)
  }, [mapa])

  useEffect(() => {
    motor.current?.definirEstado({ selecionado, destacados, conectandoDe })
  }, [selecionado, destacados, conectandoDe])

  useEffect(() => {
    motor.current?.definirAcoes(acoes)
  })

  // `Home` faz o mesmo que o botão de enquadrar, fora dos campos de texto.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Home') return
      if (evento.ctrlKey || evento.altKey || evento.metaKey) return
      if ((evento.target as HTMLElement | null)?.matches('input, textarea')) return
      evento.preventDefault()
      motor.current?.enquadrar()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [])

  return (
    <div
      ref={container}
      // `sobre-ilha` e `arrastando` são ligadas pelo próprio motor direto no
      // elemento; aqui o `className` fica constante para o React não apagá-las.
      className="palco"
      onDragOver={(evento) => {
        // Só aceita o que veio da lista lateral; sem o preventDefault o drop nem acontece.
        if (!evento.dataTransfer.types.includes(TIPO_ARRASTE)) return
        evento.preventDefault()
        evento.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(evento) => {
        evento.preventDefault()
        const id = evento.dataTransfer.getData(TIPO_ARRASTE)
        if (!id || !motor.current) return
        const ponto = motor.current.soltarDaLista(id, evento.clientX, evento.clientY)
        if (!ponto) return
        onSelecionar(id)
        onFixar(id, ponto)
      }}
    >
      {/* Só aparece havendo ilha para enquadrar: num mapa vazio o botão não teria
          para onde levar. */}
      {mapa.ilhas.length > 0 && (
        <button
          type="button"
          className="botao-enquadrar"
          onClick={() => motor.current?.enquadrar()}
          title={t.enquadrar}
          aria-label={t.enquadrarRotulo}
        >
          <IconeEnquadrar tamanho={17} />
        </button>
      )}

      <div className="dica-mapa">
        {t.dicaDoMapa} <kbd>Alt</kbd> {t.dicaDoMapaAlt}
      </div>
    </div>
  )
}
