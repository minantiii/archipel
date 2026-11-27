import { create } from 'zustand'
import type { Idioma, Mapa, MetaPatch, Movimentacao, Posicao, Resultado } from '@shared/types'
import { textosDe, type Textos } from '../lib/textos'

/**
 * Estado do renderer.
 *
 * O mapa aqui é sempre um espelho do que o main devolveu — nunca é editado
 * localmente. Toda mutação vai ao disco primeiro e o mapa devolvido substitui
 * este, então a tela nunca mostra algo que o disco não confirmou.
 */
interface Estado {
  raiz: string | null
  mapa: Mapa | null
  carregando: boolean
  erro: string | null
  /** Operação deu certo, mas sobrou algo para o usuário conferir no disco. */
  aviso: string | null
  selecionado: string | null
  /** Última movimentação desfazível, ou `null` se não há o que desfazer. */
  movimentacao: Movimentacao | null

  busca: string
  filtroTag: string | null

  idioma: Idioma
  /** Os textos do idioma em vigor, prontos para usar na tela. */
  t: Textos
  /** Quando ligado, clicar de uma ilha a outro cria a conexão em vez de selecionar. */
  modoConexao: boolean
  /** Primeira ponta escolhida enquanto o modo conexão está ligado. */
  conectandoDe: string | null
  /**
   * Id de uma pasta recém-criada, esperando ser batizada.
   *
   * Uma pasta nova nasce como "Nova pasta", então o painel abre já com o campo
   * de renomear em foco — sem isso o usuário teria que descobrir sozinho que o
   * título se edita com duplo clique.
   */
  batizando: string | null

  iniciar: () => Promise<void>
  escolherMapa: () => Promise<void>
  /**
   * Relê o mapa do disco.
   *
   * `silencioso` é para a recarga que ninguém pediu — a do observador de
   * arquivos. Ela não acende a barra de carregamento, não desabilita botão e
   * não apaga a mensagem de erro que o usuário talvez ainda esteja lendo.
   */
  recarregar: (opcoes?: { silencioso?: boolean }) => Promise<void>
  selecionar: (id: string | null) => void
  fixar: (id: string, pos: Posicao | null) => Promise<void>
  abrirNoExplorer: (id: string) => Promise<void>
  adicionarPasta: () => Promise<void>
  /** Move para o mapa pastas soltas na janela pelo Explorer. Sem diálogo nenhum. */
  adicionarCaminhos: (caminhos: string[]) => Promise<void>
  /** Cria uma pasta vazia, opcionalmente fixada no ponto do mapa onde foi pedida. */
  criarPasta: (pos: Posicao | null) => Promise<void>
  /** Consome o aviso de "acabei de nascer", para o campo abrir uma vez só. */
  batizada: () => void
  removerDoMapa: (id: string) => Promise<void>
  apagarPasta: (id: string) => Promise<void>
  desfazerMovimentacao: () => Promise<void>
  executarAcao: (acao: AcaoDeAbrir, id: string) => Promise<void>
  abrirTerminalNoMapa: () => Promise<void>

  setBusca: (texto: string) => void
  setFiltroTag: (tag: string | null) => void
  /** Pega do main o idioma da sessão — o que foi escolhido no instalador. */
  carregarIdioma: () => Promise<void>
  alternarModoConexao: () => void
  /** Trata o clique numa ilha quando o modo conexão está ligado. */
  clicarEmModoConexao: (id: string) => Promise<void>
  desconectar: (origem: string, destino: string) => Promise<void>
  salvarMeta: (id: string, patch: MetaPatch) => Promise<void>
  reordenar: (ids: string[]) => Promise<void>
  renomear: (id: string, novoNome: string) => Promise<void>
}

/** Ações de "abrir" disponíveis para uma ilha. */
export type AcaoDeAbrir = 'explorer' | 'vscode' | 'terminal' | 'copiarCaminho'

function mensagemDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro)
}

/**
 * Cores escolhidas no seletor que o disco ainda não confirmou, por id.
 *
 * O seletor de cor dispara uma mudança por movimento do mouse. Gravar cada uma
 * era uma escrita mais uma varredura inteira do mapa por pixel arrastado; agora
 * a tela mostra a cor na hora e o disco só recebe a última, quando o mouse para.
 */
const coresPendentes = new Map<string, { cor: string; timer: ReturnType<typeof setTimeout> }>()

/** Quanto o seletor de cor precisa ficar parado para a cor ir ao disco. */
const ESPERA_COR_MS = 140

