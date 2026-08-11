import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { CANAIS } from '@shared/types'

/**
 * Atualização automática, lendo as releases do GitHub.
 *
 * A postura aqui é a mesma do resto do app: **nada acontece com a janela do
 * usuário sem ele saber.** A versão nova é baixada em segundo plano e fica
 * esperando; a troca só acontece quando ele fecha o app por conta própria.
 *
 * Nada de reiniciar sozinho no meio do uso. Este app move pastas de verdade — um
 * reinício surpresa durante uma movimentação seria a pior hora possível.
 */

/** Espera antes da primeira checagem, para não disputar com a abertura do mapa. */
const ESPERA_INICIAL_MS = 8000

export function cuidarDeAtualizacoes(): void {
  /*
   * Em desenvolvimento não há o que atualizar: o `app-update.yml` só existe
   * dentro do pacote, e sem ele o updater lança logo na primeira chamada. Sair
   * cedo evita um erro barulhento em toda execução do `npm run dev`.
   */
  if (!app.isPackaged) return

  // Baixa sozinho, instala só ao fechar. Os dois já são o padrão, mas explícito
  // aqui porque são exatamente as duas decisões de comportamento que importam.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    for (const janela of BrowserWindow.getAllWindows()) {
      janela.webContents.send(CANAIS.atualizacaoPronta, info.version)
    }
  })

  /*
   * Falha de atualização é silenciosa de propósito.
   *
   * Sem internet, GitHub fora do ar, release ainda sem manifesto — nada disso é
   * problema do usuário nem impede o app de funcionar. Uma faixa de erro dizendo
   * "não consegui verificar atualizações" só ensinaria a ignorar as faixas que
   * importam. Fica no log, para quem for investigar.
   */
  autoUpdater.on('error', (erro) => {
    console.error('Atualização automática:', erro.message)
  })

  setTimeout(() => {
    void autoUpdater.checkForUpdates()
  }, ESPERA_INICIAL_MS)
}
