import matter from 'gray-matter'
import { MOTORES, type Agente, type Conversa, type MotorAgente, type StatusConversa } from '@shared/types'

/**
 * Leitura e escrita dos `.md` do time de agentes.
 *
 * Mesmas garantias dos `.md` das ilhas: parsear nunca lança (campo estragado
 * vira o padrão) e o corpo é texto livre de quem escreve.
 *
 * Sem Electron aqui: o `delegar` roda como Node puro e usa este módulo.
 */

/** Nome de agente: curto, sem espaço, e seguro como nome de arquivo e argumento de linha de comando. */
const NOME_VALIDO = /^[a-z0-9][a-z0-9_-]{0,39}$/

export function nomeDeAgenteValido(nome: string): boolean {
  return NOME_VALIDO.test(nome) && nome !== 'voce'
}

/** Sugere um nome válido a partir do que foi digitado: "Revisor de Código" vira "revisor-de-codigo". */
export function higienizarNomeDeAgente(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 40)
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim().length > 0 ? valor.trim() : null
}

function data(valor: unknown): string | null {
  // O YAML transforma `2026-11-27T10:00:00Z` sem aspas num `Date`.
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString()
  return texto(valor)
}

function motor(valor: unknown): MotorAgente {
  return MOTORES.includes(valor as MotorAgente) ? (valor as MotorAgente) : 'claude'
}

export function parsearAgente(nome: string, bruto: string): Agente {
  let dados: Record<string, unknown> = {}
  let corpo = bruto
  try {
    const lido = matter(bruto)
    dados = lido.data
    corpo = lido.content
  } catch {
    // Frontmatter quebrado: o arquivo inteiro vira a função, com os padrões.
  }
  return {
    nome,
    motor: motor(dados.motor),
    modelo: texto(dados.modelo),
    ilha: texto(dados.ilha),
    funcao: corpo.trim()
  }
}

export function serializarAgente(agente: Agente): string {
  const dados: Record<string, unknown> = { motor: agente.motor }
  if (agente.modelo) dados.modelo = agente.modelo
  if (agente.ilha) dados.ilha = agente.ilha
  return matter.stringify(`\n${agente.funcao.trim()}\n`, dados)
}

const STATUS: StatusConversa[] = ['trabalhando', 'terminou', 'falhou']

/**
 * O corpo da conversa tem duas seções. O separador é um comentário HTML
 * (invisível ao ler o `.md`), e não o título: uma tarefa que traga uma linha
 * "## Resposta" no meio não pode cortar a conversa no lugar errado.
 */
const TITULO_TAREFA = '## Tarefa'
const TITULO_RESPOSTA = '## Resposta'
const MARCA_RESPOSTA = '<!-- archipel:resposta -->'

export function parsearConversa(id: string, bruto: string): Conversa | null {
  let dados: Record<string, unknown>
  let corpo: string
  try {
    const lido = matter(bruto)
    dados = lido.data
    corpo = lido.content
  } catch {
    return null
  }
  const de = texto(dados.de)
  const para = texto(dados.para)
  const inicio = data(dados.inicio)
  if (!de || !para || !inicio) return null

  // Arquivo escrito à mão (ou antes da marca existir): o título separa.
  let marca = corpo.indexOf(MARCA_RESPOSTA)
  let tamanhoMarca = MARCA_RESPOSTA.length
  if (marca < 0) {
    const titulo = corpo.search(/^## Resposta\s*$/m)
    if (titulo >= 0) {
      marca = titulo
      tamanhoMarca = 0
    }
  }
  let tarefa = marca < 0 ? corpo : corpo.slice(0, marca)
  let resposta = marca < 0 ? '' : corpo.slice(marca + tamanhoMarca)
  tarefa = tarefa.trim().replace(/^## Tarefa\s*/, '')
  resposta = resposta.trim().replace(/^## Resposta\s*/, '')

  return {
    id,
    de,
    para,
    status: STATUS.includes(dados.status as StatusConversa)
      ? (dados.status as StatusConversa)
      : 'falhou',
    inicio,
    fim: data(dados.fim),
    sessao: texto(dados.sessao),
    pid: typeof dados.pid === 'number' && Number.isInteger(dados.pid) && dados.pid > 0 ? dados.pid : null,
    tarefa: tarefa.trim(),
    resposta: resposta.trim()
  }
}

export function serializarConversa(conversa: Conversa): string {
  const dados: Record<string, unknown> = {
    de: conversa.de,
    para: conversa.para,
    status: conversa.status,
    inicio: conversa.inicio
  }
  if (conversa.fim) dados.fim = conversa.fim
  if (conversa.sessao) dados.sessao = conversa.sessao
  if (conversa.pid && conversa.status === 'trabalhando') dados.pid = conversa.pid
  const corpo = `\n${TITULO_TAREFA}\n\n${conversa.tarefa.trim()}\n\n${MARCA_RESPOSTA}\n${TITULO_RESPOSTA}\n\n${conversa.resposta.trim()}\n`
  return matter.stringify(corpo, dados)
}

/** Id de conversa: ordena por data no nome do arquivo e diz quem falou com quem. */
export function idDeConversa(de: string, para: string, quando: Date): string {
  const carimbo = quando.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const sufixo = Math.random().toString(36).slice(2, 6)
  return `${carimbo}-${de}-${para}-${sufixo}`
}
