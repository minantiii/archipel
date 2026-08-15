import { relative, resolve } from 'node:path'

/**
 * Perguntas sobre caminhos, respondidas sem tocar no disco.
 *
 * Vivem fora do `move.ts` porque o histórico também precisa comparar raízes, e
 * um módulo pequeno e puro é mais fácil de importar dos dois lados do que
 * arrastar a movimentação inteira junto.
 */

/** `true` se `filho` está dentro de `pai` (ou é o próprio). Case-insensitive no Windows. */
export function contem(pai: string, filho: string): boolean {
  const normalizar = (p: string): string =>
    process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p)

  const caminho = relative(normalizar(pai), normalizar(filho))
  return caminho === '' || (!caminho.startsWith('..') && !/^[a-z]:/i.test(caminho))
}

/**
 * `true` quando os dois apontam para o mesmo lugar.
 *
 * Sai de `contem` nos dois sentidos em vez de comparar texto: assim herda de
 * graça o `resolve` e a insensibilidade a maiúsculas do Windows, onde
 * `C:\Mapa` e `c:\mapa\` são a mesma pasta.
 */
export function mesmoCaminho(a: string, b: string): boolean {
  return contem(a, b) && contem(b, a)
}
