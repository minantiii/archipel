import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { basename, dirname, join } from 'node:path'
import {
  CANAIS,
  type Mapa,
  type MetaPatch,
  type Movimentacao,
  type PastaCriada,
  type Idioma,
  type Ilha,
  type Posicao,
  type Resultado,
  type Versoes
} from '@shared/types'
import { abrirNoVsCode, abrirTerminal } from './vault/actions'
import { mesmoCaminho } from './vault/caminhos'
import { definirRaiz, obterRaiz } from './vault/config'
import { criarPasta } from './vault/criar'
import { gravarConfig, lerConfig } from './vault/estrutura'
import { ultimaMovimentacao } from './vault/historico'
import { ehDiretorio } from './vault/io'
import { conectar, desconectar, esquecerMeta, marcarAcesso, salvarMeta } from './vault/metadados'
import { desfazerUltima, moverPasta, moverVarias } from './vault/move'
import { confirmacaoDoLote, relatarLote } from './relato'
import { idiomaAtual, t } from './textos'
import { renomearPasta } from './vault/renomear'
import { carregarMapa } from './vault/scan'
import { observar } from './vault/watcher'

/**
 * Mantém o observador apontado para o mapa aberto.
 *
 * Chamado a cada carregamento porque é o momento em que sabemos qual é a raiz
 * válida; trocar de mapa simplesmente reaponta o watcher.
 */
let raizObservada: string | null = null

async function sincronizarObservador(raiz: string): Promise<void> {
  if (raizObservada === raiz) return
  raizObservada = raiz

  await observar(raiz, () => {
    for (const janela of BrowserWindow.getAllWindows()) {
      janela.webContents.send(CANAIS.mapaMudou)
    }
  })
}

/** Recupera a raiz atual ou explode — usado nos handlers que não fazem sentido sem mapa. */
async function raizObrigatoria(): Promise<string> {
  const raiz = await obterRaiz()
  if (!raiz) throw new Error(t().nenhumMapaAberto)
  return raiz
}

function janelaDe(evento: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(evento.sender)
}

async function acharIlha(raiz: string, id: string): Promise<Ilha> {
  const ilha = (await carregarMapa(raiz)).ilhas.find((n) => n.id === id)
  if (!ilha) throw new Error(t().pastaForaDoMapa(id))
  return ilha
}

/** Caminho de uma ilha que existe de fato no disco — ilha ausente não tem o que abrir. */
async function caminhoUsavel(id: string): Promise<string> {
  const ilha = await acharIlha(await raizObrigatoria(), id)
  if (ilha.ausente) throw new Error(t().pastaSumiuDoDisco(id))
  return ilha.caminho
}

/**
 * Anota que o usuário acabou de usar a pasta.
 *
 * Sempre **depois** de a abertura dar certo: carimbar antes registraria como uso
 * um clique que terminou em "não encontrei o VS Code".
 *
 * Engole o próprio erro porque um `.md` travado por outro programa não pode
 * custar ao usuário o clique que ele deu — a pasta abriu, e dizer que falhou
 * mandaria procurar problema onde não houve. O carimbo é o detalhe menos
 * importante do gesto.
 */
async function registrarUso(id: string): Promise<void> {
  try {
    await marcarAcesso(await raizObrigatoria(), id)
  } catch {
    // Silêncio proposital: veja o comentário acima.
  }
}

/**
 * Confirmação para operações que mexem em pasta de verdade.
 *
 * Sempre mostra os caminhos completos: o usuário precisa conseguir conferir
 * exatamente o que vai sair do lugar antes de autorizar.
 */
async function confirmar(
  janela: BrowserWindow | null,
  opcoes: {
    titulo: string
    mensagem: string
    detalhe: string
    botao: string
    /** Deixa "Cancelar" como botão padrão: um Enter distraído não pode destruir nada. */
    padraoCancelar?: boolean
  }
): Promise<boolean> {
  const config: Electron.MessageBoxOptions = {
    type: opcoes.padraoCancelar ? 'warning' : 'question',
    title: opcoes.titulo,
    message: opcoes.mensagem,
    detail: opcoes.detalhe,
    buttons: [opcoes.botao, t().cancelar],
    defaultId: opcoes.padraoCancelar ? 1 : 0,
    cancelId: 1,
    noLink: true
  }

  const { response } = janela
    ? await dialog.showMessageBox(janela, config)
    : await dialog.showMessageBox(config)
  return response === 0
}

/** Envelope de uma operação que deu certo mas tem uma ressalva a comunicar. */
class ComAviso<T> {
  constructor(
    readonly dados: T,
    readonly aviso: string
  ) {}
}

