import type { Idioma } from '@shared/types'

/**
 * Os textos da interface.
 *
 * O português é a fonte da verdade e o inglês é tipado a partir dele (`typeof
 * PT`), então esquecer uma chave na tradução não compila. Sem isso a falta só
 * apareceria como `undefined` no meio de um botão, e provavelmente só depois de
 * publicado.
 *
 * O vocabulário do app foi escolhido antes do inglês existir, e a tradução
 * mantém a metáfora inteira em vez de traduzir palavra a palavra: ilha vira
 * *island*, ponte vira *bridge*, mapa vira *map*, diário vira *journal*. Um
 * "notes" no lugar de *journal* seria mais comum e diria menos.
 */

const PT = {
  // Boas-vindas
  bemVindoTitulo: 'Archipel',
  bemVindoTexto:
    'Escolha uma pasta para ser o seu mapa. As pastas de projeto que estiverem lá dentro viram ilhas.',
  escolherMapa: 'Escolher pasta do mapa',

  // Topo
  trocarDeMapa: 'Trocar de mapa',
  adicionarPasta: 'Adicionar pasta',
  recarregar: 'Recarregar',
  modoConexao: 'Modo conexão (L)',
  esconderLista: 'Esconder a lista (Ctrl+B)',
  mostrarLista: 'Mostrar a lista (Ctrl+B)',
  esconderListaRotulo: 'Esconder a barra lateral',
  mostrarListaRotulo: 'Mostrar a barra lateral',
  contagem: (ilhas: number, pontes: number) =>
    `${ilhas} ${ilhas === 1 ? 'ilha' : 'ilhas'} · ${pontes} ${pontes === 1 ? 'ponte' : 'pontes'}`,

  // Lateral
  buscar: 'Buscar pasta ou diário…',
  nadaEncontrado: 'Nada encontrado.',
  contagemLista: (visiveis: number, total: number) => `${visiveis} de ${total} ilhas`,
  limpeParaReordenar: ' · limpe o filtro para reordenar',
  pastasComATag: (n: number) => `${n} pasta(s)`,
  pastaSumiu: 'Nenhuma pasta com este nome no mapa — só uma ligação apontando para cá',
  seloAusente: 'ausente',
  dicaDoItem: (caminho: string) =>
    `${caminho}\n\nDuplo clique abre no Explorer.\nArraste para o mapa para posicionar, sobre outro item para reordenar, ou para fora da janela para tirar do mapa.`,

  // Painel de detalhes
  acoes: 'Ações',
  explorer: 'Explorer',
  vsCode: 'VS Code',
  terminal: 'Terminal',
  copiarCaminho: 'Copiar caminho',
  tirarDoMapa: 'Tirar do mapa…',
  tags: 'Tags',
  novaTag: 'nova tag',
  semTags: 'sem tags',
  removerTag: (tag: string) => `Remover a tag ${tag}`,
  sobrescreverCor: 'Sobrescrever a cor da tag',
  adicionar: 'Adicionar',
  cor: 'Cor',
  usarCorDaTag: 'Usar a cor da tag',
  pontes: (n: number) => `Pontes (${n})`,
  semPontes: 'Nenhuma. Ligue o',
  semPontesModo: 'modo conexão',
  semPontesFim: 'e clique de uma pasta a outra.',
  derrubarPonte: 'Derrubar esta ponte',
  diario: 'Diário',
  diarioVazio: 'Para que serve esta pasta? Use [[NomeDaPasta]] para ligar com outra.',
  diarioDica: 'Salva ao sair do campo. As',
  diarioDicaLigacoes: 'ligações',
  diarioDicaFim: 'daqui viram as pontes do mapa.',
  aberta: 'Aberta',
  nuncaAberta: 'nenhuma vez por aqui',
  noMapa: 'No mapa',
  desdeSempre: 'desde sempre',
  fechar: 'Fechar',
  renomearDica: 'Clique duas vezes para renomear',
  pastaAusente:
    'Esta ilha só existe como ligação: nenhuma pasta com este nome está no mapa. Traga a pasta para o mapa ou apague a ligação que aponta para cá.',

  // Menus
  abrirNoExplorer: 'Abrir no Explorer',
  abrirNoVsCode: 'Abrir no VS Code',
  abrirTerminalAqui: 'Abrir terminal aqui',
  soltarPosicao: 'Soltar posição fixada',
  apagarPasta: 'Excluir ilha…',
  criarPastaAqui: 'Criar pasta aqui',
  adicionarExistente: 'Adicionar pasta existente…',
  abrirTerminalNoMapa: 'Abrir terminal no mapa',
  menuDoMapa: 'Mapa',

  // Soltar pastas vindas do Explorer
  soltarTitulo: 'Solte para mover para o mapa',
  soltarDestino: (raiz: string) => `As pastas passam a viver em ${raiz}`,
  mapaVazioTitulo: 'O mapa está vazio.',
  mapaVazioTexto: 'Arraste pastas do Explorer para cá — elas passam a viver em',

  // Mapa
  dicaDoMapa: 'arraste uma ilha para fixá-la ·',
  dicaDoMapaAlt: '+ clique solta · duplo clique abre a pasta · arraste da lista para posicionar',
  enquadrar: 'Centralizar a visão nas ilhas (Home)',
  enquadrarRotulo: 'Centralizar a visão nas ilhas',

  // Faixas
  entendi: 'entendi',
  dispensar: 'dispensar',
  sair: 'sair',
  modoConexaoLigado: 'Modo conexão ligado — clique na primeira pasta e depois na segunda.',
  conectandoDe: (nome: string) => `Conectando a partir de "${nome}" — clique na outra pasta.`,
  desfazer: 'Desfazer',
  desfazerMovimentacao: (nome: string) => `Última movimentação: ${nome}`,
  modoConexaoAtivo: 'Modo conexão: clique de uma ilha até outra para criar a ponte.',
  atualizacaoPronta: (versao: string) =>
    `Archipel ${versao} foi baixado e será instalado quando você fechar o app.`,
  carregando: 'Carregando…',

  // Terminal embutido
  terminalAlternar: "Terminal (Ctrl+')",
  terminalTitulo: 'Terminal',
  terminalNovaAba: 'Nova aba (na ilha selecionada)',
  terminalFecharAba: 'Fechar aba',
  terminalEsconder: "Esconder o terminal (Ctrl+')",
  abrirNoTerminalEmbutido: 'Abrir no terminal do Archipel',

  // Agentes
  agentes: 'Agentes',
  agentesAlternar: 'Time de agentes',
  agentesVazio:
    'Nenhum agente ainda. Um agente é um Claude ou um Gemini com nome, função e uma pasta de trabalho. Eles passam tarefas uns aos outros.',
  agenteNovo: 'Novo agente',
  agenteNovoNaIlha: 'Novo agente nesta ilha',
  agenteNome: 'Nome',
  agenteNomeAjuda: 'Minúsculas, números, - e _. É o nome que os outros usam no --para.',
  agenteMotor: 'Motor',
  agenteModelo: 'Modelo',
  agenteModeloAjuda: 'Vazio = o padrão do motor',
  agenteIlha: 'Trabalha na ilha',
  agenteRaiz: '(raiz do mapa)',
  agenteFuncao: 'Função',
  agenteFuncaoAjuda: 'O que ele faz e como. Os colegas veem a primeira linha.',
  agenteSalvar: 'Salvar',
  agenteCancelar: 'Cancelar',
  agenteIniciar: 'Abrir sessão',
  agenteEditar: 'Editar',
  agenteApagar: 'Apagar',
  agenteApagarPergunta: (nome: string) => `Apagar o agente ${nome}? As conversas dele ficam.`,
  agenteStatus: {
    parado: 'parado',
    sessao: 'em sessão',
    trabalhando: 'trabalhando',
    terminou: 'terminou',
    falhou: 'falhou'
  },
  conversas: 'Conversas',
  conversasVazio:
    'Nenhuma conversa ainda. Abra a sessão de um agente e peça para ele passar uma tarefa a um colega.',
  conversaTarefa: 'Tarefa',
  conversaResposta: 'Resposta',
  conversaEsperando: 'Esperando a resposta…',
  conversaVoce: 'você',
  conversaParar: 'Parar',
  conversaContinuar: 'Continuar conversa',
  conversaContinuarAjuda: (agente: string) =>
    `Abre uma aba com ${agente}, de onde ele parou nesta conversa`,
  notificacaoTerminou: (agente: string) => `${agente} terminou a tarefa`,
  notificacaoFalhou: (agente: string) => `${agente} não conseguiu terminar a tarefa`,

  // Configurações
  configuracoes: 'Configurações',
  tema: 'Tema',
  temas: {
    padrao: { nome: 'Padrão', descricao: 'Cinza escuro, como sempre foi.' },
    kanagawa: {
      nome: 'Kanagawa',
      descricao: 'Gravura japonesa: papel creme e azul da onda.'
    },
    'kanagawa-noite': {
      nome: 'Kanagawa noite',
      descricao: 'A mesma gravura, num mar azul-noite.'
    }
  }
}

