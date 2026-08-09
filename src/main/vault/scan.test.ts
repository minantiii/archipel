import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { caminhoArquivoMeta, caminhoMeta } from './estrutura'
import { parsear } from './markdown'
import { carregarMapa } from './scan'

let raiz: string

beforeEach(async () => {
  raiz = await fs.mkdtemp(join(tmpdir(), 'mapa-teste-'))
})

afterEach(async () => {
  await fs.rm(raiz, { recursive: true, force: true })
})

async function criarPasta(nome: string, arquivo = 'a.txt'): Promise<void> {
  await fs.mkdir(join(raiz, nome), { recursive: true })
  await fs.writeFile(join(raiz, nome, arquivo), 'conteudo')
}

async function escreverMeta(id: string, conteudo: string): Promise<void> {
  await fs.mkdir(join(caminhoMeta(raiz), 'pastas'), { recursive: true })
  await fs.writeFile(caminhoArquivoMeta(raiz, id), conteudo, 'utf8')
}

describe('carregarMapa', () => {
  it('cria a estrutura do mapa no primeiro carregamento', async () => {
    await carregarMapa(raiz)

    await expect(fs.access(join(caminhoMeta(raiz), 'CLAUDE.md'))).resolves.toBeUndefined()
    await expect(fs.access(join(caminhoMeta(raiz), 'config.yaml'))).resolves.toBeUndefined()
    await expect(fs.access(join(caminhoMeta(raiz), 'pastas'))).resolves.toBeUndefined()
  })

  it('registra pastas que apareceram no disco por fora', async () => {
    await criarPasta('kronos-spec')
    await criarPasta('ApiTelemetria')

    const mapa = await carregarMapa(raiz)

    expect(mapa.ilhas.map((n) => n.id)).toEqual(['ApiTelemetria', 'kronos-spec'])
    expect(mapa.ilhas.every((n) => !n.ausente)).toBe(true)
    await expect(fs.access(caminhoArquivoMeta(raiz, 'kronos-spec'))).resolves.toBeUndefined()
  })

  it('ignora o próprio .organizador e pastas ocultas', async () => {
    await criarPasta('erp')
    await fs.mkdir(join(raiz, '.git'), { recursive: true })

    const mapa = await carregarMapa(raiz)
    expect(mapa.ilhas.map((n) => n.id)).toEqual(['erp'])
  })

  it('marca como ausente o .md cuja pasta sumiu, sem perder os metadados', async () => {
    await criarPasta('erp')
    await carregarMapa(raiz)
    await fs.rm(join(raiz, 'erp'), { recursive: true })
    await escreverMeta('erp', '---\ntags: [importante]\n---\n\ndiário que não pode sumir\n')

    const mapa = await carregarMapa(raiz)
    const erp = mapa.ilhas.find((i) => i.id === 'erp')

    expect(erp?.ausente).toBe(true)
    expect(erp?.tags).toEqual(['importante'])
    expect(erp?.diario).toContain('diário que não pode sumir')
  })

  it('preserva tags e diário entre carregamentos', async () => {
    await criarPasta('frontend')
    await carregarMapa(raiz)
    await escreverMeta('frontend', '---\ntags: [web]\ncor: "#ff0000"\n---\n\nmeu diário\n')

    const mapa = await carregarMapa(raiz)
    const ilha = mapa.ilhas.find((i) => i.id === 'frontend')

    expect(ilha?.tags).toEqual(['web'])
    expect(ilha?.cor).toBe('#ff0000')
    expect(ilha?.diario).toContain('meu diário')
  })

  it('transforma ligações em pontes', async () => {
    await criarPasta('frontend')
    await criarPasta('ApiTelemetria')
    await carregarMapa(raiz)
    await escreverMeta('frontend', '---\n---\n\nConsome a [[ApiTelemetria]].\n')

    const mapa = await carregarMapa(raiz)

    expect(mapa.pontes).toEqual([{ origem: 'frontend', destino: 'ApiTelemetria' }])
  })

  it('não duplica a ponte quando os dois lados se citam', async () => {
    await criarPasta('a')
    await criarPasta('b')
    await carregarMapa(raiz)
    await escreverMeta('a', '---\n---\n\n[[b]]\n')
    await escreverMeta('b', '---\n---\n\n[[a]]\n')

    const mapa = await carregarMapa(raiz)
    expect(mapa.pontes).toHaveLength(1)
  })

  it('ligação para nome inexistente vira ilha ausente em vez de erro', async () => {
    await criarPasta('frontend')
    await carregarMapa(raiz)
    await escreverMeta('frontend', '---\n---\n\nDepende do [[servico-que-nao-existe]].\n')

    const mapa = await carregarMapa(raiz)
    const fantasma = mapa.ilhas.find((n) => n.id === 'servico-que-nao-existe')

    expect(fantasma?.ausente).toBe(true)
    expect(mapa.pontes).toHaveLength(1)
  })

  it('ignora auto-referência', async () => {
    await criarPasta('sozinho')
    await carregarMapa(raiz)
    await escreverMeta('sozinho', '---\n---\n\nEu sou [[sozinho]].\n')

    const mapa = await carregarMapa(raiz)
    expect(mapa.pontes).toHaveLength(0)
    expect(mapa.ilhas).toHaveLength(1)
  })

  it('higieniza nome de pasta com colchetes e guarda o nome real', async () => {
    await criarPasta('Demandas - [Cache]')

    const mapa = await carregarMapa(raiz)
    const ilha = mapa.ilhas[0]

    expect(ilha.id).toBe('Demandas - Cache')
    expect(ilha.caminho).toBe(join(raiz, 'Demandas - [Cache]'))
    expect(ilha.ausente).toBe(false)

    // E no segundo carregamento não pode duplicar a ilha nem recriar o arquivo.
    const segundo = await carregarMapa(raiz)
    expect(segundo.ilhas).toHaveLength(1)
    expect(segundo.ilhas[0].ausente).toBe(false)
  })

  it('desvia de colisão de id gerando um sufixo', async () => {
    await criarPasta('proj [x]')
    await criarPasta('proj x')

    const mapa = await carregarMapa(raiz)
    const ids = mapa.ilhas.map((n) => n.id).sort()

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(mapa.ilhas.every((n) => !n.ausente)).toBe(true)
  })

  it('registra no config.yaml as tags novas encontradas nos .md', async () => {
    await criarPasta('erp')
    await carregarMapa(raiz)
    await escreverMeta('erp', '---\ntags: [financeiro]\n---\n')

    const mapa = await carregarMapa(raiz)
    const yaml = await fs.readFile(join(caminhoMeta(raiz), 'config.yaml'), 'utf8')

    expect(mapa.tags.map((t) => t.nome)).toEqual(['financeiro'])
    expect(mapa.tags[0].cor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(yaml).toContain('financeiro')
  })

  it('dá cores distintas a tags diferentes', async () => {
    await criarPasta('a')
    await criarPasta('b')
    await criarPasta('c')
    await carregarMapa(raiz)
    await escreverMeta('a', '---\ntags: [kronos]\n---\n')
    await escreverMeta('b', '---\ntags: [web]\n---\n')
    await escreverMeta('c', '---\ntags: [api, spec, financeiro]\n---\n')

    const mapa = await carregarMapa(raiz)
    const cores = mapa.tags.map((t) => t.cor)

    expect(new Set(cores).size).toBe(cores.length)
  })

  it('respeita a cor de tag já definida no config.yaml', async () => {
    await criarPasta('erp')
    await carregarMapa(raiz)
    await escreverMeta('erp', '---\ntags: [financeiro]\n---\n')
    await fs.writeFile(
      join(caminhoMeta(raiz), 'config.yaml'),
      'tags:\n  - nome: financeiro\n    cor: "#123456"\n',
      'utf8'
    )

    const mapa = await carregarMapa(raiz)
    expect(mapa.tags[0].cor).toBe('#123456')
  })

  it('tira do config.yaml a tag que nenhuma pasta usa mais', async () => {
    await criarPasta('erp')
    await escreverMeta('erp', '---\ntags: [financeiro]\n---\n')
    await carregarMapa(raiz)

    // O usuário tira a tag pelo painel: o registro tem que ir junto, senão
    // sobra um chip na lateral que filtra e não acha nada.
    await escreverMeta('erp', '---\ntags: []\n---\n')
    const mapa = await carregarMapa(raiz)

    expect(mapa.tags).toEqual([])
    const bruto = await fs.readFile(join(caminhoMeta(raiz), 'config.yaml'), 'utf8')
    expect(bruto).not.toContain('financeiro')
  })

  it('mantém no config.yaml a tag que ainda tem outra pasta usando', async () => {
    await criarPasta('a')
    await criarPasta('b')
    await escreverMeta('a', '---\ntags: [comum]\n---\n')
    await escreverMeta('b', '---\ntags: [comum]\n---\n')
    await carregarMapa(raiz)

    await escreverMeta('a', '---\ntags: []\n---\n')
    const mapa = await carregarMapa(raiz)

    expect(mapa.tags.map((t) => t.nome)).toEqual(['comum'])
  })

  it('preserva a ordem manual ao descartar uma tag órfã', async () => {
    await criarPasta('a')
    await criarPasta('b')
    await escreverMeta('a', '---\ntags: [orfa]\n---\n')
    await fs.writeFile(
      join(caminhoMeta(raiz), 'config.yaml'),
      'tags:\n  - nome: orfa\n    cor: "#123456"\nordem:\n  - b\n  - a\n',
      'utf8'
    )
    await escreverMeta('a', '---\ntags: []\n---\n')

    const mapa = await carregarMapa(raiz)

    expect(mapa.tags).toEqual([])
    expect(mapa.ordem).toEqual(['b', 'a'])
  })

  it('lê config.yaml antigo, que só tem tags, sem quebrar', async () => {
    await criarPasta('erp')
    await carregarMapa(raiz)
    await escreverMeta('erp', '---\ntags: [financeiro]\n---\n')
    await fs.writeFile(
      join(caminhoMeta(raiz), 'config.yaml'),
      'tags:\n  - nome: financeiro\n    cor: "#123456"\n',
      'utf8'
    )

    const mapa = await carregarMapa(raiz)

    expect(mapa.ordem).toEqual([])
    expect(mapa.tags[0].cor).toBe('#123456')
  })

  it('preserva a ordem manual ao registrar uma tag nova', async () => {
    await criarPasta('a')
    await criarPasta('b')
    await carregarMapa(raiz)
    await fs.writeFile(
      join(caminhoMeta(raiz), 'config.yaml'),
      'tags: []\nordem:\n  - b\n  - a\n',
      'utf8'
    )

    // A tag nova força uma regravação do config.yaml — a ordem não pode sumir junto.
    await escreverMeta('a', '---\ntags: [inedita]\n---\n')
    const mapa = await carregarMapa(raiz)

    expect(mapa.ordem).toEqual(['b', 'a'])
    expect(mapa.tags.map((t) => t.nome)).toEqual(['inedita'])
  })

  it('limpa da ordem os ids que não existem mais', async () => {
    await criarPasta('a')
    await carregarMapa(raiz)
    await fs.writeFile(
      join(caminhoMeta(raiz), 'config.yaml'),
      'tags: []\nordem:\n  - a\n  - pasta-que-sumiu\n',
      'utf8'
    )

    const mapa = await carregarMapa(raiz)

    expect(mapa.ordem).toEqual(['a'])
    expect(await fs.readFile(join(caminhoMeta(raiz), 'config.yaml'), 'utf8')).not.toContain(
      'pasta-que-sumiu'
    )
  })

  it('ignora ordem malformada', async () => {
    await criarPasta('a')
    await carregarMapa(raiz)
    await fs.writeFile(
      join(caminhoMeta(raiz), 'config.yaml'),
      'tags: []\nordem: "isso nao e lista"\n',
      'utf8'
    )

    expect((await carregarMapa(raiz)).ordem).toEqual([])
  })

  it('sobrevive a config.yaml corrompido', async () => {
    await criarPasta('erp')
    await carregarMapa(raiz)
    await fs.writeFile(join(caminhoMeta(raiz), 'config.yaml'), 'tags: [: : :\n  ??\n', 'utf8')

    const mapa = await carregarMapa(raiz)
    expect(mapa.ilhas).toHaveLength(1)
  })

  it('não reescreve o .md de uma pasta já registrada', async () => {
    await criarPasta('erp')
    await carregarMapa(raiz)

    const caminho = caminhoArquivoMeta(raiz, 'erp')
    const antes = await fs.readFile(caminho, 'utf8')
    const criadoEm = parsear(antes).meta.criadoEm

    await carregarMapa(raiz)

    expect(parsear(await fs.readFile(caminho, 'utf8')).meta.criadoEm).toBe(criadoEm)
  })
})
