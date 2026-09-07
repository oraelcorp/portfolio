// scripts/compare-palette.ts — Fase 8, parte 1(d): compara el modo color con el RGB literal
// de la foto frente a las paletas diseñadas, en el MISMO frame y con el mismo estado interno.
//
// El mismo frame importa: el shimmer cambia glifos cada 120 ms, así que dos capturas tomadas
// con segundos de diferencia no son comparables aunque la paleta fuera idéntica. Aquí se
// cambia la paleta con `setPalette()`, que repinta en el sitio sin tocar nada más.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4222;
const URL = `http://localhost:${PORT}/?debug`;
const OUT = resolve('screenshots', 'palette');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const MODOS = [
  ['photo', 'RGB literal de la foto (actual)'],
  ['bands', 'bandas planas (Otsu k=4)'],
  ['ramp', 'rampa continua (mismas anclas)'],
] as const;

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
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  await waitForServer();
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page: Page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
  await page
    .waitForFunction(
      () => Number(document.querySelector<HTMLElement>('[data-ascii]')?.dataset.reveal ?? '0') >= 0.999,
      null,
      { timeout: 15_000 },
    )
    .catch(() => console.warn('  aviso: la onda no terminó'));
  await sleep(600);

  // Al modo color, y esperar a que acabe el crossfade
  await page.evaluate(() => {
    const w = window as unknown as { __asciiPortrait?: { toggleMode: () => void } };
    w.__asciiPortrait?.toggleMode();
  });
  await sleep(1600);

  // El shimmer se congela para que los tres recortes sean el MISMO frame
  await page.evaluate(() => {
    const w = window as unknown as { __asciiPortrait?: { reduced: boolean } };
    if (w.__asciiPortrait) w.__asciiPortrait.reduced = true;
  });
  await sleep(200);

  const caja = await page.locator('[data-ascii]').boundingBox();
  if (!caja) throw new Error('sin canvas');

  const hocico = await page.evaluate(() => {
    const w = window as unknown as { __asciiPortrait?: { hocico: Uint8Array } };
    const h = w.__asciiPortrait?.hocico;
    return h ? Array.from(h).filter((v) => v === 1).length : 0;
  });
  console.log(`celdas marcadas como hocico: ${hocico}`);

  for (const [modo, titulo] of MODOS) {
    await page.evaluate((m) => {
      const w = window as unknown as { __asciiPortrait?: { setPalette: (x: string) => void } };
      w.__asciiPortrait?.setPalette(m);
    }, modo);
    await sleep(400);
    await page.screenshot({ path: join(OUT, `modo-${modo}.png`), clip: caja });

    // Cuánto color hay DE VERDAD en lo pintado. "Pardo apagado" es una impresión; esto la
    // convierte en dos números: saturación media y dispersión CIRCULAR del tono (los tonos
    // son ángulos, así que promediarlos como escalares se rompe al cruzar 0°/360°).
    const m = await page.evaluate(() => {
      const cv = document.querySelector<HTMLCanvasElement>('[data-ascii]');
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return { sat: 0, disp: 0, n: 0 };
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      let sSat = 0;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < d.length; i += 4) {
        const a = (d[i + 3] ?? 0) / 255;
        if (a < 0.35) continue; // píxeles de tinta, no el antialias del borde del glifo
        const r = (d[i] ?? 0) / 255;
        const g = (d[i + 1] ?? 0) / 255;
        const b = (d[i + 2] ?? 0) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const dd = max - min;
        if (max < 0.08) continue;
        const sat = max === 0 ? 0 : dd / max;
        let h = 0;
        if (dd > 0) {
          if (max === r) h = ((g - b) / dd) % 6;
          else if (max === g) h = (b - r) / dd + 2;
          else h = (r - g) / dd + 4;
          h *= 60;
          if (h < 0) h += 360;
        }
        const rad = (h * Math.PI) / 180;
        // Ponderado por saturación: el tono de un gris no significa nada
        sx += Math.cos(rad) * sat;
        sy += Math.sin(rad) * sat;
        sSat += sat;
        n++;
      }
      if (n === 0) return { sat: 0, disp: 0, n: 0 };
      const R = Math.hypot(sx, sy) / Math.max(sSat, 1e-6);
      // 1 - R: 0 = todo el mismo tono, 1 = tonos repartidos por la rueda
      return { sat: sSat / n, disp: 1 - R, n };
    });
    console.log(
      `  → modo-${modo}.png  ${titulo}
` +
        `       saturación media ${m.sat.toFixed(3)} · dispersión de tono ${m.disp.toFixed(3)} · ${m.n} píxeles de tinta`,
    );
  }

  await browser.close();
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
