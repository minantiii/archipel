import { describe, expect, it } from 'vitest'
import { interpretarConfig } from './config'

describe('interpretarConfig', () => {
  it('lê a raiz gravada', () => {
    expect(interpretarConfig('{"raiz":"C:\\\\Mapa"}')).toEqual({ raiz: 'C:\\Mapa' })
  })

  it('tolera o BOM que o Bloco de Notas deixa', () => {
    // Invisível no editor e fatal para o JSON.parse: sem isto o app abriria na
    // tela de boas-vindas, como se nenhum mapa tivesse sido escolhido.
    expect(interpretarConfig('\uFEFF{"raiz":"C:\\\\Mapa"}')).toEqual({ raiz: 'C:\\Mapa' })
  })

  it('degrada para "nenhum mapa" em vez de estourar', () => {
    for (const lixo of ['', '{', 'não é json', 'null', '[]']) {
      expect(interpretarConfig(lixo)).toEqual({ raiz: null })
    }
  })

  it('descarta raiz que não é texto', () => {
    expect(interpretarConfig('{"raiz":42}')).toEqual({ raiz: null })
    expect(interpretarConfig('{"raiz":null}')).toEqual({ raiz: null })
    expect(interpretarConfig('{}')).toEqual({ raiz: null })
  })

  it('ignora o que não conhece', () => {
    expect(interpretarConfig('{"raiz":"/mapa","tema":"escuro"}')).toEqual({ raiz: '/mapa' })
  })
})
