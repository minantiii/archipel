import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import type { Movimentacao } from '@shared/types'
import { caminhoMeta } from './estrutura'
import { ehDiretorio, existe } from './io'

/**
 * Movimentação de pastas de projeto.
 *
 * Este é o único lugar do app que pode destruir trabalho do usuário, então cada
 * passo é conservador: valida antes, tenta o caminho barato (`rename`), e só
 * remove a origem depois de conferir que a cópia chegou inteira. Tudo fica
 * registrado em `.organizador/movimentos.log` para dar pra auditar e desfazer.
 */

export class ErroDeMovimentacao extends Error {}

const ARQUIVO_LOG = 'movimentos.log'

/** `true` se `filho` está dentro de `pai` (ou é o próprio). Case-insensitive no Windows. */
export function contem(pai: string, filho: string): boolean {
  const normalizar = (p: string): string =>
    process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p)

  const caminho = relative(normalizar(pai), normalizar(filho))
  return caminho === '' || (!caminho.startsWith('..') && !/^[a-z]:/i.test(caminho))
}

interface Medida {
  arquivos: number
  bytes: number
}

/** Conta arquivos e bytes de uma árvore, para conferir se a cópia saiu completa. */
async function medirArvore(raiz: string): Promise<Medida> {
  const medida: Medida = { arquivos: 0, bytes: 0 }
  const pilha = [raiz]

  while (pilha.length > 0) {
    const atual = pilha.pop() as string
    const entradas = await fs.readdir(atual, { withFileTypes: true })

    for (const entrada of entradas) {
      const caminho = join(atual, entrada.name)
      if (entrada.isDirectory()) {
        pilha.push(caminho)
      } else {
        medida.arquivos++
        // `lstat` e não `stat`: link simbólico é medido como link dos dois lados,
        // senão a verificação acusaria diferença por causa do alvo.
        medida.bytes += (await fs.lstat(caminho)).size
      }
    }
  }

  return medida
}

/**
 * Move um diretório. Tenta `rename` e, se origem e destino estiverem em volumes
 * diferentes (`EXDEV`), copia, confere e só então apaga a origem.
 *
 * Devolve um aviso quando a movimentação deu certo mas deixou sobra para trás.
 */
async function moverDiretorio(origem: string, destino: string): Promise<string | null> {
  try {
    await fs.rename(origem, destino)
    // Mesmo volume: o `rename` é atômico. Ou aconteceu, ou não aconteceu —
    // nunca existe um estado pela metade para alguém encontrar depois.
    return null
  } catch (erro) {
    const codigo = (erro as NodeJS.ErrnoException).code
    if (codigo !== 'EXDEV') throw erro
  }

  return copiarVerificarERemover(origem, destino)
}

/** Apaga sem deixar a falha da limpeza mascarar o erro que a motivou. */
async function limpar(caminho: string): Promise<void> {
  await fs.rm(caminho, { recursive: true, force: true }).catch(() => undefined)
}

/** Exportado para o teste conseguir exercitar o caminho de volumes diferentes. */
export async function copiarVerificarERemover(
  origem: string,
  destino: string
): Promise<string | null> {
  const antes = await medirArvore(origem)

  try {
    await fs.cp(origem, destino, { recursive: true, errorOnExist: true, force: false })
  } catch (erro) {
    // Cópia parcial não pode ficar para trás fingindo que deu certo.
    await limpar(destino)
    throw erro
  }

  const depois = await medirArvore(destino)
  if (depois.arquivos !== antes.arquivos || depois.bytes !== antes.bytes) {
    await limpar(destino)
    throw new ErroDeMovimentacao(
      `A cópia saiu diferente da origem (${antes.arquivos} arquivos/${antes.bytes} bytes contra ` +
        `${depois.arquivos}/${depois.bytes}). Nada foi apagado — a pasta continua em "${origem}".`
    )
  }

  // Daqui em diante a movimentação DEU CERTO: o conteúdo está inteiro e
  // conferido no destino. Não conseguir limpar a origem — um arquivo travado
  // por outro programa, por exemplo — é uma sobra a comunicar, não um motivo
  // para dizer que falhou. Dizer "falhou" mandaria o usuário procurar a pasta
  // no lugar errado, e ela está no lugar certo.
  try {
    await fs.rm(origem, { recursive: true, force: true })
    return null
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro)
    return (
      `A pasta chegou inteira e conferida em "${destino}", mas não deu para remover tudo da ` +
      `origem "${origem}" (${motivo}). O conteúdo no destino está completo — confira e apague ` +
      `a sobra à mão, de preferência fechando antes o programa que esteja usando esses arquivos.`
    )
  }
}

