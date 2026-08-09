import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { caminhoMeta } from './estrutura'
import { ehDiretorio, existe } from './io'
import {
  contem,
  copiarVerificarERemover,
  desfazerUltima,
  moverPasta,
  moverVarias,
  ultimaMovimentacao
} from './move'

let base: string
let raiz: string
let fora: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'mapa-move-'))
  raiz = join(base, 'mapa')
  fora = join(base, 'desktop')
  await fs.mkdir(caminhoMeta(raiz), { recursive: true })
  await fs.mkdir(fora, { recursive: true })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(base, { recursive: true, force: true })
})

/**
 * Faz uma chamada de `fs` falhar só para um caminho, deixando o resto real.
 *
 * É o único jeito de reproduzir "arquivo travado por outro programa": um handle
 * aberto pelo Node não impede a remoção no Windows, porque o libuv abre os
 * arquivos com `FILE_SHARE_DELETE`. `move.ts` e o teste enxergam o mesmo objeto
 * `promises`, então espionar aqui intercepta a chamada de lá.
 */
function falharEm(metodo: 'rm' | 'rename', caminho: string, codigo: string): void {
  const original = fs[metodo] as (...args: unknown[]) => Promise<unknown>
  vi.spyOn(fs, metodo).mockImplementation((async (...args: unknown[]) => {
    if (String(args[0]) === caminho) {
      throw Object.assign(new Error(`${codigo}: simulado pelo teste`), { code: codigo })
    }
    return original.apply(fs, args)
  }) as never)
}

/** Cria uma pasta de projeto com alguns arquivos e uma subpasta. */
async function criarProjeto(pai: string, nome: string): Promise<string> {
  const dir = join(pai, nome)
  await fs.mkdir(join(dir, 'src'), { recursive: true })
  await fs.writeFile(join(dir, 'README.md'), `# ${nome}\n`, 'utf8')
  await fs.writeFile(join(dir, 'src', 'index.ts'), 'export const x = 1\n', 'utf8')
  return dir
}

/** Escreve o log de movimentações à mão, para exercitar históricos específicos. */
async function escreverLog(entradas: object[]): Promise<void> {
  await fs.mkdir(caminhoMeta(raiz), { recursive: true })
  await fs.writeFile(
    join(caminhoMeta(raiz), 'movimentos.log'),
    entradas.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8'
  )
}

/**
 * Recuperação depois de uma falha no meio do caminho.
 *
 * Estes três casos são exatamente os buracos que o registro-antes-de-agir fecha,
 * e nenhum deles era exercitado antes.
 */
describe('recuperação de falhas', () => {
  it('ainda oferece desfazer quando só a confirmação se perdeu', async () => {
    // O cenário: a pasta foi movida, mas gravar a segunda linha falhou (disco
    // cheio, antivírus, app fechado no meio). Sobra uma `iniciada` órfã.
    const origem = join(fora, 'erp')
    const destino = await criarProjeto(raiz, 'erp')
    await escreverLog([
      { em: new Date().toISOString(), de: origem, para: destino, tipo: 'mover', estado: 'iniciada' }
    ])

    expect(await ultimaMovimentacao(raiz)).toMatchObject({ de: origem, para: destino })

    // E desfazer funciona de verdade: é este o ponto todo.
    await desfazerUltima(raiz)
    await expect(fs.access(origem)).resolves.toBeUndefined()
    await expect(fs.access(destino)).rejects.toThrow()
  })

  it('não oferece desfazer de uma movimentação que foi abortada', async () => {
    const origem = join(fora, 'erp')
    const destino = join(raiz, 'erp')
    await escreverLog([
      { em: new Date().toISOString(), de: origem, para: destino, tipo: 'mover', estado: 'iniciada' },
      { em: new Date().toISOString(), de: origem, para: destino, tipo: 'mover', estado: 'falhou' }
    ])

    expect(await ultimaMovimentacao(raiz)).toBeNull()
  })

  it('lê log antigo, gravado antes de existirem estados', async () => {
    // Compatibilidade: o mapa de quem já usava o app não pode virar inútil.
    const origem = join(fora, 'erp')
    const destino = await criarProjeto(raiz, 'erp')
    await escreverLog([{ em: new Date().toISOString(), de: origem, para: destino, tipo: 'mover' }])

    expect(await ultimaMovimentacao(raiz)).toMatchObject({ de: origem, para: destino })
  })

  it('a última operação é a que vale, mesmo com uma abortada no meio', async () => {
    const antigaDe = join(fora, 'antiga')
    const antigaPara = join(raiz, 'antiga')
    const atualDe = join(fora, 'erp')
    const atualPara = await criarProjeto(raiz, 'erp')

    await escreverLog([
      { em: '1', de: antigaDe, para: antigaPara, tipo: 'mover', estado: 'iniciada' },
      { em: '1', de: antigaDe, para: antigaPara, tipo: 'mover', estado: 'concluida' },
      { em: '2', de: atualDe, para: atualPara, tipo: 'mover', estado: 'iniciada' },
      { em: '2', de: atualDe, para: atualPara, tipo: 'mover', estado: 'falhou' }
    ])

    // A abortada some, então quem sobra é a movimentação anterior.
    expect(await ultimaMovimentacao(raiz)).toMatchObject({ de: antigaDe, para: antigaPara })
  })
})

