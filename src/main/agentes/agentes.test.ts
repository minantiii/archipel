import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Agente, Conversa } from '@shared/types'
import { lerArgumentos } from './argumentos'
import {
  apagarAgente,
  carregarTime,
  gravarConversa,
  marcarParada,
  pastaDaIlha,
  salvarAgente,
  ultimaSessao
} from './disco'
import {
  higienizarNomeDeAgente,
  nomeDeAgenteValido,
  parsearAgente,
  parsearConversa,
  serializarAgente,
  serializarConversa
} from './formato'
import { comandoDelegado, comandoInterativo, lerSaida, promptDoTime, resumoDaFuncao } from './motores'

const revisor: Agente = {
  nome: 'revisor',
  motor: 'gemini',
  modelo: 'gemini-3.8-flash-medium',
  ilha: 'kronos',
  funcao: 'Revisa código.\nAponta bugs e só.'
}
const arquiteto: Agente = { nome: 'arquiteto', motor: 'claude', modelo: null, ilha: null, funcao: '' }

describe('formato do agente', () => {
  it('ida e volta preserva os campos', () => {
    expect(parsearAgente('revisor', serializarAgente(revisor))).toEqual(revisor)
    expect(parsearAgente('arquiteto', serializarAgente(arquiteto))).toEqual(arquiteto)
  })

  it('frontmatter estragado cai nos padrões', () => {
    const agente = parsearAgente('x', '---\nmotor: [quebrado\n---\nfaz coisas')
    expect(agente.motor).toBe('claude')
    expect(agente.funcao).toContain('faz coisas')
    expect(parsearAgente('x', '---\nmotor: gpt\n---\n').motor).toBe('claude')
  })

  it('valida e higieniza nomes', () => {
    expect(nomeDeAgenteValido('revisor-2')).toBe(true)
    expect(nomeDeAgenteValido('Revisor')).toBe(false)
    expect(nomeDeAgenteValido('a b')).toBe(false)
    expect(nomeDeAgenteValido('voce')).toBe(false)
    expect(nomeDeAgenteValido('../x')).toBe(false)
    expect(higienizarNomeDeAgente('Revisor de Código!')).toBe('revisor-de-codigo')
  })
})

describe('formato da conversa', () => {
  const conversa: Conversa = {
    id: 'c1',
    de: 'arquiteto',
    para: 'revisor',
    status: 'terminou',
    inicio: '2026-11-27T10:00:00.000Z',
    fim: '2026-11-27T10:01:00.000Z',
    sessao: 'abc',
    pid: null,
    tarefa: 'Revise o arquivo.\n\n## Resposta\nlinha que é igual ao título',
    resposta: 'Tudo certo.\n\n## Resposta\nrepetida no meio'
  }

  it('ida e volta preserva tarefa e resposta, mesmo com títulos dentro', () => {
    const lida = parsearConversa('c1', serializarConversa(conversa))
    expect(lida?.de).toBe('arquiteto')
    expect(lida?.sessao).toBe('abc')
    expect(lida?.resposta).toBe(conversa.resposta)
    expect(lida?.tarefa).toBe(conversa.tarefa)
  })

  it('pid só é gravado enquanto a tarefa roda', () => {
    const rodando = parsearConversa('c1', serializarConversa({ ...conversa, status: 'trabalhando', pid: 4321 }))
    expect(rodando?.pid).toBe(4321)
    expect(parsearConversa('c1', serializarConversa({ ...conversa, pid: 4321 }))?.pid).toBeNull()
  })

  it('arquivo sem os campos obrigatórios é ignorado', () => {
    expect(parsearConversa('x', 'sem frontmatter')).toBeNull()
  })
})

