// O Vite embute o worker no pacote quando o import termina em `?worker&inline`.
// Embutido porque o app empacotado abre a tela por `file://`, e worker em
// arquivo separado com essa origem pode ser barrado pelo Chromium.
declare module '*?worker&inline' {
  const ConstrutorDoWorker: new () => Worker
  export default ConstrutorDoWorker
}
