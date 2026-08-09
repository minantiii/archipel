import { describe, expect, it } from 'vitest'
import { DIAS_ATE_APAGAR, DIAS_ATE_ESQUECER, diasSemUso, emPalavras, frescor } from './datas'

const AGORA = Date.parse('2026-08-09T12:00:00.000Z')
const diasAtras = (n: number): string => new Date(AGORA - n * 86400000).toISOString()

describe('diasSemUso', () => {
  it('conta a partir da última abertura', () => {
    const dias = diasSemUso({ ultimoAcessoEm: diasAtras(12), criadoEm: diasAtras(400) }, AGORA)
    expect(dias).toBeCloseTo(12)
  })

  it('cai para a entrada no mapa quando a pasta nunca foi aberta', () => {
    const dias = diasSemUso({ ultimoAcessoEm: null, criadoEm: diasAtras(240) }, AGORA)
    expect(dias).toBeCloseTo(240)
  })

  it('devolve null sem data nenhuma, em vez de inventar abandono', () => {
    expect(diasSemUso({ ultimoAcessoEm: null, criadoEm: null }, AGORA)).toBeNull()
  })

  it('ignora data ilegível', () => {
    expect(diasSemUso({ ultimoAcessoEm: 'ontem de tarde', criadoEm: null }, AGORA)).toBeNull()
  })

  it('trata data no futuro como agora', () => {
    expect(diasSemUso({ ultimoAcessoEm: diasAtras(-30), criadoEm: null }, AGORA)).toBe(0)
  })
})

describe('frescor', () => {
  it('não apaga quem foi usada há pouco', () => {
    expect(frescor(0)).toBe(1)
    expect(frescor(DIAS_ATE_APAGAR)).toBe(1)
  })

  it('não apaga quem não tem data', () => {
    expect(frescor(null)).toBe(1)
  })

  it('decai entre os dois marcos, sem degrau', () => {
    const meio = frescor((DIAS_ATE_APAGAR + DIAS_ATE_ESQUECER) / 2)
    expect(meio).toBeLessThan(1)
    expect(meio).toBeGreaterThan(frescor(DIAS_ATE_ESQUECER))
    // Monotônico: mais tempo parada nunca deixa a ilha mais acesa.
    for (let d = 0; d < 400; d += 17) expect(frescor(d + 17)).toBeLessThanOrEqual(frescor(d))
  })

  it('para de apagar no piso, para a ilha nunca sumir', () => {
    expect(frescor(DIAS_ATE_ESQUECER)).toBeGreaterThan(0)
    expect(frescor(99999)).toBe(frescor(DIAS_ATE_ESQUECER))
  })
})

describe('emPalavras', () => {
  it('chama de hoje o que foi hoje', () => {
    expect(emPalavras(diasAtras(0), AGORA)).toBe('hoje')
  })

  it('conta em dias, meses e anos conforme a distância', () => {
    expect(emPalavras(diasAtras(3), AGORA)).toBe('há 3 dias')
    expect(emPalavras(diasAtras(150), AGORA)).toBe('há 5 meses')
    expect(emPalavras(diasAtras(800), AGORA)).toBe('há 2 anos')
  })

  it('devolve null para data ausente ou ilegível', () => {
    expect(emPalavras(null, AGORA)).toBeNull()
    expect(emPalavras('nunca', AGORA)).toBeNull()
  })
})
