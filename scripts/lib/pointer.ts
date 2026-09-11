// scripts/lib/pointer.ts — coloca el puntero sobre el retrato de forma FIABLE.
//
// Por qué existe: tres sondas distintas han reportado ceros silenciosos (sangría vacía, clics
// perdidos, modo que no cambia) por la misma causa. Lenis sigue interpolando el scroll un rato
// después de `scrollTo(0,0)`, el canvas se mueve bajo un cursor quieto y dispara `pointerleave`,
// así que `hasPointer` queda en false y todo lo que dependa del puntero mide la nada. Un
// usuario real genera `pointermove` continuo y no lo nota; una sonda que mueve el ratón una vez
// y luego mide, sí.
//
// La regla aquí es: confirmar que el motor RECIBIÓ el puntero, y si no, abortar con un mensaje
// que diga qué pasó — nunca devolver un cero que se pueda confundir con un resultado.

import type { Page } from 'playwright';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Enciende el hover del retrato. Bajo automatización nace APAGADO (ver `hover` en
 * `AsciiPortraitGL` y `hero.ts`): es el candado que impide que una sonda tiña el retrato de
 * color sin querer. Este helper es la única puerta, así que una sonda que quiera medir la
 * sangría TIENE que pasar por aquí — que era justo lo que antes se olvidaba.
 */
export async function habilitarHover(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as { __asciiGL?: { habilitarHover?: () => void } }).__asciiGL;
    g?.habilitarHover?.();
  });
}

export interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Deja la página arriba del todo, esperando a que Lenis termine de interpolar. */
export async function asentarScroll(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
}

/** Caja del canvas del retrato en px CSS. */
export async function cajaRetrato(page: Page, selector = '[data-ascii]'): Promise<Caja> {
  return page.evaluate((sel) => {
    const r = document.querySelector<HTMLCanvasElement>(sel)?.getBoundingClientRect();
    return { x: r?.x ?? 0, y: r?.y ?? 0, w: r?.width ?? 0, h: r?.height ?? 0 };
  }, selector);
}

/**
 * Mueve el puntero a una fracción del retrato y NO vuelve hasta confirmar que el motor lo
 * recibió. Lanza si no lo consigue: medir sin puntero no es un resultado, es un fallo de sonda.
 *
 * @param motor 'gl' | '2d' — cuál de las dos instancias hay que consultar.
 */
export async function colocarPuntero(
  page: Page,
  fx: number,
  fy: number,
  motor: 'gl' | '2d' = 'gl',
): Promise<Caja> {
  await asentarScroll(page);
  await habilitarHover(page);
  const caja = await cajaRetrato(page);
  const px = caja.x + caja.w * fx;
  const py = caja.y + caja.h * fy;

  for (let intento = 0; intento < 14; intento++) {
    await page.mouse.move(px + (intento % 2), py, { steps: 8 });
    await sleep(220);
    const ok = await page.evaluate((m) => {
      const inst = (window as unknown as Record<string, { hasPointer?: boolean } | undefined>)[
        m === 'gl' ? '__asciiGL' : '__asciiPortrait'
      ];
      return inst?.hasPointer === true;
    }, motor);
    if (ok) {
      // Un último movimiento exacto para dejarlo centrado en el punto pedido.
      await page.mouse.move(px, py);
      await sleep(200);
      return caja;
    }
    // Puede haberse desplazado la página: se vuelve a asentar antes de reintentar.
    if (intento % 4 === 3) await asentarScroll(page);
  }

  throw new Error(
    `El puntero no llegó al retrato tras 14 intentos (fracción ${fx}, ${fy}). ` +
      'Sin puntero, cualquier medida de sangría, clic o modo sería un cero falso.',
  );
}

/**
 * Igual que `colocarPuntero` pero con coordenadas absolutas de viewport, que es como las
 * tienen las sondas antiguas. Confirma que el motor recibió el puntero antes de devolver.
 */
export async function confirmarPuntero(
  page: Page,
  px: number,
  py: number,
  motor: 'gl' | '2d' = 'gl',
): Promise<void> {
  await habilitarHover(page);
  for (let intento = 0; intento < 14; intento++) {
    await page.mouse.move(px + (intento % 2), py, { steps: 12 });
    await sleep(200);
    const ok = await page.evaluate((m) => {
      const inst = (window as unknown as Record<string, { hasPointer?: boolean } | undefined>)[
        m === 'gl' ? '__asciiGL' : '__asciiPortrait'
      ];
      return inst?.hasPointer === true;
    }, motor);
    if (ok) {
      await page.mouse.move(px, py);
      await sleep(150);
      return;
    }
  }
  throw new Error(`El puntero no llegó al retrato en (${px}, ${py}); la medida sería un cero falso.`);
}
