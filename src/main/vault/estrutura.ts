import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { TagDef } from '@shared/types'
import { escreverAtomico, existe } from './io'

/**
 * Layout do mapa no disco e o arquivo de configuração dele.
 *
 * ```
 * <raiz>/
 *   kronos-spec/            ← pasta de projeto real
 *   .organizador/
 *     AGENTS.md             ← explica o formato pro agente de linha de comando
 *     config.yaml           ← cores das tags
 *     pastas/kronos-spec.md ← metadados da ilha
 * ```
 *
 * É tudo que o app escreve no mapa, e é tudo conteúdo: nenhum arquivo daqui
 * cresce sozinho com o uso. Estado do app (raiz escolhida, histórico de
 * movimentações) mora em `userData`, fora do mapa.
 */

export const DIR_META = '.organizador'
export const DIR_PASTAS = 'pastas'

export function caminhoMeta(raiz: string): string {
  return join(raiz, DIR_META)
}

export function caminhoPastas(raiz: string): string {
  return join(raiz, DIR_META, DIR_PASTAS)
}

export function caminhoArquivoMeta(raiz: string, id: string): string {
  return join(caminhoPastas(raiz), `${id}.md`)
}

/** Paleta usada para dar cor a tags novas. Escolhida para ler bem no tema escuro. */
const PALETA = [
  '#7c5cff',
  '#4dabf7',
  '#38d9a9',
  '#ffd43b',
  '#ff922b',
  '#ff6b6b',
  '#f06595',
  '#a9e34b',
  '#22b8cf',
  '#b197fc'
]

/**
 * Cor para uma tag nova: estável (o mesmo nome cai sempre no mesmo lugar da
 * paleta) mas desviando das cores já em uso, senão duas tags vizinhas no mapa
 * saem indistinguíveis.
 */
export function corAutomatica(tag: string, usadas: ReadonlySet<string> = new Set()): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0

  const inicio = hash % PALETA.length
  for (let passo = 0; passo < PALETA.length; passo++) {
    const cor = PALETA[(inicio + passo) % PALETA.length]
    if (!usadas.has(cor)) return cor
  }
  return PALETA[inicio] // Paleta esgotada: repetir é melhor que não ter cor.
}

const AGENTS_MD = `# Mapa de pastas

Este diretório é o "banco de dados" de um organizador visual de pastas. Cada pasta de
projeto na raiz é uma **ilha do mapa**, e este diretório guarda os metadados dessas
ilhas em markdown puro — de propósito, para você poder editar tudo direto.

## Onde fica cada coisa

- \`pastas/<nome>.md\` — um arquivo por pasta de projeto. O **nome do arquivo é a
  identidade da ilha** e casa com o nome da pasta na raiz do mapa.
- \`config.yaml\` — as tags conhecidas com suas cores, e \`ordem\`: a ordem manual da lista
  lateral, por nome de arquivo (sem \`.md\`). Quem não estiver na \`ordem\` aparece depois,
  em ordem alfabética. Reordenar aqui reordena a lista no app.

## Formato de \`pastas/<nome>.md\`

\`\`\`markdown
---
tags: [kronos, api]
cor: "#7c5cff"
pos: { x: 120, y: -40 }
criadoEm: 2026-08-06T12:00:00.000Z
---

Texto livre descrevendo a pasta — o diário dela. As pontes do mapa são as
ligações daqui: esta pasta consome a [[ApiTelemetria]] e alimenta o [[frontend]].
\`\`\`

Todos os campos do frontmatter são opcionais:

| Campo | Significado |
|---|---|
| \`tags\` | Lista de tags. Agrupa e colore as ilhas no mapa. |
| \`cor\` | Sobrescreve a cor vinda da tag. Hexadecimal. |
| \`pos\` | Posição fixada no mapa. **Não invente valores** — quem escreve é o app, quando o usuário arrasta a ilha. |
| \`criadoEm\`, \`ultimoAcessoEm\` | Datas ISO, mantidas pelo app. |
| \`pasta\` | Nome real da pasta no disco, presente só quando difere do nome do arquivo (nomes com \`[ ] \\| # ^\` são higienizados). Se existir, **não mexa**. |

## Regras ao editar

1. **As pontes do mapa são as \`[[ligações]]\` do corpo.** Para ligar duas pastas,
   escreva \`[[NomeDaOutraPasta]]\` no corpo de uma delas. Para derrubar a ponte, apague
   a ligação. O alvo é o nome do arquivo \`.md\` sem a extensão.
2. **Nunca crie, renomeie, mova ou apague as pastas de projeto** na raiz do mapa. Isso é
   do app, que faz verificação e mantém histórico. Você mexe só nos \`.md\` daqui.
3. **Não crie \`.md\` para pasta que não existe.** O disco manda: na varredura seguinte o
   app apaga todo \`.md\` sem pasta correspondente na raiz, e o que você escreveu nele
   se perde.
4. Ligação apontando para um nome que não existe vira uma ilha "ausente", exibida
   apagada. Útil para enxergar ligações quebradas; evite criá-las sem querer.
5. A lista de tags do \`config.yaml\` é um espelho dos \`.md\`, não uma lista própria: tag
   usada num \`.md\` e ausente de lá ganha cor automática e se registra sozinha; tag que
   nenhum \`.md\` usa mais é removida de lá na varredura seguinte. Para excluir uma tag,
   apague-a do frontmatter de todas as pastas — o registro se limpa sozinho. A cor você
   pode editar à vontade, mas pré-cadastrar uma tag sem uso não funciona.

## Coisas úteis para pedir

- "Leia as pastas e agrupe por tema, criando tags coerentes."
- "Levante pontes entre as pastas que fazem parte do mesmo sistema."
- "Escreva uma descrição de uma linha no diário de cada \`.md\` que ainda está vazio."

O app observa este diretório e redesenha o mapa sozinho quando você salva.
`