describe('contem', () => {
  it('reconhece pai, filho e a própria pasta', () => {
    expect(contem(join(base, 'a'), join(base, 'a', 'b'))).toBe(true)
    expect(contem(join(base, 'a'), join(base, 'a'))).toBe(true)
    expect(contem(join(base, 'a'), join(base, 'b'))).toBe(false)
    expect(contem(join(base, 'a', 'b'), join(base, 'a'))).toBe(false)
  })
})

describe('moverPasta', () => {
  it('move para dentro do mapa preservando o conteúdo', async () => {
    const origem = await criarProjeto(fora, 'erp')
    const destino = join(raiz, 'erp')

    await moverPasta(raiz, origem, destino)

    await expect(fs.access(origem)).rejects.toThrow()
    expect(await fs.readFile(join(destino, 'README.md'), 'utf8')).toBe('# erp\n')
    expect(await fs.readFile(join(destino, 'src', 'index.ts'), 'utf8')).toContain('export const x')
  })

  it('recusa quando já existe pasta com o mesmo nome no destino', async () => {
    const origem = await criarProjeto(fora, 'erp')
    await criarProjeto(raiz, 'erp')

    await expect(moverPasta(raiz, origem, join(raiz, 'erp'))).rejects.toThrow(/Já existe/)

    // E o mais importante: a origem continua intacta.
    expect(await fs.readFile(join(origem, 'README.md'), 'utf8')).toBe('# erp\n')
  })

  it('recusa origem inexistente', async () => {
    await expect(
      moverPasta(raiz, join(fora, 'nao-existe'), join(raiz, 'nao-existe'))
    ).rejects.toThrow(/não existe/)
  })

  it('recusa origem que é um arquivo', async () => {
    const arquivo = join(fora, 'diario.txt')
    await fs.writeFile(arquivo, 'oi', 'utf8')
    await expect(moverPasta(raiz, arquivo, join(raiz, 'arquivo.txt'))).rejects.toThrow(/não é uma pasta/)
  })

  it('recusa mover uma pasta que contém o próprio mapa', async () => {
    await expect(moverPasta(raiz, base, join(raiz, 'base'))).rejects.toThrow(/contém o próprio mapa/)
    await expect(fs.access(raiz)).resolves.toBeUndefined()
  })

  it('recusa destino dentro da origem', async () => {
    const origem = await criarProjeto(fora, 'erp')
    await expect(moverPasta(raiz, origem, join(origem, 'dentro'))).rejects.toThrow(/dentro da pasta/)
  })

  it('registra a intenção antes de mover e a confirmação depois', async () => {
    const origem = await criarProjeto(fora, 'erp')
    await moverPasta(raiz, origem, join(raiz, 'erp'))

    const log = await fs.readFile(join(caminhoMeta(raiz), 'movimentos.log'), 'utf8')
    const linhas = log.trim().split('\n').map((l) => JSON.parse(l))

    // Duas linhas por movimentação: a primeira é gravada antes de o disco mudar,
    // e é ela que garante que dá para desfazer mesmo se a segunda se perder.
    expect(linhas).toHaveLength(2)
    expect(linhas[0]).toMatchObject({ de: origem, para: join(raiz, 'erp'), tipo: 'mover', estado: 'iniciada' })
    expect(linhas[1]).toMatchObject({ de: origem, para: join(raiz, 'erp'), tipo: 'mover', estado: 'concluida' })
  })

  it('não move nada quando não consegue registrar a intenção', async () => {
    const origem = await criarProjeto(fora, 'erp')

    // `.organizador` ocupado por um arquivo: gravar o log é impossível, e a
    // regra é não mover o que não pode ser registrado.
    await fs.rm(caminhoMeta(raiz), { recursive: true, force: true })
    await fs.writeFile(caminhoMeta(raiz), 'nao sou uma pasta\n')

    await expect(moverPasta(raiz, origem, join(raiz, 'erp'))).rejects.toThrow()

    // A pasta continua exatamente onde estava.
    await expect(fs.access(origem)).resolves.toBeUndefined()
    await expect(fs.access(join(raiz, 'erp'))).rejects.toThrow()
  })
})

