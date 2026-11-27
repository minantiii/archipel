import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ilha, Mapa, OrganizadorApi } from '@shared/types'
import { useStore } from './store'

/**
 * A store só conversa com o disco por `window.api`, então dá para exercitá-la
 * inteira no Node trocando a ponte por uma de mentira.
 */

function ilha(id: string, extra: Partial<Ilha> = {}): Ilha {
  return {
    id,
    caminho: `C:\\mapa\\${id}`,
    tags: [],
    cor: null,
    pos: null,
    diario: '',
    links: [],
    ausente: false,
    criadoEm: null,
    ultimoAcessoEm: null,
    ...extra
  }
}

function mapaCom(ilhas: Ilha[], extra: Partial<Mapa> = {}): Mapa {
  return { raiz: 'C:\\mapa', ilhas, pontes: [], tags: [], ordem: [], ...extra }
}

/** Uma cópia sem nenhum objeto em comum — é assim que todo mapa chega do IPC. */
function vindoDoDisco(mapa: Mapa): Mapa {
  return JSON.parse(JSON.stringify(mapa)) as Mapa
}

const pasta = {
  salvarMeta: vi.fn(),
  conectar: vi.fn(),
  renomear: vi.fn(),
  ultimaMovimentacao: vi.fn()
}
const mapaApi = { carregar: vi.fn() }

beforeEach(() => {
  vi.resetAllMocks()
  pasta.ultimaMovimentacao.mockResolvedValue(null)
  const api = { pasta, mapa: mapaApi } as unknown as OrganizadorApi
  vi.stubGlobal('window', { api })

  useStore.setState({
    raiz: 'C:\\mapa',
    mapa: null,
    carregando: false,
    erro: null,
    selecionado: null,
    movimentacao: null,
    busca: '',
    filtroTag: null,
    modoConexao: false,
    conectandoDe: null
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('recarga silenciosa', () => {
  it('não mexe em nada quando o disco devolve o mesmo mapa', async () => {
    const mapa = mapaCom([ilha('api'), ilha('site')])
    useStore.setState({ mapa })
    mapaApi.carregar.mockResolvedValue(vindoDoDisco(mapa))

    const avisos = vi.fn()
    const parar = useStore.subscribe(avisos)
    await useStore.getState().recarregar({ silencioso: true })
    parar()

    // O mesmo objeto, e nenhum aviso: é o que impede o eco do observador de
    // arquivos de redesenhar a tela e reaquecer a simulação.
    expect(useStore.getState().mapa).toBe(mapa)
    expect(avisos).not.toHaveBeenCalled()
  })

  it('não acende o carregamento nem apaga o erro que está na tela', async () => {
    useStore.setState({ mapa: mapaCom([ilha('api')]), erro: 'algo deu errado' })
    mapaApi.carregar.mockResolvedValue(mapaCom([ilha('api'), ilha('site')]))

    const carregandoVisto: boolean[] = []
    const parar = useStore.subscribe((estado) => carregandoVisto.push(estado.carregando))
    await useStore.getState().recarregar({ silencioso: true })
    parar()

    expect(carregandoVisto).not.toContain(true)
    expect(useStore.getState().erro).toBe('algo deu errado')
    expect(useStore.getState().mapa?.ilhas).toHaveLength(2)
  })
})

describe('mapa novo chegando', () => {
  it('desliga o filtro de uma tag que deixou de existir', async () => {
    useStore.setState({
      mapa: mapaCom([ilha('api', { tags: ['kronos'] })], {
        tags: [{ nome: 'kronos', cor: '#7c5cff' }]
      }),
      filtroTag: 'kronos'
    })
    mapaApi.carregar.mockResolvedValue(mapaCom([ilha('api')]))

    await useStore.getState().recarregar()

    expect(useStore.getState().filtroTag).toBeNull()
  })

  it('solta a seleção e a ponta de conexão de uma ilha que saiu', async () => {
    useStore.setState({
      mapa: mapaCom([ilha('api'), ilha('site')]),
      selecionado: 'site',
      conectandoDe: 'site'
    })
    mapaApi.carregar.mockResolvedValue(mapaCom([ilha('api')]))

    await useStore.getState().recarregar()

    expect(useStore.getState().selecionado).toBeNull()
    expect(useStore.getState().conectandoDe).toBeNull()
  })
})

describe('renomear', () => {
  it('leva a seleção para a ilha renomeada, e não para outra de nome parecido', async () => {
    useStore.setState({ mapa: mapaCom([ilha('minha-api'), ilha('velho')]), selecionado: 'velho' })
    // "minha-api" vem antes na lista e o caminho dela também termina em "api".
    pasta.renomear.mockResolvedValue({ ok: true, dados: mapaCom([ilha('api'), ilha('minha-api')]) })

    await useStore.getState().renomear('velho', 'api')

    expect(useStore.getState().selecionado).toBe('api')
  })
})

describe('cor da ilha', () => {
  it('mostra cada cor na hora e grava só a última', async () => {
    vi.useFakeTimers()
    useStore.setState({ mapa: mapaCom([ilha('api')]) })
    pasta.salvarMeta.mockImplementation((_id: string, patch: { cor: string }) =>
      Promise.resolve(mapaCom([ilha('api', { cor: patch.cor })]))
    )

    const { salvarMeta } = useStore.getState()
    void salvarMeta('api', { cor: '#111111' })
    void salvarMeta('api', { cor: '#222222' })
    void salvarMeta('api', { cor: '#333333' })

    expect(useStore.getState().mapa?.ilhas[0].cor).toBe('#333333')
    expect(pasta.salvarMeta).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    expect(pasta.salvarMeta).toHaveBeenCalledTimes(1)
    expect(pasta.salvarMeta).toHaveBeenCalledWith('api', { cor: '#333333' })
    expect(useStore.getState().mapa?.ilhas[0].cor).toBe('#333333')
  })

  it('"usar a cor da tag" cancela uma cor que ainda não tinha sido gravada', async () => {
    vi.useFakeTimers()
    useStore.setState({ mapa: mapaCom([ilha('api', { cor: '#111111' })]) })
    pasta.salvarMeta.mockResolvedValue(mapaCom([ilha('api')]))

    const { salvarMeta } = useStore.getState()
    void salvarMeta('api', { cor: '#222222' })
    await salvarMeta('api', { cor: null })
    await vi.runAllTimersAsync()

    expect(pasta.salvarMeta).toHaveBeenCalledTimes(1)
    expect(pasta.salvarMeta).toHaveBeenCalledWith('api', { cor: null })
    expect(useStore.getState().mapa?.ilhas[0].cor).toBeNull()
  })
})

describe('modo conexão', () => {
  it('partindo de uma ilha ausente, quem escreve a ligação é a que existe', async () => {
    const mapa = mapaCom([ilha('api'), ilha('fantasma', { ausente: true })])
    useStore.setState({ mapa, modoConexao: true })
    pasta.conectar.mockResolvedValue(mapa)

    await useStore.getState().clicarEmModoConexao('fantasma')
    await useStore.getState().clicarEmModoConexao('api')

    expect(pasta.conectar).toHaveBeenCalledWith('api', 'fantasma')
  })
})
