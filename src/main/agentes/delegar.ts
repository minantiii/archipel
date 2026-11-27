import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import type { Conversa } from '@shared/types'
import { gravarConversa, listarAgentes, pastaDaIlha, ultimaSessao } from './disco'
import { idDeConversa } from './formato'
import { lerArgumentos } from './argumentos'
import { comandoDelegado, lerSaida, promptDoTime } from './motores'

/**
 * `delegar`: um agente passa uma tarefa a outro e espera a resposta.
 *
 * Roda como Node puro, pelo próprio executável do Archipel com
 * `ELECTRON_RUN_AS_NODE=1` (o `delegar.cmd` que o app grava em `userData` faz
 * isso). Assim funciona sem Node instalado na máquina.
 *
 *   "C:\...\delegar.cmd" --para revisor <<'FIM'
 *   tarefa...
 *   FIM
 *
 * Cada pedido vira um `.md` em `.organizador/agentes/conversas/`, gravado com
 * `trabalhando` antes de o motor começar e atualizado no fim: é por esse arquivo
 * que o app vê o barco navegar até a ilha e a resposta chegar.
 */

/** Um agente pode delegar a outro, que delega a outro... até aqui. Evita um laço sem fim. */
const PROFUNDIDADE_MAXIMA = 3

/** Tira as marcas de sessão do Claude Code: o agente chamado é uma sessão própria, não filha. */
function semMarcasDoClaudeCode(ambiente: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const limpo = { ...ambiente }
  for (const chave of Object.keys(limpo)) {
    if (chave === 'CLAUDECODE' || chave.startsWith('CLAUDE_CODE_CHILD')) delete limpo[chave]
  }
  return limpo
}

async function lerStdin(): Promise<string> {
  // Sem nada encanado (terminal interativo), não fica esperando para sempre.
  if (process.stdin.isTTY) return ''
  const pedacos: Buffer[] = []
  for await (const pedaco of process.stdin) pedacos.push(pedaco as Buffer)
  return Buffer.concat(pedacos).toString('utf8')
}

function falhar(mensagem: string): never {
  process.stderr.write(`delegar: ${mensagem}\n`)
  process.exit(2)
}

async function principal(): Promise<void> {
  const raiz = process.env.ARCHIPEL_MAPA
  if (!raiz) falhar('ARCHIPEL_MAPA não definido. Rode pelo terminal de um agente do Archipel.')

  const de = process.env.ARCHIPEL_AGENTE || 'voce'
  const profundidade = Number(process.env.ARCHIPEL_PROFUNDIDADE) || 0
  if (profundidade >= PROFUNDIDADE_MAXIMA) {
    falhar(`limite de ${PROFUNDIDADE_MAXIMA} delegações em cadeia. Resolva esta tarefa você mesmo.`)
  }

  const opcoes = lerArgumentos(process.argv.slice(2))
  const agentes = await listarAgentes(raiz)
  const nomes = agentes.map((a) => a.nome).join(', ') || '(nenhum)'
  if (!opcoes.para) falhar(`falta --para <nome>. Agentes: ${nomes}`)
  const alvo = agentes.find((a) => a.nome === opcoes.para)
  if (!alvo) falhar(`não existe agente "${opcoes.para}". Agentes: ${nomes}`)
  if (alvo.nome === de) falhar('um agente não delega para si mesmo.')

  let tarefa = opcoes.tarefa ?? ''
  if (!tarefa && opcoes.arquivo) tarefa = await fs.readFile(opcoes.arquivo, 'utf8')
  if (!tarefa) tarefa = await lerStdin()
  tarefa = tarefa.replace(/^﻿/, '').trim()
  if (!tarefa) falhar('tarefa vazia. Mande pelo stdin, por --tarefa "..." ou por --arquivo <caminho>.')

  const sessao = opcoes.nova ? null : await ultimaSessao(raiz, de, alvo.nome)
  const comando = comandoDelegado(
    alvo,
    de,
    tarefa,
    promptDoTime(alvo, agentes, process.env.ARCHIPEL_DELEGAR || null),
    sessao
  )
  const pasta = await pastaDaIlha(raiz, alvo.ilha)

  const conversa: Conversa = {
    id: idDeConversa(de, alvo.nome, new Date()),
    de,
    para: alvo.nome,
    status: 'trabalhando',
    inicio: new Date().toISOString(),
    fim: null,
    sessao,
    // O painel para a tarefa matando este processo (e a árvore abaixo dele).
    pid: process.pid,
    tarefa,
    resposta: ''
  }
  await gravarConversa(raiz, conversa)

  const filho = spawn(comando.programa, comando.args, {
    cwd: pasta,
    stdio: [comando.entrada === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    env: {
      ...semMarcasDoClaudeCode(process.env),
      // O próprio alvo pode delegar adiante: ele passa a ser o remetente.
      ARCHIPEL_AGENTE: alvo.nome,
      ARCHIPEL_PROFUNDIDADE: String(profundidade + 1),
      // Este processo é o Electron em modo Node; o motor não deve herdar isso,
      // senão um `code .` lá dentro abriria um Node em vez do VS Code.
      ELECTRON_RUN_AS_NODE: ''
    },
    windowsHide: true
  })

  let stdout = ''
  let stderr = ''
  filho.stdout?.setEncoding('utf8').on('data', (d: string) => (stdout += d))
  filho.stderr?.setEncoding('utf8').on('data', (d: string) => (stderr += d))
  if (comando.entrada !== null) filho.stdin?.end(comando.entrada, 'utf8')

  const encerrar = async (resposta: string, ok: boolean, novaSessao: string | null): Promise<void> => {
    conversa.status = ok ? 'terminou' : 'falhou'
    conversa.fim = new Date().toISOString()
    conversa.resposta = resposta
    conversa.sessao = novaSessao ?? conversa.sessao
    await gravarConversa(raiz, conversa)
  }

  // Ctrl+C em quem pediu: a conversa não pode ficar "trabalhando" para sempre.
  process.on('SIGINT', () => {
    filho.kill()
    void encerrar('Interrompido por quem pediu.', false, null).finally(() => process.exit(130))
  })

  const codigo = await new Promise<number>((resolver) => {
    filho.on('error', (erro) => {
      stderr += `\n${erro.message}`
      resolver(127)
    })
    filho.on('close', (c) => resolver(c ?? 1))
  })

  const saida =
    codigo === 127 && !stdout
      ? {
          ok: false,
          resposta: `Não consegui rodar "${comando.programa}". Ele está instalado e no PATH?\n${stderr.trim()}`,
          sessao: null
        }
      : lerSaida(alvo.motor, stdout, stderr, codigo)

  await encerrar(saida.resposta, saida.ok, saida.sessao)
  process.stdout.write(`${saida.resposta.trim()}\n`)
  process.exit(saida.ok ? 0 : 1)
}

principal().catch((erro: unknown) => falhar(erro instanceof Error ? erro.message : String(erro)))
