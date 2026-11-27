import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { Agente, Conversa, Time } from '@shared/types'
import { escreverAtomico } from '../vault/io'
import {
  nomeDeAgenteValido,
  parsearAgente,
  parsearConversa,
  serializarAgente,
  serializarConversa
} from './formato'

/**
 * O time no disco:
 *
 * ```
 * <raiz>/.organizador/agentes/
 *   revisor.md                 ← um agente (motor, modelo, ilha; corpo = função)
 *   conversas/
 *     20261127-103000-arquiteto-revisor-x1y2.md
 * ```
 *
 * Sem Electron: o `delegar` (Node puro) usa este módulo também.
 */

export const DIR_AGENTES = 'agentes'
export const DIR_CONVERSAS = 'conversas'

/** Conversas que o app carrega. As mais velhas continuam no disco, só não vêm para a tela. */
export const LIMITE_CONVERSAS = 60

export function caminhoAgentes(raiz: string): string {
  return join(raiz, '.organizador', DIR_AGENTES)
}

export function caminhoConversas(raiz: string): string {
  return join(caminhoAgentes(raiz), DIR_CONVERSAS)
}

async function nomesDeArquivo(pasta: string): Promise<string[]> {
  try {
    const entradas = await fs.readdir(pasta, { withFileTypes: true })
    return entradas
      .filter((e) => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'))
      .map((e) => e.name.slice(0, -3))
  } catch {
    return []
  }
}

export async function listarAgentes(raiz: string): Promise<Agente[]> {
  const nomes = (await nomesDeArquivo(caminhoAgentes(raiz))).filter(nomeDeAgenteValido)
  const agentes = await Promise.all(
    nomes.map(async (nome) => {
      try {
        return parsearAgente(nome, await fs.readFile(join(caminhoAgentes(raiz), `${nome}.md`), 'utf8'))
      } catch {
        return null
      }
    })
  )
  return agentes.filter((a): a is Agente => a !== null).sort((a, b) => a.nome.localeCompare(b.nome))
}

export async function listarConversas(raiz: string, limite = LIMITE_CONVERSAS): Promise<Conversa[]> {
  // O nome começa pela data, então a ordem alfabética invertida já é da mais nova à mais velha.
  const ids = (await nomesDeArquivo(caminhoConversas(raiz))).sort().reverse().slice(0, limite)
  const conversas = await Promise.all(
    ids.map(async (id) => {
      try {
        return parsearConversa(id, await fs.readFile(join(caminhoConversas(raiz), `${id}.md`), 'utf8'))
      } catch {
        return null
      }
    })
  )
  return conversas.filter((c): c is Conversa => c !== null)
}

/** `true` se o processo existe. `EPERM` também é vivo: existe, só não é nosso para sinalizar. */
export function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (erro) {
    return (erro as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Conversa "trabalhando" cujo `delegar` já morreu (PC desligado no meio, processo
 * morto pelo Gerenciador de Tarefas) ficaria trabalhando para sempre, com o barco
 * âmbar e a rota no mapa. Na leitura ela é encerrada como falha.
 */
async function encerrarOrfas(
  raiz: string,
  conversas: Conversa[],
  vivo: (pid: number) => boolean
): Promise<Conversa[]> {
  return Promise.all(
    conversas.map(async (c) => {
      if (c.status !== 'trabalhando' || c.pid === null || vivo(c.pid)) return c
      const encerrada: Conversa = {
        ...c,
        status: 'falhou',
        fim: new Date().toISOString(),
        pid: null,
        resposta: c.resposta || 'A tarefa parou sem resposta: o processo que a rodava terminou.'
      }
      await gravarConversa(raiz, encerrada).catch(() => undefined)
      return encerrada
    })
  )
}

export async function carregarTime(
  raiz: string,
  vivo: (pid: number) => boolean = processoVivo
): Promise<Time> {
  const [agentes, conversas] = await Promise.all([listarAgentes(raiz), listarConversas(raiz)])
  return { agentes, conversas: await encerrarOrfas(raiz, conversas, vivo) }
}

/** Marca a conversa como parada por você. Quem mata o processo é o chamador. */
export async function marcarParada(raiz: string, id: string): Promise<Conversa | null> {
  if (!/^[\w.-]+$/.test(id)) return null
  const conversa = (await listarConversas(raiz, 400)).find((c) => c.id === id)
  if (!conversa) return null
  const parada: Conversa = {
    ...conversa,
    status: 'falhou',
    fim: new Date().toISOString(),
    pid: null,
    resposta: 'Parada por você no painel do Archipel.'
  }
  await gravarConversa(raiz, parada)
  return parada
}

export async function salvarAgente(raiz: string, agente: Agente, nomeAntigo: string | null): Promise<void> {
  if (!nomeDeAgenteValido(agente.nome)) {
    throw new Error(
      `Nome de agente inválido: "${agente.nome}". Use letras minúsculas, números, - e _ (até 40).`
    )
  }
  const pasta = caminhoAgentes(raiz)
  await fs.mkdir(pasta, { recursive: true })
  const destino = join(pasta, `${agente.nome}.md`)

  const renomeando = nomeAntigo !== null && nomeAntigo !== agente.nome
  if (nomeAntigo === null || renomeando) {
    // Criar ou renomear por cima de outro agente apagaria o que ele era.
    const ocupado = await fs.access(destino).then(
      () => true,
      () => false
    )
    if (ocupado) throw new Error(`Já existe um agente chamado "${agente.nome}".`)
  }

  await escreverAtomico(destino, serializarAgente(agente))
  if (renomeando) await fs.rm(join(pasta, `${nomeAntigo}.md`), { force: true })
}

/** Apaga o agente. As conversas dele ficam: são o histórico do que foi feito. */
export async function apagarAgente(raiz: string, nome: string): Promise<void> {
  if (!nomeDeAgenteValido(nome)) throw new Error(`Agente inválido: "${nome}".`)
  await fs.rm(join(caminhoAgentes(raiz), `${nome}.md`), { force: true })
}

export async function gravarConversa(raiz: string, conversa: Conversa): Promise<void> {
  await fs.mkdir(caminhoConversas(raiz), { recursive: true })
  await escreverAtomico(join(caminhoConversas(raiz), `${conversa.id}.md`), serializarConversa(conversa))
}

/**
 * Sessão da última conversa de `de` com `para` que deu certo, para o próximo
 * pedido continuar de onde parou em vez de começar do zero.
 */
export async function ultimaSessao(raiz: string, de: string, para: string): Promise<string | null> {
  const conversas = await listarConversas(raiz, 400)
  const anterior = conversas.find(
    (c) => c.de === de && c.para === para && c.status === 'terminou' && c.sessao
  )
  return anterior?.sessao ?? null
}

/**
 * Pasta da ilha no disco. O nome da ilha costuma ser o da pasta, mas nomes com
 * `[ ] | # ^` são higienizados e o verdadeiro fica no campo `pasta:` do `.md`.
 * Ilha que não existe mais cai na raiz, em vez de o agente não rodar.
 */
export async function pastaDaIlha(raiz: string, ilha: string | null): Promise<string> {
  if (!ilha || /[\\/]/.test(ilha) || ilha === '..' || ilha === '.') return raiz
  const candidatos = [ilha]
  try {
    const meta = matter(await fs.readFile(join(raiz, '.organizador', 'pastas', `${ilha}.md`), 'utf8'))
    const real = meta.data.pasta
    if (typeof real === 'string' && real && !/[\\/]/.test(real)) candidatos.unshift(real)
  } catch {
    // Sem `.md`: tenta o nome direto.
  }
  for (const nome of candidatos) {
    try {
      if ((await fs.stat(join(raiz, nome))).isDirectory()) return join(raiz, nome)
    } catch {
      // Próximo candidato.
    }
  }
  return raiz
}
