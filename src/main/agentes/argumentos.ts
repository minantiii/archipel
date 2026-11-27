/** Argumentos do `delegar`: `--para x`, `--para=x`, `--tarefa`, `--arquivo`, `--nova`. */
export interface Opcoes {
  para: string | null
  tarefa: string | null
  arquivo: string | null
  nova: boolean
}

export function lerArgumentos(args: readonly string[]): Opcoes {
  const opcoes: Opcoes = { para: null, tarefa: null, arquivo: null, nova: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const igual = arg.startsWith('--') ? arg.indexOf('=') : -1
    const flag = igual > 0 ? arg.slice(0, igual) : arg
    const grudado = igual > 0 ? arg.slice(igual + 1) : null
    const valor = (): string | null => grudado ?? args[++i] ?? null
    if (flag === '--para') opcoes.para = valor()
    else if (flag === '--tarefa') opcoes.tarefa = valor()
    else if (flag === '--arquivo') opcoes.arquivo = valor()
    else if (flag === '--nova') opcoes.nova = true
  }
  return opcoes
}
