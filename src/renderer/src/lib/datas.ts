/**
 * Há quanto tempo uma pasta não recebe atenção, e como dizer isso em português.
 *
 * O app nasceu de pastas que somem de vista. Saber que existem é metade; a outra
 * metade é saber quais já não servem para nada — e é isso que estas contas dão.
 */

/** A partir daqui a ilha começa a apagar no mapa. */
export const DIAS_ATE_APAGAR = 30

/** A partir daqui ela é considerada esquecida, no fundo da escala. */
export const DIAS_ATE_ESQUECER = 180

/** Opacidade de quem está no fundo da escala. Apagada, nunca invisível. */
const OPACIDADE_MINIMA = 0.4

const DIA_MS = 86400000

/**
 * Dias desde o último sinal de vida da pasta.
 *
 * `ultimoAcessoEm` responde direto. Sem ele, vale a data de entrada no mapa: uma
 * pasta que está ali há oito meses e nunca foi aberta está esquecida do mesmo
 * jeito, e tratá-la como novidade esconderia justamente o caso que interessa.
 *
 * Sem nenhuma das duas, devolve `null` — e quem não sabe não chuta. Um `.md`
 * escrito à mão não tem data nenhuma, e apagar essa ilha no mapa seria inventar
 * um abandono que ninguém observou.
 */
export function diasSemUso(
  ilha: { ultimoAcessoEm: string | null; criadoEm: string | null },
  agora: number = Date.now()
): number | null {
  const referencia = ilha.ultimoAcessoEm ?? ilha.criadoEm
  if (!referencia) return null

  const quando = Date.parse(referencia)
  if (Number.isNaN(quando)) return null

  // Data no futuro (relógio remexido, arquivo copiado de outra máquina) conta
  // como agora: o passado é a única direção que esta escala sabe ler.
  return Math.max(0, (agora - quando) / DIA_MS)
}

/**
 * Quanto a ilha ainda "brilha": 1 para uso recente, caindo até um piso.
 *
 * Decai linearmente entre os dois marcos em vez de trocar de estado num limiar,
 * senão o mapa dividiria as pastas em dois grupos secos e a ideia é justamente
 * mostrar o esmaecimento como um gradiente.
 */
export function frescor(dias: number | null): number {
  if (dias === null || dias <= DIAS_ATE_APAGAR) return 1
  if (dias >= DIAS_ATE_ESQUECER) return OPACIDADE_MINIMA

  const percorrido = (dias - DIAS_ATE_APAGAR) / (DIAS_ATE_ESQUECER - DIAS_ATE_APAGAR)
  return 1 - percorrido * (1 - OPACIDADE_MINIMA)
}

const RELATIVO = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })

const ESCALA: [limite: number, unidade: Intl.RelativeTimeFormatUnit, emDias: number][] = [
  [1, 'day', 1],
  [30, 'day', 1],
  [365, 'month', 30.44],
  [Infinity, 'year', 365.25]
]

/**
 * "hoje", "há 3 dias", "há 5 meses" — a data em linguagem de gente.
 *
 * A data exata continua importando quando se quer conferir, mas ela vai no
 * `title`: na leitura corrida, "há 7 meses" diz mais do que "12/01/2026".
 */
export function emPalavras(iso: string | null, agora: number = Date.now()): string | null {
  if (!iso) return null

  const quando = Date.parse(iso)
  if (Number.isNaN(quando)) return null

  const dias = Math.max(0, (agora - quando) / DIA_MS)
  if (dias < 1) return 'hoje'

  const [, unidade, emDias] = ESCALA.find(([limite]) => dias < limite) ?? ESCALA[ESCALA.length - 1]
  return RELATIVO.format(-Math.round(dias / emDias), unidade)
}

/** Data por extenso, para o `title` de quem quiser conferir. */
export function porExtenso(iso: string | null): string | null {
  if (!iso) return null
  const quando = new Date(iso)
  return Number.isNaN(quando.getTime()) ? null : quando.toLocaleString('pt-BR')
}
