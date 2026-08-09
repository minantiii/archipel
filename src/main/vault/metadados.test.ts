import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { caminhoArquivoMeta, caminhoPastas } from './estrutura'
import { parsear } from './markdown'
import { marcarAcesso, salvarMeta } from './metadados'

let raiz: string

beforeEach(async () => {
  raiz = await fs.mkdtemp(join(tmpdir(), 'mapa-meta-'))
  await fs.mkdir(caminhoPastas(raiz), { recursive: true })
})

afterEach(async () => {
  await fs.rm(raiz, { recursive: true, force: true })
})

async function ler(id: string): Promise<ReturnType<typeof parsear>> {
  return parsear(await fs.readFile(caminhoArquivoMeta(raiz, id), 'utf8'))
}

describe('salvarMeta', () => {
  it('grava a posição fixada', async () => {
    await salvarMeta(raiz, 'erp', { pos: { x: 12, y: -30 } })
    expect((await ler('erp')).meta.pos).toEqual({ x: 12, y: -30 })
  })

  it('limpa a posição com null e mantém o resto', async () => {
    await salvarMeta(raiz, 'erp', { tags: ['financeiro'], pos: { x: 1, y: 2 } })
    await salvarMeta(raiz, 'erp', { pos: null })

    const arquivo = await ler('erp')
    expect(arquivo.meta.pos).toBeNull()
    expect(arquivo.meta.tags).toEqual(['financeiro'])
  })

  it('preserva o corpo escrito à mão ao mexer só nas tags', async () => {
    await fs.writeFile(
      caminhoArquivoMeta(raiz, 'erp'),
      '---\ntags: [velha]\n---\n\nTexto do usuário com [[frontend]].\n',
      'utf8'
    )

    await salvarMeta(raiz, 'erp', { tags: ['nova'] })

    const arquivo = await ler('erp')
    expect(arquivo.meta.tags).toEqual(['nova'])
    expect(arquivo.corpo).toContain('Texto do usuário com [[frontend]].')
    expect(arquivo.links).toEqual(['frontend'])
  })

  it('não mexe em campo que o patch não menciona', async () => {
    await salvarMeta(raiz, 'erp', { tags: ['a'], cor: '#123456', diario: 'diario' })
    await salvarMeta(raiz, 'erp', { pos: { x: 0, y: 0 } })

    const arquivo = await ler('erp')
    expect(arquivo.meta.tags).toEqual(['a'])
    expect(arquivo.meta.cor).toBe('#123456')
    expect(arquivo.corpo).toContain('diario')
  })

  it('cria o arquivo quando ele ainda não existe', async () => {
    await salvarMeta(raiz, 'novo', { tags: ['x'] })
    expect((await ler('novo')).meta.tags).toEqual(['x'])
  })

  it('relê o disco antes de gravar, sem sobrescrever edição externa', async () => {
    await salvarMeta(raiz, 'erp', { tags: ['inicial'] })

    // Simula o Claude Code editando o arquivo enquanto a tela estava aberta.
    await fs.writeFile(
      caminhoArquivoMeta(raiz, 'erp'),
      '---\ntags: [inicial]\n---\n\nDescrição que o Claude acabou de escrever.\n',
      'utf8'
    )

    // A UI salva só a posição, sem saber da diario nova.
    await salvarMeta(raiz, 'erp', { pos: { x: 5, y: 5 } })

    const arquivo = await ler('erp')
    expect(arquivo.corpo).toContain('Descrição que o Claude acabou de escrever.')
    expect(arquivo.meta.pos).toEqual({ x: 5, y: 5 })
  })
})

describe('marcarAcesso', () => {
  it('grava a data do uso', async () => {
    const antes = Date.now()
    await marcarAcesso(raiz, 'erp')

    const carimbo = (await ler('erp')).meta.ultimoAcessoEm
    expect(carimbo).not.toBeNull()
    expect(Date.parse(carimbo as string)).toBeGreaterThanOrEqual(antes)
  })

  it('avança o carimbo a cada uso', async () => {
    await marcarAcesso(raiz, 'erp')
    const primeiro = (await ler('erp')).meta.ultimoAcessoEm

    await new Promise((r) => setTimeout(r, 5))
    await marcarAcesso(raiz, 'erp')

    const segundo = (await ler('erp')).meta.ultimoAcessoEm
    expect(Date.parse(segundo as string)).toBeGreaterThan(Date.parse(primeiro as string))
  })

  it('não toca em tags, cor, posição nem no diário', async () => {
    await salvarMeta(raiz, 'erp', {
      tags: ['financeiro'],
      cor: '#123456',
      pos: { x: 7, y: 8 },
      diario: 'Texto do usuário com [[frontend]].'
    })

    await marcarAcesso(raiz, 'erp')

    const arquivo = await ler('erp')
    expect(arquivo.meta.tags).toEqual(['financeiro'])
    expect(arquivo.meta.cor).toBe('#123456')
    expect(arquivo.meta.pos).toEqual({ x: 7, y: 8 })
    expect(arquivo.corpo).toContain('Texto do usuário com [[frontend]].')
    expect(arquivo.links).toEqual(['frontend'])
  })

  it('preserva edição feita por fora entre uma abertura e outra', async () => {
    await marcarAcesso(raiz, 'erp')
    await fs.writeFile(
      caminhoArquivoMeta(raiz, 'erp'),
      '---\ntags: [escrita-a-mao]\n---\n\nDescrição escrita no editor.\n',
      'utf8'
    )

    await marcarAcesso(raiz, 'erp')

    const arquivo = await ler('erp')
    expect(arquivo.meta.tags).toEqual(['escrita-a-mao'])
    expect(arquivo.corpo).toContain('Descrição escrita no editor.')
    expect(arquivo.meta.ultimoAcessoEm).not.toBeNull()
  })
})