/** Cria `.organizador/` com o `AGENTS.md` e o `config.yaml`, se ainda não existirem. */
export async function garantirEstrutura(raiz: string): Promise<void> {
  await fs.mkdir(caminhoPastas(raiz), { recursive: true })

  const agentes = join(caminhoMeta(raiz), 'AGENTS.md')
  const legado = join(caminhoMeta(raiz), 'CLAUDE.md')

  // Mapas criados antes do rename têm o arquivo com o nome antigo. Renomear, e não
  // gerar um segundo do zero, porque o conteúdo pode ter sido editado à mão. Se o
  // rename falhar (arquivo travado), cai no caminho de baixo e cria o novo — dois
  // arquivos explicando o formato é bem menos ruim do que o mapa não abrir.
  if (!(await existe(agentes)) && (await existe(legado))) {
    try {
      await fs.rename(legado, agentes)
    } catch {
      /* segue para a criação normal */
    }
  }

  if (!(await existe(agentes))) await escreverAtomico(agentes, AGENTS_MD)

  const config = join(caminhoMeta(raiz), 'config.yaml')
  if (!(await existe(config))) await gravarConfig(raiz, { tags: [], ordem: [] })

  // O histórico de movimentações morava aqui dentro e só crescia. Agora ele vive
  // em `userData`, com teto; o arquivo velho é varrido no primeiro carregamento
  // para não ficar de sujeira no mapa de quem já usava o app.
  await fs.rm(join(caminhoMeta(raiz), 'movimentos.log'), { force: true }).catch(() => undefined)
}

export interface ConfigMapa {
  tags: TagDef[]
  /** Ordem manual da lista lateral, por id. */
  ordem: string[]
}

function normalizarOrdem(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  const ids = valor.filter((item): item is string => typeof item === 'string' && item.length > 0)
  return [...new Set(ids)]
}

function normalizarTags(valor: unknown): TagDef[] {
  if (!Array.isArray(valor)) return []
  const tags: TagDef[] = []
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) continue
    const { nome, cor } = item as Record<string, unknown>
    if (typeof nome !== 'string' || nome.trim().length === 0) continue
    tags.push({
      nome: nome.trim(),
      cor: typeof cor === 'string' && /^#[0-9a-f]{3,8}$/i.test(cor) ? cor : corAutomatica(nome)
    })
  }
  return tags
}

/** Lê `config.yaml`. YAML quebrado degrada para vazio em vez de derrubar o app. */
export async function lerConfig(raiz: string): Promise<ConfigMapa> {
  try {
    const bruto = await fs.readFile(join(caminhoMeta(raiz), 'config.yaml'), 'utf8')
    const dados = parseYaml(bruto) as Partial<ConfigMapa> | null
    return { tags: normalizarTags(dados?.tags), ordem: normalizarOrdem(dados?.ordem) }
  } catch {
    return { tags: [], ordem: [] }
  }
}

/**
 * Grava o `config.yaml` inteiro.
 *
 * Recebe o objeto completo de propósito: gravar só as tags apagaria a ordem
 * manual da lista, e vice-versa. Quem chama precisa ter lido antes.
 */
export async function gravarConfig(raiz: string, config: ConfigMapa): Promise<void> {
  const cabecalho =
    '# Tags do mapa (nome e cor) e a ordem manual da lista lateral.\n' +
    '# Editável à mão — o app respeita o que estiver aqui.\n'
  await escreverAtomico(
    join(caminhoMeta(raiz), 'config.yaml'),
    cabecalho + stringifyYaml(config satisfies ConfigMapa)
  )
}
