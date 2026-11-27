import type { Agente, MotorAgente } from '@shared/types'

/**
 * Como cada motor é chamado. Puro (sem disco, sem processo), para os testes
 * conferirem os argumentos exatos que vão para o `claude` e o `agy`.
 *
 * Diferenças que pesam:
 * - o `claude` aceita prompt de sistema (`--append-system-prompt`) e lê a
 *   tarefa do stdin no modo `-p`;
 * - o `agy` não tem prompt de sistema e exige a tarefa como argumento do `-p`.
 *   Com stdin aberto ele fica esperando para sempre, então quem roda precisa
 *   fechá-lo (`stdio: 'ignore'`).
 */

export interface Comando {
  programa: string
  args: string[]
  /** Texto a mandar no stdin. `null` = stdin fechado. */
  entrada: string | null
}

const NOME_MOTOR: Record<MotorAgente, string> = { claude: 'Claude', gemini: 'Gemini' }

/** Primeira linha não vazia da função: o resumo que os colegas veem. */
export function resumoDaFuncao(funcao: string): string {
  const linha = funcao.split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
  const limpa = linha.replace(/^#+\s*/, '').trim()
  return limpa.length > 140 ? `${limpa.slice(0, 137)}...` : limpa
}

/**
 * O que o agente sabe sobre si e sobre o time, e como passar tarefa adiante.
 *
 * Vai como prompt de sistema no `claude` e no começo da mensagem no `agy`.
 */
export function promptDoTime(
  agente: Agente,
  time: readonly Agente[],
  /** Caminho do `delegar.cmd`. Vai literal: o Claude Code não aprova comando cujo programa vem de variável. */
  delegar: string | null
): string {
  const colegas = time.filter((a) => a.nome !== agente.nome)
  const partes = [
    `Você é "${agente.nome}", um agente do time do Archipel (${NOME_MOTOR[agente.motor]}).`
  ]
  if (agente.funcao.trim()) partes.push(`Sua função:\n${agente.funcao.trim()}`)

  if (colegas.length === 0) {
    partes.push('Por enquanto você é o único agente do time.')
    return partes.join('\n\n')
  }

  const lista = colegas
    .map((c) => {
      const onde = c.ilha ? `pasta ${c.ilha}` : 'raiz do mapa'
      const resumo = resumoDaFuncao(c.funcao)
      return `- ${c.nome} (${NOME_MOTOR[c.motor]}, ${onde})${resumo ? `: ${resumo}` : ''}`
    })
    .join('\n')

  partes.push(`Colegas do time:\n${lista}`)
  if (!delegar) return partes.join('\n\n')
  partes.push(
    [
      'Para passar uma tarefa a um colega e esperar a resposta dele, rode no terminal.',
      'No Bash:',
      `"${delegar}" --para <nome> <<'FIM'`,
      '<a tarefa, com todo o contexto que ele precisa>',
      'FIM',
      `No PowerShell: & "${delegar}" --para <nome> --arquivo <caminho de um .md com a tarefa>`,
      '',
      'A resposta sai na saída do comando. O colega não vê esta conversa: mande o contexto junto,',
      'com caminhos completos de arquivo. Pedidos seguidos ao mesmo colega continuam a mesma',
      'conversa com ele (use --nova para começar outra). A tarefa pode levar minutos: rode o',
      'comando com o tempo limite mais longo que tiver (600000 ms no Bash do Claude Code).',
      'Só passe tarefa adiante quando ajudar de verdade; o resto, faça você mesmo.'
    ].join('\n')
  )
  return partes.join('\n\n')
}

/**
 * Sessão interativa, numa aba do terminal embutido. Com `sessao`, retoma uma
 * conversa que o agente teve sem janela (uma tarefa delegada a ele).
 */
export function comandoInterativo(agente: Agente, prompt: string, sessao: string | null = null): Comando {
  const modelo = agente.modelo ? ['--model', agente.modelo] : []
  if (agente.motor === 'claude') {
    return {
      programa: 'claude',
      args: [...modelo, ...(sessao ? ['--resume', sessao] : []), '--append-system-prompt', prompt],
      entrada: null
    }
  }
  // Retomando, o `agy` já tem o papel na conversa: não precisa apresentá-lo de novo.
  if (sessao) {
    return { programa: 'agy', args: [...modelo, '--conversation', sessao], entrada: null }
  }
  // Sem prompt de sistema no `agy`: o papel vai como primeira mensagem, e a
  // sessão continua aberta depois dela (`-i`).
  return {
    programa: 'agy',
    args: [
      ...modelo,
      '-i',
      `${prompt}\n\nResponda só com uma linha dizendo quem você é e espere as instruções.`
    ],
    entrada: null
  }
}

/** Tarefa delegada: roda sem janela, do começo ao fim, e devolve JSON. */
export function comandoDelegado(
  agente: Agente,
  de: string,
  tarefaPura: string,
  prompt: string,
  sessao: string | null
): Comando {
  // Quem recebe precisa saber quem pede: a tarefa chega sem o resto da conversa.
  const tarefa = `Pedido de ${de === 'voce' ? 'você (o usuário)' : `"${de}"`}:

${tarefaPura}`
  const modelo = agente.modelo ? ['--model', agente.modelo] : []
  if (agente.motor === 'claude') {
    return {
      programa: 'claude',
      args: [
        '-p',
        '--output-format',
        'json',
        '--permission-mode',
        'acceptEdits',
        ...modelo,
        ...(sessao ? ['--resume', sessao] : []),
        '--append-system-prompt',
        prompt
      ],
      entrada: tarefa
    }
  }
  // Na primeira mensagem o papel vai junto; ao continuar, o `agy` já o tem.
  const mensagem = sessao ? tarefa : `${prompt}\n\n---\n\nTarefa:\n${tarefa}`
  return {
    programa: 'agy',
    args: [
      // Grudado na flag: solto, o `agy` reclama se a tarefa começar com `-`.
      `--print=${mensagem}`,
      '--output-format',
      'json',
      '--mode',
      'accept-edits',
      '--print-timeout',
      '0s',
      ...modelo,
      ...(sessao ? ['--conversation', sessao] : [])
    ],
    entrada: null
  }
}

export interface Saida {
  ok: boolean
  resposta: string
  sessao: string | null
}

/**
 * Lê o JSON que o motor imprimiu. Saída que não é JSON (erro antes de começar,
 * login vencido) volta inteira como resposta, para quem pediu ver o motivo.
 */
export function lerSaida(motor: MotorAgente, stdout: string, stderr: string, codigo: number): Saida {
  const bruto = stdout.trim()
  const inicio = bruto.indexOf('{')
  try {
    const dados = JSON.parse(inicio >= 0 ? bruto.slice(inicio) : bruto) as Record<string, unknown>
    if (motor === 'claude') {
      const resposta = typeof dados.result === 'string' ? dados.result : ''
      return {
        ok: codigo === 0 && dados.is_error !== true,
        resposta: resposta || String(dados.subtype ?? ''),
        sessao: typeof dados.session_id === 'string' ? dados.session_id : null
      }
    }
    const resposta = typeof dados.response === 'string' ? dados.response : ''
    return {
      ok: codigo === 0 && dados.status === 'SUCCESS',
      // O `agy` às vezes abre a resposta com uma etiqueta interna, como `[MAHI68]`.
      resposta: resposta.replace(/^\s*\[[A-Z0-9]{4,10}\]\s*/, ''),
      sessao: typeof dados.conversation_id === 'string' ? dados.conversation_id : null
    }
  } catch {
    const motivo = [bruto, stderr.trim()].filter(Boolean).join('\n')
    return { ok: false, resposta: motivo || `O motor saiu com código ${codigo}.`, sessao: null }
  }
}
