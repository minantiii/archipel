/**
 * Contrato compartilhado entre main, preload e renderer.
 *
 * Regra do projeto: o renderer NUNCA toca no filesystem. Tudo que mexe em disco
 * passa por aqui, atravessa o preload via contextBridge e é executado no main.
 */

export interface Posicao {
  x: number
  y: number
}

/** Uma ilha do mapa: uma pasta de projeto. */
export interface Ilha {
  /** Nome da pasta no disco, idêntico ao nome do arquivo `.md`. É a identidade da ilha. */
  id: string
  /** Caminho absoluto da pasta no disco. */
  caminho: string
  tags: string[]
  /** Sobrescreve a cor da tag principal. `null` = usa a cor da tag. */
  cor: string | null
  /** Posição fixada pelo usuário. `null` = o layout automático decide. */
  pos: Posicao | null
  /** Corpo do markdown em texto livre — é onde vivem as `[[ligações]]`. */
  diario: string
  /** Ids citados via `[[ligação]]` no corpo do diário. */
  links: string[]
  /** `true` quando o `.md` existe mas a pasta sumiu do disco. */
  ausente: boolean
  criadoEm: string | null
  ultimoAcessoEm: string | null
}

export interface Ponte {
  origem: string
  destino: string
}

export interface TagDef {
  nome: string
  cor: string
}

export interface Mapa {
  /** Raiz do mapa no disco. */
  raiz: string
  ilhas: Ilha[]
  pontes: Ponte[]
  tags: TagDef[]
  /**
   * Ordem manual da lista lateral, por id.
   *
   * Ids que não estiverem aqui entram depois, em ordem alfabética — assim uma
   * pasta nova aparece no fim em vez de sumir da lista.
   */
  ordem: string[]
}

/** Campos de uma ilha que a UI pode alterar. */
export type MetaPatch = Partial<Pick<Ilha, 'tags' | 'cor' | 'pos' | 'diario'>>

/**
 * Resultado de operações que podem falhar de forma esperada (mover, renomear...).
 *
 * `aviso` cobre o meio-termo que faltava: a operação deu certo, mas deixou algo
 * para o usuário conferir — sobra na origem depois de uma cópia entre discos,
 * por exemplo. Reportar isso como erro faria procurar a pasta no lugar errado.
 */
export type Resultado<T> =
  | { ok: true; dados: T; aviso?: string }
  | { ok: false; erro: string }

export interface Movimentacao {
  em: string
  de: string
  para: string
}

/** Retorno de "criar pasta": o mapa já recarregado e o id da ilha recém-nascida. */
export interface PastaCriada {
  mapa: Mapa
  /** Quem chamou usa isto para selecionar a pasta e abrir o campo de renomear. */
  id: string
}

export interface Versoes {
  app: string
  electron: string
  node: string
  chrome: string
}

/**
 * Idiomas da interface.
 *
 * Só a interface: as chaves dos arquivos (`criadoEm`, `pasta`, `ordem`) e os
 * nomes de `.organizador` seguem em português nos dois. São o formato dos dados,
 * não texto de tela — traduzi-los quebraria todo mapa já existente e criaria
 * dois dialetos do mesmo formato, com um mapa impossível de abrir no outro idioma.
 */
export type Idioma = 'pt' | 'en'

/** API exposta em `window.api` pelo preload. */
export interface OrganizadorApi {
  sistema: {
    versoes(): Promise<Versoes>
    /** Idioma da sessão: o escolhido no instalador, ou o do sistema. Só leitura. */
    idioma(): Promise<Idioma>
  }

  mapa: {
    /** Raiz configurada, ou `null` se o usuário ainda não escolheu uma. */
    obterRaiz(): Promise<string | null>
    /** Abre o diálogo do SO para escolher a raiz. `null` se cancelado. */
    escolherRaiz(): Promise<string | null>
    /** Varre o disco, reconcilia com os `.md` e devolve o mapa. */
    carregar(): Promise<Mapa | null>
    /** Notifica quando o disco muda por fora (Explorer, editor de texto...). Devolve o unsubscribe. */
    aoMudar(callback: () => void): () => void
  }

  atualizacao: {
    /**
     * Avisa quando uma versão nova já foi baixada e está esperando o app fechar.
     * Devolve o unsubscribe.
     */
    aoFicarPronta(callback: (versao: string) => void): () => void
  }

  pasta: {
    salvarMeta(id: string, patch: MetaPatch): Promise<Mapa>
    /** Grava a ordem manual da lista lateral. */
    reordenar(ids: string[]): Promise<Mapa>
    conectar(origem: string, destino: string): Promise<Mapa>
    desconectar(origem: string, destino: string): Promise<Mapa>
    renomear(id: string, novoNome: string): Promise<Resultado<Mapa>>
    /** Escolhe uma pasta fora do mapa e a MOVE para dentro. */
    adicionar(): Promise<Resultado<Mapa>>
    /** Cria uma pasta vazia no mapa, opcionalmente já fixada numa posição. */
    criar(pos: Posicao | null): Promise<Resultado<PastaCriada>>
    /** Move a pasta de volta para fora do mapa, num destino escolhido. */
    removerDoMapa(id: string): Promise<Resultado<Mapa>>
    /** Manda a pasta e todo o conteúdo dela para a Lixeira do sistema. */
    apagar(id: string): Promise<Resultado<Mapa>>
    ultimaMovimentacao(): Promise<Movimentacao | null>
    desfazerUltimaMovimentacao(): Promise<Resultado<Mapa>>
  }

  abrir: {
    explorer(id: string): Promise<Resultado<null>>
    vscode(id: string): Promise<Resultado<null>>
    terminal(id: string): Promise<Resultado<null>>
    /** Terminal em `.organizador`, de onde se enxerga o mapa inteiro. */
    terminalNoMapa(): Promise<Resultado<null>>
    copiarCaminho(id: string): Promise<Resultado<null>>
  }
}

/** Nomes dos canais de IPC. Usados pelo preload e pelo main — nunca pelo renderer. */
export const CANAIS = {
  sistemaVersoes: 'sistema:versoes',
  sistemaIdioma: 'sistema:idioma',

  mapaObterRaiz: 'mapa:obter-raiz',
  mapaEscolherRaiz: 'mapa:escolher-raiz',
  mapaCarregar: 'mapa:carregar',
  mapaMudou: 'mapa:mudou',

  atualizacaoPronta: 'atualizacao:pronta',

  pastaSalvarMeta: 'pasta:salvar-meta',
  pastaReordenar: 'pasta:reordenar',
  pastaConectar: 'pasta:conectar',
  pastaDesconectar: 'pasta:desconectar',
  pastaRenomear: 'pasta:renomear',
  pastaAdicionar: 'pasta:adicionar',
  pastaCriar: 'pasta:criar',
  pastaRemoverDoMapa: 'pasta:remover-do-mapa',
  pastaApagar: 'pasta:apagar',
  pastaUltimaMovimentacao: 'pasta:ultima-movimentacao',
  pastaDesfazerMovimentacao: 'pasta:desfazer-movimentacao',

  abrirExplorer: 'abrir:explorer',
  abrirVscode: 'abrir:vscode',
  abrirTerminal: 'abrir:terminal',
  abrirTerminalNoMapa: 'abrir:terminal-mapa',
  abrirCopiarCaminho: 'abrir:copiar-caminho'
} as const
