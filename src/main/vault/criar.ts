import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { existe } from './io'
import { higienizarNome } from './markdown'

/**
 * Criação de uma pasta de projeto vazia na raiz do mapa.
 *
 * Não escreve o `.md`: quem faz isso é o `carregarMapa`, que já registra
 * sozinho qualquer pasta nova que apareça na raiz — é o mesmo caminho de quando
 * você joga uma pasta no mapa pelo Explorer. Duplicar esse trabalho aqui daria
 * duas fontes de verdade para a mesma coisa.
 */

export class ErroDeCriacao extends Error {}

const NOME_PADRAO = 'Nova pasta'

/** Teto para a busca por nome livre. Estourar isso significa que algo está errado. */
const LIMITE = 999

/** Primeiro nome livre a partir de `base`: "Nova pasta", "Nova pasta 2"... */
async function nomeLivre(raiz: string, base: string): Promise<string> {
  if (!(await existe(join(raiz, base)))) return base

  for (let n = 2; n <= LIMITE; n++) {
    const tentativa = `${base} ${n}`
    if (!(await existe(join(raiz, tentativa)))) return tentativa
  }

  throw new ErroDeCriacao(`Já existem ${LIMITE} pastas chamadas "${base}" no mapa.`)
}

/**
 * Cria a pasta e devolve o id da ilha correspondente.
 *
 * O nome sai pronto e genérico porque quem acabou de clicar em "criar" ainda vai
 * batizar a pasta — a UI abre o campo de renomear já em foco.
 */
export async function criarPasta(raiz: string): Promise<string> {
  if (!(await existe(raiz))) throw new ErroDeCriacao('O mapa não existe mais no disco.')

  const nome = await nomeLivre(raiz, NOME_PADRAO)
  // `mkdir` sem `recursive`: se algo aparecer nesse caminho entre a checagem e
  // agora, o erro é bem-vindo — melhor falhar do que adotar uma pasta alheia.
  await fs.mkdir(join(raiz, nome))

  return higienizarNome(nome)
}
