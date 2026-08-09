import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { caminhoArquivoMeta, caminhoPastas } from './estrutura'
import { parsear } from './markdown'
import { renomearPasta, validarNome } from './renomear'
import { carregarMapa } from './scan'

let raiz: string

beforeEach(async () => {
  raiz = await fs.mkdtemp(join(tmpdir(), 'mapa-renomear-'))
  await fs.mkdir(caminhoPastas(raiz), { recursive: true })
})

afterEach(async () => {
  await fs.rm(raiz, { recursive: true, force: true })
})

async function criarPasta(nome: string): Promise<void> {
  await fs.mkdir(join(raiz, nome), { recursive: true })
  await fs.writeFile(join(raiz, nome, 'README.md'), `# ${nome}\n`, 'utf8')
}

async function lerMeta(id: string): Promise<ReturnType<typeof parsear>> {
  return parsear(await fs.readFile(caminhoArquivoMeta(raiz, id), 'utf8'))
}

describe('validarNome', () => {
  it('aceita nomes normais de projeto', () => {
    expect(validarNome('kronos-spec')).toBe('kronos-spec')
    expect(validarNome('  Demandas - Cache  ')).toBe('Demandas - Cache')
    expect(validarNome('ApiTelemetria')).toBe('ApiTelemetria')
  })

  it('remove ponto e espaço do fim, que o Windows não aceita', () => {
    expect(validarNome('projeto.')).toBe('projeto')
    expect(validarNome('projeto ')).toBe('projeto')
  })

  it('recusa vazio e caracteres proibidos', () => {
    expect(() => validarNome('   ')).toThrow(/não pode ficar vazio/)
    expect(() => validarNome('a/b')).toThrow(/não pode conter/)
    expect(() => validarNome('a:b')).toThrow(/não pode conter/)
    expect(() => validarNome('a?b')).toThrow(/não pode conter/)
  })

  it('recusa nome escondido', () => {
    expect(() => validarNome('.git')).toThrow(/escondidas/)
  })
})

describe('renomearPasta', () => {
  it('renomeia a pasta no disco e o arquivo de metadados', async () => {
    await criarPasta('erp')
    await carregarMapa(raiz)

    const novoId = await renomearPasta(raiz, 'erp', 'erp-financeiro')

    expect(novoId).toBe('erp-financeiro')
    await expect(fs.access(join(raiz, 'erp-financeiro', 'README.md'))).resolves.toBeUndefined()
    await expect(fs.access(join(raiz, 'erp'))).rejects.toThrow()
    await expect(fs.access(caminhoArquivoMeta(raiz, 'erp'))).rejects.toThrow()
  })

  it('preserva tags e diario ao renomear', async () => {
    await criarPasta('erp')
    await carregarMapa(raiz)
    await fs.writeFile(
      caminhoArquivoMeta(raiz, 'erp'),
      '---\ntags: [financeiro]\ncor: "#123456"\n---\n\nMinha diario.\n',
      'utf8'
    )

    await renomearPasta(raiz, 'erp', 'erp-novo')

    const meta = await lerMeta('erp-novo')
    expect(meta.meta.tags).toEqual(['financeiro'])
    expect(meta.meta.cor).toBe('#123456')
    expect(meta.corpo).toContain('Minha diario.')
  })

  it('atualiza os ligações que apontavam para o nome antigo', async () => {
    await criarPasta('erp')
    await criarPasta('frontend')
    await criarPasta('relatorios')
    await carregarMapa(raiz)

    await fs.writeFile(
      caminhoArquivoMeta(raiz, 'frontend'),
      '---\n---\n\nConsome o [[erp]] direto.\n',
      'utf8'
    )
    await fs.writeFile(
      caminhoArquivoMeta(raiz, 'relatorios'),
      '---\n---\n\nPuxa do [[erp|sistema financeiro]].\n',
      'utf8'
    )

    await renomearPasta(raiz, 'erp', 'erp-novo')

    expect((await lerMeta('frontend')).corpo).toContain('[[erp-novo]]')
    expect((await lerMeta('relatorios')).corpo).toContain('[[erp-novo|sistema financeiro]]')

    // E o mapa continua com as duas pontes, agora apontando para o novo id.
    const mapa = await carregarMapa(raiz)
    expect(mapa.pontes).toHaveLength(2)
    expect(mapa.ilhas.filter((n) => n.ausente)).toHaveLength(0)
  })

  it('recusa nome que já existe no mapa', async () => {
    await criarPasta('erp')
    await criarPasta('frontend')
    await carregarMapa(raiz)

    await expect(renomearPasta(raiz, 'erp', 'frontend')).rejects.toThrow(/Já existe/)
    await expect(fs.access(join(raiz, 'erp'))).resolves.toBeUndefined()
  })

  it('renomeia para um nome com colchetes guardando o nome real', async () => {
    await criarPasta('demandas')
    await carregarMapa(raiz)

    const novoId = await renomearPasta(raiz, 'demandas', 'Demandas [Cache]')

    expect(novoId).toBe('Demandas Cache')
    await expect(fs.access(join(raiz, 'Demandas [Cache]'))).resolves.toBeUndefined()
    expect((await lerMeta('Demandas Cache')).meta.pasta).toBe('Demandas [Cache]')

    const mapa = await carregarMapa(raiz)
    expect(mapa.ilhas).toHaveLength(1)
    expect(mapa.ilhas[0].ausente).toBe(false)
  })

  it('renomear para o mesmo nome não faz nada', async () => {
    await criarPasta('erp')
    await carregarMapa(raiz)

    expect(await renomearPasta(raiz, 'erp', 'erp')).toBe('erp')
    await expect(fs.access(join(raiz, 'erp'))).resolves.toBeUndefined()
  })

  it('renomeia uma ilha ausente mexendo só nos metadados', async () => {
    await fs.writeFile(caminhoArquivoMeta(raiz, 'sumido'), '---\ntags: [x]\n---\n', 'utf8')

    await renomearPasta(raiz, 'sumido', 'sumido-novo')

    expect((await lerMeta('sumido-novo')).meta.tags).toEqual(['x'])
    await expect(fs.access(caminhoArquivoMeta(raiz, 'sumido'))).rejects.toThrow()
  })
})
