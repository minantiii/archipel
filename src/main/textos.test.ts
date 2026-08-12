import { describe, expect, it } from 'vitest'
import { interpretarIdiomaGravado } from './textos'

describe('interpretarIdiomaGravado', () => {
  it('lê o que o instalador escreveu', () => {
    expect(interpretarIdiomaGravado('pt')).toBe('pt')
    expect(interpretarIdiomaGravado('en')).toBe('en')
  })

  it('perdoa o que o arquivo pode ganhar de brinde', () => {
    // O NSIS escreve sem quebra de linha, mas basta abrir e salvar no Bloco de
    // Notas para aparecer um BOM ou um "\r\n" — invisíveis, e sozinhos fariam o
    // app cair no idioma do sistema em vez do escolhido na instalação.
    expect(interpretarIdiomaGravado('﻿en')).toBe('en')
    expect(interpretarIdiomaGravado('en\r\n')).toBe('en')
    expect(interpretarIdiomaGravado(' PT ')).toBe('pt')
  })

  it('devolve null para o que não é idioma', () => {
    // `null` aqui não é "português": é "não sei", e aí quem decide é o sistema.
    for (const invalido of ['', 'fr', 'pt-BR', '1046', 'pt en']) {
      expect(interpretarIdiomaGravado(invalido)).toBeNull()
    }
  })
})
