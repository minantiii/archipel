import matter from 'gray-matter'
import type { Posicao } from '@shared/types'

/**
 * Leitura e escrita dos arquivos `.md` que descrevem cada pasta do mapa.
 *
 * Duas garantias que o resto do app depende:
 *  1. `serializar` NUNCA destrói o corpo do arquivo — só reescreve o frontmatter.
 *     O corpo é território do usuário e do Claude Code.
 *  2. `parsear` nunca lança. Frontmatter ausente, malformado ou com tipos
 *     errados degrada para o valor padrão em vez de derrubar o app.
 */

export interface MetaArquivo {
  /**
   * Nome real da pasta no disco, quando difere do nome do arquivo `.md`.
   *
   * Existe porque nomes de pasta podem conter `[ ] | # ^` (o usuário tem uma
   * "Demandas - [Cache]"), que quebrariam a sintaxe `[[ligação]]`. O arquivo
   * usa um nome higienizado e este campo guarda o nome verdadeiro.
   */
  pasta: string | null
  tags: string[]
  cor: string | null
  pos: Posicao | null
  criadoEm: string | null
  ultimoAcessoEm: string | null
}

export interface ArquivoPasta {
  meta: MetaArquivo
  corpo: string
  /** Alvos citados via `[[ligação]]` no corpo, sem duplicatas. */
  links: string[]
}

const META_PADRAO: MetaArquivo = {
  pasta: null,
  tags: [],
  cor: null,
  pos: null,
  criadoEm: null,
  ultimoAcessoEm: null
}

/**
 * Higieniza um nome de pasta para virar nome de arquivo `.md` e alvo de ligação.
 *
 * Colchetes são invólucro e somem; `| # ^` costumam separar palavras e viram `-`.
 * Assim "Demandas - [Cache]" fica legível como "Demandas - Cache" em vez de virar
 * uma sopa de traços.
 */
export function higienizarNome(nome: string): string {
  const limpo = nome
    .replace(/[[\]]/g, '')
    .replace(/[|#^]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s-]+|[\s-]+$/g, '')
  return limpo.length > 0 ? limpo : 'sem-nome'
}

const LIGACAO = /\[\[([^[\]|#^]+?)(?:\|[^[\]]*?)?\]\]/g

/** Extrai os alvos dos `[[ligações]]` de um texto, sem duplicatas. */
export function extrairLigacoes(corpo: string): string[] {
  const achados = new Set<string>()
  for (const [, alvo] of corpo.matchAll(LIGACAO)) {
    const limpo = alvo.trim()
    if (limpo.length > 0) achados.add(limpo)
  }
  return [...achados]
}

function comoTexto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim().length > 0 ? valor.trim() : null
}

function comoTags(valor: unknown): string[] {
  // Aceita tanto `tags: [a, b]` quanto `tags: a` — o Claude Code pode escrever qualquer um.
  const bruto = Array.isArray(valor) ? valor : valor === undefined || valor === null ? [] : [valor]
  const tags = bruto
    .map((t) => (typeof t === 'string' ? t.trim().replace(/^#/, '') : ''))
    .filter((t) => t.length > 0)
  return [...new Set(tags)]
}

function comoPosicao(valor: unknown): Posicao | null {
  if (typeof valor !== 'object' || valor === null) return null
  const { x, y } = valor as Record<string, unknown>
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

/** Lê um `.md`. Nunca lança: conteúdo inválido vira metadados padrão. */
export function parsear(conteudo: string): ArquivoPasta {
  let dados: Record<string, unknown> = {}
  let corpo = conteudo

  try {
    const resultado = matter(conteudo)
    dados = (resultado.data ?? {}) as Record<string, unknown>
    corpo = resultado.content
  } catch {
    // Frontmatter malformado: trata o arquivo inteiro como corpo e segue.
    // Assim uma edição YAML errada some com as tags, mas nunca com o texto.
    dados = {}
    corpo = conteudo
  }

  return {
    meta: {
      pasta: comoTexto(dados.pasta),
      tags: comoTags(dados.tags),
      cor: comoTexto(dados.cor),
      pos: comoPosicao(dados.pos),
      criadoEm: comoTexto(dados.criadoEm),
      ultimoAcessoEm: comoTexto(dados.ultimoAcessoEm)
    },
    corpo,
    links: extrairLigacoes(corpo)
  }
}

/** Gera o conteúdo do `.md`, preservando o corpo exatamente como está. */
export function serializar(arquivo: Pick<ArquivoPasta, 'meta' | 'corpo'>): string {
  const { meta, corpo } = arquivo

  // Só grava as chaves que têm valor: frontmatter enxuto é mais fácil de ler
  // e de editar à mão (ou pelo Claude Code).
  const dados: Record<string, unknown> = {}
  if (meta.pasta) dados.pasta = meta.pasta
  if (meta.tags.length > 0) dados.tags = meta.tags
  if (meta.cor) dados.cor = meta.cor
  if (meta.pos) dados.pos = meta.pos
  if (meta.criadoEm) dados.criadoEm = meta.criadoEm
  if (meta.ultimoAcessoEm) dados.ultimoAcessoEm = meta.ultimoAcessoEm

  return matter.stringify(corpo, dados)
}

/** Insere um `[[ligação]]` no fim do corpo, se ele ainda não existir. */
export function adicionarLigacao(corpo: string, alvo: string): string {
  if (extrairLigacoes(corpo).includes(alvo)) return corpo
  const base = corpo.replace(/\s+$/, '')
  return base.length > 0 ? `${base}\n\n[[${alvo}]]\n` : `[[${alvo}]]\n`
}

/** Remove todos os `[[ligações]]` que apontam para `alvo`, onde quer que estejam. */
export function removerLigacao(corpo: string, alvo: string): string {
  const semLink = corpo.replace(LIGACAO, (trecho, capturado: string) =>
    capturado.trim() === alvo ? '' : trecho
  )
  // Some com as linhas que ficaram vazias e colapsa o excesso de linhas em branco.
  return semLink
    .split('\n')
    .filter((linha, indice, todas) => linha.trim().length > 0 || todas[indice - 1]?.trim() !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** Renomeia o alvo de todos os ligações que apontavam para `de`. */
export function renomearLigacoes(corpo: string, de: string, para: string): string {
  return corpo.replace(LIGACAO, (trecho, capturado: string) => {
    if (capturado.trim() !== de) return trecho
    const apelido = trecho.includes('|') ? trecho.slice(trecho.indexOf('|'), -2) : ''
    return `[[${para}${apelido}]]`
  })
}

export { META_PADRAO }