describe('sobra na origem', () => {
  it('avisa em vez de falhar quando não consegue limpar a origem', async () => {
    const origem = await criarProjeto(fora, 'erp')
    const destino = join(raiz, 'erp')
    falharEm('rm', origem, 'EBUSY')

    const aviso = await copiarVerificarERemover(origem, destino)

    // O que mais importa: o conteúdo chegou inteiro do outro lado.
    await expect(fs.readFile(join(destino, 'src', 'index.ts'), 'utf8')).resolves.toBe(
      'export const x = 1\n'
    )
    expect(aviso).toMatch(/não deu para remover/)
    expect(aviso).toContain(destino)
  })

  it('a movimentação com sobra continua registrada e desfazível', async () => {
    const origem = await criarProjeto(fora, 'erp')
    const destino = join(raiz, 'erp')
    // Força o caminho de volumes diferentes e, nele, a falha na limpeza.
    falharEm('rename', origem, 'EXDEV')
    falharEm('rm', origem, 'EBUSY')

    const { aviso } = await moverPasta(raiz, origem, destino)

    expect(aviso).toMatch(/não deu para remover/)
    // O ponto: apesar da sobra, a movimentação foi tratada como o sucesso que
    // é — então continua havendo o que desfazer.
    expect(await ultimaMovimentacao(raiz)).toMatchObject({ de: origem, para: destino })
  })
})

describe('copiarVerificarERemover', () => {
  it('copia a árvore inteira e só então remove a origem', async () => {
    const origem = await criarProjeto(fora, 'erp')
    const destino = join(raiz, 'erp')

    await copiarVerificarERemover(origem, destino)

    await expect(fs.access(origem)).rejects.toThrow()
    expect(await fs.readFile(join(destino, 'src', 'index.ts'), 'utf8')).toContain('export const x')
  })

  it('não deixa cópia pela metade quando o destino já existe', async () => {
    const origem = await criarProjeto(fora, 'erp')
    const destino = await criarProjeto(raiz, 'erp')

    await expect(copiarVerificarERemover(origem, destino)).rejects.toThrow()

    // A origem tem que continuar lá — é a única cópia boa que sobrou.
    expect(await fs.readFile(join(origem, 'README.md'), 'utf8')).toBe('# erp\n')
  })

  it('leva junto pastas vazias e arquivos de tamanho zero', async () => {
    const origem = join(fora, 'esquisita')
    await fs.mkdir(join(origem, 'vazia'), { recursive: true })
    await fs.writeFile(join(origem, 'zero.txt'), '', 'utf8')

    const destino = join(raiz, 'esquisita')
    await copiarVerificarERemover(origem, destino)

    await expect(fs.access(join(destino, 'vazia'))).resolves.toBeUndefined()
    expect((await fs.stat(join(destino, 'zero.txt'))).size).toBe(0)
  })
})

