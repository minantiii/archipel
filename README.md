# Archipel

Um mapa navegável para pastas de projeto. Em vez de organizar arquivos `.md`, ele organiza as
**pastas** — cada uma vira uma **ilha** de um mapa força-dirigido no disco,
com tags, pontes entre ilhas e abertura direta no Explorer, VS Code ou terminal.

Nasceu de um problema concreto: dezenas de pastas de projeto espalhadas pela área de
trabalho, porque enterrá-las em `Documentos` significa nunca mais achá-las.

## Rodando

```bash
npm install
npm run dev          # app com hot reload
npm test             # testes do núcleo (disco, markdown, movimentação)
npm run typecheck
npm run build:win    # gera o instalador em dist/
```

Na primeira abertura, escolha uma pasta para ser o mapa. Depois é só arrastar as
pastas do Explorer para dentro da janela — o app move cada uma para lá de verdade.
Arrastar um item da lista lateral para fora da janela faz o contrário: tira a pasta
do mapa. O botão **Adicionar pasta**, que abre um seletor, continua para quem
prefere escolher por diálogo.

## Idioma

A interface fala português ou inglês, e a escolha é feita **na primeira tela do
instalador** — não há botão para trocar depois. É decisão de uma vez só, e o topo do app
estava gastando um lugar de destaque com ela.

O assistente grava a escolha em `%APPDATA%\archipel\idioma.txt`, que é de onde o app lê ao
abrir. Fica ali, e não na pasta de instalação, porque a atualização automática apaga a
pasta de instalação inteira a cada versão nova. Rodando pelo `npm run dev` o arquivo não
existe, e aí vale o idioma do Windows.

As chaves dos arquivos (`criadoEm`, `pasta`, `ordem`) e os nomes dentro de `.organizador`
seguem em português nos dois idiomas: são o formato dos dados, não texto de tela. Traduzi-los
criaria dois dialetos do mesmo formato, com mapas impossíveis de abrir no outro idioma.

## Como o mapa é guardado

```
C:\SeuMapa\
  kronos-spec\                    ← pasta de projeto real
  ApiTelemetria\
  .organizador\
    AGENTS.md                     ← explica o formato pro agente de linha de comando
    config.yaml                   ← tags e cores
    pastas\
      kronos-spec.md
```

É tudo que o app escreve no mapa, e é tudo conteúdo — nada aqui cresce sozinho com o uso.
Estado do app (a raiz escolhida, o histórico de movimentações) fica em `%APPDATA%`, fora do
mapa: o mapa continua sendo uma pasta comum, copiável e versionável.

Cada `.md` descreve uma ilha:

```markdown
---
tags: [kronos, spec]
cor: "#7c5cff"
pos: { x: 120, y: -40 }
---

Especificação do Kronos. Consome a [[ApiTelemetria]] e guia o [[kronos-portaria]].
```

Três regras sustentam tudo:

1. **O nome do arquivo é a identidade da ilha** e casa com o nome da pasta no disco.
2. **As pontes do mapa são as `[[ligações]]` do corpo** do `.md`.
3. **O disco manda sobre existência.** Pasta nova ganha `.md` sozinha; pasta que some do
   disco leva a ilha e o `.md` dela junto, na varredura seguinte. O mapa é um retrato do
   disco, não um cadastro paralelo — e a conta disso é que tags e diário se vão com a pasta.

Nomes com `[ ] | # ^` quebrariam a sintaxe de ligação, então o arquivo usa um nome
higienizado e o campo `pasta:` guarda o nome verdadeiro.

## Editando os metadados por fora

Como tudo é markdown puro, qualquer editor serve — e o app **redesenha o mapa sozinho**
conforme os arquivos são salvos. Clique com o direito no vazio do mapa e use
**Abrir terminal no mapa** para cair em `.organizador`, que é de onde se enxergam todos
os `.md` de uma vez. Cada ilha também tem "Abrir terminal aqui", que cai dentro daquele
projeto.

O app não embute nenhuma ferramenta de IA nem exige uma instalada. Mas, como o formato é
markdown, um agente de linha de comando trabalha nele nativamente — é só rodar o agente no
terminal que você acabou de abrir. O `AGENTS.md` gerado em `.organizador` documenta o
formato e as regras, e dá para pedir coisas como:

> Leia as pastas e agrupe por tema, criando tags coerentes.
> Levante pontes entre as pastas que fazem parte do mesmo sistema.

## Movimentação de pastas

É a única parte que pode destruir trabalho, então é conservadora:

- valida antes (origem existe, destino livre, mapa não vai parar dentro de si mesmo);
- confirma mostrando os caminhos completos — com uma exceção deliberada: soltar pastas
  na janela move na hora, sem perguntar. Ali o gesto já apontou a origem e o destino com o
  mouse, e a pergunta seria pedir que se confirmasse o que acabou de ser feito. Sair do
  mapa continua confirmando, porque o destino ainda precisa ser escolhido;
