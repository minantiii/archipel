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
  contagem: (ilhas: number, pontes: number) =>
    `${ilhas} ${ilhas === 1 ? 'ilha' : 'ilhas'} · ${pontes} ${pontes === 1 ? 'ponte' : 'pontes'}`,

  // Lateral
  buscar: 'Buscar pasta ou diário…',
  nadaEncontrado: 'Nada encontrado.',
  contagemLista: (visiveis: number, total: number) => `${visiveis} de ${total} ilhas`,
  limpeParaReordenar: ' · limpe o filtro para reordenar',
  pastasComATag: (n: number) => `${n} pasta(s)`,
  pastaSumiu: 'Esta pasta não existe mais no disco',
  seloAusente: 'ausente',
  dicaDoItem: (caminho: string) =>
    `${caminho}\n\nDuplo clique abre no Explorer.\nArraste para o mapa para posicionar, ou sobre outro item para reordenar.`,

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
    'Esta pasta não existe mais no disco. Os metadados continuam guardados — se ela voltar para o mapa com o mesmo nome, tudo se religa sozinho.',

  // Menus
  abrirNoExplorer: 'Abrir no Explorer',
  abrirNoVsCode: 'Abrir no VS Code',
  abrirTerminalAqui: 'Abrir terminal aqui',
  soltarPosicao: 'Soltar posição fixada',
  apagarPasta: 'Apagar pasta…',
  criarPastaAqui: 'Criar pasta aqui',
  adicionarExistente: 'Adicionar pasta existente…',
  abrirTerminalNoMapa: 'Abrir terminal no mapa',

  // Mapa
  dicaDoMapa: 'arraste uma ilha para fixá-la ·',
  dicaDoMapaAlt: '+ clique solta · duplo clique abre a pasta · arraste da lista para posicionar',
  enquadrar: 'Centralizar a visão nas ilhas (Home)',
  enquadrarRotulo: 'Centralizar a visão nas ilhas',

  // Faixas
  entendi: 'entendi',
  desfazer: 'Desfazer',
  desfazerMovimentacao: (nome: string) => `Última movimentação: ${nome}`,
  modoConexaoAtivo: 'Modo conexão: clique de uma ilha até outra para criar a ponte.',
  atualizacaoPronta: (versao: string) =>
    `Archipel ${versao} foi baixado e será instalado quando você fechar o app.`,
  carregando: 'Carregando…'
}

const EN: typeof PT = {
  bemVindoTitulo: 'Archipel',
  bemVindoTexto:
    'Choose a folder to be your map. The project folders inside it become islands.',
  escolherMapa: 'Choose the map folder',

  trocarDeMapa: 'Switch map',
  adicionarPasta: 'Add folder',
  recarregar: 'Reload',
  modoConexao: 'Bridge mode (L)',
  contagem: (ilhas: number, pontes: number) =>
    `${ilhas} ${ilhas === 1 ? 'island' : 'islands'} · ${pontes} ${pontes === 1 ? 'bridge' : 'bridges'}`,

  buscar: 'Search folder or journal…',
  nadaEncontrado: 'Nothing found.',
  contagemLista: (visiveis: number, total: number) => `${visiveis} of ${total} islands`,
  limpeParaReordenar: ' · clear the filter to reorder',
  pastasComATag: (n: number) => `${n} folder(s)`,
  pastaSumiu: 'This folder no longer exists on disk',
  seloAusente: 'missing',
  dicaDoItem: (caminho: string) =>
    `${caminho}\n\nDouble-click opens it in Explorer.\nDrag to the map to place it, or onto another item to reorder.`,

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
    'This folder no longer exists on disk. Its metadata is still kept — if it comes back to the map under the same name, everything reconnects on its own.',

  abrirNoExplorer: 'Open in Explorer',
  abrirNoVsCode: 'Open in VS Code',
  abrirTerminalAqui: 'Open terminal here',
  soltarPosicao: 'Release pinned position',
  apagarPasta: 'Delete folder…',
  criarPastaAqui: 'Create folder here',
  adicionarExistente: 'Add existing folder…',
  abrirTerminalNoMapa: 'Open terminal at the map',

  dicaDoMapa: 'drag an island to pin it ·',
  dicaDoMapaAlt: '+ click releases · double-click opens the folder · drag from the list to place',
  enquadrar: 'Center the view on the islands (Home)',
  enquadrarRotulo: 'Center the view on the islands',

  entendi: 'got it',
  desfazer: 'Undo',
  desfazerMovimentacao: (nome: string) => `Last move: ${nome}`,
  modoConexaoAtivo: 'Bridge mode: click from one island to another to build the bridge.',
  atualizacaoPronta: (versao: string) =>
    `Archipel ${versao} has been downloaded and will install when you close the app.`,
  carregando: 'Loading…'
}

const TRADUCOES = { pt: PT, en: EN }

export type Textos = typeof PT

export function textosDe(idioma: Idioma): Textos {
  return TRADUCOES[idioma]
}
