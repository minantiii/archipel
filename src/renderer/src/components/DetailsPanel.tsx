import { useEffect, useState } from 'react'
import type { Mapa, Ilha } from '@shared/types'
import { emPalavras, porExtenso } from '../lib/datas'
import type { AcaoDeAbrir } from '../state/store'

/**
 * Tira a linha em branco que separa o frontmatter do corpo no `.md`.
 *
 * No arquivo ela é formatação — todo `.md` tem uma. Mas ela vem dentro do corpo
 * e, no textarea, vira uma primeira linha vazia que empurra o diário inteiro
 * para baixo, como se o texto estivesse desalinhado com a caixa.
 *
 * Só o que se **edita** é normalizado: o arquivo mantém a linha até o usuário
 * mexer no diário de verdade.
 */
function paraEditor(corpo: string): string {
  return corpo.replace(/^\n+/, '')
}

interface Props {
  ilha: Ilha
  mapa: Mapa
  onFechar: () => void
  onSalvar: (patch: { tags?: string[]; cor?: string | null; diario?: string }) => void
  onDesconectar: (destino: string) => void
  onSelecionar: (id: string) => void
  onAcao: (acao: AcaoDeAbrir) => void
  onRemover: () => void
  onRenomear: (novoNome: string) => void
  /** `true` quando a pasta acabou de ser criada e ainda se chama "Nova pasta". */
  batizar?: boolean
  onBatizada?: () => void
}

