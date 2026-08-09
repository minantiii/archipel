import { describe, expect, it } from 'vitest'
import { confirmacaoDoLote, relatarLote } from './relato'
import type { RelatorioDoLote } from './vault/move'

const RAIZ = 'C:\\Mapa'
const vazio: RelatorioDoLote = { movidas: [], falhas: [], avisos: [] }

function movida(nome: string): RelatorioDoLote['movidas'][number] {
  return { em: '2026-08-09T12:00:00.000Z', de: `C:\\Desktop\\${nome}`, para: `${RAIZ}\\${nome}` }
}

describe('confirmacaoDoLote', () => {
  it('mostra os dois caminhos inteiros quando é uma pasta só', () => {
    const t = confirmacaoDoLote(RAIZ, ['C:\\Desktop\\erp'])

    expect(t.mensagem).toBe('Mover "erp" para o mapa?')
    expect(t.detalhe).toContain('C:\\Desktop\\erp')
    expect(t.detalhe).toContain('C:\\Mapa\\erp')
    expect(t.botao).toBe('Mover')
  })

  it('lista os nomes e conta quantos quando são vários', () => {
    const t = confirmacaoDoLote(RAIZ, ['C:\\a\\erp', 'C:\\b\\portal', 'C:\\c\\scripts'])

    expect(t.mensagem).toBe('Mover 3 pastas para o mapa?')
    expect(t.botao).toBe('Mover 3')
    for (const nome of ['erp', 'portal', 'scripts']) expect(t.detalhe).toContain(nome)
    // Avisa de antemão o que acontece se alguma falhar.
    expect(t.detalhe).toContain('as demais seguem')
  })

  it('corta a lista longa em vez de estourar a modal', () => {
    const muitas = Array.from({ length: 30 }, (_, i) => `C:\\x\\pasta${i}`)
    const t = confirmacaoDoLote(RAIZ, muitas)

    expect(t.mensagem).toBe('Mover 30 pastas para o mapa?')
    expect(t.detalhe).toContain('e mais 18')
    expect(t.detalhe).toContain('pasta11')
    expect(t.detalhe).not.toContain('pasta12')
  })

  it('não inventa "e mais" quando a lista cabe inteira', () => {
    const t = confirmacaoDoLote(RAIZ, ['C:\\a\\um', 'C:\\a\\dois'])
    expect(t.detalhe).not.toContain('e mais')
  })
})

describe('relatarLote', () => {
  it('cala a boca quando tudo entrou', () => {
    expect(relatarLote({ ...vazio, movidas: [movida('erp'), movida('portal')] })).toBeNull()
  })

  it('lista o que ficou de fora, com o motivo', () => {
    const texto = relatarLote({
      movidas: [movida('erp')],
      falhas: [{ origem: 'C:\\Desktop\\portal', motivo: 'Já existe "portal" no destino.' }],
      avisos: []
    })

    expect(texto).toContain('1 pasta entrou no mapa, 1 ficou de fora')
    expect(texto).toContain('• portal — Já existe "portal" no destino.')
    // Tranquiliza sobre o que sobrou, que é a dúvida imediata.
    expect(texto).toContain('continuam onde estavam')
  })

  it('concorda em número no plural e no singular', () => {
    const varias = relatarLote({
      movidas: [movida('a'), movida('b')],
      falhas: [
        { origem: 'C:\\x\\c', motivo: 'travada' },
        { origem: 'C:\\x\\d', motivo: 'travada' }
      ],
      avisos: []
    })
    expect(varias).toContain('2 pastas entraram no mapa, 2 ficaram de fora')

    const nenhuma = relatarLote({
      movidas: [],
      falhas: [{ origem: 'C:\\x\\c', motivo: 'travada' }],
      avisos: []
    })
    expect(nenhuma).toContain('0 pastas entraram no mapa, 1 ficou de fora')
  })

  it('repassa a ressalva de sobra na origem mesmo sem falha nenhuma', () => {
    const texto = relatarLote({
      movidas: [movida('erp')],
      falhas: [],
      avisos: ['Sobrou conteúdo na origem "C:\\Desktop\\erp" (EBUSY).']
    })

    expect(texto).toContain('Sobrou conteúdo na origem')
    // Sem falhas, não existe cabeçalho de contagem para confundir.
    expect(texto).not.toContain('ficou de fora')
  })
})
