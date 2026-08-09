import { describe, expect, it } from 'vitest'
import { posicaoLivre, raioDaIlha, type IlhaPosicionavel } from './colisao'

function ilha(id: string, extra: Partial<IlhaPosicionavel> = {}): IlhaPosicionavel {
  return { id, grau: 0, ...extra }
}

/** Distância entre o centro de duas ilhas fixadas. */
function entre(a: { x: number; y: number }, b: IlhaPosicionavel): number {
  return Math.hypot(a.x - (b.fx as number), a.y - (b.fy as number))
}

/** Menor distância aceitável entre os centros de duas ilhas fixadas. */
function minimo(a: IlhaPosicionavel, b: IlhaPosicionavel): number {
  return raioDaIlha(a) + raioDaIlha(b) + 6
}

describe('posicaoLivre', () => {
  it('não mexe no ponto quando não há nenhuma ilha fixada por perto', () => {
    const nova = ilha('nova')
    const longe = ilha('longe', { fx: 500, fy: 500 })

    expect(posicaoLivre(nova, 10, 20, [nova, longe])).toEqual({ x: 10, y: 20 })
  })

  it('ignora as ilhas soltas — quem as afasta é a simulação', () => {
    const nova = ilha('nova')
    const solta = ilha('solta')

    expect(posicaoLivre(nova, 0, 0, [nova, solta])).toEqual({ x: 0, y: 0 })
  })

  it('empurra para fora quando o ponto cai dentro de uma fixada', () => {
    const nova = ilha('nova')
    const ocupada = ilha('ocupada', { fx: 0, fy: 0 })

    const ponto = posicaoLivre(nova, 4, 0, [nova, ocupada])

    expect(entre(ponto, ocupada)).toBeCloseTo(minimo(nova, ocupada))
    // Empurra na direção em que já estava indo, e só o necessário.
    expect(ponto.y).toBe(0)
    expect(ponto.x).toBeGreaterThan(0)
  })

  it('resolve o empilhamento exato, sem direção para deduzir', () => {
    const nova = ilha('nova')
    const ocupada = ilha('ocupada', { fx: 30, fy: -12 })

    const ponto = posicaoLivre(nova, 30, -12, [nova, ocupada])

    expect(entre(ponto, ocupada)).toBeCloseTo(minimo(nova, ocupada))
  })

  it('dá sempre o mesmo resultado para o mesmo empilhamento', () => {
    const nova = ilha('nova')
    const ocupada = ilha('ocupada', { fx: 0, fy: 0 })

    expect(posicaoLivre(nova, 0, 0, [nova, ocupada])).toEqual(
      posicaoLivre(nova, 0, 0, [nova, ocupada])
    )
  })

  it('reserva mais espaço para as ilhas grandes', () => {
    const hub = ilha('hub', { grau: 10 })
    const ocupada = ilha('ocupada', { fx: 0, fy: 0, grau: 10 })

    const ponto = posicaoLivre(hub, 1, 0, [hub, ocupada])

    expect(entre(ponto, ocupada)).toBeCloseTo(minimo(hub, ocupada))
    expect(entre(ponto, ocupada)).toBeGreaterThan(minimo(ilha('a'), ilha('b')))
  })

  it('não deixa a saída de uma colisão criar outra', () => {
    const nova = ilha('nova')
    // Duas vizinhas encostadas: escapar de uma joga em cima da outra.
    const esquerda = ilha('esquerda', { fx: 0, fy: 0 })
    const direita = ilha('direita', { fx: 24, fy: 0 })

    const ponto = posicaoLivre(nova, 12, 1, [nova, esquerda, direita])

    expect(entre(ponto, esquerda)).toBeGreaterThanOrEqual(minimo(nova, esquerda) - 1e-6)
    expect(entre(ponto, direita)).toBeGreaterThanOrEqual(minimo(nova, direita) - 1e-6)
  })

  it('não desvia de si mesma ao reposicionar uma ilha que já estava fixada', () => {
    const jaFixada = ilha('jaFixada', { fx: 40, fy: 40 })

    expect(posicaoLivre(jaFixada, 40, 40, [jaFixada])).toEqual({ x: 40, y: 40 })
  })
})
