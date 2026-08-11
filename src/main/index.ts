import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { cuidarDeAtualizacoes } from './atualizacao'
import { carregarIdioma } from './textos'
import { registrarIpc } from './ipc'
import { pararDeObservar } from './vault/watcher'

/**
 * Altura da barra de título, casada com a `.topo` do CSS.
 *
 * Os dois precisam bater: é o mesmo faixa de tela: o Windows desenha os botões
 * de janela por cima, e a `.topo` desenha o resto. Mexeu num, mexe no outro.
 */
const ALTURA_TOPO = 52

function criarJanela(): BrowserWindow {
  const janela = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 940,
    minHeight: 620,
    show: false,
    /**
     * O quadro nativo é claro e destoa do app inteiro. `hidden` esconde a barra
     * de título e entrega aquela faixa para a página, e `titleBarOverlay` manda
     * o Windows redesenhar minimizar/maximizar/fechar por cima, nas nossas cores.
     *
     * É melhor que `frame: false` com botões próprios: os botões continuam sendo
     * os do sistema, então o Snap Layouts, o menu do clique direito e o duplo
     * clique para maximizar seguem funcionando de graça.
     */
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      // Tom médio do gradiente da `.topo` já composto sobre `--fundo`: o overlay
      // é chapado, então uma cor de ponta deixaria degrau visível no canto.
      color: '#1e1e23',
      symbolColor: '#e6e6ea',
      height: ALTURA_TOPO
    },
    // Igual ao `--fundo` do CSS: é a cor que a janela mostra antes do primeiro
    // quadro do renderer, e divergir daqui dá um flash de cor errada ao abrir.
    backgroundColor: '#141416',
    title: 'Archipel',
    /*
     * Só no desenvolvimento. No app instalado o ícone da janela vem do próprio
     * `.exe`, que o electron-builder já carimba a partir de `build/icon.ico` —
     * apontar para cá naquele caso não acharia nada, porque `build/` fica fora
     * do pacote. Sem isto, `npm run dev` abre com o ícone genérico do Electron.
     */
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Evita o flash branco: só mostra quando o renderer já pintou.
  janela.once('ready-to-show', () => janela.show())

  // Erro no renderer aparece no terminal de quem rodou `npm run dev`, em vez de
  // ficar escondido atrás do devtools.
  janela.webContents.on('console-message', (detalhes) => {
    console.log(`[renderer:${detalhes.level}] ${detalhes.message}`)
  })




  // Links externos vão para o navegador, nunca abrem uma janela Electron.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void janela.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void janela.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return janela
}

// Uma instância só: abrir de novo foca a janela existente em vez de duplicar o app.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [janela] = BrowserWindow.getAllWindows()
    if (janela) {
      if (janela.isMinimized()) janela.restore()
      janela.focus()
    }
  })

  void app.whenReady().then(async () => {
    // Antes de qualquer janela: os diálogos do main leem daqui.
    await carregarIdioma()
    // Precisa casar com o `appId` do electron-builder, senão o Windows agrupa a
    // janela e o atalho como se fossem dois programas diferentes na barra.
    app.setAppUserModelId('com.archipel.app')
    registrarIpc()
    criarJanela()
    cuidarDeAtualizacoes()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) criarJanela()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Solta os handles do watcher antes de sair, senão o processo pode ficar preso.
  app.on('will-quit', () => {
    void pararDeObservar()
  })
}