/** Pinta por cima do mapa vindo do disco as cores que ainda estão a caminho dele. */
function comCoresPendentes(mapa: Mapa): Mapa {
  if (coresPendentes.size === 0) return mapa

  let mudou = false
  const ilhas = mapa.ilhas.map((ilha) => {
    const pendente = coresPendentes.get(ilha.id)
    if (!pendente || pendente.cor === ilha.cor) return ilha
    mudou = true
    return { ...ilha, cor: pendente.cor }
  })
  return mudou ? { ...mapa, ilhas } : mapa
}

/**
 * `true` quando os dois valores dizem a mesma coisa, ainda que sejam objetos
 * diferentes. Tudo aqui veio do IPC, então é JSON puro e com as chaves sempre
 * na mesma ordem.
 */
function mesmoConteudo(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * O pedaço do estado que acompanha um mapa recém-chegado do disco.
 *
 * Dois cuidados moram aqui, num lugar só, para valer em toda operação:
 *
 *  1. Mapa igual ao que já está na tela **mantém o objeto antigo**. Quase toda
 *     gravação volta em eco pelo observador de arquivos, e trocar o objeto por um
 *     idêntico redesenhava a lista inteira e reaquecia a simulação do mapa à toa.
 *  2. Nada pode ficar apontando para o que sumiu: seleção numa ilha que saiu,
 *     ponta de conexão que não existe mais, filtro por uma tag que acabou — este
 *     último deixava o mapa inteiro apagado, sem chip nenhum para desligar.
 */
function assentar(estado: Estado, recebido: Mapa | null): Partial<Estado> {
  const pintado = recebido && comCoresPendentes(recebido)
  const mapa = pintado && estado.mapa && mesmoConteudo(estado.mapa, pintado) ? estado.mapa : pintado

  const existe = (id: string | null): boolean =>
    id !== null && mapa !== null && mapa.ilhas.some((ilha) => ilha.id === id)
  const tagExiste =
    estado.filtroTag !== null && mapa !== null && mapa.tags.some((t) => t.nome === estado.filtroTag)

  return {
    mapa,
    selecionado: existe(estado.selecionado) ? estado.selecionado : null,
    conectandoDe: existe(estado.conectandoDe) ? estado.conectandoDe : null,
    filtroTag: tagExiste ? estado.filtroTag : null
  }
}

/** Devolve o próprio estado quando o parcial não muda nada — o zustand então nem avisa ninguém. */
function seMudou(estado: Estado, parcial: Partial<Estado>): Estado | Partial<Estado> {
  const chaves = Object.keys(parcial) as (keyof Estado)[]
  return chaves.some((chave) => !Object.is(estado[chave], parcial[chave])) ? parcial : estado
}

type Definir = (parcial: Partial<Estado> | ((estado: Estado) => Estado | Partial<Estado>)) => void

/** Põe na tela um mapa vindo do disco. */
function receber(mapa: Mapa | null): void {
  useStore.setState((estado) => assentar(estado, mapa))
}

function soltarCorPendente(id: string): void {
  const pendente = coresPendentes.get(id)
  if (!pendente) return
  clearTimeout(pendente.timer)
  coresPendentes.delete(id)
}

/** Mostra a cor agora e agenda a gravação para quando o seletor sossegar. */
function pintar(id: string, cor: string): void {
  soltarCorPendente(id)

  const timer = setTimeout(() => {
    // Só solta a pendência se ninguém escolheu outra cor enquanto o disco
    // gravava esta — senão a resposta desta gravação repintaria a ilha com a
    // cor velha por um instante.
    const concluir = (): void => {
      if (coresPendentes.get(id)?.timer === timer) coresPendentes.delete(id)
    }

    window.api.pasta.salvarMeta(id, { cor }).then(
      (mapa) => {
        concluir()
        receber(mapa)
      },
      (erro: unknown) => {
        concluir()
        useStore.setState({ erro: mensagemDoErro(erro) })
        // A cor mostrada nunca chegou ao disco: a tela volta ao que está lá.
        void useStore.getState().recarregar({ silencioso: true })
      }
    )
  }, ESPERA_COR_MS)

  coresPendentes.set(id, { cor, timer })
  receber(useStore.getState().mapa)
}

export const useStore = create<Estado>((set, get) => ({
  raiz: null,
  mapa: null,
  carregando: true,
  erro: null,
  aviso: null,
  selecionado: null,
  movimentacao: null,
  busca: '',
  filtroTag: null,
  // Palpite até o main dizer o que ficou gravado, logo na abertura.
  idioma: 'pt',
  t: textosDe('pt'),
  modoConexao: false,
  conectandoDe: null,
  batizando: null,

  iniciar: async () => {
    set({ carregando: true, erro: null })
    try {
      const raiz = await window.api.mapa.obterRaiz()
      set({ raiz })
      if (raiz) await get().recarregar()
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    } finally {
      set({ carregando: false })
    }
  },

  escolherMapa: async () => {
    try {
      const raiz = await window.api.mapa.escolherRaiz()
      if (!raiz) return
      // Mapa novo, tela limpa: a busca, o filtro e a ponta de conexão eram do
      // mapa anterior. O `mapa: null` desmonta o palco, para o novo nascer com
      // câmera e posições próprias em vez de herdar as do antigo.
      set({ raiz, mapa: null, selecionado: null, busca: '', filtroTag: null, conectandoDe: null })
      await get().recarregar()
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    }
  },

  recarregar: async (opcoes) => {
    const silencioso = opcoes?.silencioso === true
    if (!silencioso) set({ carregando: true, erro: null })
    try {
      // O mapa é o último `await` de propósito: entre ele chegar e ir para a tela
      // não sobra brecha para a resposta de outra operação entrar na frente e
      // ser atropelada por este retrato, que já seria o mais velho dos dois.
      const movimentacao = await window.api.pasta.ultimaMovimentacao()
      const mapa = await window.api.mapa.carregar()

      set((estado) =>
        seMudou(estado, {
          ...assentar(estado, mapa),
          raiz: mapa?.raiz ?? null,
          movimentacao: mesmoConteudo(estado.movimentacao, movimentacao)
            ? estado.movimentacao
            : movimentacao
        })
      )
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    } finally {
      if (!silencioso) set({ carregando: false })
    }
  },

  selecionar: (id) => set({ selecionado: id }),

  fixar: async (id, pos) => {
    try {
      // O mapa devolvido já vem do disco relido, então a tela nunca diverge dele.
      receber(await window.api.pasta.salvarMeta(id, { pos }))
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    }
  },

  abrirNoExplorer: async (id) => {
    await get().executarAcao('explorer', id)
  },

  executarAcao: async (acao, id) => {
    try {
      const resultado = await window.api.abrir[acao](id)
      if (!resultado.ok) set({ erro: resultado.erro })
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    }
  },

  abrirTerminalNoMapa: async () => {
    try {
      const resultado = await window.api.abrir.terminalNoMapa()
      if (!resultado.ok) set({ erro: resultado.erro })
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    }
  },

  adicionarPasta: async () => {
    await aplicarMovimentacao(set, () => window.api.pasta.adicionar())
  },

  adicionarCaminhos: async (caminhos) => {
    // Soltar algo que não veio do disco não é erro nem operação: é nada.
    if (caminhos.length === 0) return
    await aplicarMovimentacao(set, () => window.api.pasta.adicionarCaminhos(caminhos))
  },

  criarPasta: async (pos) => {
    set({ carregando: true, erro: null, aviso: null })
    try {
      const resultado = await window.api.pasta.criar(pos)
      if (!resultado.ok) return set({ erro: resultado.erro })

      const { mapa, id } = resultado.dados
      // Já seleciona e marca para batizar: o painel abre com o nome em edição.
      set((estado) => ({ ...assentar(estado, mapa), selecionado: id, batizando: id }))
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    } finally {
      set({ carregando: false })
    }
  },

  batizada: () => set({ batizando: null }),

  removerDoMapa: async (id) => {
    await aplicarMovimentacao(set, () => window.api.pasta.removerDoMapa(id))
  },

  apagarPasta: async (id) => {
    set({ carregando: true, erro: null, aviso: null })
    try {
      const resultado = await window.api.pasta.apagar(id)
      if (!resultado.ok) return set({ erro: resultado.erro })

      // A pasta apagada não existe mais, e o `assentar` solta a seleção nela:
      // segurá-la deixaria um painel aberto sobre uma ilha que sumiu.
      receber(resultado.dados)
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    } finally {
      set({ carregando: false })
    }
  },

  desfazerMovimentacao: async () => {
    await aplicarMovimentacao(set, () => window.api.pasta.desfazerUltimaMovimentacao())
  },

  setBusca: (texto) => set({ busca: texto }),

  setFiltroTag: (tag) => set({ filtroTag: get().filtroTag === tag ? null : tag }),

  carregarIdioma: async () => {
    const idioma = await window.api.sistema.idioma()
    set({ idioma, t: textosDe(idioma) })
  },

  alternarModoConexao: () =>
    set({ modoConexao: !get().modoConexao, conectandoDe: null, selecionado: null }),

  clicarEmModoConexao: async (id) => {
    const primeira = get().conectandoDe

    // Primeiro clique escolhe a ponta; clicar nela de novo desiste.
    if (!primeira) return set({ conectandoDe: id })
    if (primeira === id) return set({ conectandoDe: null })

    set({ conectandoDe: null })

    // A ponte é uma `[[ligação]]` escrita no `.md` de quem a origina, e ilha
    // ausente não tem `.md`: partindo dela, a ligação ia para um arquivo que a
    // varredura seguinte apagava, e o clique parecia não ter feito nada. Quem
    // escreve é sempre a ponta que existe de verdade.
    const ausente = (alvo: string): boolean =>
      get().mapa?.ilhas.find((ilha) => ilha.id === alvo)?.ausente === true
    if (ausente(primeira) && ausente(id)) return
    const [origem, destino] = ausente(primeira) ? [id, primeira] : [primeira, id]

    try {
      receber(await window.api.pasta.conectar(origem, destino))
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    }
  },

  desconectar: async (origem, destino) => {
    try {
      receber(await window.api.pasta.desconectar(origem, destino))
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    }
  },

  salvarMeta: async (id, patch) => {
    // Só a cor, e uma cor de verdade: é o seletor sendo arrastado.
    if (typeof patch.cor === 'string' && Object.keys(patch).length === 1) {
      return pintar(id, patch.cor)
    }
    // Qualquer outra palavra sobre a cor ("usar a da tag") vale mais que uma
    // escolha do seletor que ainda nem tinha sido gravada.
    if (patch.cor !== undefined) soltarCorPendente(id)

    try {
      receber(await window.api.pasta.salvarMeta(id, patch))
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    }
  },

  reordenar: async (ids) => {
    // Aplica a nova ordem na hora e deixa o disco confirmar depois: esperar o
    // IPC faria o item voltar para o lugar antigo por um instante.
    const mapa = get().mapa
    if (mapa) set({ mapa: { ...mapa, ordem: ids } })

    try {
      receber(await window.api.pasta.reordenar(ids))
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
      // A ordem mostrada não foi gravada: volta para a que está no disco.
      void get().recarregar({ silencioso: true })
    }
  },

  renomear: async (id, novoNome) => {
    const antes = new Set(get().mapa?.ilhas.map((ilha) => ilha.id))
    try {
      const resultado = await window.api.pasta.renomear(id, novoNome)
      if (!resultado.ok) return set({ erro: resultado.erro })

      // O id mudou junto com o nome, então a seleção precisa seguir a ilha nova
      // em vez de apontar para um id que não existe mais. A renomeada é a única
      // que não estava no mapa de antes — procurar pelo fim do caminho confundia
      // "api" com "minha-api" e selecionava a pasta errada.
      const mapa = resultado.dados
      const renomeada = mapa.ilhas.find((ilha) => !antes.has(ilha.id))?.id ?? null
      set((estado) => {
        const assentado = assentar(estado, mapa)
        const seguia = estado.selecionado === id && assentado.selecionado === null
        return seguia ? { ...assentado, selecionado: renomeada } : assentado
      })
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    }
  }
}))

/**
 * Executa uma operação que mexe em pasta e sincroniza a tela com o resultado.
 *
 * Toda operação de movimentação devolve o mapa relido do disco, então o estado
 * daqui nunca fica adiantado em relação ao que realmente aconteceu.
 */
async function aplicarMovimentacao(
  set: Definir,
  acao: () => Promise<Resultado<Mapa>>
): Promise<void> {
  set({ carregando: true, erro: null, aviso: null })
  try {
    const resultado = await acao()
    if (resultado.ok) {
      set((estado) => ({
        ...assentar(estado, resultado.dados),
        // A operação deu certo: o que veio aqui é ressalva, não falha.
        aviso: resultado.aviso ?? null
      }))
      // Depois do mapa, e não junto: esperar por isto com o mapa na mão abria
      // uma brecha para ele chegar à tela já vencido.
      set({ movimentacao: await window.api.pasta.ultimaMovimentacao() })
    } else {
      set({ erro: resultado.erro })
    }
  } catch (erro) {
    set({ erro: mensagemDoErro(erro) })
  } finally {
    set({ carregando: false })
  }
}
