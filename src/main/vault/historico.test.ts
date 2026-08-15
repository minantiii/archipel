import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  interpretarHistorico,
  registrarDesfecho,
  registrarInicio,
  ultimaMovimentacao,
  type Registro
} from './historico'

const userData = vi.hoisted(() => ({ pasta: '' }))
vi.mock('electron', () => ({ app: { getPath: () => userData.pasta } }))

let base: string
const raiz = 'C:\\Mapa'

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'mapa-historico-'))
  userData.pasta = base
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function movimentacao(nome: string): { em: string; de: string; para: string } {
  return { em: new Date().toISOString(), de: `D:\\${nome}`, para: `${raiz}\\${nome}` }
}

async function registrar(nome: string): Promise<void> {
  const mov = movimentacao(nome)
  await registrarInicio(raiz, mov, 'mover')
  await registrarDesfecho(raiz, mov, 'mover', 'concluida')
}

async function lerArquivo(): Promise<Registro[]> {
  return JSON.parse(await fs.readFile(join(base, 'movimentos.json'), 'utf8'))
}

describe('interpretarHistorico', () => {
  it('degrada para vazio em vez de estourar', () => {
    for (const lixo of ['', '{', 'não é json', 'null', '{"a":1}']) {
      expect(interpretarHistorico(lixo)).toEqual([])
    }
  })

  it('descarta o registro estragado sem levar os bons junto', () => {
    const bom = { raiz, de: 'D:\\erp', para: 'C:\\Mapa\\erp', em: '1', tipo: 'mover', estado: 'concluida' }
    const bruto = JSON.stringify([{ de: 'sem raiz nem para' }, null, 42, bom])

    expect(interpretarHistorico(bruto)).toEqual([bom])
  })

  it('registro sem estado vale como concluído', () => {
    const bruto = JSON.stringify([{ raiz, de: 'D:\\erp', para: 'C:\\Mapa\\erp' }])

    expect(interpretarHistorico(bruto)).toEqual([
      { raiz, de: 'D:\\erp', para: 'C:\\Mapa\\erp', em: '', tipo: 'mover', estado: 'concluida' }
    ])
  })

  it('tolera o BOM que o Bloco de Notas deixa', () => {
    expect(interpretarHistorico('\uFEFF[]')).toEqual([])
  })
})

describe('histórico', () => {
  it('grava um arquivo só, e em userData', async () => {
    await registrar('erp')

    // `raiz` nem existe no disco neste teste: o histórico não encosta no mapa.
    expect(await fs.readdir(base)).toEqual(['movimentos.json'])
  })

  it('para de crescer no limite, descartando o mais antigo', async () => {
    for (let n = 0; n < 55; n++) await registrar(`proj-${n}`)

    const registros = await lerArquivo()
    expect(registros).toHaveLength(50)
    expect(registros[0].para).toBe(`${raiz}\\proj-5`)
    expect(registros.at(-1)?.para).toBe(`${raiz}\\proj-54`)
  })

  it('cada mapa enxerga só as próprias movimentações', async () => {
    const outraRaiz = 'C:\\OutroMapa'
    await registrar('erp')

    const mov = { em: '2', de: 'D:\\portal', para: `${outraRaiz}\\portal` }
    await registrarInicio(outraRaiz, mov, 'mover')
    await registrarDesfecho(outraRaiz, mov, 'mover', 'concluida')

    // O arquivo é um só, mas o "desfazer" de cada mapa é o dele.
    expect(await ultimaMovimentacao(raiz)).toMatchObject({ para: `${raiz}\\erp` })
    expect(await ultimaMovimentacao(outraRaiz)).toMatchObject({ para: `${outraRaiz}\\portal` })
  })

  it('acha a raiz do registro apesar da barra no fim e da caixa das letras', async () => {
    await registrar('erp')

    expect(await ultimaMovimentacao('c:\\mapa\\')).toMatchObject({ para: `${raiz}\\erp` })
  })

  it('não oferece desfazer em cima de um desfazer', async () => {
    await registrar('erp')

    const volta = { em: '3', de: `${raiz}\\erp`, para: 'D:\\erp' }
    await registrarInicio(raiz, volta, 'desfazer')
    await registrarDesfecho(raiz, volta, 'desfazer', 'concluida')

    // Senão o atalho viraria um ping-pong movendo a pasta de um lado para o outro.
    expect(await ultimaMovimentacao(raiz)).toBeNull()
  })

  it('o desfecho fecha o registro aberto em vez de criar outro', async () => {
    const mov = movimentacao('erp')
    await registrarInicio(raiz, mov, 'mover')
    await registrarDesfecho(raiz, mov, 'mover', 'concluida')

    const registros = await lerArquivo()
    expect(registros).toHaveLength(1)
    expect(registros[0].estado).toBe('concluida')
  })

  it('desfecho sem registro aberto não inventa entrada', async () => {
    await registrarDesfecho(raiz, movimentacao('fantasma'), 'mover', 'concluida')

    await expect(fs.access(join(base, 'movimentos.json'))).rejects.toThrow()
  })
})
