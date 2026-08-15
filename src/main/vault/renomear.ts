import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { caminhoArquivoMeta, caminhoPastas } from './estrutura'
import { ehDiretorio, escreverAtomico, existe } from './io'
import { higienizarNome, parsear, renomearLigacoes, serializar } from './markdown'

/**
 * Renomeia uma pasta do mapa.
 *
 * A parte que não pode ser esquecida é a última: os `[[ligações]]` dos outros
 * arquivos apontam para o nome antigo, e sem atualizá-los todas as conexões
 * daquele ilha viram links quebrados.
 */

export class ErroDeRenomeacao extends Error {}

/** Caracteres que o Windows não aceita em nome de arquivo ou pasta. */
const INVALIDOS = ['<', '>', ':', '"', '/', '\\', '|', '?', '*']

export function validarNome(nome: string): string {
  // O Windows também não aceita nome terminando em ponto ou espaço.
  const limpo = nome.trim().replace(/[. ]+$/, '')

  if (limpo.length === 0) throw new ErroDeRenomeacao('O nome não pode ficar vazio.')
  if (INVALIDOS.some((caractere) => limpo.includes(caractere))) {
    throw new ErroDeRenomeacao(`O nome não pode conter ${INVALIDOS.join(' ')}`)
  }
  if (limpo.startsWith('.')) {
    throw new ErroDeRenomeacao('Pastas começando com ponto ficam escondidas do mapa.')
  }

  return limpo
}

export async function renomearPasta(raiz: string, id: string, novoNome: string): Promise<string> {
  const nome = validarNome(novoNome)
  const novoId = higienizarNome(nome)

  const arquivoAtual = caminhoArquivoMeta(raiz, id)
  if (!(await existe(arquivoAtual))) {
    throw new ErroDeRenomeacao(`"${id}" não está no mapa.`)
  }

  const arquivo = parsear(await fs.readFile(arquivoAtual, 'utf8'))
  const nomeAtual = arquivo.meta.pasta ?? id
  if (nome === nomeAtual && novoId === id) return id

  if (novoId !== id && (await existe(caminhoArquivoMeta(raiz, novoId)))) {
    throw new ErroDeRenomeacao(`Já existe uma pasta chamada "${novoId}" no mapa.`)
  }

  const pastaAtual = join(raiz, nomeAtual)
  const pastaNova = join(raiz, nome)

  // A pasta pode ter sumido entre a varredura e o clique; nesse caso não há o
  // que renomear no disco, e só os metadados mudam.
  if (await ehDiretorio(pastaAtual)) {
    if (nome !== nomeAtual && (await existe(pastaNova))) {
      throw new ErroDeRenomeacao(`Já existe "${nome}" na raiz do mapa.`)
    }
    await fs.rename(pastaAtual, pastaNova)
  }

  await escreverAtomico(
    caminhoArquivoMeta(raiz, novoId),
    serializar({
      meta: { ...arquivo.meta, pasta: novoId === nome ? null : nome },
      corpo: arquivo.corpo
    })
  )

  if (novoId !== id) {
    await fs.rm(arquivoAtual, { force: true })
    await atualizarLigacoes(raiz, id, novoId)
  }

  return novoId
}

/** Reaponta para `novoId` todos os ligações que citavam `idAntigo`. */
async function atualizarLigacoes(raiz: string, idAntigo: string, novoId: string): Promise<void> {
  const dir = caminhoPastas(raiz)
  const arquivos = (await fs.readdir(dir)).filter((nome) => nome.toLowerCase().endsWith('.md'))

  for (const nome of arquivos) {
    const caminho = join(dir, nome)

    try {
      const arquivo = parsear(await fs.readFile(caminho, 'utf8'))
      if (!arquivo.links.includes(idAntigo)) continue

      const corpo = renomearLigacoes(arquivo.corpo, idAntigo, novoId)
      if (corpo !== arquivo.corpo) {
        await escreverAtomico(caminho, serializar({ meta: arquivo.meta, corpo }))
      }
    } catch {
      // Um arquivo ilegível não pode impedir os outros de serem corrigidos.
    }
  }
}
