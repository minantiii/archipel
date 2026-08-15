import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contem, mesmoCaminho } from './caminhos'

const base = join(tmpdir(), 'mapa-caminhos')

describe('contem', () => {
  it('reconhece pai, filho e a própria pasta', () => {
    expect(contem(join(base, 'a'), join(base, 'a', 'b'))).toBe(true)
    expect(contem(join(base, 'a'), join(base, 'a'))).toBe(true)
    expect(contem(join(base, 'a'), join(base, 'b'))).toBe(false)
    expect(contem(join(base, 'a', 'b'), join(base, 'a'))).toBe(false)
  })
})

describe('mesmoCaminho', () => {
  it('ignora barra no fim e caixa das letras no Windows', () => {
    expect(mesmoCaminho(join(base, 'a'), join(base, 'a') + '\\')).toBe(true)
    expect(mesmoCaminho(join(base, 'a'), join(base, 'b'))).toBe(false)
    // Pai e filho não são o mesmo lugar — é o que impede uma pasta que mora
    // dentro do mapa, mas mais fundo, de ser confundida com a raiz.
    expect(mesmoCaminho(join(base, 'a'), join(base, 'a', 'b'))).toBe(false)
  })
})
