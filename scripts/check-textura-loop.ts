// scripts/check-textura-loop.ts — ¿la ganancia elegida aguanta TODO el loop, o solo los dos
// fotogramas del barrido? `sweep-gain.ts` eligió 1.5 midiendo el instante más oscuro y el más
// claro; esto recorre el clip entero reproduciéndose y mide textura y celdas a lo largo de él,
// contra el ancla del Canvas 2D calibrado (textura 25.02).
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { VentanaSonda } from './lib/motor.ts';

const PORT = 4238;
const OUT = resolve('screenshots', 'gain');
const ANCLA_2D = 25.1;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const guardian = setTimeout(
  () => {
    console.error('FATAL: tope de tiempo');
    process.exit(1);
  },
  6 * 60 * 1000,
);
guardian.unref?.();

const MEDIR = `(() => {
  const c = document.querySelector('[data-ascii]');
  const v = window.__asciiGL.source;
  const off = document.createElement('canvas');
  off.width = c.width; off.height = c.height;
  const x = off.getContext('2d', { willReadFrequently: true });
  x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, cols = Math.floor(W / 8), rows = Math.floor(c.height / 8);
  const cel = new Float64Array(cols * rows);
  let celdas = 0;
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    let suma = 0, mx = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const p = ((cy * 8 + j) * W + cx * 8 + i) * 4;
      const l = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
      suma += l; if (l > mx) mx = l;
    }
    cel[cy * cols + cx] = suma / 64;
    if (mx >= 20) celdas++;
  }
  let dif = 0, n = 0;
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx + 1 < cols; cx++) {
    const a = cel[cy * cols + cx], b = cel[cy * cols + cx + 1];
    if (a < 4 && b < 4) continue;
    dif += Math.abs(a - b); n++;
  }
  return { t: v.currentTime, celdas, textura: n > 0 ? dif / n : 0 };
})()`;

const preview = startPreview(PORT);
const L: string[] = [];
const say = (s = ''): void => {
  console.log(s);
  L.push(s);
};
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
    } catch {
      /* aún no */
    }
    await sleep(400);
  }
  const b = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => (document.querySelector('[data-ascii]') as HTMLElement)?.dataset.glReveal === '1.000',
    null,
    { timeout: 40_000 },
  );

  // Fuera el puntero: la sangría del hover tiñe el retrato de color y falsea la medida.
  await page.mouse.move(5, 5);
  await page.evaluate(() => {
    document.querySelector('[data-ascii]')?.dispatchEvent(new PointerEvent('pointerleave'));
  });
  await sleep(1600);

  say(`== TEXTURA A LO LARGO DEL LOOP · ancla del Canvas 2D calibrado: ${ANCLA_2D} ==`);
  for (const g of [1.0, 1.2, 1.4, 1.6]) {
    await page.evaluate((gg) => {
      const m = (window as VentanaSonda).__asciiGL;
      if (m) m.gainOverride = gg;
    }, g);
    await sleep(600);
    const tex: number[] = [],
      cel: number[] = [];
    say('');
    say(`   ganancia ${g.toFixed(1)}`);
    say('     t      celdas   textura   vs ancla');
    for (let i = 0; i < 14; i++) {
      const m = (await page.evaluate(MEDIR)) as { t: number; celdas: number; textura: number };
      tex.push(m.textura);
      cel.push(m.celdas);
      say(
        `   ${m.t.toFixed(2).padStart(5)}   ${String(m.celdas).padStart(6)}   ${m.textura.toFixed(2).padStart(7)}   ${(m.textura - ANCLA_2D >= 0 ? '+' : '') + (m.textura - ANCLA_2D).toFixed(2)}`,
      );
      await sleep(500);
    }
    const med = (a: number[]): number => a.reduce((p, c) => p + c, 0) / a.length;
    say(
      `   media: celdas ${med(cel).toFixed(0)} · textura ${med(tex).toFixed(2)} · mín ${Math.min(...tex).toFixed(2)} · máx ${Math.max(...tex).toFixed(2)}`,
    );
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'textura-loop.txt'), L.join('\n'), 'utf8');
  await b.close();
} catch (e) {
  // Sin este catch, el process.exit del finally se traga el error y la sonda muere en silencio.
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