describe('motores', () => {
  it('prompt do time lista os colegas e mostra o caminho literal do delegar', () => {
    const prompt = promptDoTime(arquiteto, [arquiteto, revisor], 'C:\\dados\\delegar.cmd')
    expect(prompt).toContain('revisor (Gemini, pasta kronos): Revisa código.')
    expect(prompt).toContain('"C:\\dados\\delegar.cmd" --para <nome>')
    expect(prompt).not.toContain('$ARCHIPEL_DELEGAR')
  })

  it('sem colegas ou sem delegar, não ensina a delegar', () => {
    expect(promptDoTime(arquiteto, [arquiteto], 'x')).toContain('único agente')
    expect(promptDoTime(arquiteto, [arquiteto, revisor], null)).not.toContain('--para')
  })

  it('claude delegado lê a tarefa do stdin e retoma a sessão', () => {
    const c = comandoDelegado(arquiteto, 'revisor', 'faça X', 'PROMPT', 's1')
    expect(c.programa).toBe('claude')
    expect(c.args).toEqual(expect.arrayContaining(['-p', '--resume', 's1', '--append-system-prompt', 'PROMPT']))
    expect(c.entrada).toContain('Pedido de "revisor"')
    expect(c.entrada).toContain('faça X')
  })

  it('agy delegado leva a tarefa grudada no --print e fecha o stdin', () => {
    const c = comandoDelegado(revisor, 'voce', '-começa com traço', 'PROMPT', null)
    expect(c.programa).toBe('agy')
    expect(c.entrada).toBeNull()
    expect(c.args[0]).toMatch(/^--print=PROMPT/)
    expect(c.args[0]).toContain('Pedido de você')
    expect(c.args).toEqual(expect.arrayContaining(['--model', 'gemini-3.8-flash-medium']))
    // Ao continuar, o papel não vai de novo.
    const seguinte = comandoDelegado(revisor, 'voce', 'mais', 'PROMPT', 'conv')
    expect(seguinte.args[0]).not.toContain('PROMPT')
    expect(seguinte.args).toEqual(expect.arrayContaining(['--conversation', 'conv']))
  })

  it('sessão interativa', () => {
    expect(comandoInterativo(arquiteto, 'P').args).toEqual(['--append-system-prompt', 'P'])
    const agy = comandoInterativo(revisor, 'P')
    expect(agy.args).toContain('-i')
  })

  it('sessão interativa retomando uma conversa delegada', () => {
    expect(comandoInterativo(arquiteto, 'P', 's1').args).toEqual(['--resume', 's1', '--append-system-prompt', 'P'])
    const agy = comandoInterativo(revisor, 'P', 'g1')
    expect(agy.args).toEqual(['--model', 'gemini-3.8-flash-medium', '--conversation', 'g1'])
  })

  it('lê a saída JSON dos dois motores', () => {
    expect(
      lerSaida('gemini', '{"conversation_id":"g1","status":"SUCCESS","response":"[MAHI68] oi\\n"}', '', 0)
    ).toEqual({ ok: true, resposta: 'oi\n', sessao: 'g1' })
    expect(lerSaida('claude', '{"result":"feito","session_id":"c1","is_error":false}', '', 0)).toEqual({
      ok: true,
      resposta: 'feito',
      sessao: 'c1'
    })
    const quebrada = lerSaida('claude', 'Not logged in', 'erro', 1)
    expect(quebrada.ok).toBe(false)
    expect(quebrada.resposta).toContain('Not logged in')
  })

  it('resumo é a primeira linha, sem título markdown', () => {
    expect(resumoDaFuncao('\n# Revisor\nresto')).toBe('Revisor')
  })
})

describe('argumentos do delegar', () => {
  it('aceita valor separado e grudado', () => {
    expect(lerArgumentos(['--para', 'revisor', '--nova'])).toMatchObject({ para: 'revisor', nova: true })
    expect(lerArgumentos(['--para=revisor', '--tarefa=a=b'])).toMatchObject({ para: 'revisor', tarefa: 'a=b' })
  })
})

