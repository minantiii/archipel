import { useEffect, useMemo, useState } from 'react'
import { MOTORES, type Agente, type Conversa, type Mapa, type MotorAgente } from '@shared/types'
import { barcosDoTime, type StatusAgente } from '../lib/agentes'
import { emPalavras } from '../lib/datas'
import { useStore } from '../state/store'

/**
 * O time de agentes, no lugar do painel da ilha: a lista dos agentes com o
 * estado de cada um, o formulário para criar ou editar, e as conversas entre
 * eles (o que um pediu ao outro e o que voltou).
 */

const NOME_MOTOR: Record<MotorAgente, string> = { claude: 'Claude', gemini: 'Gemini (agy)' }

/** Sugestões do campo de modelo. Vazio continua valendo (o padrão do motor). */
const MODELOS: Record<MotorAgente, string[]> = {
  claude: ['opus', 'sonnet', 'haiku'],
  gemini: [
    'gemini-4-hydrogen-high',
    'gemini-4-hydrogen-medium',
    'gemini-3.8-flash-high',
    'gemini-3.8-flash-medium',
    'gemini-3.8-flash-low'
  ]
}

function higienizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+/, '')
    .slice(0, 40)
}

interface Props {
  mapa: Mapa
  onFechar: () => void
}

export default function PainelAgentes({ mapa, onFechar }: Props): React.JSX.Element {
  const t = useStore((e) => e.t)
  const time = useStore((e) => e.time)
  const abertos = useStore((e) => e.agentesAbertos)
  const foco = useStore((e) => e.agenteEmFoco)
  const novoAgente = useStore((e) => e.novoAgente)
  const { salvarAgente, apagarAgente, abrirSessaoDoAgente, focarAgente } = useStore.getState()

  /** Agente no formulário: `nomeAntigo` `null` = criando. */
  const [editando, setEditando] = useState<{ agente: Agente; nomeAntigo: string | null } | null>(null)
  const [confirmandoApagar, setConfirmandoApagar] = useState<string | null>(null)
  const [conversaAberta, setConversaAberta] = useState<string | null>(null)
  /** Força o recálculo do "terminou há pouco" sem esperar o disco mudar. */
  const [relogio, setRelogio] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setRelogio(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!novoAgente) return
    setEditando({
      agente: { nome: '', motor: 'claude', modelo: null, ilha: novoAgente.ilha, funcao: '' },
      nomeAntigo: null
    })
  }, [novoAgente])

  const ilhas = useMemo(() => mapa.ilhas.filter((i) => !i.ausente).map((i) => i.id).sort(), [mapa])
  const status = useMemo(() => {
    const barcos = barcosDoTime(time, new Set(abertos), new Set(ilhas), relogio)
    return new Map(barcos.map((b) => [b.nome, b.status]))
  }, [time, abertos, ilhas, relogio])

  const agentes = time?.agentes ?? []
  const conversas = (time?.conversas ?? []).filter(
    (c) => !foco || c.de === foco || c.para === foco
  )

  const salvar = async (): Promise<void> => {
    if (!editando) return
    const ok = await salvarAgente(editando.agente, editando.nomeAntigo)
    if (ok) setEditando(null)
  }

  const mudar = (patch: Partial<Agente>): void =>
    setEditando((e) => (e ? { ...e, agente: { ...e.agente, ...patch } } : e))

  return (
    <aside className="detalhes painel-agentes" aria-label={t.agentes}>
      <header className="detalhes-topo">
        <h2>{t.agentes}</h2>
        <button className="fechar" onClick={onFechar} title={t.fechar}>
          ×
        </button>
      </header>

      {editando ? (
        <section className="formulario-agente">
          <label>
            <span>{t.agenteNome}</span>
            <input
              autoFocus
              value={editando.agente.nome}
              onChange={(e) => mudar({ nome: higienizar(e.target.value) })}
              placeholder="revisor"
            />
            <small>{t.agenteNomeAjuda}</small>
          </label>
          <label>
            <span>{t.agenteMotor}</span>
            <select
              value={editando.agente.motor}
              onChange={(e) => mudar({ motor: e.target.value as MotorAgente, modelo: null })}
            >
              {MOTORES.map((m) => (
                <option key={m} value={m}>
                  {NOME_MOTOR[m]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.agenteModelo}</span>
            <input
              list={`modelos-${editando.agente.motor}`}
              value={editando.agente.modelo ?? ''}
              onChange={(e) => mudar({ modelo: e.target.value.trim() || null })}
              placeholder={t.agenteModeloAjuda}
            />
            <datalist id={`modelos-${editando.agente.motor}`}>
              {MODELOS[editando.agente.motor].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label>
            <span>{t.agenteIlha}</span>
            <select
              value={editando.agente.ilha ?? ''}
              onChange={(e) => mudar({ ilha: e.target.value || null })}
            >
              <option value="">{t.agenteRaiz}</option>
              {ilhas.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.agenteFuncao}</span>
            <textarea
              rows={6}
              value={editando.agente.funcao}
              onChange={(e) => mudar({ funcao: e.target.value })}
              placeholder="Revisa o código que o time escreve e aponta bugs, com arquivo e linha."
            />
            <small>{t.agenteFuncaoAjuda}</small>
          </label>
          <div className="formulario-acoes">
            <button onClick={() => setEditando(null)}>{t.agenteCancelar}</button>
            <button
              className="primario"
              onClick={() => void salvar()}
              disabled={editando.agente.nome.length === 0}
            >
              {t.agenteSalvar}
            </button>
          </div>
        </section>
      ) : (
        <section>
          {agentes.length === 0 && <p className="vazio">{t.agentesVazio}</p>}
          <ul className="lista-agentes">
            {agentes.map((agente) => {
              const estado: StatusAgente = status.get(agente.nome) ?? 'parado'
              return (
                <li
                  key={agente.nome}
                  className={foco === agente.nome ? 'agente em-foco' : 'agente'}
                  onClick={() => focarAgente(foco === agente.nome ? null : agente.nome)}
                >
                  <div className="agente-linha">
                    <span className={`selo-status status-${estado}`} title={t.agenteStatus[estado]} />
                    <strong>{agente.nome}</strong>
                    <span className="agente-motor">{NOME_MOTOR[agente.motor]}</span>
                  </div>
                  <div className="agente-detalhe">
                    {agente.ilha ?? t.agenteRaiz} · {t.agenteStatus[estado]}
                    {agente.modelo ? ` · ${agente.modelo}` : ''}
                  </div>
                  {foco === agente.nome && (
                    <div className="agente-acoes" onClick={(e) => e.stopPropagation()}>
                      <button className="primario" onClick={() => abrirSessaoDoAgente(agente.nome)}>
                        {t.agenteIniciar}
                      </button>
                      <button onClick={() => setEditando({ agente, nomeAntigo: agente.nome })}>
                        {t.agenteEditar}
                      </button>
                      {confirmandoApagar === agente.nome ? (
                        <button
                          className="perigoso"
                          onClick={() => {
                            setConfirmandoApagar(null)
                            void apagarAgente(agente.nome)
                          }}
                          title={t.agenteApagarPergunta(agente.nome)}
                        >
                          {t.agenteApagar}?
                        </button>
                      ) : (
                        <button className="perigoso" onClick={() => setConfirmandoApagar(agente.nome)}>
                          {t.agenteApagar}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <button
            className="botao-novo-agente"
            onClick={() =>
              setEditando({
                agente: { nome: '', motor: 'claude', modelo: null, ilha: null, funcao: '' },
                nomeAntigo: null
              })
            }
          >
            + {t.agenteNovo}
          </button>
        </section>
      )}

      <section className="secao-conversas">
        <h3>
          {t.conversas}
          {foco ? ` · ${foco}` : ''}
        </h3>
        {conversas.length === 0 && <p className="vazio">{t.conversasVazio}</p>}
        <ul className="lista-conversas">
          {conversas.map((c) => (
            <ItemConversa
              key={c.id}
              conversa={c}
              aberta={conversaAberta === c.id}
              onAlternar={() => setConversaAberta(conversaAberta === c.id ? null : c.id)}
            />
          ))}
        </ul>
      </section>
    </aside>
  )
}

function ItemConversa({
  conversa,
  aberta,
  onAlternar
}: {
  conversa: Conversa
  aberta: boolean
  onAlternar: () => void
}): React.JSX.Element {
  const t = useStore((e) => e.t)
  const agentes = useStore((e) => e.time?.agentes)
  const { pararConversa, abrirSessaoDoAgente } = useStore.getState()
  const de = conversa.de === 'voce' ? t.conversaVoce : conversa.de
  // Só dá para continuar com quem ainda existe e numa conversa que o motor guardou.
  const podeContinuar =
    conversa.status !== 'trabalhando' &&
    conversa.sessao !== null &&
    (agentes ?? []).some((a) => a.nome === conversa.para)
  return (
    <li className={`conversa conversa-${conversa.status}`}>
      <button className="conversa-cabeca" onClick={onAlternar} aria-expanded={aberta}>
        <span className={`selo-status status-${conversa.status}`} />
        <span className="conversa-rota">
          {de} → {conversa.para}
        </span>
        <span className="conversa-quando">{emPalavras(conversa.inicio) ?? ''}</span>
      </button>
      {!aberta && <p className="conversa-previa">{conversa.tarefa.slice(0, 140)}</p>}
      {aberta && (
        <div className="conversa-corpo">
          <h4>{t.conversaTarefa}</h4>
          <pre>{conversa.tarefa}</pre>
          <h4>{t.conversaResposta}</h4>
          <pre>{conversa.status === 'trabalhando' ? t.conversaEsperando : conversa.resposta}</pre>
        </div>
      )}
      {(conversa.status === 'trabalhando' || (aberta && podeContinuar)) && (
        <div className="conversa-acoes">
          {conversa.status === 'trabalhando' && (
            <button className="perigoso" onClick={() => void pararConversa(conversa.id)}>
              ■ {t.conversaParar}
            </button>
          )}
          {aberta && podeContinuar && (
            <button
              onClick={() => abrirSessaoDoAgente(conversa.para, conversa.sessao)}
              title={t.conversaContinuarAjuda(conversa.para)}
            >
              ↺ {t.conversaContinuar}
            </button>
          )}
        </div>
      )}
    </li>
  )
}
