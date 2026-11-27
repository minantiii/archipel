# Roadmap do Archipel

Plano vivo: marque `[x]` quando um item ficar pronto e testado. Ideia nova entra
em **Ideias soltas** até ganhar lugar numa fase.

Última revisão: 27/11/2026.

---

## Decisões em aberto

Respondê-las define a ordem das fases.

- [ ] **Para que o Archipel serve primeiro?** Mapa para organizar pastas, ou o
      lugar de onde se abrem e acompanham as sessões do Claude? As fases 2 e 3
      só fazem sentido no segundo caso.
- [ ] **O ai-memory (Fabio Akita) fica?** Depende do teste da fase 1. Se ficar,
      o item 3.3 só mostra a wiki dele em vez de criar uma memória própria.

---

## Feito

### Mapa reescrito sem React (27/11/2026)

- [x] Física num Web Worker (`src/renderer/src/mapa/simulacao.worker.ts`)
- [x] Desenho em WebGL com PixiJS (`src/renderer/src/mapa/motor.ts`)
- [x] `Palco.tsx` virou só a casca React; hover, arraste e zoom não re-renderizam nada
- [x] Removida a `react-force-graph-2d`
- [x] Zoom suave pela roda e inércia ao soltar o arraste do mapa
- [x] Física pausa com a janela escondida
- [x] Janela abre maximizada
- [x] Mão fechada ao arrastar o mapa (o sistema de eventos do PixiJS sobrescrevia o cursor)
- [x] Ilhas boiam devagar em volta do próprio lugar (só desenho; param no hover e no arraste)
- [x] Instalado no lugar do `.exe` antigo

### Temas (27/11/2026)

- [x] Engrenagem no topo abre Configurações, com a escolha de tema (salva na máquina)
- [x] Tema Kanagawa (gravura de Hokusai): papel creme, ondas seigaiha, nanquim, pontes em pincelada
- [x] Tema Kanagawa noite: a mesma gravura num mar azul-noite
- [x] Botões de janela do Windows mudam de cor com o tema
- [x] Tirada a dica de rodapé do mapa

### Terminal embutido e exclusão de ilha — v0.1.4 (27/11/2026)

- [x] Terminal embutido no rodapé do mapa (xterm.js + `node-pty`, PowerShell 7 quando houver)
  - Código: `src/main/terminal.ts` (shell) e `src/renderer/src/components/PainelTerminal.tsx` (painel)
  - `Ctrl+'` ou botão no topo mostra/esconde; abas com `+`; arrastar a borda muda a altura
  - Nasce na pasta da ilha selecionada (ou na raiz); menu da ilha tem "Abrir no terminal do Archipel"
  - Ocupa só o espaço entre a lista e o painel da ilha; cores seguem o tema
  - `node-pty` vai fora do `.asar` (`asarUnpack` no `electron-builder.yml`)
- [x] Mapa não pisca nem some mais ao redimensionar a lista ou o terminal
- [x] "Excluir ilha…" (menu e painel): pasta para a Lixeira e nenhum rastro: apaga o `.md`
      e as `[[pontes]]` que chegavam nela; também exclui ilha fantasma
- [x] Dica: `claude -r` na lista tem a opção de mostrar as sessões de todas as pastas
      (não copiar sessões entre pastas: a retomada roda na pasta errada)

### Mapa de pastas (27/11/2026)

- [x] Pastas da área de trabalho trazidas para o `mapa-trabalho`
- [x] Tags, descrição de uma linha e pontes em todas as ilhas
- [x] Pontes só dentro do mesmo grupo; posições destravadas para o mapa se acomodar

---

## Fase 0: pendências

- [ ] Testar no app instalado o que não foi testado automaticamente: arrastar
      para fixar, Alt+clique, duplo clique, menu do botão direito, soltar da lista
- [x] Publicar a versão 0.1.4 (terminal embutido, excluir ilha, sem piscar)
- [x] Commit das mudanças (sem coautoria; PR só com título)
- [x] Publicar a versão 0.1.3 no GitHub, para a atualização automática levar o mapa novo
- [x] Copiar as memórias do Claude presas nos caminhos antigos `Desktop\...`
      para os caminhos novos em `Documents\mapa-trabalho\...` (11 pastas, 87
      arquivos; caminhos internos atualizados; originais mantidos)

## Fase 1: teste do ai-memory

Memória automática entre sessões. Repositório: <https://github.com/akitaonrails/ai-memory>.

- [ ] Instalar e ligar só no Claude Code
- [ ] Usar por uma semana nos chamados
- [ ] Conferir se os ganchos funcionam no Windows nativo (o suporte é experimental)
- [ ] Manter só local: nada de servidor compartilhado sem aval da empresa
- [ ] Decidir: fica, vai para o WSL2, ou sai

## Fase 2: o Archipel abre as sessões

- [x] **2.1 Abrir terminal**: opções no menu da ilha
  - [x] "Abrir terminal aqui": Windows Terminal na pasta da ilha (já existia)
  - [x] "Abrir no terminal do Archipel": aba do terminal embutido na pasta da ilha
  - [x] Plano B quando o Windows Terminal não estiver instalado (cai no PowerShell)