const EN: typeof PT = {
  bemVindoTitulo: 'Archipel',
  bemVindoTexto: 'Choose a folder to be your map. The project folders inside it become islands.',
  escolherMapa: 'Choose the map folder',

  trocarDeMapa: 'Switch map',
  adicionarPasta: 'Add folder',
  recarregar: 'Reload',
  modoConexao: 'Bridge mode (L)',
  esconderLista: 'Hide the list (Ctrl+B)',
  mostrarLista: 'Show the list (Ctrl+B)',
  esconderListaRotulo: 'Hide the sidebar',
  mostrarListaRotulo: 'Show the sidebar',
  contagem: (ilhas: number, pontes: number) =>
    `${ilhas} ${ilhas === 1 ? 'island' : 'islands'} · ${pontes} ${pontes === 1 ? 'bridge' : 'bridges'}`,

  buscar: 'Search folder or journal…',
  nadaEncontrado: 'Nothing found.',
  contagemLista: (visiveis: number, total: number) => `${visiveis} of ${total} islands`,
  limpeParaReordenar: ' · clear the filter to reorder',
  pastasComATag: (n: number) => `${n} folder(s)`,
  pastaSumiu: 'No folder by this name on the map — just a link pointing here',
  seloAusente: 'missing',
  dicaDoItem: (caminho: string) =>
    `${caminho}\n\nDouble-click opens it in Explorer.\nDrag to the map to place it, onto another item to reorder, or out of the window to take it off the map.`,

  acoes: 'Actions',
  explorer: 'Explorer',
  vsCode: 'VS Code',
  terminal: 'Terminal',
  copiarCaminho: 'Copy path',
  tirarDoMapa: 'Remove from map…',
  tags: 'Tags',
  novaTag: 'new tag',
  semTags: 'no tags',
  removerTag: (tag: string) => `Remove the tag ${tag}`,
  sobrescreverCor: 'Override the tag color',
  adicionar: 'Add',
  cor: 'Color',
  usarCorDaTag: 'Use the tag color',
  pontes: (n: number) => `Bridges (${n})`,
  semPontes: 'None. Turn on',
  semPontesModo: 'bridge mode',
  semPontesFim: 'and click from one folder to another.',
  derrubarPonte: 'Tear down this bridge',
  diario: 'Journal',
  diarioVazio: 'What is this folder for? Use [[FolderName]] to link to another one.',
  diarioDica: 'Saved when you leave the field. The',
  diarioDicaLigacoes: 'links',
  diarioDicaFim: 'in here become the bridges on the map.',
  aberta: 'Opened',
  nuncaAberta: 'never from here',
  noMapa: 'On the map',
  desdeSempre: 'since forever',
  fechar: 'Close',
  renomearDica: 'Double-click to rename',
  pastaAusente:
    'This island only exists as a link: no folder by this name is on the map. Bring the folder onto the map or delete the link pointing here.',

  abrirNoExplorer: 'Open in Explorer',
  abrirNoVsCode: 'Open in VS Code',
  abrirTerminalAqui: 'Open terminal here',
  soltarPosicao: 'Release pinned position',
  apagarPasta: 'Delete island…',
  criarPastaAqui: 'Create folder here',
  adicionarExistente: 'Add existing folder…',
  abrirTerminalNoMapa: 'Open terminal at the map',
  menuDoMapa: 'Map',

  soltarTitulo: 'Drop to move onto the map',
  soltarDestino: (raiz: string) => `The folders will live in ${raiz}`,
  mapaVazioTitulo: 'The map is empty.',
  mapaVazioTexto: 'Drag folders here from Explorer — they will live in',

  dicaDoMapa: 'drag an island to pin it ·',
  dicaDoMapaAlt: '+ click releases · double-click opens the folder · drag from the list to place',
  enquadrar: 'Center the view on the islands (Home)',
  enquadrarRotulo: 'Center the view on the islands',

  entendi: 'got it',
  dispensar: 'dismiss',
  sair: 'exit',
  modoConexaoLigado: 'Bridge mode is on — click the first folder, then the second.',
  conectandoDe: (nome: string) => `Bridging from "${nome}" — click the other folder.`,
  desfazer: 'Undo',
  desfazerMovimentacao: (nome: string) => `Last move: ${nome}`,
  modoConexaoAtivo: 'Bridge mode: click from one island to another to build the bridge.',
  atualizacaoPronta: (versao: string) =>
    `Archipel ${versao} has been downloaded and will install when you close the app.`,
  carregando: 'Loading…',

  terminalAlternar: "Terminal (Ctrl+')",
  terminalTitulo: 'Terminal',
  terminalNovaAba: 'New tab (in the selected island)',
  terminalFecharAba: 'Close tab',
  terminalEsconder: "Hide the terminal (Ctrl+')",
  abrirNoTerminalEmbutido: 'Open in the Archipel terminal',

  agentes: 'Agents',
  agentesAlternar: 'Agent team',
  agentesVazio:
    'No agents yet. An agent is a Claude or a Gemini with a name, a role and a working folder. They hand tasks to each other.',
  agenteNovo: 'New agent',
  agenteNovoNaIlha: 'New agent on this island',
  agenteNome: 'Name',
  agenteNomeAjuda: 'Lowercase, digits, - and _. Others use it in --para.',
  agenteMotor: 'Engine',
  agenteModelo: 'Model',
  agenteModeloAjuda: "Empty = the engine's default",
  agenteIlha: 'Works on island',
  agenteRaiz: '(map root)',
  agenteFuncao: 'Role',
  agenteFuncaoAjuda: 'What it does and how. Teammates see the first line.',
  agenteSalvar: 'Save',
  agenteCancelar: 'Cancel',
  agenteIniciar: 'Open session',
  agenteEditar: 'Edit',
  agenteApagar: 'Delete',
  agenteApagarPergunta: (nome: string) => `Delete agent ${nome}? Its conversations stay.`,
  agenteStatus: {
    parado: 'idle',
    sessao: 'in session',
    trabalhando: 'working',
    terminou: 'done',
    falhou: 'failed'
  },
  conversas: 'Conversations',
  conversasVazio:
    "No conversations yet. Open an agent's session and ask it to hand a task to a teammate.",
  conversaTarefa: 'Task',
  conversaResposta: 'Answer',
  conversaEsperando: 'Waiting for the answer…',
  conversaVoce: 'you',
  conversaParar: 'Stop',
  conversaContinuar: 'Continue conversation',
  conversaContinuarAjuda: (agente: string) =>
    `Opens a tab with ${agente}, where it left off in this conversation`,
  notificacaoTerminou: (agente: string) => `${agente} finished the task`,
  notificacaoFalhou: (agente: string) => `${agente} could not finish the task`,

  configuracoes: 'Settings',
  tema: 'Theme',
  temas: {
    padrao: { nome: 'Default', descricao: 'Dark gray, as it has always been.' },
    kanagawa: {
      nome: 'Kanagawa',
      descricao: 'Japanese woodblock: cream paper and wave blue.'
    },
    'kanagawa-noite': {
      nome: 'Kanagawa night',
      descricao: 'The same print, on a night-blue sea.'
    }
  }
}

const TRADUCOES = { pt: PT, en: EN }

export type Textos = typeof PT

export function textosDe(idioma: Idioma): Textos {
  return TRADUCOES[idioma]
}
