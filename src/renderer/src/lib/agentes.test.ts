import { describe, expect, it } from 'vitest'
import type { Conversa, Time } from '@shared/types'
import { barcosDoTime, RECENTE_MS, rotasDoTime } from './agentes'

const agora = Date.parse('2026-11-27T12:00:00Z')

function conversa(parcial: Partial<Conversa>): Conversa {
  return {
    id: 'x',
    de: 'a',
    para: 'b',
    status: 'terminou',
    inicio: new Date(agora - 1000).toISOString(),
    fim: new Date(agora - 500).toISOString(),
    sessao: null,
    pid: null,
    tarefa: '',
    resposta: '',
    ...parcial
  }
}

const time = (conversas: Conversa[]): Time => ({
  agentes: [
    { nome: 'a', motor: 'claude', modelo: null, ilha: 'kronos', funcao: '' },
    { nome: 'b', motor: 'gemini', modelo: null, ilha: 'sumiu', funcao: '' }
  ],
  conversas
})

describe('barcos', () => {
  const ilhas = new Set(['kronos'])

  it('ilha que não existe mais ancora no centro', () => {
    const [a, b] = barcosDoTime(time([]), new Set(), ilhas, agora)
    expect(a.ilha).toBe('kronos')
    expect(b.ilha).toBeNull()
  })

  it('trabalhando vence sessão aberta, que vence terminou', () => {
    const t = time([conversa({ status: 'trabalhando', fim: null }), conversa({ de: 'b', para: 'a' })])
    const [a, b] = barcosDoTime(t, new Set(['a', 'b']), ilhas, agora)
    expect(b.status).toBe('trabalhando')
    expect(a.status).toBe('sessao')
    expect(barcosDoTime(t, new Set(), ilhas, agora)[0].status).toBe('terminou')
  })

  it('terminou se apaga depois de um tempo', () => {
    const velha = conversa({ fim: new Date(agora - RECENTE_MS - 1).toISOString() })
    expect(barcosDoTime(time([velha]), new Set(), ilhas, agora)[1].status).toBe('parado')
    const falhou = conversa({ status: 'falhou' })
    expect(barcosDoTime(time([falhou]), new Set(), ilhas, agora)[1].status).toBe('falhou')
  })

  it('rotas só entre agentes que existem', () => {
    const t = time([
      conversa({ status: 'trabalhando' }),
      conversa({ de: 'voce', status: 'trabalhando' }),
      conversa({ de: 'b', para: 'a' })
    ])
    expect(rotasDoTime(t)).toEqual([{ de: 'a', para: 'b' }])
  })
})