/** O que uma movimentação devolve: o registro e, se houver, a ressalva a mostrar. */
export interface ResultadoMovimentacao {
  movimentacao: Movimentacao
  /** Preenchido quando a pasta chegou inteira mas sobrou algo na origem. */
  aviso: string | null
}

/**
 * Executa uma movimentação já validada, cercada pelo log.
 *
 * A ordem aqui é a garantia central do app: **o registro vem antes de qualquer
 * mudança no disco**. Se não der para gravar o log, nada é movido — uma
 * movimentação que não pode ser registrada é uma movimentação que não pode ser
 * desfeita, e mover sem rede de segurança é pior do que não mover.
 *
 * A confirmação depois é gravada em silêncio: nesse ponto a pasta já mudou de
 * lugar, e transformar uma falha de log em exceção faria a UI dizer que nada
 * aconteceu quando aconteceu. A entrada `iniciada` sozinha já basta para
 * desfazer, porque quem decide se a movimentação de fato ocorreu é o disco.
 */
async function executar(
  raiz: string,
  origem: string,
  destino: string,
  tipo: EntradaLog['tipo']
): Promise<ResultadoMovimentacao> {
  const movimentacao: Movimentacao = { em: new Date().toISOString(), de: origem, para: destino }

  await fs.mkdir(dirname(destino), { recursive: true })
  await registrar(raiz, movimentacao, tipo, 'iniciada')

  let aviso: string | null
  try {
    aviso = await moverDiretorio(origem, destino)
  } catch (erro) {
    await registrarSilencioso(raiz, movimentacao, tipo, 'falhou')
    throw erro
  }

  await registrarSilencioso(raiz, movimentacao, tipo, 'concluida')
  return { movimentacao, aviso }
}

/** Valida e move uma pasta, registrando no log. Não pergunta nada — quem confirma é a UI. */
export async function moverPasta(
  raiz: string,
  origem: string,
  destino: string
): Promise<ResultadoMovimentacao> {
  if (!(await ehDiretorio(origem))) {
    throw new ErroDeMovimentacao(`"${origem}" não existe ou não é uma pasta.`)
  }
  if (contem(origem, raiz)) {
    throw new ErroDeMovimentacao(
      `"${origem}" contém o próprio mapa. Mover essa pasta colocaria o mapa dentro dele mesmo.`
    )
  }
  if (await existe(destino)) {
    throw new ErroDeMovimentacao(`Já existe "${basename(destino)}" no destino.`)
  }
  if (contem(origem, destino)) {
    throw new ErroDeMovimentacao('O destino está dentro da pasta de origem.')
  }

  return executar(raiz, origem, destino, 'mover')
}

/** Desfaz a última movimentação, devolvendo a pasta para onde ela estava. */
export async function desfazerUltima(raiz: string): Promise<ResultadoMovimentacao> {
  const ultima = await ultimaMovimentacao(raiz)
  if (!ultima) throw new ErroDeMovimentacao('Não há movimentação recente para desfazer.')

  if (!(await ehDiretorio(ultima.para))) {
    throw new ErroDeMovimentacao(
      `A pasta não está mais em "${ultima.para}" — alguém a moveu por fora. Nada foi feito.`
    )
  }
  if (await existe(ultima.de)) {
    throw new ErroDeMovimentacao(`Já existe algo em "${ultima.de}". Nada foi feito.`)
  }

  return executar(raiz, ultima.para, ultima.de, 'desfazer')
}

/**
 * Estado de uma entrada do log.
 *
 * - `iniciada`  — gravada antes de tocar no disco.
 * - `concluida` — confirmada depois que a pasta mudou de lugar.
 * - `falhou`    — a movimentação foi abortada e o disco não mudou.
 *
 * Uma `iniciada` sem par continua valendo como movimentação a desfazer: ou o
 * app morreu no meio, ou só a confirmação não foi gravada. Quem decide se ela
 * realmente aconteceu é o disco, na validação do `desfazerUltima`.
 */