- **registra a intenção antes de tocar no disco.** Se não der para gravar o registro,
  nada é movido: uma movimentação que não pode ser registrada é uma que não pode ser desfeita.
  A confirmação vem depois e, se ela se perder, a intenção sozinha já basta para o `Ctrl` + `Z`
  — quem decide se a movimentação aconteceu é o disco, não o registro;
- usa `rename` e, entre volumes diferentes, **copia, confere arquivos e bytes, e só então
  remove a origem**. Se a origem não puder ser limpa (arquivo travado por outro programa), a
  movimentação continua sendo um sucesso — o conteúdo está inteiro no destino — e o app avisa
  o que sobrou para conferir, em vez de dizer que falhou e mandar procurar no lugar errado;
- serializa toda operação que altera o mapa, para que duas nunca se cruzem;
- guarda as últimas movimentações em `%APPDATA%`, e `Ctrl` + `Z` devolve a última pasta para
  onde ela estava (com a mesma confirmação de caminhos completos). O histórico tem teto e não
  entra no mapa: registro de movimentação é estado do app, não conteúdo da sua pasta.

Ao migrar suas pastas de verdade, vá em lotes de 3 a 5 e confira no Explorer entre eles.

## Atalhos

| Ação | Como |
|---|---|
| Trazer pastas para o mapa | arrastar do Explorer e soltar em qualquer canto da janela |
| Tirar uma pasta do mapa | arrastar o item da lista lateral para fora da janela |
| Fixar uma ilha no lugar | arrastar no mapa (a posição vai para o `.md`) |
| Posicionar sem procurar | arrastar da lista lateral e soltar no mapa |
| Reordenar a lista | arrastar um item sobre outro na lista |
| Soltar a posição | `Alt` + clique |
| Abrir no Explorer | duplo clique — na bolinha do mapa ou na linha da lista |
| Menu de ações | botão direito |
| Modo conexão | `L` |
| Limpar seleção, ou sair do modo conexão | `Esc` |
| Renomear | duplo clique no título do painel |
| Desfazer a última movimentação | `Ctrl` + `Z` |
| Esconder a lista | `Ctrl` + `B` |

A ordem manual da lista fica em `ordem:` no `config.yaml`, então sobrevive a reinícios e dá
para reorganizá-la por fora. Reordenar só funciona com a busca e o filtro de tag limpos —
arrastar dentro de uma lista filtrada daria uma ordem sem sentido.

Renomear atualiza as ligações de todos os outros arquivos — as pontes não quebram.

## Time de agentes

Agentes são um Claude ou um Gemini com nome, função e uma ilha onde trabalham. Eles
não são as ilhas: um agente mora em `.organizador/agentes/<nome>.md` e aparece no mapa como
um **barco** ancorado perto da ilha dele.

```markdown
---
motor: gemini                     # claude | gemini (pelo `agy`)
modelo: gemini-3.8-flash-medium   # opcional
ilha: kronos-spec                 # opcional; sem ilha = raiz do mapa
---

Revisa o código que o time escreve e aponta bugs, com arquivo e linha.
```

- O botão do barco no topo abre o painel do time: criar, editar, apagar e **Abrir sessão**,
  que abre uma aba do terminal embutido rodando o motor na pasta do agente. Ele já sabe quem
  é, quem são os colegas e como passar uma tarefa adiante.
- Um agente passa tarefa a outro pelo `delegar.cmd` (o caminho exato vai no prompt dele,
  porque o Claude Code não aprova comando cujo programa vem de variável):

  ```bash
  "C:\Users\voce\AppData\Roaming\archipel\delegar.cmd" --para revisor <<'FIM'
  Revise src/main/terminal.ts e aponte bugs.
  FIM
  ```

  Quem recebe roda sem janela (`claude -p` ou `agy -p`), na pasta dele, e a resposta volta
  na saída do comando. Pedidos seguidos ao mesmo colega continuam a mesma conversa;
  `--nova` começa outra. Funciona de qualquer aba do terminal do Archipel (de lá, quem pede
  aparece como "você"). O Claude chamado assim pode editar arquivos, mas não roda comandos
  sem alguém para aprovar.
- Cada pedido vira `.organizador/agentes/conversas/<data>-<de>-<para>.md`, com a tarefa e a
  resposta. É por esse arquivo que o mapa vê o barco ficar âmbar ("trabalhando"), a rota
  tracejada entre os dois e, no fim, a vela verde (ou vermelha, se falhou).
- O `delegar` roda pelo próprio executável do Archipel em modo Node
  (`ELECTRON_RUN_AS_NODE`), então não precisa de Node instalado. O código está em
  `src/main/agentes/`.

Ao contrário do resto de `.organizador`, as conversas crescem com o uso: são o histórico
do que o time fez. Apagar a pasta `conversas` não quebra nada.

## Arquitetura

- **main** (Node) — dono exclusivo do filesystem; toda leitura, escrita e movimentação.
- **preload** — `contextBridge` tipado; roda com `sandbox: true`.
- **renderer** — React + TypeScript, sem `nodeIntegration`. Nunca toca em `fs`.

O contrato entre os três está em `shared/types.ts`. O núcleo que mexe em disco
(`src/main/vault/`) não depende do Electron, o que o deixa testável direto no Node.
