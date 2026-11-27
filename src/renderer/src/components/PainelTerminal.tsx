import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { TERMINAIS, type TemaId } from '../lib/tema'
import { useStore } from '../state/store'

/**
 * Terminal embutido, no rodapé do mapa.
 *
 * Cada aba é um shell de verdade rodando no main (`node-pty`); aqui só se
 * desenha (xterm.js) e se repassa o teclado. As abas continuam vivas com o
 * painel escondido: fechar o painel não mata o que está rodando, fechar a aba sim.
 */

export const ALTURA_PADRAO_TERMINAL = 260
export const ALTURA_MINIMA_TERMINAL = 110

interface Aba {
  chave: number
  ilha: string | null
  /** Aba de sessão de um agente: roda o motor dele em vez do shell. */
  agente: string | null
  /** Sessão do motor a retomar (continuar uma conversa delegada). */
  sessao: string | null
  titulo: string
}

const FONTE = "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace"

interface Props {
  visivel: boolean
  altura: number
  onAltura: (altura: number) => void
  /** Espaço à direita ocupado pelo painel da ilha, para o terminal não ficar embaixo dele. */
  recuoDireita: number
}

export default function PainelTerminal({
  visivel,
  altura,
  onAltura,
  recuoDireita
}: Props): React.JSX.Element {
  const t = useStore((e) => e.t)
  const tema = useStore((e) => e.tema)
  const pedido = useStore((e) => e.pedidoTerminal)
  const alternarTerminal = useStore((e) => e.alternarTerminal)
  const [abas, setAbas] = useState<Aba[]>([])
  const [ativa, setAtiva] = useState<number | null>(null)
  const proximaChave = useRef(1)
  const ultimoPedido = useRef(0)

  // As sessões avisam a saída por callback guardado; o ref evita fechar sobre uma
  // lista velha, e é atualizado na hora para dois efeitos do mesmo quadro se verem.
  const abasAtuais = useRef(abas)
  abasAtuais.current = abas

  const novaAba = (
    ilha: string | null,
    agente: string | null = null,
    sessao: string | null = null
  ): void => {
    const chave = proximaChave.current++
    const titulo = agente ? `⛵ ${agente}${sessao ? ' ↺' : ''}` : (ilha ?? '…')
    const lista = [...abasAtuais.current, { chave, ilha, agente, sessao, titulo }]
    abasAtuais.current = lista
    setAbas(lista)
    setAtiva(chave)
  }

  const fecharAba = (chave: number): void => {
    const resto = abasAtuais.current.filter((a) => a.chave !== chave)
    abasAtuais.current = resto
    setAbas(resto)
    setAtiva((agora) => (agora === chave ? (resto[resto.length - 1]?.chave ?? null) : agora))
    // Sem aba nenhuma, o painel não tem o que mostrar.
    if (resto.length === 0 && useStore.getState().terminalVisivel) alternarTerminal()
  }

  // Pedido vindo de fora (menu da ilha): abre uma aba na pasta pedida.
  useEffect(() => {
    if (!pedido || pedido.vez === ultimoPedido.current) return
    ultimoPedido.current = pedido.vez
    novaAba(pedido.ilha, pedido.agente ?? null, pedido.sessao ?? null)
  }, [pedido])

  // Abriu o painel sem aba nenhuma: nasce uma na ilha selecionada, ou na raiz.
  useEffect(() => {
    if (!visivel || abasAtuais.current.length > 0) return
    novaAba(useStore.getState().selecionado)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visivel])

  /** Arrasta a borda de cima para mudar a altura. */
  const comecarRedimensionar = (evento: React.PointerEvent): void => {
    evento.preventDefault()
    const inicioY = evento.clientY
    const inicioAltura = altura
    const maxima = Math.max(ALTURA_MINIMA_TERMINAL, window.innerHeight - 200)
    document.body.classList.add('redimensionando-terminal')
    const mover = (e: PointerEvent): void => {
      const nova = inicioAltura + (inicioY - e.clientY)
      onAltura(Math.min(maxima, Math.max(ALTURA_MINIMA_TERMINAL, nova)))
    }
    const soltar = (): void => {
      document.body.classList.remove('redimensionando-terminal')
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
  }

  return (
    <section
      className="painel-terminal"
      style={{
        height: altura,
        marginRight: recuoDireita,
        display: visivel ? undefined : 'none'
      }}
      aria-label={t.terminalTitulo}
    >
      <div className="alca-terminal" onPointerDown={comecarRedimensionar} />
      <header className="terminal-abas">
        {abas.map((aba) => (
          <div
            key={aba.chave}
            className={aba.chave === ativa ? 'terminal-aba ativa' : 'terminal-aba'}
            onClick={() => setAtiva(aba.chave)}
            onAuxClick={(e) => e.button === 1 && fecharAba(aba.chave)}
            title={aba.titulo}
          >
            <span>{aba.titulo}</span>
            <button
              className="terminal-fechar-aba"
              onClick={(e) => {
                e.stopPropagation()
                fecharAba(aba.chave)
              }}
              aria-label={t.terminalFecharAba}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="terminal-nova-aba"
          onClick={() => novaAba(useStore.getState().selecionado)}
          title={t.terminalNovaAba}
          aria-label={t.terminalNovaAba}
        >
          +
        </button>
        <button className="terminal-esconder" onClick={alternarTerminal} title={t.terminalEsconder}>
          ⌄
        </button>
      </header>
      <div className="terminal-corpo">
        {abas.map((aba) => (
          <Sessao
            key={aba.chave}
            ilha={aba.ilha}
            agente={aba.agente}
            sessao={aba.sessao}
            ativa={visivel && aba.chave === ativa}
            tema={tema}
            onTitulo={(titulo) =>
              !aba.agente &&
              setAbas((atuais) => atuais.map((a) => (a.chave === aba.chave ? { ...a, titulo } : a)))
            }
            onSaiu={() => fecharAba(aba.chave)}
          />
        ))}
      </div>
    </section>
  )
}

interface PropsSessao {
  ilha: string | null
  agente: string | null
  sessao: string | null
  ativa: boolean
  tema: TemaId
  onTitulo: (titulo: string) => void
  onSaiu: () => void
}

function Sessao({ ilha, agente, sessao, ativa, tema, onTitulo, onSaiu }: PropsSessao): React.JSX.Element {
  const caixa = useRef<HTMLDivElement | null>(null)
  const terminal = useRef<Terminal | null>(null)
  const ajuste = useRef<FitAddon | null>(null)
  const idPty = useRef<number | null>(null)
  const callbacks = useRef({ onTitulo, onSaiu })
  callbacks.current = { onTitulo, onSaiu }

  useEffect(() => {
    const elemento = caixa.current
    if (!elemento) return
    let encerrado = false

    const term = new Terminal({
      fontFamily: FONTE,
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowTransparency: false,
      theme: TERMINAIS[useStore.getState().tema]
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(elemento)
    terminal.current = term
    ajuste.current = fit
    if (elemento.offsetWidth > 0) fit.fit()

    // Ctrl+C com texto selecionado copia, em vez de mandar interrupção ao shell.
    term.attachCustomKeyEventHandler((e) => {
      if (
        e.type === 'keydown' &&
        e.ctrlKey &&
        !e.shiftKey &&
        e.key === 'c' &&
        term.hasSelection()
      ) {
        void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      return true
    })

    // A saída pode chegar antes de o `abrir` responder: guarda até saber o id.
    const pendente: Array<[number, string]> = []
    const pararDeOuvir = window.api.terminal.aoReceber((id, dados) => {
      if (idPty.current === null) pendente.push([id, dados])
      else if (id === idPty.current) term.write(dados)
    })
    const pararDeOuvirSaida = window.api.terminal.aoSair((id) => {
      if (id === idPty.current) callbacks.current.onSaiu()
    })

    // A aba de agente conta como "em sessão" no barco enquanto existir.
    if (agente) useStore.getState().marcarAgenteAberto(agente, true)

    void window.api.terminal.abrir(ilha, term.cols, term.rows, agente, sessao).then(({ id, pasta }) => {
      if (encerrado) {
        window.api.terminal.fechar(id)
        return
      }
      idPty.current = id
      for (const [de, dados] of pendente) if (de === id) term.write(dados)
      pendente.length = 0
      callbacks.current.onTitulo(pasta.split(/[\\/]/).filter(Boolean).pop() ?? pasta)
      term.onData((dados) => window.api.terminal.escrever(id, dados))
      term.onResize(({ cols, rows }) => window.api.terminal.redimensionar(id, cols, rows))
    }).catch((erro: unknown) => {
      // Agente apagado ou motor que não abriu: o motivo fica escrito na aba.
      term.write(`\r\n${erro instanceof Error ? erro.message : String(erro)}\r\n`)
    })

    const observador = new ResizeObserver(() => {
      if (elemento.offsetWidth > 0 && elemento.offsetHeight > 0) fit.fit()
    })
    observador.observe(elemento)

    return () => {
      encerrado = true
      if (agente) useStore.getState().marcarAgenteAberto(agente, false)
      observador.disconnect()
      pararDeOuvir()
      pararDeOuvirSaida()
      if (idPty.current !== null) window.api.terminal.fechar(idPty.current)
      term.dispose()
    }
    // A sessão nasce uma vez; trocar de ilha é abrir outra aba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = TERMINAIS[tema]
  }, [tema])

  // Ao aparecer, reajusta ao tamanho (escondida ela não tinha medida) e pega o foco.
  useEffect(() => {
    if (!ativa) return
    const quadro = requestAnimationFrame(() => {
      if (caixa.current && caixa.current.offsetWidth > 0) ajuste.current?.fit()
      terminal.current?.focus()
    })
    return () => cancelAnimationFrame(quadro)
  }, [ativa])

  return (
    <div className="terminal-sessao" ref={caixa} style={{ display: ativa ? undefined : 'none' }} />
  )
}