describe('desfazerUltima', () => {
  it('devolve a pasta para o lugar de origem', async () => {
    const origem = await criarProjeto(fora, 'erp')
    await moverPasta(raiz, origem, join(raiz, 'erp'))

    await desfazerUltima(raiz)

    expect(await fs.readFile(join(origem, 'README.md'), 'utf8')).toBe('# erp\n')
    await expect(fs.access(join(raiz, 'erp'))).rejects.toThrow()
  })

  it('não faz ping-pong: desfazer duas vezes seguidas é recusado', async () => {
    const origem = await criarProjeto(fora, 'erp')
    await moverPasta(raiz, origem, join(raiz, 'erp'))
    await desfazerUltima(raiz)

    await expect(desfazerUltima(raiz)).rejects.toThrow(/Não há movimentação recente/)
    expect(await fs.readFile(join(origem, 'README.md'), 'utf8')).toBe('# erp\n')
  })

  it('recusa quando alguém já ocupou o lugar de origem', async () => {
    const origem = await criarProjeto(fora, 'erp')
    await moverPasta(raiz, origem, join(raiz, 'erp'))
    await criarProjeto(fora, 'erp') // usuário recriou a pasta por fora

    await expect(desfazerUltima(raiz)).rejects.toThrow(/Já existe algo/)
    // A pasta movida continua no mapa, intacta.
    await expect(fs.access(join(raiz, 'erp', 'README.md'))).resolves.toBeUndefined()
  })

  it('recusa quando a pasta sumiu do mapa por fora', async () => {
    const origem = await criarProjeto(fora, 'erp')
    await moverPasta(raiz, origem, join(raiz, 'erp'))
    await fs.rm(join(raiz, 'erp'), { recursive: true })

    await expect(desfazerUltima(raiz)).rejects.toThrow(/não está mais em/)
  })

  it('desfaz apenas a movimentação mais recente', async () => {
    const a = await criarProjeto(fora, 'a')
    const b = await criarProjeto(fora, 'b')
    await moverPasta(raiz, a, join(raiz, 'a'))
    await moverPasta(raiz, b, join(raiz, 'b'))

    await desfazerUltima(raiz)

    await expect(fs.access(join(fora, 'b'))).resolves.toBeUndefined()
    await expect(fs.access(join(raiz, 'a'))).resolves.toBeUndefined()
  })
})

