// scripts/measure-weight.ts — mide el peso visual del retrato COMPLETO tal y como se publica
// (sobre el build, sin inyectar opciones por ?debug) y lo compara con la referencia.
//
// Fórmula única para ambos, si no la comparación no vale: se binea el canvas con su tamaño de
// celda y se promedia, entre las celdas que tienen tinta, la luminancia por píxel de la celda.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 4184;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Celda medida en la referencia (scripts/measure-grid.ts), en px CSS. */
const REF_CELL = 7.56;

interface Weight {
  filled: number;
  perPixel: number;
  accent: number;
  white: number;
  cols: number;
  rows: number;
}

/** Recorre un ImageData ya cargado en el navegador y devuelve las métricas por celda. */
const CELL_STATS = `(d, w, h, cellPx) => {
  const cols = Math.floor(w / cellPx);
  const rows = Math.floor(h / cellPx);
  let inked = 0, acc = 0, accent = 0, white = 0;

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let ink = 0, r = 0, g = 0, b = 0;
      const x0 = Math.floor(cx * cellPx), y0 = Math.floor(cy * cellPx);
      const x1 = Math.min(w, Math.floor((cx + 1) * cellPx));
      const y1 = Math.min(h, Math.floor((cy + 1) * cellPx));

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const pr = d[i] ?? 0, pg = d[i + 1] ?? 0, pb = d[i + 2] ?? 0;
          const lum = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
          if (lum < 26) continue;
          ink += lum; r += pr * lum; g += pg * lum; b += pb * lum;
        }
      }

      if (ink === 0) continue;
      inked++;
      acc += ink / (cellPx * cellPx);

      const cr = r / ink, cg = g / ink, cb = b / ink;
      const max = Math.max(cr, cg, cb), min = Math.min(cr, cg, cb);
      if (max < 12) continue;
      const sat = (max - min) / max;
      if (sat < 0.18) white++;
      else if (sat > 0.3) accent++;
    }
  }

  return { filled: (inked / (cols * rows)) * 100, perPixel: inked ? acc / inked : 0, accent, white, cols, rows };
}`;

async function measureOurs(page: Page): Promise<Weight> {
  return page.evaluate(async (stats) => {
    const fn = eval(stats) as (d: Uint8ClampedArray, w: number, h: number, c: number) => Weight;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) throw new Error('sin canvas');

    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    // Se usa la celda EFECTIVA del motor, que tras el ajuste a píxel puede no ser la nominal
    const cellPx = 8 * dpr;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return fn(d, canvas.width, canvas.height, cellPx);
  }, CELL_STATS);
}

async function measureReference(page: Page): Promise<Weight> {
  const dataUrl = `data:image/png;base64,${readFileSync(resolve('recon/reference/hero-base-2x.png')).toString('base64')}`;

  return page.evaluate(
    async ({ dataUrl, stats, cellPx }) => {
      const fn = eval(stats) as (d: Uint8ClampedArray, w: number, h: number, c: number) => Weight;
      const img = new Image();
      img.src = dataUrl;
      await img.decode();

      const region = { x: 1688, y: 104, w: 1128, h: 1696 };
      const c = document.createElement('canvas');
      c.width = region.w;
      c.height = region.h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('sin contexto');

      ctx.drawImage(img, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
      const d = ctx.getImageData(0, 0, region.w, region.h).data;
      return fn(d, region.w, region.h, cellPx);
    },
    { dataUrl, stats: CELL_STATS, cellPx: REF_CELL * 2 },
  );
}

function row(label: string, w: Weight): void {
  const hl = w.accent + w.white > 0 ? (w.white / (w.accent + w.white)) * 100 : 0;
  console.log(
    `  ${label.padEnd(30)} grid ${`${w.cols}×${w.rows}`.padEnd(9)} · celdas con tinta ${w.filled.toFixed(1).padStart(5)} % · peso ${w.perPixel.toFixed(1).padStart(5)} · highlights ${hl.toFixed(1).padStart(5)} %`,
  );
}

async function main(): Promise<void> {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(URL)).ok) break;
      } catch {
        /* aún no */
      }
      await sleep(400);
    }

    const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // Sin ?debug: se mide exactamente lo que se publica
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.reveal === '1.000',
      null,
      { timeout: 15_000 },
    );
    await sleep(600);

    const ours = await measureOurs(page);
    await page.goto('about:blank');
    const ref = await measureReference(page);

    console.log('=== Peso visual del retrato completo (misma fórmula para ambos) ===\n');
    row('good-fella.com (referencia)', ref);
    row('nuestro hero (build actual)', ours);

    const ratio = ref.perPixel > 0 ? ours.perPixel / ref.perPixel : 0;
    console.log(`\n  ratio de peso: ×${ratio.toFixed(2)} respecto a la referencia`);
    console.log('  de ese ratio, ×1.73 es inevitable: el verde #39FF6A tiene luminancia 202');
    console.log('  frente a los 117 del naranja #FD551D. El resto viene de la curva de alpha.');
    console.log(`  → exceso atribuible a la curva de alpha: ×${(ratio / 1.73).toFixed(2)}`);

    await browser.close();
  } finally {
    server.kill();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