- [ ] **2.2 Editor de `CLAUDE.md` na ilha**
  - [ ] Aba no painel de detalhes mostrando o `CLAUDE.md` da pasta
  - [ ] Criar o arquivo quando ele não existir
  - [ ] Salvar com a mesma proteção do diário (não perder o que foi digitado)
  - [ ] Marca na ilha indicando que ela tem `CLAUDE.md`

## Fase 3: o Archipel acompanha as sessões

- [ ] **3.1 Status do Claude na ilha**
  - [ ] Gancho do Claude Code (início, Stop, Notification) grava o status por pasta
  - [ ] O Archipel observa e mostra na ilha: trabalhando / terminou / esperando você
  - [ ] "Não lido" até você abrir a ilha
  - [ ] Conviver com o gancho de som que já existe (ver hooks via Git Bash na memória)
- [ ] **3.2 Sessões da ilha e busca**
  - [ ] Listar as conversas da pasta (lidas de `~/.claude/projects/`), com data e primeira mensagem
  - [ ] Botão "retomar" (`claude -r <id>` na pasta certa)
  - [ ] Busca por palavra em todas as conversas, levando à ilha e à sessão
- [ ] **3.3 Memória da ilha**: mostrar e editar o que o Claude lembra do projeto
      (ou a wiki do ai-memory, conforme a fase 1)

## Fase 4: trabalho do dia a dia

- [ ] **4.1 Git na ilha**
  - [ ] Branch atual
  - [ ] Marca de mudanças sem commit e de atraso em relação ao remoto
  - [ ] Botão "atualizar todos" (pull nos repositórios do mapa)
- [ ] **4.2 Portas na ilha**: servidor rodando naquela pasta (`:5173`), com clique para abrir
- [ ] **4.3 Tarefa do TaskHub na ilha**: ligar a ilha a uma issue (BERLIM-xxx) e abrir com um clique

## Fase 5: o mapa

- [ ] **5.1 Ctrl+K**: digitar o nome e pular para a ilha, ou abrir a pasta
- [ ] **5.2 Mar por tag**: mancha de cor suave atrás de cada grupo

## Temas: próximos passos

- [ ] **T.1 Escolher o tema ao instalar**
  - [ ] Decidir onde: numa tela do instalador, ou na primeira vez que o app abre
  - [ ] Dá para trocar depois em Configurações
- [ ] **T.2 Criar o próprio tema**
  - [ ] Editor em Configurações: cores do fundo, painéis, texto, destaque e pontes
  - [ ] Ver o mapa mudando enquanto edita
  - [ ] Salvar com nome e trocar entre os temas criados
  - [ ] Exportar/importar o tema como arquivo, para passar para outra pessoa
- [ ] **T.3 Imagem de fundo (wallpaper)**
  - [ ] Escolher uma imagem do computador para o fundo do mapa
  - [ ] Ajustar escurecer/clarear e desfoque, para as ilhas continuarem legíveis
  - [ ] Funciona com qualquer tema (por cima do papel ou do cinza)
  - [ ] A imagem é copiada para a pasta do app (não quebra se o original sumir)

## Fase 6: time de agentes (inspirado no OpenBot)

Agentes separados das ilhas (não é "cada ilha um agente"). Referência:
<https://openbot.run/>. Licença PolyForm Noncommercial: copiar ideias, nunca código.

Decisões antes de começar:
- [ ] Como o agente aparece no mapa (ex.: barcos que navegam até a ilha onde trabalham)
- [ ] O agente roda dentro do Archipel (o terminal embutido já existe) ou no Windows Terminal
- [ ] Como o celular alcança o PC: só no Wi-Fi local, ou de fora (precisa de túnel e aval da empresa)

- [ ] **6.1 Time de agentes conversando entre si**
  - [ ] Criar agente com nome, função e pasta de trabalho
  - [ ] Um agente passa tarefa e arquivos para outro
  - [ ] Ver a conversa entre eles e poder parar ou reassumir
- [ ] **6.2 Rotinas automáticas**
  - [ ] Agendar uma tarefa para um agente (diária, semanal, horário)
  - [ ] Rodar mesmo com a janela fechada (Archipel na bandeja)
  - [ ] Histórico do que cada rotina fez
- [ ] **6.3 App no celular**
  - [ ] Ver o status dos agentes e o mapa
  - [ ] Mandar tarefa e responder quando um agente pedir você
  - [ ] Notificação quando terminar

## Ideias soltas

- [ ] Terminal: com uma ilha selecionada, abrir o terminal ir sempre para a aba dela
      (por ora o Gabriel preferiu deixar como está)

## Fora do plano (de propósito)

- Plugins/marketplace e troca automática de provedor de IA (só usamos o Claude).
- Cada ilha ser um agente (descartado: as ilhas continuam sendo só pastas).
- "Abrir Claude aqui" (aba já rodando `claude`): descartado pelo Gabriel.