describe('moverVarias', () => {
  it('move todas quando todas cabem', async () => {
    for (const nome of ['erp', 'portal', 'scripts']) await criarProjeto(fora, nome)

    const relatorio = await moverVarias(raiz, [
      join(fora, 'erp'),
      join(fora, 'portal'),
      join(fora, 'scripts')
    ])

    expect(relatorio.movidas).toHaveLength(3)
    expect(relatorio.falhas).toEqual([])
    for (const nome of ['erp', 'portal', 'scripts']) {
      expect(await ehDiretorio(join(raiz, nome))).toBe(true)
      expect(await existe(join(fora, nome))).toBe(false)
    }
  })

  it('segue depois de uma falha, em vez de abandonar o resto do lote', async () => {
    await criarProjeto(fora, 'antes')
    await criarProjeto(fora, 'depois')
    // A do meio nem existe: falha na validação, sem tocar em disco.
    const relatorio = await moverVarias(raiz, [
      join(fora, 'antes'),
      join(fora, 'fantasma'),
      join(fora, 'depois')
    ])

    expect(relatorio.movidas).toHaveLength(2)
    expect(relatorio.falhas).toHaveLength(1)
    expect(relatorio.falhas[0].origem).toBe(join(fora, 'fantasma'))
    // A que vinha *depois* da falha é a que prova que o lote não parou.
    expect(await ehDiretorio(join(raiz, 'depois'))).toBe(true)
  })

  it('conta o motivo de cada falha', async () => {
    await criarProjeto(fora, 'erp')
    await fs.mkdir(join(raiz, 'erp'), { recursive: true }) // nome já ocupado

    const relatorio = await moverVarias(raiz, [join(fora, 'erp')])

    expect(relatorio.movidas).toEqual([])
    expect(relatorio.falhas[0].motivo).toContain('Já existe')
    // A origem continua onde estava: falha de validação não mexe em nada.
    expect(await ehDiretorio(join(fora, 'erp'))).toBe(true)
  })

  it('a segunda de nome repetido encontra a primeira no lugar e é recusada', async () => {
    const um = await criarProjeto(join(fora, 'cliente-a'), 'docs')
    const dois = await criarProjeto(join(fora, 'cliente-b'), 'docs')

    const relatorio = await moverVarias(raiz, [um, dois])

    expect(relatorio.movidas).toHaveLength(1)
    expect(relatorio.falhas).toHaveLength(1)
    expect(relatorio.falhas[0].origem).toBe(dois)
    expect(relatorio.falhas[0].motivo).toContain('Já existe')
    // E a recusada continua inteira na origem, não pela metade.
    expect(await existe(join(dois, 'README.md'))).toBe(true)
  })

  it('recusa a pasta que contém o próprio mapa sem derrubar as outras', async () => {
    await criarProjeto(fora, 'erp')

    const relatorio = await moverVarias(raiz, [base, join(fora, 'erp')])

    expect(relatorio.falhas).toHaveLength(1)
    expect(relatorio.falhas[0].motivo).toContain('mapa')
    expect(relatorio.movidas).toHaveLength(1)
  })

  it('registra cada movimentação no log, uma por uma', async () => {
    for (const nome of ['um', 'dois']) await criarProjeto(fora, nome)

    await moverVarias(raiz, [join(fora, 'um'), join(fora, 'dois')])

    // O desfazer continua sendo por pasta: a última do lote é a primeira a voltar.
    const ultima = await ultimaMovimentacao(raiz)
    expect(ultima?.para).toBe(join(raiz, 'dois'))
    await desfazerUltima(raiz)
    expect(await ehDiretorio(join(fora, 'dois'))).toBe(true)
    expect(await ehDiretorio(join(raiz, 'um'))).toBe(true)
  })

  it('junta as ressalvas de sobra na origem', async () => {
    await criarProjeto(fora, 'travada')
    // Força o caminho de cópia entre volumes e trava a limpeza da origem.
    falharEm('rename', join(fora, 'travada'), 'EXDEV')
    falharEm('rm', join(fora, 'travada'), 'EBUSY')

    const relatorio = await moverVarias(raiz, [join(fora, 'travada')])

    expect(relatorio.movidas).toHaveLength(1)
    expect(relatorio.avisos).toHaveLength(1)
    expect(relatorio.avisos[0]).toContain('travada')
  })

  it('lote vazio não faz nada e não reclama', async () => {
    expect(await moverVarias(raiz, [])).toEqual({ movidas: [], falhas: [], avisos: [] })
  })
})

describe('ultimaMovimentacao', () => {
  it('devolve null quando não há histórico', async () => {
    expect(await ultimaMovimentacao(raiz)).toBeNull()
  })

  it('ignora linha corrompida no log sem perder o resto', async () => {
    const origem = await criarProjeto(fora, 'erp')
    await moverPasta(raiz, origem, join(raiz, 'erp'))
    await fs.appendFile(join(caminhoMeta(raiz), 'movimentos.log'), '{ isso nao e json\n', 'utf8')

    expect(await ultimaMovimentacao(raiz)).toMatchObject({ para: join(raiz, 'erp') })
  })
})
