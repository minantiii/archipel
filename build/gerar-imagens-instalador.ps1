<#
    Gera as duas imagens que o assistente de instalação usa.

    O NSIS só aceita BMP nesses dois lugares, e nada moderno exporta BMP. Usa o
    System.Drawing do próprio Windows, que desenha gradiente, texto e imagem e
    salva BMP nativamente — sem dependência nova no projeto.

    Antes daqui houve uma tentativa de rasterizar pelo Chromium do Electron, como
    faz o `gerar-icone.cjs`. Não vingou: `capturePage` estoura `UnknownVizError`
    para estas janelas, e não valeu insistir por uma imagem estática.

    O ícone vem de `icon.png`, já gerado por `gerar-icone.cjs` — assim o desenho
    do instalador é literalmente o mesmo do app, sem uma segunda cópia para
    divergir com o tempo.

    Uso, depois de gerar o ícone:
      powershell -ExecutionPolicy Bypass -File build/gerar-imagens-instalador.ps1
#>

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$icone = [System.Drawing.Image]::FromFile((Join-Path $aqui 'icon.png'))

# Tamanhos fixados pelo NSIS. Não são sugestão: imagem de outro tamanho é
# esticada ou cortada, e o resultado fica torto.
$LATERAL = @{ largura = 164; altura = 314; arquivo = 'instalador-lateral.bmp' }
$CABECALHO = @{ largura = 150; altura = 57; arquivo = 'instalador-cabecalho.bmp' }

function Novo-Desenho($largura, $altura) {
    # 24 bits porque é o que o NSIS espera; salvar em 32 com alfa faz algumas
    # versões desenharem a imagem com o fundo preto.
    $bmp = New-Object System.Drawing.Bitmap($largura, $altura, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.TextRenderingHint = 'ClearTypeGridFit'
    return @($bmp, $g)
}

# --- Lateral: aparece na primeira e na última página, ao lado da área branca ---

$bmp, $g = Novo-Desenho $LATERAL.largura $LATERAL.altura

$area = New-Object System.Drawing.Rectangle(0, 0, $LATERAL.largura, $LATERAL.altura)
$gradiente = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $area,
    [System.Drawing.ColorTranslator]::FromHtml('#6ca2e5'),
    [System.Drawing.ColorTranslator]::FromHtml('#154075'),
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
$g.FillRectangle($gradiente, $area)

$g.DrawImage($icone, 38, 74, 88, 88)

$branco = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$suave = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 255, 255, 255))
$centralizado = New-Object System.Drawing.StringFormat
$centralizado.Alignment = 'Center'

$fonteNome = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
$fonteFrase = New-Object System.Drawing.Font('Segoe UI', 8)
$g.DrawString('Archipel', $fonteNome, $branco, 82, 182, $centralizado)
$g.DrawString("Um mapa para as suas`npastas de projeto", $fonteFrase, $suave, 82, 212, $centralizado)

$g.Dispose()
$bmp.Save((Join-Path $aqui $LATERAL.arquivo), [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()
"$($LATERAL.arquivo) — $($LATERAL.largura)x$($LATERAL.altura)"

# --- Cabeçalho: fica numa faixa branca das páginas internas, então vai claro ---

$bmp, $g = Novo-Desenho $CABECALHO.largura $CABECALHO.altura

$g.Clear([System.Drawing.Color]::White)
$g.DrawImage($icone, 14, 13, 31, 31)

$escuro = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#1b1b21'))
$fonteCabecalho = New-Object System.Drawing.Font('Segoe UI', 10.5, [System.Drawing.FontStyle]::Bold)
$g.DrawString('Archipel', $fonteCabecalho, $escuro, 51, 18)

$g.Dispose()
$bmp.Save((Join-Path $aqui $CABECALHO.arquivo), [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()
"$($CABECALHO.arquivo) — $($CABECALHO.largura)x$($CABECALHO.altura)"

$icone.Dispose()
