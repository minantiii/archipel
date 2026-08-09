/**
 * Separação entre ilhas fixadas.
 *
 * O `forceCollide` da simulação resolve a sobreposição entre ilhas soltas, mas
 * não entre as fixadas: o d3 reescreve `x`/`y` a partir de `fx`/`fy` a cada
 * tick, então força nenhuma move uma ilha presa. Duas fixadas no mesmo ponto
 * ficam empilhadas para sempre — uma some literalmente dentro da outra.
 *
 * Por isso a separação das fixadas é resolvida na hora de fixar, aqui, e não
 * pela simulação.
 */

/** O mínimo que a separação precisa saber de uma ilha. */
export interface IlhaPosicionavel {
  id: string
  grau: number
  fx?: number
  fy?: number
}

export function raioDaIlha(ilha: IlhaPosicionavel): number {
  // Cresce com o número de pontes, mas satura: um hub não pode virar um planeta.
  return 6 + Math.min(ilha.grau, 10) * 1.4
}

/**
 * Respiro entre as bordas de duas ilhas fixadas, em unidades do mapa.
 *
 * Só o suficiente para as bolinhas não se encostarem — bem menos que o raio do
 * `forceCollide`, que reserva espaço para o rótulo também. Aqui o usuário
 * apontou um lugar de propósito, e afastar 150px do ponto escolhido para caber
 * um nome comprido seria desobedecer o gesto. Rótulos podem se cruzar; corpos, não.
 */
const FOLGA = 6

/**
 * Quantas vezes reavaliar todas as vizinhas.
 *
 * Empurrar para longe de uma pode encostar em outra, então é preciso repassar.
 * O teto existe porque num aglomerado apertado as correções podem ficar
 * empurrando de um lado para o outro sem convergir; a última posição já está
 * bem melhor que a original, e é a que vale.
 */
const MAX_PASSADAS = 24

/** Direção estável para desempatar quando o ponto cai no centro exato da outra. */
function anguloDeDesempate(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return (hash % 360) * (Math.PI / 180)
}

/**
 * Devolve o ponto mais próximo de (`x`, `y`) onde `alvo` pode ser fixada sem
 * entrar em nenhuma outra ilha **já fixada**.
 *
 * As livres são ignoradas de propósito: a simulação as tira do caminho sozinha,
 * e desviar delas faria o mesmo gesto cair em lugares diferentes conforme o
 * mapa ainda estivesse se acomodando.
 */
export function posicaoLivre(
  alvo: IlhaPosicionavel,
  x: number,
  y: number,
  ilhas: Iterable<IlhaPosicionavel>
): { x: number; y: number } {
  const fixadas = [...ilhas].filter(
    (i) => i.id !== alvo.id && i.fx !== undefined && i.fy !== undefined
  )
  if (fixadas.length === 0) return { x, y }

  const raioAlvo = raioDaIlha(alvo)
  let px = x
  let py = y

  for (let passada = 0; passada < MAX_PASSADAS; passada++) {
    let encostou = false

    for (const outra of fixadas) {
      const ox = outra.fx as number
      const oy = outra.fy as number
      const minimo = raioAlvo + raioDaIlha(outra) + FOLGA

      let dx = px - ox
      let dy = py - oy
      let distancia = Math.hypot(dx, dy)
      if (distancia >= minimo) continue

      encostou = true
      if (distancia < 1e-6) {
        // Soltou bem no centro da outra: não há direção para empurrar. O ângulo
        // vem do id para o mesmo gesto dar sempre o mesmo resultado.
        const angulo = anguloDeDesempate(alvo.id)
        dx = Math.cos(angulo)
        dy = Math.sin(angulo)
        distancia = 1
      }

      px = ox + (dx / distancia) * minimo
      py = oy + (dy / distancia) * minimo
    }

    if (!encostou) break
  }

  return { x: px, y: py }
}
