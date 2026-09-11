// scripts/lib/acento.ts — reconocer el ACENTO en una captura sin dar por hecho de qué color es.
//
// Hasta el 2026-09-10 media docena de sondas distinguían "ASCII" de "color" preguntando si el
// canal VERDE mandaba, porque el acento del sitio era `#39FF6A`. Al mover la marca a guinda eso
// deja de significar nada: el acento pasa a ser rojo-dominante, igual que la paleta cálida del
// modo color, y las sondas dejan de poder separar los dos modos — no porque el retrato falle,
// sino porque el criterio estaba atado a un color concreto.
//
// La regla buena no mira el tono: compara la PROPORCIÓN entre canales contra el acento que el
// sitio tenga puesto en ese momento, leído de su token. Así sobrevive al siguiente cambio de
// marca, que es lo que la auditoría del acento dejó claro que hace falta.

/** Expresión para `page.evaluate`: devuelve el acento vigente como [r,g,b] 0-255. */
export const LEER_ACENTO = `(() => {
  const sonda = document.createElement('span');
  sonda.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent-ascii').trim()
    || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  document.body.appendChild(sonda);
  const m = getComputedStyle(sonda).color.match(/\\d+/g) || ['0', '0', '0'];
  sonda.remove();
  return [Number(m[0]), Number(m[1]), Number(m[2])];
})()`;

/**
 * Trozo de código, listo para incrustar dentro de un `page.evaluate`, que define
 * `esAcento(R, G, B)` a partir de un `ACC` que ya esté en el ámbito.
 *
 * El umbral 0.16 sale de la separación real entre el acento y la paleta cálida del retrato: los
 * tonos de la rampa que más se le acercan quedan por encima de 0.30 en esta distancia.
 */
export const ES_ACENTO_FN = `
  const _an = (() => { const m = Math.max(ACC[0], ACC[1], ACC[2]) || 1; return [ACC[0] / m, ACC[1] / m, ACC[2] / m]; })();
  const esAcento = (R, G, B) => {
    const m = Math.max(R, G, B) || 1;
    return Math.abs(R / m - _an[0]) + Math.abs(G / m - _an[1]) + Math.abs(B / m - _an[2]) < 0.16;
  };
`;
