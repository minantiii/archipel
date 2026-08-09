import { contextBridge, ipcRenderer } from 'electron'
import { CANAIS } from '@shared/types'
import type {
  Mapa,
  MetaPatch,
  Movimentacao,
  OrganizadorApi,
  PastaCriada,
  Posicao,
  Resultado,
  Versoes
} from '@shared/types'

/**
 * Ponte tipada entre o renderer e o main.
 *
 * Só o que está aqui é alcançável pelo renderer — nada de `ipcRenderer` solto
 * nem de `fs`. Roda com `sandbox: true`, então usa apenas o subconjunto do
 * módulo `electron` disponível em preloads sandboxed.
 */
const api: OrganizadorApi = {
  sistema: {
    versoes: (): Promise<Versoes> => ipcRenderer.invoke(CANAIS.sistemaVersoes)
  },

  mapa: {
    obterRaiz: (): Promise<string | null> => ipcRenderer.invoke(CANAIS.mapaObterRaiz),
    escolherRaiz: (): Promise<string | null> => ipcRenderer.invoke(CANAIS.mapaEscolherRaiz),
    carregar: (): Promise<Mapa | null> => ipcRenderer.invoke(CANAIS.mapaCarregar),
    aoMudar: (callback: () => void): (() => void) => {
      const ouvinte = (): void => callback()
      ipcRenderer.on(CANAIS.mapaMudou, ouvinte)
      return () => ipcRenderer.removeListener(CANAIS.mapaMudou, ouvinte)
    }
  },

  pasta: {
    salvarMeta: (id: string, patch: MetaPatch): Promise<Mapa> =>
      ipcRenderer.invoke(CANAIS.pastaSalvarMeta, id, patch),
    reordenar: (ids: string[]): Promise<Mapa> => ipcRenderer.invoke(CANAIS.pastaReordenar, ids),
    conectar: (origem: string, destino: string): Promise<Mapa> =>
      ipcRenderer.invoke(CANAIS.pastaConectar, origem, destino),
    desconectar: (origem: string, destino: string): Promise<Mapa> =>
      ipcRenderer.invoke(CANAIS.pastaDesconectar, origem, destino),
    renomear: (id: string, novoNome: string): Promise<Resultado<Mapa>> =>
      ipcRenderer.invoke(CANAIS.pastaRenomear, id, novoNome),
    adicionar: (): Promise<Resultado<Mapa>> => ipcRenderer.invoke(CANAIS.pastaAdicionar),
    criar: (pos: Posicao | null): Promise<Resultado<PastaCriada>> =>
      ipcRenderer.invoke(CANAIS.pastaCriar, pos),
    removerDoMapa: (id: string): Promise<Resultado<Mapa>> =>
      ipcRenderer.invoke(CANAIS.pastaRemoverDoMapa, id),
    apagar: (id: string): Promise<Resultado<Mapa>> => ipcRenderer.invoke(CANAIS.pastaApagar, id),
    ultimaMovimentacao: (): Promise<Movimentacao | null> =>
      ipcRenderer.invoke(CANAIS.pastaUltimaMovimentacao),
    desfazerUltimaMovimentacao: (): Promise<Resultado<Mapa>> =>
      ipcRenderer.invoke(CANAIS.pastaDesfazerMovimentacao)
  },

  abrir: {
    explorer: (id: string): Promise<Resultado<null>> => ipcRenderer.invoke(CANAIS.abrirExplorer, id),
    vscode: (id: string): Promise<Resultado<null>> => ipcRenderer.invoke(CANAIS.abrirVscode, id),
    terminal: (id: string): Promise<Resultado<null>> => ipcRenderer.invoke(CANAIS.abrirTerminal, id),
    terminalNoMapa: (): Promise<Resultado<null>> =>
      ipcRenderer.invoke(CANAIS.abrirTerminalNoMapa),
    copiarCaminho: (id: string): Promise<Resultado<null>> =>
      ipcRenderer.invoke(CANAIS.abrirCopiarCaminho, id)
  }
}

contextBridge.exposeInMainWorld('api', api)