export default function DetailsPanel({
  ilha,
  mapa,
  onFechar,
  onSalvar,
  onDesconectar,
  onSelecionar,
  onAcao,
  onRemover,
  onRenomear,
  batizar,
  onBatizada
}: Props): React.JSX.Element {
  const [diario, setDiario] = useState(() => paraEditor(ilha.diario))
  const [novaTag, setNovaTag] = useState('')
  const [renomeando, setRenomeando] = useState<string | null>(null)

  // Pasta recém-criada abre com o nome já em edição e selecionado: ela nasceu
  // como "Nova pasta" e o próximo passo óbvio é dar um nome de verdade.
  useEffect(() => {
    if (!batizar) return
    setRenomeando(ilha.id)
    onBatizada?.()
  }, [batizar, ilha.id, onBatizada])

  // A ilha pode mudar debaixo do painel — troca de seleção, ou alguém editando
  // o arquivo por fora. Em ambos os casos o textarea precisa acompanhar.
  useEffect(() => {
    setDiario(paraEditor(ilha.diario))
  }, [ilha.id, ilha.diario])

  const vizinhos = mapa.pontes
    .filter((a) => a.origem === ilha.id || a.destino === ilha.id)
    .map((a) => (a.origem === ilha.id ? a.destino : a.origem))

  const adicionarTag = (): void => {
    const tag = novaTag.trim().replace(/^#/, '')
    if (tag.length === 0 || ilha.tags.includes(tag)) return setNovaTag('')
    onSalvar({ tags: [...ilha.tags, tag] })
    setNovaTag('')
  }

  return (
    <aside className="detalhes">
      <header className="detalhes-topo">
        {renomeando === null ? (
          <h2
            title="Clique duas vezes para renomear"
            onDoubleClick={() => setRenomeando(ilha.id)}
          >
            {ilha.id}
          </h2>
        ) : (
          <input
            className="campo-renomear"
            autoFocus
            value={renomeando}
            // Seleciona tudo ao focar: no caso da pasta nova, digitar já troca
            // o "Nova pasta" inteiro em vez de acrescentar ao lado dele.
            onFocus={(e) => e.target.select()}
            onChange={(e) => setRenomeando(e.target.value)}
            onBlur={() => setRenomeando(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setRenomeando(null)
              if (e.key === 'Enter') {
                const nome = renomeando.trim()
                setRenomeando(null)
                if (nome.length > 0 && nome !== ilha.id) onRenomear(nome)
              }
            }}
          />
        )}
        <button className="fechar" onClick={onFechar} title="Fechar">
          ×
        </button>
      </header>

      <p className="caminho" title={ilha.caminho}>
        {ilha.caminho}
      </p>

      {/* Duas linhas discretas, não uma seção: são contexto de canto de olho,
          e promovê-las competiria com as ações, que é o que se vem fazer aqui. */}
      <dl className="datas">
        <div>
          <dt>Aberta</dt>
          <dd title={porExtenso(ilha.ultimoAcessoEm) ?? undefined}>
            {emPalavras(ilha.ultimoAcessoEm) ?? (
              // Nunca aberta *pelo app* — não é o mesmo que nunca usada, e dizer
              // "nunca" mentiria sobre tudo que aconteceu antes do mapa existir.
              <span className="sem-data">nenhuma vez por aqui</span>
            )}
          </dd>
        </div>
        <div>
          <dt>No mapa</dt>
          <dd title={porExtenso(ilha.criadoEm) ?? undefined}>
            {emPalavras(ilha.criadoEm) ?? <span className="sem-data">desde sempre</span>}
          </dd>
        </div>
      </dl>

      {ilha.ausente && (
        <p className="aviso-ausente">
          Esta pasta não existe mais no disco. Os metadados continuam guardados — se ela voltar para
          o mapa com o mesmo nome, tudo se religa sozinho.
        </p>
      )}

      <section>
        <h3>Ações</h3>
        <div className="grade-acoes">
          <button onClick={() => onAcao('explorer')} disabled={ilha.ausente}>
            Explorer
          </button>
          <button onClick={() => onAcao('vscode')} disabled={ilha.ausente}>
            VS Code
          </button>
          <button onClick={() => onAcao('terminal')} disabled={ilha.ausente}>
            Terminal
          </button>
          <button onClick={() => onAcao('copiarCaminho')}>Copiar caminho</button>
          <button className="perigoso" onClick={onRemover} disabled={ilha.ausente}>
            Tirar do mapa…
          </button>
        </div>
      </section>

      <section>
        <h3>Tags</h3>
        <div className="tags-da-ilha">
          {ilha.tags.map((tag) => (
            <span
              key={tag}
              className="chip-tag no-painel"
              style={
                {
                  '--cor-tag': mapa.tags.find((t) => t.nome === tag)?.cor ?? '#6b6b78'
                } as React.CSSProperties
              }
            >
              {tag}
              <button
                onClick={() => onSalvar({ tags: ilha.tags.filter((t) => t !== tag) })}
                title={`Remover a tag ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
          {ilha.tags.length === 0 && <span className="vazio">sem tags</span>}
        </div>

        <div className="linha-tag">
          <input
            type="text"
            value={novaTag}
            placeholder="nova tag"
            list="tags-existentes"
            onChange={(e) => setNovaTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adicionarTag()}
          />
          <datalist id="tags-existentes">
            {mapa.tags.map((t) => (
              <option key={t.nome} value={t.nome} />
            ))}
          </datalist>
          <button onClick={adicionarTag}>Adicionar</button>
        </div>
      </section>

      <section>
        <h3>Cor</h3>
        <div className="linha-cor">
          <input
            type="color"
            value={ilha.cor ?? '#7c5cff'}
            onChange={(e) => onSalvar({ cor: e.target.value })}
            title="Sobrescrever a cor da tag"
          />
          <button onClick={() => onSalvar({ cor: null })} disabled={!ilha.cor}>
            Usar a cor da tag
          </button>
        </div>
      </section>

      <section>
        <h3>Pontes ({vizinhos.length})</h3>
        {vizinhos.length === 0 && (
          <p className="vazio">
            Nenhuma. Ligue o <strong>modo conexão</strong> e clique de uma pasta a outra.
          </p>
        )}
        <ul className="lista-conexoes">
          {vizinhos.map((vizinho) => (
            <li key={vizinho}>
              <button className="link-vizinho" onClick={() => onSelecionar(vizinho)}>
                {vizinho}
              </button>
              <button
                className="remover-conexao"
                onClick={() => onDesconectar(vizinho)}
                title="Derrubar esta ponte"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="secao-diario">
        <h3>Diário</h3>
        <textarea
          value={diario}
          placeholder="Para que serve esta pasta? Use [[NomeDaPasta]] para ligar com outra."
          onChange={(e) => setDiario(e.target.value)}
          // Compara contra o corpo já normalizado, senão a linha em branco
          // removida contaria como edição e todo blur gravaria em disco.
          onBlur={() => diario !== paraEditor(ilha.diario) && onSalvar({ diario })}
        />
        <p className="dica-diario">
          Salva ao sair do campo. As <code>[[ligações]]</code> daqui viram as pontes do mapa.
        </p>
      </section>
    </aside>
  )
}