describe('disco do time', () => {
  let raiz: string

  beforeEach(async () => {
    raiz = await fs.mkdtemp(join(tmpdir(), 'archipel-agentes-'))
  })
  afterEach(async () => {
    await fs.rm(raiz, { recursive: true, force: true })
  })

  it('salva, renomeia e apaga agentes', async () => {
    await salvarAgente(raiz, revisor, null)
    await expect(salvarAgente(raiz, revisor, null)).rejects.toThrow(/Já existe/)
    await expect(salvarAgente(raiz, { ...revisor, nome: 'Mau Nome' }, null)).rejects.toThrow(/inválido/)

    await salvarAgente(raiz, { ...revisor, nome: 'critico' }, 'revisor')
    let time = await carregarTime(raiz)
    expect(time.agentes.map((a) => a.nome)).toEqual(['critico'])

    await apagarAgente(raiz, 'critico')
    time = await carregarTime(raiz)
    expect(time.agentes).toEqual([])
  })

  it('conversas vêm da mais nova à mais velha e a última sessão boa é reaproveitada', async () => {
    const base = { tarefa: 't', resposta: 'r', fim: null, pid: null }
    await gravarConversa(raiz, { ...base, id: '20261127-100000-a-b-x', de: 'a', para: 'b', status: 'terminou', inicio: '2026-11-27T10:00:00Z', sessao: 'velha' })
    await gravarConversa(raiz, { ...base, id: '20261127-110000-a-b-y', de: 'a', para: 'b', status: 'terminou', inicio: '2026-11-27T11:00:00Z', sessao: 'nova' })
    await gravarConversa(raiz, { ...base, id: '20261127-120000-a-b-z', de: 'a', para: 'b', status: 'falhou', inicio: '2026-11-27T12:00:00Z', sessao: null })

    const time = await carregarTime(raiz)
    expect(time.conversas.map((c) => c.id)).toEqual([
      '20261127-120000-a-b-z',
      '20261127-110000-a-b-y',
      '20261127-100000-a-b-x'
    ])
    expect(await ultimaSessao(raiz, 'a', 'b')).toBe('nova')
    expect(await ultimaSessao(raiz, 'b', 'a')).toBeNull()
  })

  it('tarefa cujo processo morreu é encerrada como falha na leitura', async () => {
    const base = { tarefa: 't', resposta: '', fim: null, sessao: null, de: 'a', para: 'b', inicio: '2026-11-27T10:00:00Z' }
    await gravarConversa(raiz, { ...base, id: '20261127-100000-a-b-v', status: 'trabalhando', pid: 111 })
    await gravarConversa(raiz, { ...base, id: '20261127-100001-a-b-m', status: 'trabalhando', pid: 222 })
    const time = await carregarTime(raiz, (pid) => pid === 111)
    const porId = new Map(time.conversas.map((c) => [c.id, c]))
    expect(porId.get('20261127-100000-a-b-v')?.status).toBe('trabalhando')
    expect(porId.get('20261127-100001-a-b-m')?.status).toBe('falhou')
    // E fica gravado: a próxima leitura já vem encerrada.
    const relido = await carregarTime(raiz, () => true)
    expect(relido.conversas.find((c) => c.id === '20261127-100001-a-b-m')?.status).toBe('falhou')
  })

  it('parar marca a conversa como falha e recusa id estranho', async () => {
    const base = { tarefa: 't', resposta: '', fim: null, sessao: null, de: 'a', para: 'b', inicio: '2026-11-27T10:00:00Z' }
    await gravarConversa(raiz, { ...base, id: '20261127-100000-a-b-p', status: 'trabalhando', pid: 999 })
    const parada = await marcarParada(raiz, '20261127-100000-a-b-p')
    expect(parada?.status).toBe('falhou')
    expect(parada?.pid).toBeNull()
    expect(await marcarParada(raiz, '..\fora')).toBeNull()
  })

  it('pasta da ilha: nome direto, campo pasta, ou a raiz', async () => {
    await fs.mkdir(join(raiz, 'kronos'))
    await fs.mkdir(join(raiz, 'Demandas - [Cache]'))
    await fs.mkdir(join(raiz, '.organizador', 'pastas'), { recursive: true })
    await fs.writeFile(
      join(raiz, '.organizador', 'pastas', 'Demandas - Cache.md'),
      '---\npasta: "Demandas - [Cache]"\n---\n'
    )
    expect(await pastaDaIlha(raiz, 'kronos')).toBe(join(raiz, 'kronos'))
    expect(await pastaDaIlha(raiz, 'Demandas - Cache')).toBe(join(raiz, 'Demandas - [Cache]'))
    expect(await pastaDaIlha(raiz, 'sumiu')).toBe(raiz)
    expect(await pastaDaIlha(raiz, '..\\..\\Windows')).toBe(raiz)
    expect(await pastaDaIlha(raiz, null)).toBe(raiz)
  })
})