/** Converte exceção em `Resultado` para a UI mostrar o motivo em vez de um stack trace. */
async function tentar<T>(acao: () => Promise<T | ComAviso<T>>): Promise<Resultado<T>> {
  try {
    const saida = await acao()
    return saida instanceof ComAviso
      ? { ok: true, dados: saida.dados, aviso: saida.aviso }
      : { ok: true, dados: saida }
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) }
  }
}

/**
 * Fila que serializa tudo que altera o mapa.
 *
 * As modais nativas já impediam duas operações do usuário ao mesmo tempo na
 * prática, mas "na prática" não é garantia: o watcher, um atalho repetido ou um
 * segundo clique rápido podiam intercalar leitura e escrita — `desfazerUltima`,
 * por exemplo, lê o histórico e só depois age. Aqui isso passa a ser impossível por
 * construção. Só operações de escrita entram; leitura não espera ninguém.
 */
let fila: Promise<unknown> = Promise.resolve()

function enfileirar<T>(acao: () => Promise<T>): Promise<T> {
  const proxima = fila.then(acao, acao)
  // A fila não pode morrer por causa de uma operação que falhou.
  fila = proxima.catch(() => undefined)
  return proxima
}

/**
 * Move um lote de pastas para dentro do mapa e devolve o mapa relido.
 *
 * O caminho comum do botão "Adicionar pasta" e do arraste do Explorer: os dois
 * só diferem em de onde saem os caminhos e em o que perguntam antes. Daqui para
 * baixo, nada mais pergunta nada — já está autorizado.
 */
async function moverParaDentroDoMapa(
  raiz: string,
  origens: readonly string[]
): Promise<Mapa | ComAviso<Mapa>> {
  // O lote inteiro numa chamada só da fila: assim nada se intromete entre
  // uma pasta e a seguinte, e o log sai na ordem em que o usuário escolheu.
  const relatorio = await enfileirar(() => moverVarias(raiz, origens))

  const mapa = await carregarMapa(raiz)
  const relato = relatarLote(relatorio, idiomaAtual())
  return relato ? new ComAviso(mapa, relato) : mapa
}

/**
 * Registra todos os handlers de IPC. Chamado uma única vez, no `whenReady`.
 *
 * Cada handler é a única porta de entrada do renderer para o disco — nenhuma
 * operação de filesystem existe fora daqui.
 */
