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
  recarregar: () => Promise<void>
  selecionar: (id: string | null) => void
  fixar: (id: string, pos: Posicao | null) => Promise<void>
  abrirNoExplorer: (id: string) => Promise<void>
  adicionarPasta: () => Promise<void>
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
      set({ raiz, selecionado: null })
      await get().recarregar()
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    }
  },

  recarregar: async () => {
    set({ carregando: true, erro: null })
    try {
      const mapa = await window.api.mapa.carregar()
      const selecionado = get().selecionado
      set({
        mapa,
        raiz: mapa?.raiz ?? null,
        movimentacao: await window.api.pasta.ultimaMovimentacao(),
        // Solta a seleção se a ilha sumiu do disco entre um carregamento e outro.
        selecionado: mapa?.ilhas.some((n) => n.id === selecionado) ? selecionado : null
      })
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    } finally {
      set({ carregando: false })
    }
  },

  selecionar: (id) => set({ selecionado: id }),

  fixar: async (id, pos) => {
    try {
      // O mapa devolvido já vem do disco relido, então a tela nunca diverge dele.
      set({ mapa: await window.api.pasta.salvarMeta(id, { pos }) })
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

  criarPasta: async (pos) => {
    set({ carregando: true, erro: null, aviso: null })
    try {
      const resultado = await window.api.pasta.criar(pos)
      if (!resultado.ok) return set({ erro: resultado.erro })

      const { mapa, id } = resultado.dados
      // Já seleciona e marca para batizar: o painel abre com o nome em edição.
      set({ mapa, selecionado: id, batizando: id })
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

      const mapa = resultado.dados
      set({
        mapa,
        // A pasta apagada não existe mais: segurar a seleção nela deixaria um
        // painel aberto sobre uma ilha que sumiu.
        selecionado: mapa.ilhas.some((n) => n.id === get().selecionado) ? get().selecionado : null
      })
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
    const origem = get().conectandoDe

    // Primeiro clique escolhe a ponta; clicar nela de novo desiste.
    if (!origem) return set({ conectandoDe: id })
    if (origem === id) return set({ conectandoDe: null })

    set({ conectandoDe: null })
    try {
      set({ mapa: await window.api.pasta.conectar(origem, id) })
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    }
  },

  desconectar: async (origem, destino) => {
    try {
      set({ mapa: await window.api.pasta.desconectar(origem, destino) })
    } catch (erro) {
      set({ erro: mensagemDoErro(erro) })
    }
  },

  salvarMeta: async (id, patch) => {
    try {
      set({ mapa: await window.api.pasta.salvarMeta(id, patch) })
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
      set({ mapa: await window.api.pasta.reordenar(ids) })
    } catch (erro) {
      set({ erro: mensagemDoErro(erro), mapa })
    }
  },

  renomear: async (id, novoNome) => {
    try {
      const resultado = await window.api.pasta.renomear(id, novoNome)
      if (!resultado.ok) return set({ erro: resultado.erro })

      // O id mudou junto com o nome, então a seleção precisa seguir a ilha novo
      // em vez de apontar para um id que não existe mais.
      const mapa = resultado.dados
      const selecionado = get().selecionado
      set({
        mapa,
        selecionado: mapa.ilhas.some((n) => n.id === selecionado)
          ? selecionado
          : (mapa.ilhas.find((n) => n.caminho.endsWith(novoNome))?.id ?? null)
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
  set: (parcial: Partial<Estado>) => void,
  acao: () => Promise<Resultado<Mapa>>
): Promise<void> {
  set({ carregando: true, erro: null, aviso: null })
  try {
    const resultado = await acao()
    if (resultado.ok) {
      set({
        mapa: resultado.dados,
        movimentacao: await window.api.pasta.ultimaMovimentacao(),
        // A operação deu certo: o que veio aqui é ressalva, não falha.
        aviso: resultado.aviso ?? null
      })
    } else {
      set({ erro: resultado.erro })
    }
  } catch (erro) {
    set({ erro: mensagemDoErro(erro) })
  } finally {
    set({ carregando: false })
  }
}
