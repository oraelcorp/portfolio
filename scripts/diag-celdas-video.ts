// scripts/diag-celdas-video.ts — ¿por qué el vídeo dibuja la mitad de celdas que la foto?
//
// Contradicción a resolver (checkpoint A): la luma de la fuente predice ~9 800 celdas con tinta
// para el vídeo (72.8 % vacías de 36 000) y la foto rinde 10 450 reales... pero el vídeo rinde
// 5 906. O el contenido del vídeo varía muchísimo con el tiempo, o el camino del vídeo pierde
// celdas por el camino. Se miden LAS DOS COSAS A LA VEZ y en el mismo instante:
//   predicho — muestreando el frame actual en un canvas 2D con el mismo recorte y curva
//   real     — contando celdas con tinta en el canvas que de verdad se está pintando
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { VentanaSonda } from './lib/motor.ts';

const PORT = 4230;
const OUT = resolve('screenshots', 'nitidez');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const preview = startPreview(PORT);
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

  const L: string[] = [];
  const say = (s = '') => {
    console.log(s);
    L.push(s);
  };
  say('== CELDAS CON TINTA: PREDICHO POR LA FUENTE vs PINTADO DE VERDAD (vídeo) ==');
  say('   t vídeo   predicho   real    real/predicho');

  const pred: number[] = [],
    real: number[] = [];
  for (let i = 0; i < 14; i++) {
    const m = await page.evaluate(() => {
      const COLS = 160,
        ROWS = 225,
        ZOOM = 1.2,
        FX = 0.1,
        FY = 1,
        CONTRAST = 1.4,
        EMPTY = 0.12;
      const c = document.querySelector<HTMLCanvasElement>('[data-ascii]')!;
      const v = (window as VentanaSonda).__asciiGL?.source as HTMLVideoElement;
      const vw = 580,
        vh = 806;
      const cv = document.createElement('canvas');
      cv.width = COLS;
      cv.height = ROWS;
      const x = cv.getContext('2d', { willReadFrequently: true })!;
      const target = COLS / ROWS,
        srcA = vw / vh;
      let w = 1,
        h = 1;
      if (srcA > target) w = target / srcA;
      else h = srcA / target;
      w /= ZOOM;
      h /= ZOOM;
      x.drawImage(v, (1 - w) * FX * vw, (1 - h) * FY * vh, w * vw, h * vh, 0, 0, COLS, ROWS);
      const d = x.getImageData(0, 0, COLS, ROWS).data;
      let predicho = 0;
      for (let k = 0; k < d.length; k += 4) {
        const l = (0.2126 * (d[k] ?? 0) + 0.7152 * (d[k + 1] ?? 0) + 0.0722 * (d[k + 2] ?? 0)) / 255;
        if (Math.max(0, Math.min(1, (l - 0.15) * CONTRAST)) >= EMPTY) predicho++;
      }
      // Real: celdas de 8x8 px de dispositivo con algo dibujado.
      const off = document.createElement('canvas');
      off.width = c.width;
      off.height = c.height;
      const ox = off.getContext('2d', { willReadFrequently: true })!;
      ox.drawImage(c, 0, 0);
      const dd = ox.getImageData(0, 0, c.width, c.height).data;
      let realC = 0;
      for (let cy = 0; cy + 8 <= c.height; cy += 8) {
        for (let cx = 0; cx + 8 <= c.width; cx += 8) {
          let hay = false;
          for (let j = 0; j < 8 && !hay; j++)
            for (let i2 = 0; i2 < 8; i2++) {
              const p = ((cy + j) * c.width + cx + i2) * 4;
              if (0.2126 * (dd[p] ?? 0) + 0.7152 * (dd[p + 1] ?? 0) + 0.0722 * (dd[p + 2] ?? 0) >= 20) {
                hay = true;
                break;
              }
            }
          if (hay) realC++;
        }
      }
      return { t: v.currentTime, predicho, real: realC };
    });
    pred.push(m.predicho);
    real.push(m.real);
    say(
      `   ${m.t.toFixed(2).padStart(7)}   ${String(m.predicho).padStart(8)}   ${String(m.real).padStart(5)}    ${(m.real / Math.max(1, m.predicho)).toFixed(3)}`,
    );
    await sleep(600);
  }
  const med = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  say('');
  say(
    `   media predicho ${med(pred).toFixed(0)} · media real ${med(real).toFixed(0)} · ratio ${(med(real) / med(pred)).toFixed(3)}`,
  );
  say(`   rango real: ${Math.min(...real)} – ${Math.max(...real)}   (la foto rinde 10 450 constantes)`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'celdas-video.txt'), L.join('\n'), 'utf8');
  await b.close();
} finally {
  preview.stop();
}
