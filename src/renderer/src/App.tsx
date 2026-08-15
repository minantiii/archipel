import { useEffect, useMemo, useRef, useState } from 'react'
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

/**
 * `true` quando o que está sendo arrastado veio de fora — do Explorer.
 *
 * É o que separa uma pasta chegando de um item da lista sendo reposicionado no
 * mapa: aquele arraste carrega o nosso próprio tipo, nunca `Files`.
 */
function ehDoExplorer(evento: React.DragEvent): boolean {
  // O `?.` não é firula: o tipo do React promete um `dataTransfer` sempre
  // presente, mas um `DragEvent` construído à mão — como os de teste — vem com
  // ele nulo, e aí a tela inteira morria num TypeError.
  return evento.dataTransfer?.types.includes('Files') === true
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
    t,
    modoConexao,
    conectandoDe,
    iniciar,
    carregarIdioma,
    escolherMapa,
    recarregar,
    selecionar,
    fixar,
    abrirNoExplorer,
    executarAcao,
    abrirTerminalNoMapa,
    adicionarPasta,
    adicionarCaminhos,
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
  /** Uma pasta do Explorer está pairando sobre a janela, esperando ser solta. */
  const [recebendo, setRecebendo] = useState(false)
  /**
   * Quantos elementos da página o arraste já atravessou.
   *
   * Contador, e não um booleano: entrar num filho dispara `dragenter` nele e
   * `dragleave` no pai, e com booleano a cortina piscava a cada elemento que o
   * ponteiro cruzava. Só o zero significa que o arraste deixou a janela.
   */
  const profundidade = useRef(0)

  useEffect(() => {
    void carregarIdioma()
    void iniciar()
  }, [carregarIdioma, iniciar])

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

  // O main avisa quando o disco muda por fora — um editor mexendo nos `.md`,
  // ou você mexendo nas pastas pelo Explorer. O mapa se atualiza sozinho.
  useEffect(() => {
    if (!raiz) return
    return window.api.mapa.aoMudar(() => {
      void useStore.getState().recarregar()
    })
  }, [raiz])

  /*
   * Versão nova baixada e esperando.
   *
   * Fora do `raiz` de propósito: a atualização vale mesmo para quem ainda está na
   * tela de boas-vindas, sem mapa escolhido.
   *
   * Reusa a faixa de aviso em vez de inventar uma notificação: é o mesmo tom de
   * "algo que você precisa saber, sem urgência", e ela já sabe se fechar sozinha.
   */
  useEffect(() => {
    return window.api.atualizacao.aoFicarPronta((versao) => {
      useStore.setState({
        aviso: useStore.getState().t.atualizacaoPronta(versao)
      })
    })
  }, [])

  /*
   * Rede de segurança do arraste de arquivos.
   *
   * Sem `preventDefault`, o Chromium trata uma pasta solta como um endereço e
   * **navega** para ela: a janela do app vira um listador de arquivos, sem
   * botão de voltar. Fica na janela inteira, e não só no `.app`, porque a tela
   * de boas-vindas também é um lugar onde dá para soltar uma pasta sem querer.
   */
  useEffect(() => {
    const impedirNavegacao = (evento: DragEvent): void => {
      if (!evento.dataTransfer?.types.includes('Files')) return
      evento.preventDefault()
    }

    window.addEventListener('dragover', impedirNavegacao)
    window.addEventListener('drop', impedirNavegacao)
    return () => {
      window.removeEventListener('dragover', impedirNavegacao)
      window.removeEventListener('drop', impedirNavegacao)
    }
  }, [])

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
        <h1>{t.bemVindoTitulo}</h1>
        <p>{t.bemVindoTexto}</p>
        <button className="primario" onClick={() => void escolherMapa()} disabled={carregando}>
          {t.escolherMapa}
        </button>
        {erro && <p className="erro">{erro}</p>}
      </div>
    )
  }

  const ilhaDoMenu = mapa?.ilhas.find((i) => i.id === menu?.id)
  const ilhaSelecionada = mapa?.ilhas.find((i) => i.id === selecionado)

  /** Menu de uma ilha: tudo que se faz com aquela pasta. */
  const itensDaIlha = (id: string): ItemMenu[] => [
    { rotulo: t.abrirNoExplorer, acao: () => void abrirNoExplorer(id) },
    { rotulo: t.abrirNoVsCode, acao: () => void executarAcao('vscode', id) },
    { rotulo: t.abrirTerminalAqui, acao: () => void executarAcao('terminal', id) },
    { rotulo: t.copiarCaminho, acao: () => void executarAcao('copiarCaminho', id) },
    {
      rotulo: t.soltarPosicao,
      acao: () => void fixar(id, null),
      desabilitado: !ilhaDoMenu?.pos
    },
    {
      rotulo: t.tirarDoMapa,
      acao: () => void removerDoMapa(id),
      perigoso: true,
      desabilitado: ilhaDoMenu?.ausente
    },
    {
      rotulo: t.apagarPasta,
      acao: () => void apagarPasta(id),
      perigoso: true,
      desabilitado: ilhaDoMenu?.ausente
    }
  ]

  /** Menu do vazio: clicar com o direito no nada agora oferece criar algo ali. */
  const itensDoFundo = (pos?: { x: number; y: number }): ItemMenu[] => [
    { rotulo: t.criarPastaAqui, acao: () => void criarPasta(pos ?? null) },
    { rotulo: t.adicionarExistente, acao: () => void adicionarPasta() },
    // Terminal em `.organizador`: é a única forma de chegar num prompt que
    // enxerga o mapa inteiro. Aberto dentro de um projeto, o terminal não vê os
    // `.md` dos projetos irmãos — nem quem for editá-los ali por conta própria.
    { rotulo: t.abrirTerminalNoMapa, acao: () => void abrirTerminalNoMapa() }
  ]

  const itensMenu: ItemMenu[] = !menu
    ? []
    : menu.id !== null
      ? itensDaIlha(menu.id)
      : itensDoFundo(menu.pos)

  /**
   * Pastas soltas na janela entram no mapa direto, sem passar por diálogo.
   *
   * O caminho no disco não vem do `File` — ele não sabe onde mora. Quem
   * responde isso é o preload, que é o único lado da ponte com acesso ao
   * `webUtils`. O que não veio do disco devolve `''` e é descartado aqui.
   */
  const receberDoExplorer = (evento: React.DragEvent): void => {
    const caminhos = Array.from(evento.dataTransfer.files)
      .map((arquivo) => window.api.sistema.caminhoDoArquivo(arquivo))
      .filter((caminho) => caminho.length > 0)

    void adicionarCaminhos(caminhos)
  }

  return (
    <div
      className="app"
      onDragEnter={(evento) => {
        if (!ehDoExplorer(evento)) return
        profundidade.current += 1
        setRecebendo(true)
      }}
      onDragOver={(evento) => {
        if (!ehDoExplorer(evento)) return
        // Sem isto o drop nem chega a acontecer — e a página navega para a pasta.
        evento.preventDefault()
        // "Mover" e não "copiar": é literalmente o que vai acontecer com ela.
        evento.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={(evento) => {
        if (!ehDoExplorer(evento)) return
        profundidade.current -= 1
        if (profundidade.current > 0) return
        profundidade.current = 0
        setRecebendo(false)
      }}
      onDrop={(evento) => {
        if (!ehDoExplorer(evento)) return
        evento.preventDefault()
        profundidade.current = 0
        setRecebendo(false)
        receberDoExplorer(evento)
      }}
    >
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
            {t.contagem(mapa?.ilhas.length ?? 0, mapa?.pontes.length ?? 0)}
          </span>
        </div>

        <div className="topo-acoes">
          {/* Os dois viraram ícone: são ações recorrentes, e o rótulo escrito
              ocupava espaço todo dia para dizer algo que o desenho já diz. */}
          <button
            className={modoConexao ? 'botao-icone ativo' : 'botao-icone'}
            onClick={alternarModoConexao}
            title={t.modoConexao}
            aria-label={t.modoConexao}
            aria-pressed={modoConexao}
          >
            <IconeConexao />
          </button>
          <button
            className="botao-icone"
            onClick={() => void recarregar()}
            disabled={carregando}
            title={t.recarregar}
            aria-label={t.recarregar}
          >
            <IconeRecarregar />
          </button>
          <button onClick={() => void escolherMapa()}>{t.trocarDeMapa}</button>
          <button className="primario" onClick={() => void adicionarPasta()} disabled={carregando}>
            {t.adicionarPasta}
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
          <button onClick={() => useStore.setState({ aviso: null })}>{t.entendi}</button>
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
              onTirarDoMapa={(id) => void removerDoMapa(id)}
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
              {t.mapaVazioTitulo}
              <br />
              {t.mapaVazioTexto} <code>{raiz}</code>.
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

      {/* A janela inteira é o alvo — soltar em qualquer canto vale, e a cortina
          diz isso cobrindo tudo. Ela não recebe ponteiro: se recebesse, seria
          ela quem responderia ao arraste, e o `dragleave` do que está embaixo
          nunca chegaria. */}
      {recebendo && (
        <div className="cortina-solta">
          <div className="cortina-solta-caixa">
            <strong>{t.soltarTitulo}</strong>
            <span>{t.soltarDestino(raiz)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
