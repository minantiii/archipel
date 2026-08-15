import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Ponte, Mapa, Ilha, TagDef } from '@shared/types'
import {
  caminhoArquivoMeta,
  caminhoPastas,
  corAutomatica,
  garantirEstrutura,
  gravarConfig,
  lerConfig
} from './estrutura'
import { escreverAtomico } from './io'
import { higienizarNome, parsear, serializar, type ArquivoPasta } from './markdown'
import { esquecerMeta } from './metadados'

/**
 * Varredura da raiz do mapa e reconciliação com os `.md`.
 *
 * O princípio: **o disco é a fonte da verdade sobre existência**. Se a pasta está
 * lá, ela vira ilha — mesmo que ninguém tenha registrado nada. Se ela não está
 * mais, a ilha sai do mapa e o `.md` vai junto: o mapa é um retrato do disco, e
 * ilha que não corresponde a pasta nenhuma é ruído que só cresce com o tempo.
 */

/** Nomes na raiz que não são pastas de projeto. */
function ehIgnorada(nome: string): boolean {
  return nome.startsWith('.') || nome === 'node_modules'
}

async function listarPastasReais(raiz: string): Promise<string[]> {
  const entradas = await fs.readdir(raiz, { withFileTypes: true })
  return entradas
    .filter((e) => e.isDirectory() && !ehIgnorada(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

async function listarArquivosMeta(raiz: string): Promise<Map<string, ArquivoPasta>> {
  const dir = caminhoPastas(raiz)
  const arquivos = new Map<string, ArquivoPasta>()

  let entradas: string[]
  try {
    entradas = await fs.readdir(dir)
  } catch {
    return arquivos
  }

  for (const nome of entradas) {
    if (!nome.toLowerCase().endsWith('.md')) continue
    const id = nome.slice(0, -3)
    try {
      arquivos.set(id, parsear(await fs.readFile(join(dir, nome), 'utf8')))
    } catch {
      // Arquivo ilegível (permissão, lock): ignora esta ilha em vez de falhar o mapa inteiro.
    }
  }
  return arquivos
}

/** Gera um id livre a partir do nome da pasta, desviando de colisões. */
function idDisponivel(nomePasta: string, usados: Set<string>): string {
  const base = higienizarNome(nomePasta)
  if (!usados.has(base)) return base
  for (let n = 2; ; n++) {
    const tentativa = `${base} (${n})`
    if (!usados.has(tentativa)) return tentativa
  }
}

/** Varre o disco, cria os `.md` que faltarem e devolve o mapa pronto pra UI. */
export async function carregarMapa(raiz: string): Promise<Mapa> {
  await garantirEstrutura(raiz)

  const pastasReais = await listarPastasReais(raiz)
  const arquivos = await listarArquivosMeta(raiz)

  // Nome da pasta no disco -> id da ilha. `meta.pasta` cobre os nomes higienizados.
  const porPastaReal = new Map<string, string>()
  for (const [id, arquivo] of arquivos) porPastaReal.set(arquivo.meta.pasta ?? id, id)

  const usados = new Set(arquivos.keys())

  // Pasta no disco sem `.md`: registra agora. É o que faz "jogar uma pasta no
  // mapa pelo Explorer" simplesmente funcionar.
  for (const nomePasta of pastasReais) {
    if (porPastaReal.has(nomePasta)) continue

    const id = idDisponivel(nomePasta, usados)
    const arquivo: ArquivoPasta = {
      meta: {
        pasta: id === nomePasta ? null : nomePasta,
        tags: [],
        cor: null,
        pos: null,
        criadoEm: new Date().toISOString(),
        ultimoAcessoEm: null
      },
      corpo: '',
      links: []
    }

    await escreverAtomico(caminhoArquivoMeta(raiz, id), serializar(arquivo))
    arquivos.set(id, arquivo)
    porPastaReal.set(nomePasta, id)
    usados.add(id)
  }

  const noDisco = new Set(pastasReais)
  const ilhas: Ilha[] = []

  for (const [id, arquivo] of arquivos) {
    const nomePasta = arquivo.meta.pasta ?? id

    // Pasta apagada, movida ou renomeada por fora: a ilha sai do mapa agora, e o
    // `.md` dela também. É seguro fazer isso aqui porque só se chega neste ponto
    // com a leitura da raiz tendo dado certo — se o mapa inteiro estivesse
    // inacessível, o `readdir` lá em cima teria estourado antes.
    if (!noDisco.has(nomePasta)) {
      await esquecerMeta(raiz, id)
      continue
    }

    ilhas.push({
      id,
      caminho: join(raiz, nomePasta),
      tags: arquivo.meta.tags,
      cor: arquivo.meta.cor,
      pos: arquivo.meta.pos,
      diario: arquivo.corpo,
      links: arquivo.links,
      ausente: false,
      criadoEm: arquivo.meta.criadoEm,
      ultimoAcessoEm: arquivo.meta.ultimoAcessoEm
    })
  }

  const { pontes, fantasmas } = montarPontes(ilhas, raiz)
  ilhas.push(...fantasmas)
  ilhas.sort((a, b) => a.id.localeCompare(b.id, 'pt-BR'))

  const config = await sincronizarConfig(raiz, ilhas)
  return { raiz, ilhas, pontes, tags: config.tags, ordem: config.ordem }
}

/**
 * Converte os ligações em pontes.
 *
 * Ligação apontando pra um nome inexistente vira uma ilha fantasma ausente em vez
 * de sumir calado — é assim que um link quebrado fica visível no mapa.
 */
function montarPontes(
  ilhas: Ilha[],
  raiz: string
): { pontes: Ponte[]; fantasmas: Ilha[] } {
  const conhecidos = new Set(ilhas.map((n) => n.id))
  const fantasmas = new Map<string, Ilha>()
  const pontes: Ponte[] = []
  const vistas = new Set<string>()

  for (const ilha of ilhas) {
    for (const alvo of ilha.links) {
      if (alvo === ilha.id) continue

      if (!conhecidos.has(alvo) && !fantasmas.has(alvo)) {
        fantasmas.set(alvo, {
          id: alvo,
          caminho: join(raiz, alvo),
          tags: [],
          cor: null,
          pos: null,
          diario: '',
          links: [],
          ausente: true,
          criadoEm: null,
          ultimoAcessoEm: null
        })
      }

      // Ida e volta entre os mesmos duas ilhas é uma ponte só. O separador é um
      // `\0` porque ele não pode aparecer num nome de pasta: com um espaço,
      // "a b"+"c" e "a"+"b c" gerariam a mesma chave e uma das duas sumiria.
      const chave = [ilha.id, alvo].sort().join('\0')
      if (vistas.has(chave)) continue
      vistas.add(chave)
      pontes.push({ origem: ilha.id, destino: alvo })
    }
  }

  return { pontes, fantasmas: [...fantasmas.values()] }
}

/**
 * Reconcilia o `config.yaml` com o que os `.md` mostram: registra tags novas com
 * cor, descarta as que nenhuma pasta usa mais e limpa da `ordem` os ids que não
 * existem mais.
 *
 * O registro de tags é um espelho dos `.md`, nunca uma lista própria: uma tag que
 * sobrevivesse à última pasta que a usava viraria um chip fantasma na lateral,
 * que filtra e não acha nada. Consequência assumida: pré-cadastrar uma tag aqui
 * à mão, antes de usá-la, não funciona — ela some na varredura seguinte.
 */
async function sincronizarConfig(
  raiz: string,
  ilhas: Ilha[]
): Promise<{ tags: TagDef[]; ordem: string[] }> {
  const config = await lerConfig(raiz)
  const emUso = new Set(ilhas.flatMap((ilha) => ilha.tags))
  const sobreviventes = config.tags.filter((t) => emUso.has(t.nome))

  const porNome = new Map(sobreviventes.map((t) => [t.nome, t]))
  const coresUsadas = new Set(sobreviventes.map((t) => t.cor))

  // Cor escolhida à mão continua valendo; só o registro morto é que cai fora.
  let mudou = sobreviventes.length !== config.tags.length
  for (const ilha of ilhas) {
    for (const tag of ilha.tags) {
      if (porNome.has(tag)) continue
      const cor = corAutomatica(tag, coresUsadas)
      porNome.set(tag, { nome: tag, cor })
      coresUsadas.add(cor)
      mudou = true
    }
  }

  // Pasta renomeada ou removida deixaria um id morto entupindo a ordem manual.
  const existentes = new Set(ilhas.map((n) => n.id))
  const ordem = config.ordem.filter((id) => existentes.has(id))
  if (ordem.length !== config.ordem.length) mudou = true

  const tags = [...porNome.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  if (mudou) await gravarConfig(raiz, { tags, ordem })
  return { tags, ordem }
}
