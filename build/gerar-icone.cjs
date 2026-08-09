/**
 * Gera `icon.ico` e `icon.png` a partir de `icone.svg`.
 *
 * Roda dentro do próprio Electron: o Chromium que desenha o app é o mesmo que
 * rasteriza o ícone, então não entra nenhuma dependência de imagem no projeto só
 * para isto.
 *
 * Uso, com o app fechado:
 *   npx electron build/gerar-icone.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const { join } = require('node:path')

/** Tamanhos que o Windows escolhe conforme o contexto: barra, lista, área de trabalho. */
const TAMANHOS = [16, 24, 32, 48, 64, 128, 256]

/**
 * Monta um `.ico` com PNGs dentro.
 *
 * O formato aceita bitmap cru ou PNG por entrada, e PNG funciona em todos os
 * tamanhos desde o Vista. Cabeçalho de 6 bytes, uma entrada de 16 para cada
 * tamanho, e os PNGs em seguida.
 */
function montarIco(imagens) {
  const cabecalho = Buffer.alloc(6)
  cabecalho.writeUInt16LE(0, 0) // reservado
  cabecalho.writeUInt16LE(1, 2) // 1 = ícone
  cabecalho.writeUInt16LE(imagens.length, 4)

  let deslocamento = 6 + imagens.length * 16
  const entradas = imagens.map(({ tamanho, png }) => {
    const e = Buffer.alloc(16)
    // 0 quer dizer 256: o campo tem um byte só, e 256 não cabe nele.
    e.writeUInt8(tamanho >= 256 ? 0 : tamanho, 0)
    e.writeUInt8(tamanho >= 256 ? 0 : tamanho, 1)
    e.writeUInt8(0, 2) // paleta: nenhuma
    e.writeUInt8(0, 3) // reservado
    e.writeUInt16LE(1, 4) // planos
    e.writeUInt16LE(32, 6) // bits por pixel
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(deslocamento, 12)
    deslocamento += png.length
    return e
  })

  return Buffer.concat([cabecalho, ...entradas, ...imagens.map((i) => i.png)])
}

/**
 * Rasteriza o SVG num `<canvas>` dentro da página e devolve o PNG em base64.
 *
 * A rota óbvia — abrir o SVG numa janela e chamar `capturePage` — depende do
 * compositor do Chromium e falhava com `UnknownVizError`, além de exigir uma
 * janela de verdade na tela. Desenhar no canvas acontece inteiro no renderer:
 * não precisa de janela visível, o alfa vem correto, e o resultado independe de
 * placa de vídeo.
 */
function roteiroDeDesenho(svg, tamanho) {
  return `(async () => {
    const svg = ${JSON.stringify(svg)}
    const imagem = new Image()
    imagem.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    await imagem.decode()

    const tela = document.createElement('canvas')
    tela.width = ${tamanho}
    tela.height = ${tamanho}
    const ctx = tela.getContext('2d')
    ctx.drawImage(imagem, 0, 0, ${tamanho}, ${tamanho})
    return tela.toDataURL('image/png')
  })()`
}

async function gerar() {
  const svg = await fs.readFile(join(__dirname, 'icone.svg'), 'utf8')
  const imagens = []
  const pagina = join(__dirname, '.rasterizando.html')

  // Uma página em branco serve de bancada para todos os tamanhos.
  await fs.writeFile(pagina, '<!doctype html><meta charset="utf-8"><title>rasterizando</title>')
  const janela = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await janela.loadFile(pagina)

  for (const tamanho of TAMANHOS) {
    const dataUrl = await janela.webContents.executeJavaScript(roteiroDeDesenho(svg, tamanho))
    imagens.push({ tamanho, png: Buffer.from(dataUrl.split(',')[1], 'base64') })
    process.stdout.write(`${tamanho} `)
  }

  janela.destroy()
  await fs.rm(pagina, { force: true })
  await fs.writeFile(join(__dirname, 'icon.ico'), montarIco(imagens))
  await fs.writeFile(join(__dirname, 'icon.png'), imagens[imagens.length - 1].png)
  console.log(`\nicon.ico (${TAMANHOS.length} tamanhos) e icon.png gerados.`)
}

// Fechar a última janela faria o Electron encerrar o processo sozinho, no meio
// da gravação dos arquivos — o `icon.ico` saía com zero byte. Quem decide quando
// sair aqui é o fim do `gerar()`.
app.on('window-all-closed', () => {})

app.whenReady().then(() =>
  gerar().then(
    () => app.exit(0),
    // Sem isto o erro vira "unhandled rejection" sem mensagem, e o processo fica
    // pendurado esperando uma janela que nunca abriu.
    (erro) => {
      console.error('\nFalhou:', erro)
      app.exit(1)
    }
  )
)
