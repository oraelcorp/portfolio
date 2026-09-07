// scripts/make-og.ts — genera public/img/og.jpg (1200×630) fotografiando NUESTRO propio hero.
// Fase 5, bloque 3.
//
// Por qué generarla y no dejarla pendiente: las meta la referencian, y sin archivo cada vez
// que alguien comparta el enlace sale una tarjeta rota. No es un asset de terceros (§10.6):
// es una captura de la página que ya construimos, hecha por código.
//
// Es un PLACEHOLDER: §7 la tiene en la lista de assets que dará Javier. Cuando llegue la
// definitiva, se sobrescribe este archivo y ya está — las meta no cambian.

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 4214;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('public', 'img', 'og.jpg');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      /* aún no */
    }
    await sleep(400);
  }
  throw new Error(`El preview no respondió en ${URL}`);
}

async function main(): Promise<void> {
  mkdirSync(resolve('public', 'img'), { recursive: true });
  const preview = startPreview(PORT);
  await waitForServer();

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  // 1200×630 es el tamaño que piden las tarjetas. Se renderiza a esa medida exacta en vez de
  // recortar de un ancho mayor: así el layout se adapta y el texto no queda cortado a la mitad.
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 } });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });

  // La onda de entrada del retrato dura 3.2 s: sin esperarla saldría a medio dibujar
  await page
    .waitForFunction(
      () => Number(document.querySelector<HTMLElement>('[data-ascii]')?.dataset.reveal ?? '0') >= 0.999,
      null,
      { timeout: 15_000 },
    )
    .catch(() => console.warn('  aviso: la onda no llegó al final, se captura igual'));
  await sleep(900);

  // El nav flota sobre el hero y en una tarjeta social no aporta: es navegación, no contenido.
  // El indicador de scroll tampoco tiene sentido en una imagen fija.
  await page.evaluate(() => {
    for (const sel of ['.nav', '[data-scroll-hint]', '.hero__hint']) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) el.style.visibility = 'hidden';
    }
  });
  await sleep(300);

  await page.screenshot({ path: OUT, type: 'jpeg', quality: 88 });

  const bytes = await page.evaluate(async () => (await fetch('/img/portrait/portrait.png')).ok);
  console.log(`→ ${OUT}  (retrato accesible: ${bytes})`);

  await browser.close();
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