export function registrarIpc(): void {
  ipcMain.handle(CANAIS.sistemaVersoes, (): Versoes => {
    return {
      app: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome
    }
  })

  ipcMain.handle(CANAIS.sistemaIdioma, (): Idioma => idiomaAtual())

  ipcMain.handle(CANAIS.mapaObterRaiz, (): Promise<string | null> => obterRaiz())

  ipcMain.handle(CANAIS.mapaEscolherRaiz, async (evento): Promise<string | null> => {
    const janela = BrowserWindow.fromWebContents(evento.sender)
    const opcoes = {
      title: t().escolherRaizTitulo,
      buttonLabel: t().escolherRaizBotao,
      properties: ['openDirectory', 'createDirectory'] as const
    }

    const resultado = janela
      ? await dialog.showOpenDialog(janela, { ...opcoes, properties: [...opcoes.properties] })
      : await dialog.showOpenDialog({ ...opcoes, properties: [...opcoes.properties] })

    const escolhida = resultado.filePaths[0]
    if (resultado.canceled || !escolhida) return null

    await definirRaiz(escolhida)
    return escolhida
  })

  ipcMain.handle(CANAIS.mapaCarregar, async (): Promise<Mapa | null> => {
    const raiz = await obterRaiz()
    // Mapa num pendrive desconectado ou pasta apagada: volta pra tela inicial
    // em vez de estourar um erro que o usuário não sabe resolver.
    if (!raiz || !(await ehDiretorio(raiz))) return null
    await sincronizarObservador(raiz)
    return carregarMapa(raiz)
  })

  ipcMain.handle(
    CANAIS.pastaSalvarMeta,
    async (_evento, id: string, patch: MetaPatch): Promise<Mapa> => {
      const raiz = await raizObrigatoria()
      // Na fila porque `salvarMeta` lê o `.md`, altera e regrava: duas chamadas
      // sobrepostas leem o mesmo estado e a última apaga o que a primeira
      // gravou. O seletor de cor dispara uma chamada por movimento do mouse, e
      // era assim que uma tag recém-criada sumia sozinha do frontmatter.
      await enfileirar(() => salvarMeta(raiz, id, patch))
      return carregarMapa(raiz)
    }
  )

  ipcMain.handle(CANAIS.pastaReordenar, async (_evento, ids: string[]): Promise<Mapa> => {
    const raiz = await raizObrigatoria()
    // Também lê-altera-grava: sem a fila, reordenar durante uma varredura podia
    // gravar por cima das cores de tag que a varredura tinha acabado de registrar.
    await enfileirar(async () => {
      const config = await lerConfig(raiz)
      await gravarConfig(raiz, { tags: config.tags, ordem: ids })
    })
    return carregarMapa(raiz)
  })

  ipcMain.handle(
    CANAIS.pastaConectar,
    async (_evento, origem: string, destino: string): Promise<Mapa> => {
      const raiz = await raizObrigatoria()
      // Mesma fila do `salvarMeta`: conectar reescreve o corpo do `.md` a partir
      // do que leu, e cruzar com outra escrita perderia uma das duas.
      await enfileirar(() => conectar(raiz, origem, destino))
      return carregarMapa(raiz)
    }
  )

  ipcMain.handle(
    CANAIS.pastaDesconectar,
    async (_evento, origem: string, destino: string): Promise<Mapa> => {
      const raiz = await raizObrigatoria()
      await enfileirar(() => desconectar(raiz, origem, destino))
      return carregarMapa(raiz)
    }
  )

  ipcMain.handle(
    CANAIS.pastaRenomear,
    async (_evento, id: string, novoNome: string): Promise<Resultado<Mapa>> =>
      tentar(async () => {
        const raiz = await raizObrigatoria()
        // Renomear também mexe em pasta no disco e reescreve vários `.md`:
        // entra na mesma fila para não cruzar com uma movimentação.
        await enfileirar(() => renomearPasta(raiz, id, novoNome))
        return carregarMapa(raiz)
      })
  )

  ipcMain.handle(CANAIS.abrirExplorer, async (_evento, id: string): Promise<Resultado<null>> =>
    tentar(async () => {
      const ilha = await acharIlha(await raizObrigatoria(), id)
      if (ilha.ausente) throw new Error(t().pastaSumiuDoDisco(id))

      const problema = await shell.openPath(ilha.caminho)
      if (problema) throw new Error(problema)
      await registrarUso(id)
      return null
    })
  )

  ipcMain.handle(CANAIS.abrirVscode, async (_evento, id: string): Promise<Resultado<null>> =>
    tentar(async () => {
      await abrirNoVsCode(await caminhoUsavel(id))
      await registrarUso(id)
      return null
    })
  )

  ipcMain.handle(CANAIS.abrirTerminal, async (_evento, id: string): Promise<Resultado<null>> =>
    tentar(async () => {
      await abrirTerminal(await caminhoUsavel(id))
      await registrarUso(id)
      return null
    })
  )

  ipcMain.handle(CANAIS.abrirTerminalNoMapa, async (): Promise<Resultado<null>> =>
    tentar(async () => {
      // Em `.organizador`, e não na raiz: é de lá que se enxergam todos os `.md`
      // de uma vez, com o `AGENTS.md` ao lado explicando o formato.
      await abrirTerminal(join(await raizObrigatoria(), '.organizador'))
      return null
    })
  )

  ipcMain.handle(CANAIS.abrirCopiarCaminho, async (_evento, id: string): Promise<Resultado<null>> =>
    tentar(async () => {
      const ilha = await acharIlha(await raizObrigatoria(), id)
      clipboard.writeText(ilha.caminho)
      return null
    })
  )

  // --- Movimentação de pastas -------------------------------------------------

  ipcMain.handle(CANAIS.pastaAdicionar, async (evento): Promise<Resultado<Mapa>> =>
    tentar(async () => {
      const raiz = await raizObrigatoria()
      const janela = janelaDe(evento)

      const escolha = await dialog.showOpenDialog({
        title: t().escolherPastasTitulo,
        buttonLabel: t().escolherPastasBotao,
        properties: ['openDirectory', 'multiSelections']
      })

      const origens = escolha.canceled ? [] : escolha.filePaths
      if (origens.length === 0) return carregarMapa(raiz)

      const autorizado = await confirmar(janela, confirmacaoDoLote(raiz, origens, idiomaAtual()))
      if (!autorizado) return carregarMapa(raiz)

      return moverParaDentroDoMapa(raiz, origens)
    })
  )

  /*
   * Arrastar do Explorer e soltar na janela.
   *
   * Não pergunta nada, ao contrário do botão logo acima: ali a escolha acontece
   * num diálogo que não mostra para onde as pastas vão, então a confirmação é a
   * primeira vez que o usuário vê o destino. No arraste ele já apontou a origem
   * e o alvo com o próprio mouse — repetir a pergunta seria pedir que
   * confirmasse o que acabou de fazer. O `Ctrl` + `Z` continua sendo a volta.
   */
  ipcMain.handle(
    CANAIS.pastaAdicionarCaminhos,
    async (_evento, caminhos: string[]): Promise<Resultado<Mapa>> =>
      tentar(async () => {
        const raiz = await raizObrigatoria()

        // Quem já mora na raiz foi arrastado de volta para onde já estava:
        // ignorar em silêncio é mais honesto que um "já existe no destino".
        // O que não for pasta segue no lote de propósito, para voltar com nome
        // e motivo na lista de quem ficou de fora.
        const origens = caminhos.filter((caminho) => !mesmoCaminho(dirname(caminho), raiz))
        if (origens.length === 0) return carregarMapa(raiz)

        return moverParaDentroDoMapa(raiz, origens)
      })
  )

  ipcMain.handle(
    CANAIS.pastaCriar,
    async (_evento, pos: Posicao | null): Promise<Resultado<PastaCriada>> =>
      tentar(async () => {
        const raiz = await raizObrigatoria()

        const id = await enfileirar(async () => {
          const novo = await criarPasta(raiz)
          // Fixa onde o usuário clicou com o direito, para a pasta nascer no
          // lugar que ele apontou em vez de ser jogada pelo layout automático.
          if (pos) await salvarMeta(raiz, novo, { pos })
          return novo
        })

        return { mapa: await carregarMapa(raiz), id }
      })
  )

  ipcMain.handle(
    CANAIS.pastaApagar,
    async (evento, id: string): Promise<Resultado<Mapa>> =>
      tentar(async () => {
        const raiz = await raizObrigatoria()
        const ilha = await acharIlha(raiz, id)
        if (ilha.ausente) throw new Error(t().pastaJaNaoEstaNoDisco(id))

        const autorizado = await confirmar(janelaDe(evento), {
          titulo: t().apagarTitulo,
          mensagem: t().apagarPergunta(id),
          detalhe: t().apagarDetalhe(ilha.caminho),
          botao: t().apagarBotao,
          // Único lugar do app que remove uma pasta a pedido: o botão padrão é
          // "Cancelar" de propósito.
          padraoCancelar: true
        })
        if (!autorizado) return carregarMapa(raiz)

        await enfileirar(async () => {
          // Lixeira, e não `fs.rm`: apagar de verdade não teria volta, e este é
          // um comando que a pessoa dá com o mouse, num menu, sem pensar muito.
          await shell.trashItem(ilha.caminho)
          await esquecerMeta(raiz, id)
        })

        return carregarMapa(raiz)
      })
  )

  ipcMain.handle(
    CANAIS.pastaRemoverDoMapa,
    async (evento, id: string): Promise<Resultado<Mapa>> =>
      tentar(async () => {
        const raiz = await raizObrigatoria()
        const janela = janelaDe(evento)
        const ilha = await acharIlha(raiz, id)
        if (ilha.ausente) throw new Error(t().pastaJaNaoEstaNoDisco(id))

        const escolha = await dialog.showOpenDialog({
          title: t().escolherDestinoTitulo,
          buttonLabel: t().escolherDestinoBotao,
          properties: ['openDirectory', 'createDirectory']
        })

        const pastaDestino = escolha.filePaths[0]
        if (escolha.canceled || !pastaDestino) return carregarMapa(raiz)

        const destino = join(pastaDestino, basename(ilha.caminho))
        const autorizado = await confirmar(janela, {
          titulo: t().tirarDoMapaTitulo,
          mensagem: t().tirarDoMapaPergunta(id),
          detalhe: t().tirarDoMapaDetalhe(ilha.caminho, destino),
          botao: t().mover
        })
        if (!autorizado) return carregarMapa(raiz)

        const { aviso } = await enfileirar(async () => {
          const resultado = await moverPasta(raiz, ilha.caminho, destino)
          await esquecerMeta(raiz, id)
          return resultado
        })
        const mapa = await carregarMapa(raiz)
        return aviso ? new ComAviso(mapa, aviso) : mapa
      })
  )

  ipcMain.handle(CANAIS.pastaUltimaMovimentacao, async (): Promise<Movimentacao | null> => {
    const raiz = await obterRaiz()
    return raiz ? ultimaMovimentacao(raiz) : null
  })

  ipcMain.handle(CANAIS.pastaDesfazerMovimentacao, async (evento): Promise<Resultado<Mapa>> =>
    tentar(async () => {
      const raiz = await raizObrigatoria()
      const ultima = await ultimaMovimentacao(raiz)
      if (!ultima) throw new Error(t().semMovimentacao)

      const autorizado = await confirmar(janelaDe(evento), {
        titulo: t().desfazerTitulo,
        mensagem: t().desfazerPergunta(basename(ultima.para)),
        detalhe: t().desfazerDetalhe(ultima.para, ultima.de),
        botao: t().desfazerBotao
      })
      if (!autorizado) return carregarMapa(raiz)

      const { aviso } = await enfileirar(() => desfazerUltima(raiz))
      const mapa = await carregarMapa(raiz)
      return aviso ? new ComAviso(mapa, aviso) : mapa
    })
  )
}
