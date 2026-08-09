import { useEffect, useMemo, useState } from 'react'
import ContextMenu, { type ItemMenu } from './components/ContextMenu'
import DetailsPanel from './components/DetailsPanel'
import DivisorLateral, { LARGURA_PADRAO, limitarLargura } from './components/DivisorLateral'
import Palco from './components/Palco'
import { IconeConexao, IconeRecarregar } from './components/Icones'
import Sidebar from './components/Sidebar'
import { useStore } from './state/store'

/** O menu de contexto atende dois alvos: uma ilha, ou o vazio do palco. */
interface EstadoMenu {
  /** `null` quando o clique direito caiu no fundo, fora de qualquer ilha. */
  id: string | null
  x: number
  y: number
  /** Ponto do mapa onde o clique caiu — só existe no menu do fundo. */
  pos?: { x: number; y: number }
}

/** Preferências de layout ficam no localStorage: são da máquina, não do mapa. */
const CHAVE_LARGURA = 'organizador:largura-lateral'
const CHAVE_LATERAL = 'organizador:lateral-visivel'

function larguraSalva(): number {
  const salvo = Number(localStorage.getItem(CHAVE_LARGURA))
  return Number.isFinite(salvo) && salvo > 0 ? limitarLargura(salvo) : LARGURA_PADRAO
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export default function App(): React.JSX.Element {
  const {
    raiz,
    mapa,
    carregando,
    erro,
    aviso,
    selecionado,
    movimentacao,
    busca,
    filtroTag,
    modoConexao,
    conectandoDe,
    iniciar,
    escolherMapa,
    recarregar,
    selecionar,
    fixar,
    abrirNoExplorer,
    executarAcao,
    abrirTerminalNoMapa,
    adicionarPasta,
    criarPasta,
    batizando,
    batizada,
    removerDoMapa,
    apagarPasta,
    desfazerMovimentacao,
    setBusca,
    setFiltroTag,
    alternarModoConexao,
    clicarEmModoConexao,
    desconectar,
    salvarMeta,
    reordenar,
    renomear
  } = useStore()

  const [menu, setMenu] = useState<EstadoMenu | null>(null)
  const [larguraLateral, setLarguraLateral] = useState(larguraSalva)
  const [lateralVisivel, setLateralVisivel] = useState(
    () => localStorage.getItem(CHAVE_LATERAL) !== 'nao'
  )

  useEffect(() => {
    void iniciar()
  }, [iniciar])

  useEffect(() => {
    localStorage.setItem(CHAVE_LARGURA, String(larguraLateral))
  }, [larguraLateral])

  useEffect(() => {
    localStorage.setItem(CHAVE_LATERAL, lateralVisivel ? 'sim' : 'nao')
  }, [lateralVisivel])

  // A janela anuncia qual mapa está aberto: com dois abertos, a barra de tarefas
  // é o único lugar que diz qual é qual.
  useEffect(() => {
    const nome = raiz?.split(/[\\/]/).filter(Boolean).pop()
    document.title = nome ? `${nome} — Archipel` : 'Archipel'
  }, [raiz])

  // O main avisa quando o disco muda por fora — Claude Code editando os `.md`,
  // ou você mexendo nas pastas pelo Explorer. O mapa se atualiza sozinho.
  useEffect(() => {
    if (!raiz) return
    return window.api.mapa.aoMudar(() => {
      void useStore.getState().recarregar()
    })
  }, [raiz])

  // Atalhos globais: Ctrl+B esconde a lateral, Ctrl+Z desfaz a última
  // movimentação, L liga e desliga o modo conexão.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      const alvo = evento.target as HTMLElement | null
      const digitando = alvo?.matches('input, textarea')

      // Os atalhos com Ctrl vêm antes do filtro de digitação lá embaixo, mas
      // cada um decide por si se convive com um campo de texto em foco.
      if (evento.ctrlKey && !evento.altKey && (evento.key === 'b' || evento.key === 'B')) {
        evento.preventDefault()
        setLateralVisivel((visivel) => !visivel)
        return
      }

      if (
        evento.ctrlKey &&
        !evento.altKey &&
        !evento.shiftKey &&
        (evento.key === 'z' || evento.key === 'Z')
      ) {
        // Escrevendo um diário ou renomeando, o Ctrl+Z é do campo: roubá-lo para
        // mover pastas no disco seria a pior troca possível.
        if (digitando) return
        evento.preventDefault()
        // Sem movimentação registrada não acontece nada — é o que se espera de
        // um Ctrl+Z com a pilha vazia, e evita um erro só para dizer isso.
        if (movimentacao && !carregando) void desfazerMovimentacao()
        return
      }

      if (digitando || evento.ctrlKey || evento.altKey || evento.metaKey) return

      if (evento.key === 'l' || evento.key === 'L') alternarModoConexao()
      if (evento.key === 'Escape') selecionar(null)
    }

    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [alternarModoConexao, selecionar, movimentacao, carregando, desfazerMovimentacao])

  /** Conjunto de ilhas que sobrevive à busca e ao filtro de tag. */
  const destacados = useMemo(() => {
    if (!mapa) return null
    const alvo = normalizar(busca.trim())
    if (alvo.length === 0 && !filtroTag) return null

    return new Set(
      mapa.ilhas
        .filter((ilha) => {
          if (filtroTag && !ilha.tags.includes(filtroTag)) return false
          if (alvo.length === 0) return true
          return normalizar(ilha.id).includes(alvo) || normalizar(ilha.diario).includes(alvo)
        })
        .map((ilha) => ilha.id)
    )
  }, [mapa, busca, filtroTag])

  if (!raiz) {
    return (
      <div className="boas-vindas">
        <h1>Archipel</h1>
        <p>
          Suas pastas de projeto viram um mapa navegável. Escolha a pasta que vai abrigar o mapa e
          tudo que você adicionar passa a viver lá dentro.
        </p>
        <button className="primario" onClick={() => void escolherMapa()} disabled={carregando}>
          Escolher pasta do mapa
        </button>
        {erro && <p className="erro">{erro}</p>}
      </div>
    )
  }

  const ilhaDoMenu = mapa?.ilhas.find((i) => i.id === menu?.id)
  const ilhaSelecionada = mapa?.ilhas.find((i) => i.id === selecionado)

  /** Menu de uma ilha: tudo que se faz com aquela pasta. */
  const itensDaIlha = (id: string): ItemMenu[] => [
    { rotulo: 'Abrir no Explorer', acao: () => void abrirNoExplorer(id) },
    { rotulo: 'Abrir no VS Code', acao: () => void executarAcao('vscode', id) },
    { rotulo: 'Abrir terminal aqui', acao: () => void executarAcao('terminal', id) },
    { rotulo: 'Copiar caminho', acao: () => void executarAcao('copiarCaminho', id) },
    {
      rotulo: 'Soltar posição fixada',
      acao: () => void fixar(id, null),
      desabilitado: !ilhaDoMenu?.pos
    },
    {
      rotulo: 'Tirar do mapa…',
      acao: () => void removerDoMapa(id),
      perigoso: true,
      desabilitado: ilhaDoMenu?.ausente
    },
    {
      rotulo: 'Apagar pasta…',
      acao: () => void apagarPasta(id),
      perigoso: true,
      desabilitado: ilhaDoMenu?.ausente
    }
  ]

  /** Menu do vazio: clicar com o direito no nada agora oferece criar algo ali. */
  const itensDoFundo = (pos?: { x: number; y: number }): ItemMenu[] => [
    { rotulo: 'Criar pasta aqui', acao: () => void criarPasta(pos ?? null) },
    { rotulo: 'Adicionar pasta existente…', acao: () => void adicionarPasta() },
    // Terminal em `.organizador`: é a única forma de chegar num prompt que
    // enxerga o mapa inteiro. Aberto dentro de um projeto, o terminal não vê os
    // `.md` dos projetos irmãos — nem quem for editá-los ali por conta própria.
    { rotulo: 'Abrir terminal no mapa', acao: () => void abrirTerminalNoMapa() }
  ]

  const itensMenu: ItemMenu[] = !menu
    ? []
    : menu.id !== null
      ? itensDaIlha(menu.id)
      : itensDoFundo(menu.pos)

  return (
    <div className="app">
      <header className="topo">
        <div className="topo-identidade">
          <button
            className="botao-lateral"
            onClick={() => setLateralVisivel((visivel) => !visivel)}
            title={lateralVisivel ? 'Esconder a lista (Ctrl+B)' : 'Mostrar a lista (Ctrl+B)'}
            aria-label={lateralVisivel ? 'Esconder a barra lateral' : 'Mostrar a barra lateral'}
            aria-pressed={!lateralVisivel}
          >
            {lateralVisivel ? '⟨' : '⟩'}
          </button>
          <strong>{raiz.split(/[\\/]/).filter(Boolean).pop()}</strong>
          <span className="topo-resumo">
            {mapa?.ilhas.length ?? 0} ilhas · {mapa?.pontes.length ?? 0} pontes
          </span>
        </div>

        <div className="topo-acoes">
          {/* Os dois viraram ícone: são ações recorrentes, e o rótulo escrito
              ocupava espaço todo dia para dizer algo que o desenho já diz. */}
          <button
            className={modoConexao ? 'botao-icone ativo' : 'botao-icone'}
            onClick={alternarModoConexao}
            title={modoConexao ? 'Modo conexão ligado (L)' : 'Modo conexão (L)'}
            aria-label="Modo conexão"
            aria-pressed={modoConexao}
          >
            <IconeConexao />
          </button>
          <button
            className="botao-icone"
            onClick={() => void recarregar()}
            disabled={carregando}
            title="Recarregar"
            aria-label="Recarregar"
          >
            <IconeRecarregar />
          </button>
          <button onClick={() => void escolherMapa()}>Trocar de mapa</button>
          <button className="primario" onClick={() => void adicionarPasta()} disabled={carregando}>
            Adicionar pasta
          </button>
        </div>

        {/* Fora do flex (é absoluta): sinaliza leitura de disco sem mexer no layout. */}
        {carregando && <div className="barra-carregando" />}
      </header>

      {erro && (
        <div className="faixa-erro">
          {erro}
          <button onClick={() => useStore.setState({ erro: null })}>dispensar</button>
        </div>
      )}

      {/* Deu certo, mas sobrou algo no disco. Não some sozinho: é a única
          chance do usuário ficar sabendo que precisa conferir a origem. */}
      {aviso && (
        <div className="faixa-aviso">
          {aviso}
          <button onClick={() => useStore.setState({ aviso: null })}>entendi</button>
        </div>
      )}

      {modoConexao && (
        <div className="faixa-modo">
          {conectandoDe
            ? `Conectando a partir de "${conectandoDe}" — clique na outra pasta.`
            : 'Modo conexão ligado — clique na primeira pasta e depois na segunda.'}
          <button onClick={alternarModoConexao}>sair</button>
        </div>
      )}

      <div className="corpo">
        {mapa && lateralVisivel && (
          <>
            <Sidebar
              mapa={mapa}
              largura={larguraLateral}
              busca={busca}
              filtroTag={filtroTag}
              selecionado={selecionado}
              onBusca={setBusca}
              onFiltroTag={setFiltroTag}
              onSelecionar={selecionar}
              onAbrir={(id) => void abrirNoExplorer(id)}
              onReordenar={(ids) => void reordenar(ids)}
            />
            <DivisorLateral largura={larguraLateral} onLargura={setLarguraLateral} />
          </>
        )}

        {mapa && mapa.ilhas.length > 0 ? (
          <Palco
            mapa={mapa}
            selecionado={selecionado}
            destacados={destacados}
            conectandoDe={conectandoDe}
            onSelecionar={(id) => {
              if (modoConexao && id) return void clicarEmModoConexao(id)
              selecionar(id)
            }}
            onAbrir={(id) => void abrirNoExplorer(id)}
            onFixar={(id, pos) => void fixar(id, pos)}
            onMenu={(id, x, y) => setMenu({ id, x, y })}
            onMenuDoFundo={(x, y, pos) => setMenu({ id: null, x, y, pos })}
          />
        ) : (
          <div className="palco palco-vazio">
            <p>
              O mapa está vazio.
              <br />
              Use <strong>Adicionar pasta</strong> para mover um projeto para cá, ou arraste as
              pastas direto para <code>{raiz}</code> pelo Explorer.
            </p>
          </div>
        )}

        {mapa && ilhaSelecionada && (
          <DetailsPanel
            ilha={ilhaSelecionada}
            mapa={mapa}
            onFechar={() => selecionar(null)}
            onSalvar={(patch) => void salvarMeta(ilhaSelecionada.id, patch)}
            onDesconectar={(destino) => void desconectar(ilhaSelecionada.id, destino)}
            onSelecionar={selecionar}
            onAcao={(acao) => void executarAcao(acao, ilhaSelecionada.id)}
            onRemover={() => void removerDoMapa(ilhaSelecionada.id)}
            onRenomear={(nome) => void renomear(ilhaSelecionada.id, nome)}
            batizar={batizando === ilhaSelecionada.id}
            onBatizada={batizada}
          />
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          titulo={menu.id ?? 'Mapa'}
          itens={itensMenu}
          onFechar={() => setMenu(null)}
        />
      )}
    </div>
  )
}
