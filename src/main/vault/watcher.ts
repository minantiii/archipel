import { watch, type FSWatcher } from 'chokidar'
import { caminhoMeta, caminhoPastas } from './estrutura'

/**
 * Observa o mapa e avisa quando algo muda por fora do app.
 *
 * É o que faz a edição por fora parecer viva: um editor de texto ou um agente de
 * linha de comando salva os `.md` e o mapa se reorganiza na tela sozinho. Também
 * cobre o usuário criando ou apagando pastas pelo Explorer.
 */

const ESPERA_MS = 400

let atual: FSWatcher | null = null

export async function pararDeObservar(): Promise<void> {
  if (!atual) return
  const anterior = atual
  atual = null
  await anterior.close()
}

export async function observar(raiz: string, aoMudar: () => void): Promise<void> {
  await pararDeObservar()

  const observador = watch([raiz, caminhoPastas(raiz)], {
    // Só o primeiro nível importa: pastas de projeto na raiz e `.md` de metadados.
    // Descer dentro dos projetos observaria node_modules inteiro sem nenhum ganho.
    depth: 0,
    ignoreInitial: true,
    ignored: (caminho) => caminho.startsWith(caminhoMeta(raiz)) && !caminho.endsWith('.md'),
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 60 }
  })

  // Uma edição em lote (o Claude salvando vários `.md` seguidos) vira uma
  // recarga só, em vez de uma por arquivo.
  let agendado: NodeJS.Timeout | null = null
  const notificar = (): void => {
    if (agendado) clearTimeout(agendado)
    agendado = setTimeout(() => {
      agendado = null
      aoMudar()
    }, ESPERA_MS)
  }

  observador.on('add', notificar)
  observador.on('change', notificar)
  observador.on('unlink', notificar)
  observador.on('addDir', notificar)
  observador.on('unlinkDir', notificar)
  observador.on('error', () => {
    // Falha do watcher não pode derrubar o app: o usuário ainda tem o botão
    // Recarregar, que é o caminho manual para o mesmo resultado.
  })

  atual = observador
}
