import { describe, expect, it } from 'vitest'
import { interpretarConfig } from './config'

const SEM_NADA = { raiz: null, idioma: null }

describe('interpretarConfig', () => {
  it('lê a raiz gravada', () => {
    expect(interpretarConfig('{"raiz":"C:\\\\Mapa"}')).toEqual({ raiz: 'C:\\Mapa', idioma: null })
  })

  it('tolera o BOM que o Bloco de Notas deixa', () => {
    // Invisível no editor e fatal para o JSON.parse: sem isto o app abriria na
    // tela de boas-vindas, como se nenhum mapa tivesse sido escolhido.
    expect(interpretarConfig('\uFEFF{"raiz":"C:\\\\Mapa"}')).toEqual({
      raiz: 'C:\\Mapa',
      idioma: null
    })
  })

  it('degrada para "nenhum mapa" em vez de estourar', () => {
    for (const lixo of ['', '{', 'não é json', 'null', '[]']) {
      expect(interpretarConfig(lixo)).toEqual(SEM_NADA)
    }
  })

  it('descarta raiz que não é texto', () => {
    expect(interpretarConfig('{"raiz":42}')).toEqual(SEM_NADA)
    expect(interpretarConfig('{"raiz":null}')).toEqual(SEM_NADA)
    expect(interpretarConfig('{}')).toEqual(SEM_NADA)
  })

  it('ignora o que não conhece', () => {
    expect(interpretarConfig('{"raiz":"/mapa","tema":"escuro"}')).toEqual({
      raiz: '/mapa',
      idioma: null
    })
  })

  it('lê o idioma escolhido', () => {
    expect(interpretarConfig('{"idioma":"en"}')).toEqual({ raiz: null, idioma: 'en' })
    expect(interpretarConfig('{"idioma":"pt"}')).toEqual({ raiz: null, idioma: 'pt' })
  })

  it('descarta idioma que não existe, em vez de confiar no arquivo', () => {
    // `null` aqui não é "português": é "nunca escolheu", e aí vale o sistema.
    for (const invalido of ['"fr"', '"PT"', '42', 'null']) {
      expect(interpretarConfig(`{"idioma":${invalido}}`).idioma).toBeNull()
    }
  })
})
