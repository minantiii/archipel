import { describe, expect, it } from 'vitest'
import {
  adicionarLigacao,
  extrairLigacoes,
  higienizarNome,
  parsear,
  removerLigacao,
  renomearLigacoes,
  serializar
} from './markdown'

describe('parsear', () => {
  it('lê frontmatter e corpo', () => {
    const arquivo = parsear(
      ['---', 'tags: [kronos, spec]', 'cor: "#7c5cff"', '---', '', 'Fala com [[ApiTelemetria]].'].join(
        '\n'
      )
    )

    expect(arquivo.meta.tags).toEqual(['kronos', 'spec'])
    expect(arquivo.meta.cor).toBe('#7c5cff')
    expect(arquivo.links).toEqual(['ApiTelemetria'])
    expect(arquivo.corpo.trim()).toBe('Fala com [[ApiTelemetria]].')
  })

  it('aceita arquivo sem frontmatter nenhum', () => {
    const arquivo = parsear('só um texto solto')
    expect(arquivo.meta.tags).toEqual([])
    expect(arquivo.corpo).toBe('só um texto solto')
  })

  it('não derruba com YAML malformado e preserva o texto', () => {
    const conteudo = ['---', 'tags: [nao, fechado', 'cor: :: ???', '---', '', 'texto importante'].join(
      '\n'
    )
    const arquivo = parsear(conteudo)
    expect(arquivo.meta.tags).toEqual([])
    expect(arquivo.corpo).toContain('texto importante')
  })

  it('normaliza tags escritas de forma inesperada', () => {
    expect(parsear('---\ntags: kronos\n---\n').meta.tags).toEqual(['kronos'])
    expect(parsear('---\ntags: ["#api", "api", " erp "]\n---\n').meta.tags).toEqual(['api', 'erp'])
  })

  it('ignora posição inválida', () => {
    expect(parsear('---\npos: { x: 1 }\n---\n').meta.pos).toBeNull()
    expect(parsear('---\npos: "meio"\n---\n').meta.pos).toBeNull()
    expect(parsear('---\npos: { x: 10, y: -4 }\n---\n').meta.pos).toEqual({ x: 10, y: -4 })
  })
})

describe('serializar', () => {
  it('faz round-trip preservando o corpo intacto', () => {
    const original = [
      '---',
      'tags: [kronos]',
      '---',
      '',
      '# Diário',
      '',
      'Linha com    espaços   estranhos.',
      '',
      '- item',
      '- outro [[frontend]]',
      ''
    ].join('\n')

    const lido = parsear(original)
    const regravado = serializar(lido)
    const relido = parsear(regravado)

    expect(relido.corpo).toBe(lido.corpo)
    expect(relido.meta.tags).toEqual(['kronos'])
    expect(relido.links).toEqual(['frontend'])
  })

  it('omite campos vazios do frontmatter', () => {
    const saida = serializar({
      meta: { pasta: null, tags: [], cor: null, pos: null, criadoEm: null, ultimoAcessoEm: null },
      corpo: 'oi'
    })
    expect(saida).not.toContain('tags')
    expect(saida).not.toContain('cor')
    expect(saida).toContain('oi')
  })

  it('guarda o nome real da pasta quando ele difere do arquivo', () => {
    const saida = serializar({
      meta: {
        pasta: 'Demandas - [Cache]',
        tags: [],
        cor: null,
        pos: null,
        criadoEm: null,
        ultimoAcessoEm: null
      },
      corpo: ''
    })
    expect(parsear(saida).meta.pasta).toBe('Demandas - [Cache]')
  })
})

describe('ligações', () => {
  it('extrai alvos com e sem apelido, sem duplicar', () => {
    expect(extrairLigacoes('[[a]] e [[b|outro nome]] e [[a]]')).toEqual(['a', 'b'])
  })

  it('ignora colchetes que não formam ligação', () => {
    expect(extrairLigacoes('[não é link](http://x) e [[  ]]')).toEqual([])
  })

  it('adiciona sem duplicar', () => {
    const corpo = adicionarLigacao('Diário inicial.', 'erp')
    expect(extrairLigacoes(corpo)).toEqual(['erp'])
    expect(extrairLigacoes(adicionarLigacao(corpo, 'erp'))).toEqual(['erp'])
  })

  it('remove só o alvo pedido e limpa a sobra', () => {
    const corpo = 'Começo.\n\n[[erp]]\n\n[[frontend]]\n'
    const semErp = removerLigacao(corpo, 'erp')
    expect(extrairLigacoes(semErp)).toEqual(['frontend'])
    expect(semErp).toContain('Começo.')
    expect(semErp).not.toMatch(/\n{3,}/)
  })

  it('renomeia preservando o apelido', () => {
    expect(renomearLigacoes('[[velho]] e [[velho|apelido]]', 'velho', 'novo')).toBe(
      '[[novo]] e [[novo|apelido]]'
    )
  })
})

describe('higienizarNome', () => {
  it('troca caracteres que quebrariam ligações', () => {
    expect(higienizarNome('Demandas - [Cache]')).toBe('Demandas - Cache')
    expect(higienizarNome('a|b#c^d')).toBe('a-b-c-d')
  })

  it('nunca devolve vazio', () => {
    expect(higienizarNome('[[]]')).toBe('sem-nome')
    expect(higienizarNome('   ')).toBe('sem-nome')
  })
})