type EstadoLog = 'iniciada' | 'concluida' | 'falhou'

interface EntradaLog extends Movimentacao {
  tipo: 'mover' | 'desfazer'
  estado: EstadoLog
}

async function registrar(
  raiz: string,
  movimentacao: Movimentacao,
  tipo: EntradaLog['tipo'],
  estado: EstadoLog
): Promise<void> {
  const entrada: EntradaLog = { ...movimentacao, tipo, estado }
  // Perder o registro de uma movimentação já feita seria pior que qualquer coisa
  // aqui, então garante o diretório em vez de assumir que ele existe.
  await fs.mkdir(caminhoMeta(raiz), { recursive: true })
  // Append e não escrita atômica: o log é histórico, cresce e nunca é reescrito.
  await fs.appendFile(join(caminhoMeta(raiz), ARQUIVO_LOG), `${JSON.stringify(entrada)}\n`, 'utf8')
}

/**
 * Registra sem deixar a falha do log virar falha da operação.
 *
 * Só é usado depois que o disco já mudou, quando a alternativa seria dizer ao
 * usuário que deu errado uma coisa que deu certo.
 */
async function registrarSilencioso(
  raiz: string,
  movimentacao: Movimentacao,
  tipo: EntradaLog['tipo'],
  estado: EstadoLog
): Promise<void> {
  await registrar(raiz, movimentacao, tipo, estado).catch(() => undefined)
}

async function lerLog(raiz: string): Promise<EntradaLog[]> {
  let bruto: string
  try {
    bruto = await fs.readFile(join(caminhoMeta(raiz), ARQUIVO_LOG), 'utf8')
  } catch {
    return []
  }

  const entradas: EntradaLog[] = []
  for (const linha of bruto.split('\n')) {
    if (linha.trim().length === 0) continue
    try {
      const dados = JSON.parse(linha) as Partial<EntradaLog>
      if (typeof dados.de === 'string' && typeof dados.para === 'string') {
        entradas.push({
          em: typeof dados.em === 'string' ? dados.em : '',
          de: dados.de,
          para: dados.para,
          tipo: dados.tipo === 'desfazer' ? 'desfazer' : 'mover',
          // Log gravado antes dos estados existirem: se está escrito, aconteceu.
          estado:
            dados.estado === 'iniciada' || dados.estado === 'falhou' ? dados.estado : 'concluida'
        })
      }
    } catch {
      // Linha corrompida não invalida o histórico inteiro.
    }
  }
  return entradas
}

/**
 * Junta as entradas de uma mesma operação numa só.
 *
 * Cada movimentação escreve duas linhas (`iniciada` e depois o desfecho). Sem
 * colapsar, a última linha do log seria uma confirmação e não uma operação.
 */
function colapsar(entradas: EntradaLog[]): EntradaLog[] {
  const operacoes: EntradaLog[] = []

  for (const entrada of entradas) {
    const anterior = operacoes.at(-1)
    const ehDesfecho =
      anterior !== undefined &&
      anterior.estado === 'iniciada' &&
      anterior.tipo === entrada.tipo &&
      anterior.de === entrada.de &&
      anterior.para === entrada.para

    if (ehDesfecho) operacoes[operacoes.length - 1] = entrada
    else operacoes.push(entrada)
  }

  return operacoes
}

/**
 * A movimentação que o `Ctrl+Z` reverteria, ou `null`.
 *
 * Se a última operação já é um "desfazer", não há o que desfazer — senão o
 * atalho viraria um ping-pong movendo a pasta de um lado para o outro sem fim.
 * Operações abortadas somem daqui: elas não chegaram a mudar o disco.
 */
export async function ultimaMovimentacao(raiz: string): Promise<Movimentacao | null> {
  const operacoes = colapsar(await lerLog(raiz)).filter((e) => e.estado !== 'falhou')
  const ultima = operacoes.at(-1)
  if (!ultima || ultima.tipo === 'desfazer') return null
  return { em: ultima.em, de: ultima.de, para: ultima.para }
}
