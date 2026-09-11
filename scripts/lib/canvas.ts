// scripts/lib/canvas.ts — leer píxeles del retrato SIN medir un estado contaminado.
//
// Es la segunda capa del candado del 2026-09-09. La primera vive en el motor: bajo
// automatización el hover del retrato nace apagado y solo lo enciende `lib/pointer.ts`, así que
// una sonda no puede teñir el retrato de color por accidente. Esta capa es el cinturón: antes de
// medir, comprueba que lo que hay en el canvas es lo que la sonda CREE que hay, y aborta si no.
//
// Por qué hacen falta las dos: la primera impide el accidente, pero el retrato también puede
// estar en color a propósito (un clic, `?glmix`, la onda del color), y una sonda que mida
// «píxeles verdes» sobre un retrato en ámbar no da un error: da un número creíble y falso.
// Cuatro mediciones distintas se fueron por ahí antes de esto.

import type { Page } from 'playwright';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Reparto de color del retrato tal y como está pintado ahora mismo. */
export interface Tinte {
  verde: number;
  calido: number;
  blanco: number;
  modo: string;
  hoverBloqueado: boolean;
}

const TINTE = `(() => {
  const c = document.querySelector('[data-ascii]');
  if (!c || !c.width) return null;
  const off = document.createElement('canvas');
  off.width = c.width; off.height = c.height;
  const x = off.getContext('2d', { willReadFrequently: true });
  x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let verde = 0, calido = 0, blanco = 0;
  for (let i = 0; i < d.length; i += 4) {
    const R = d[i], G = d[i + 1], B = d[i + 2];
    if (R + G + B < 60) continue;
    if (G > R * 1.3 && G > B * 1.3) verde++;
    else if (R > G * 1.15 && R > B * 1.3) calido++;
    else blanco++;
  }
  return {
    verde, calido, blanco,
    modo: c.dataset.glMode || '(sin poner)',
    hoverBloqueado: c.dataset.glHoverBloqueado === '1',
  };
})()`;

export async function tinteRetrato(page: Page): Promise<Tinte | null> {
  return (await page.evaluate(TINTE)) as Tinte | null;
}

/**
 * Exige que el retrato esté en ASCII antes de medir. Lanza si encuentra color, con el motivo
 * probable: no vale devolver un número que parece bueno.
 *
 * @param donde  Etiqueta para el mensaje: qué se iba a medir.
 * @param maxCalidos  Margen. La región de acento del hocico pinta unos pocos píxeles cálidos
 *   incluso en ASCII, así que exigir cero sería un falso positivo.
 */
export async function exigirAscii(page: Page, donde: string, maxCalidos = 500): Promise<void> {
  const t = await tinteRetrato(page);
  if (!t) throw new Error(`${donde}: no hay canvas de retrato que medir.`);
  if (t.calido > maxCalidos) {
    throw new Error(
      `${donde}: el retrato está en COLOR (${t.calido} píxeles cálidos, modo "${t.modo}"), ` +
        'no en ASCII. Medir aquí daría un número creíble y falso. ' +
        'Causas habituales: un clic previo, ?glmix, o la sangría del hover.',
    );
  }
}

/**
 * Avisa si alguien movió el puntero sobre el retrato con el hover bloqueado. Sirve para que una
 * sonda que mida sangría y saque CERO pueda decir por qué salió cero, en vez de reportarlo como
 * si el efecto estuviera roto — que es exactamente el fallo que este candado no quiere repetir
 * en otra forma.
 */
export async function avisarSiHoverBloqueado(page: Page, donde: string): Promise<void> {
  const t = await tinteRetrato(page);
  if (t?.hoverBloqueado) {
    throw new Error(
      `${donde}: se movió el puntero sobre el retrato pero el hover está BLOQUEADO ` +
        '(bajo automatización nace apagado). Cualquier medida de sangría saldría cero. ' +
        'Usa `colocarPuntero`/`confirmarPuntero` de lib/pointer.ts, que lo enciende.',
    );
  }
}

/** Aparta el puntero y espera a que la sangría se apague del todo (constante de caída 4.5). */
export async function apartarPuntero(page: Page): Promise<void> {
  await page.mouse.move(5, 5);
  await page.evaluate(() => {
    document.querySelector('[data-ascii]')?.dispatchEvent(new PointerEvent('pointerleave'));
  });
  await sleep(1600);
}
