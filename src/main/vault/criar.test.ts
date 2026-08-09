import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { criarPasta, ErroDeCriacao } from './criar'
import { carregarMapa } from './scan'

let base: string
let raiz: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'mapa-criar-'))
  raiz = join(base, 'mapa')
  await fs.mkdir(raiz, { recursive: true })
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('criarPasta', () => {
  it('cria a pasta no disco e devolve o id da ilha', async () => {
    const id = await criarPasta(raiz)

    expect(id).toBe('Nova pasta')
    await expect(fs.stat(join(raiz, 'Nova pasta'))).resolves.toMatchObject({})
  })

  it('a pasta nasce vazia', async () => {
    await criarPasta(raiz)
    await expect(fs.readdir(join(raiz, 'Nova pasta'))).resolves.toEqual([])
  })

  it('desvia do nome já ocupado em vez de estourar', async () => {
    expect(await criarPasta(raiz)).toBe('Nova pasta')
    expect(await criarPasta(raiz)).toBe('Nova pasta 2')
    expect(await criarPasta(raiz)).toBe('Nova pasta 3')
  })

  it('não adota uma pasta que já existia com esse nome', async () => {
    await fs.mkdir(join(raiz, 'Nova pasta'))
    await fs.writeFile(join(raiz, 'Nova pasta', 'meu-trabalho.txt'), 'não me perca\n')

    await criarPasta(raiz)

    // A original continua intacta; a nova foi para o nome seguinte.
    await expect(fs.readFile(join(raiz, 'Nova pasta', 'meu-trabalho.txt'), 'utf8')).resolves.toBe(
      'não me perca\n'
    )
    await expect(fs.readdir(join(raiz, 'Nova pasta 2'))).resolves.toEqual([])
  })

  it('recusa quando o mapa sumiu do disco', async () => {
    await fs.rm(raiz, { recursive: true, force: true })
    await expect(criarPasta(raiz)).rejects.toThrow(ErroDeCriacao)
  })

  it('a varredura seguinte registra a pasta nova coma ilha', async () => {
    const id = await criarPasta(raiz)
    const mapa = await carregarMapa(raiz)

    // O `.md` não é escrito pelo `criarPasta`: quem registra é o `carregarMapa`.
    const ilha = mapa.ilhas.find((n) => n.id === id)
    expect(ilha).toBeDefined()
    expect(ilha?.ausente).toBe(false)
    expect(ilha?.caminho).toBe(join(raiz, 'Nova pasta'))
  })
})
