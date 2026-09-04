// scripts/compare-type.ts — compara variantes tipográficas del retrato para decidir con imágenes.
// Cada variante se construye instanciando AsciiPortrait sobre un canvas de prueba con opciones
// distintas, de modo que solo cambia la tipografía y todo lo demás queda igual.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4183;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots', 'type');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Variant {
  name: string;
  title: string;
  note: string;
  opts: Record<string, unknown>;
}

const JB = '"JetBrains Mono", ui-monospace, monospace';

const VARIANTS: Variant[] = [
  {
    name: '1-actual',
    title: 'ACTUAL (antes del fix)',
    note: 'fontSize 7.56 = celda · sin ajuste a píxel · estirado ×1.67',
    opts: { fontFamily: JB, cellW: 7.56, cellH: 7.56, fontSize: 7.56, pixelSnap: false, stretch: true },
  },
  {
    name: '2-fix-1y2',
    title: 'FIX 1+2 — glifo ajustado + píxel entero',
    note: 'fontSize auto (la tinta cabe) · celda a px de dispositivo · estirado',
    opts: { fontFamily: JB, cellW: 7.56, cellH: 7.56, fontSize: 0, pixelSnap: true, stretch: true },
  },
  {
    name: '3-fix-sin-estirar',
    title: 'FIX 1+2 SIN ESTIRAR',
    note: 'igual, pero sin deformar el glifo en X (celda no cuadrada de facto)',
    opts: { fontFamily: JB, cellW: 7.56, cellH: 7.56, fontSize: 0, pixelSnap: true, stretch: false },
  },
  {
    name: '4-silkscreen',
    title: 'SILKSCREEN (fuente pixel)',
    note: 'tiene los 36 glifos pero NO es monoespaciada: avances desiguales',
    opts: {
      fontFamily: 'Silkscreen, monospace',
      cellW: 8,
      cellH: 8,
      fontSize: 8,
      pixelSnap: true,
      stretch: false,
    },
  },
];

/** Aplica opciones al retrato REAL del hero y devuelve el canvas como PNG. */
async function render(page: Page, opts: Record<string, unknown>): Promise<string> {
  return page.evaluate(async (opts) => {
    const w = globalThis as unknown as {
      __asciiPortrait?: { update: (o: Record<string, unknown>) => void };
    };
    if (!w.__asciiPortrait) throw new Error('el retrato no está expuesto (¿falta ?debug?)');

    w.__asciiPortrait.update(opts);
    await new Promise((r) => setTimeout(r, 400));

    const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]');
    return canvas ? canvas.toDataURL() : '';
  }, opts);
}

/** Luminancia media por píxel con tinta: el mismo criterio usado sobre la referencia. */
async function weigh(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return { perPixel: 0, cell: '?', font: '?', stretch: '?' };

    const m = (globalThis as unknown as { __asciiPortrait?: { metrics?: Record<string, number> } })
      .__asciiPortrait?.metrics;
    const cellPx = (m?.cw ?? 8) * (canvas.width / canvas.getBoundingClientRect().width);

    const w = canvas.width;
    const h = canvas.height;
    const d = ctx.getImageData(0, 0, w, h).data;

    // MISMA fórmula que verify-color-mapping.ts sobre la referencia: media, entre las celdas
    // que tienen tinta, de (tinta de la celda / área de la celda). Solo así son comparables.
    const cols = Math.floor(w / cellPx);
    const rows = Math.floor(h / cellPx);
    let inked = 0;
    let acc = 0;

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        let ink = 0;
        const x0 = Math.floor(cx * cellPx);
        const y0 = Math.floor(cy * cellPx);
        const x1 = Math.min(w, Math.floor((cx + 1) * cellPx));
        const y1 = Math.min(h, Math.floor((cy + 1) * cellPx));
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * w + x) * 4;
            const lum = 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
            if (lum < 26) continue;
            ink += lum;
          }
        }
        if (ink > 0) {
          inked++;
          acc += ink / (cellPx * cellPx);
        }
      }
    }

    return {
      perPixel: inked > 0 ? acc / inked : 0,
      cell: m ? `${m.cw?.toFixed(2)}×${m.ch?.toFixed(2)}` : '?',
      font: m ? (m.fs?.toFixed(2) ?? '?') : '?',
      stretch: m ? (m.stretchX?.toFixed(2) ?? '?') : '?',
    };
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);

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
    await page.goto(`${URL}?debug`, { waitUntil: 'load' });
    await page.addStyleTag({ content: '.ascii-debug{display:none}' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await sleep(800);

    const panels: Array<{ title: string; note: string; img: string }> = [];

    console.log('  peso visual — referencia medida: 23.1 luminancia media por píxel\n');

    for (const v of VARIANTS) {
      const img = await render(page, v.opts);
      const w = await weigh(page);
      panels.push({ title: v.title, note: v.note, img });
      console.log(
        `  ${v.name.padEnd(20)} celda ${w.cell}  ·  fuente ${w.font} px  ·  estirado ×${w.stretch}  ·  peso ${w.perPixel.toFixed(1).padStart(5)}  (desvío ${(w.perPixel - 23.1 >= 0 ? '+' : '') + (w.perPixel - 23.1).toFixed(1)})`,
      );
    }

    // Composición lado a lado, más un detalle ampliado del hocico para juzgar la nitidez
    await page.setViewportSize({ width: 1900, height: 1120 });
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
      <style>
        body{margin:0;background:#141314;color:#eee;font:12px/1.45 ui-monospace,monospace;
             display:flex;gap:18px;padding:20px}
        figure{margin:0;display:grid;gap:8px;align-content:start}
        img{display:block;height:760px;width:auto;border:1px solid rgba(238,238,238,.14);background:#0c0b0c}
        h2{margin:0;font-size:12px;font-weight:500;letter-spacing:-.02em}
        p{margin:0;color:#818081;max-width:420px}
      </style>
      ${panels
        .map((p) => `<figure><img src="${p.img}"><h2>${p.title}</h2><p>${p.note}</p></figure>`)
        .join('')}`,
      { waitUntil: 'load' },
    );
    await sleep(700);
    await page.screenshot({ path: join(OUT, 'comparativa.png'), fullPage: true });
    console.log('\n  screenshots/type/comparativa.png');

    // Y un zoom al 300 % de la misma región en cada variante
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
      <style>
        body{margin:0;background:#141314;color:#eee;font:12px/1.45 ui-monospace,monospace;
             display:flex;gap:18px;padding:20px}
        figure{margin:0;display:grid;gap:8px}
        .box{width:420px;height:420px;overflow:hidden;border:1px solid rgba(238,238,238,.14);background:#0c0b0c}
        .box img{transform:scale(3);transform-origin:34% 42%;image-rendering:pixelated}
        h2{margin:0;font-size:12px;font-weight:500}
      </style>
      ${panels.map((p) => `<figure><div class="box"><img src="${p.img}"></div><h2>${p.title}</h2></figure>`).join('')}`,
      { waitUntil: 'load' },
    );
    await sleep(700);
    await page.screenshot({ path: join(OUT, 'zoom-300.png'), fullPage: true });
    console.log('  screenshots/type/zoom-300.png');

    await browser.close();
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
