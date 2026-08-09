import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { MetaPatch } from '@shared/types'
import { caminhoArquivoMeta, caminhoMeta } from './estrutura'
import { escreverAtomico } from './io'
import {
  adicionarLigacao,
  META_PADRAO,
  parsear,
  removerLigacao,
  serializar,
  type ArquivoPasta
} from './markdown'

/**
 * Alterações pontuais no `.md` de uma ilha.
 *
 * Sempre relê o arquivo antes de gravar: entre o carregamento da tela e o clique
 * do usuário, o Claude Code (ou o próprio usuário no VS Code) pode ter editado o
 * arquivo. Reler evita sobrescrever essa edição com um estado velho da UI.
 */
async function lerOuCriar(caminho: string): Promise<ArquivoPasta> {
  try {
    return parsear(await fs.readFile(caminho, 'utf8'))
  } catch {
    return { meta: { ...META_PADRAO }, corpo: '', links: [] }
  }
}

export async function salvarMeta(raiz: string, id: string, patch: MetaPatch): Promise<void> {
  const caminho = caminhoArquivoMeta(raiz, id)
  const atual = await lerOuCriar(caminho)

  // `undefined` significa "não mexe"; `null` significa "limpa" — por isso a
  // comparação é com `undefined` e não um `??`.
  const meta = {
    ...atual.meta,
    ...(patch.tags !== undefined && { tags: patch.tags }),
    ...(patch.cor !== undefined && { cor: patch.cor }),
    ...(patch.pos !== undefined && { pos: patch.pos })
  }

  const corpo = patch.diario !== undefined ? patch.diario : atual.corpo
  await escreverAtomico(caminho, serializar({ meta, corpo }))
}

/**
 * Carimba que a pasta acabou de ser usada.
 *
 * Fora do `salvarMeta` de propósito: isto não é edição do usuário, é o app
 * registrando um fato. Se entrasse no `MetaPatch`, a tela poderia mandar uma data
 * qualquer, e um campo que serve para responder "faz quanto tempo que não mexo
 * nisso?" só vale se ninguém puder inventar a resposta.
 */
export async function marcarAcesso(raiz: string, id: string): Promise<void> {
  const caminho = caminhoArquivoMeta(raiz, id)
  const atual = await lerOuCriar(caminho)
  const meta = { ...atual.meta, ultimoAcessoEm: new Date().toISOString() }
  await escreverAtomico(caminho, serializar({ meta, corpo: atual.corpo }))
}

/** Aplica uma transformação no corpo de um `.md`, preservando o frontmatter. */
async function editarCorpo(
  raiz: string,
  id: string,
  transformar: (corpo: string) => string
): Promise<void> {
  const caminho = caminhoArquivoMeta(raiz, id)
  const atual = await lerOuCriar(caminho)
  const corpo = transformar(atual.corpo)
  if (corpo === atual.corpo) return
  await escreverAtomico(caminho, serializar({ meta: atual.meta, corpo }))
}

/** Cria a ponte escrevendo um `[[ligação]]` no `.md` da origem. */
export async function conectar(raiz: string, origem: string, destino: string): Promise<void> {
  if (origem === destino) throw new Error('Uma pasta não se conecta com ela mesma.')
  await editarCorpo(raiz, origem, (corpo) => adicionarLigacao(corpo, destino))
}

/**
 * Desfaz a ponte. Limpa os dois lados de propósito: no mapa a ligação é
 * mútua, então tirar só um lado deixaria a ponte viva pelo outro e daria a
 * impressão de que o clique não funcionou.
 */
export async function desconectar(raiz: string, origem: string, destino: string): Promise<void> {
  await editarCorpo(raiz, origem, (corpo) => removerLigacao(corpo, destino))
  await editarCorpo(raiz, destino, (corpo) => removerLigacao(corpo, origem))
}

/**
 * Tira o `.md` de circulação quando a pasta sai do mapa.
 *
 * Move para `removidos/` em vez de apagar: sem a pasta, a ilha viraria um fantasma
 * sujando o mapa, mas as tags e o diário que o usuário escreveu continuam
 * recuperáveis se ele se arrepender.
 */
export async function arquivarMeta(raiz: string, id: string): Promise<void> {
  const origem = caminhoArquivoMeta(raiz, id)
  const pastaArquivo = join(caminhoMeta(raiz), 'removidos')

  try {
    await fs.mkdir(pastaArquivo, { recursive: true })
    await fs.rename(origem, join(pastaArquivo, `${id}.md`))
  } catch {
    // Sem `.md` para arquivar (ilha fantasma, por exemplo): não é problema.
  }
}
