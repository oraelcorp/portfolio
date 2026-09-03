// scripts/tune-highlights.ts — calibra `smooth` y `highlightDelta` contra la proporción MEDIDA
// en la referencia, en vez de a ojo.
//
// En good-fella.com (verify-color-mapping.ts, captura DPR 2): de las celdas con color,
// 1131 son de acento y 357 blancas → el 24.0 % de la tinta con color son highlights.
// Aquí se barren combinaciones y se clasifica NUESTRO canvas con el mismo criterio de
// saturación, para elegir los parámetros que reproducen esa proporción.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4178;
const URL = `http://localhost:${PORT}/?debug`;
const OUT = resolve('screenshots', 'tune');
const CLIP = { x: 792, y: 0, width: 648, height: 900 };
const TARGET = 24.0; // % de highlights sobre la tinta con color, medido en la referencia
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const COMBOS: Array<{ smooth: number; hlDelta: number }> = [
  { smooth: 0, hlDelta: 0.25 },
  { smooth: 0.6, hlDelta: 0.25 },
  { smooth: 0.6, hlDelta: 0.18 },
  { smooth: 1.0, hlDelta: 0.18 },
  { smooth: 1.0, hlDelta: 0.12 },
  { smooth: 1.5, hlDelta: 0.12 },
  { smooth: 1.5, hlDelta: 0.08 },
  { smooth: 2.0, hlDelta: 0.08 },
];

async function setSlider(page: Page, label: string, value: number): Promise<void> {
  await page.evaluate(
    ({ label, value }) => {
      const rows = [...document.querySelectorAll('.ascii-debug__row')];
      const row = rows.find((r) => r.querySelector('span')?.textContent?.trim() === label);
      const input = row?.querySelector('input');
      if (!input) throw new Error(`Slider no encontrado: ${label}`);
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { label, value },
  );
}

/**
 * Clasificación POR CELDA, idéntica a la de verify-color-mapping.ts sobre la referencia:
 * color medio ponderado por tinta y umbral de saturación. Contar por píxel no sería comparable —
 * el antialiasing y los distintos alfas de base y highlight sesgan el recuento.
 */
async function classifyOurs(page: Page, cell: number) {
  return page.evaluate((cellPx) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;

    const w = canvas.width;
    const h = canvas.height;
    const d = ctx.getImageData(0, 0, w, h).data;

    const cols = Math.floor(w / cellPx);
    const rows = Math.floor(h / cellPx);
    let accent = 0;
    let white = 0;
    let other = 0;

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        let ink = 0;
        let r = 0;
        let g = 0;
        let b = 0;

        const x0 = Math.floor(cx * cellPx);
        const y0 = Math.floor(cy * cellPx);
        const x1 = Math.min(w, Math.floor((cx + 1) * cellPx));
        const y1 = Math.min(h, Math.floor((cy + 1) * cellPx));

        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * w + x) * 4;
            const pr = d[i] ?? 0;
            const pg = d[i + 1] ?? 0;
            const pb = d[i + 2] ?? 0;
            const lum = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
            if (lum < 26) continue;
            ink += lum;
            r += pr * lum;
            g += pg * lum;
            b += pb * lum;
          }
        }

        if (ink === 0) continue;
        r /= ink;
        g /= ink;
        b /= ink;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max < 12) continue;

        const sat = (max - min) / max;
        if (sat < 0.18) white++;
        else if (sat > 0.3 && g === max) accent++;
        else other++;
      }
    }

    return { accent, white, other };
  }, cell);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
      } catch {
        /* aún no */
      }
      await sleep(400);
    }

    const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
    await sleep(1800);
    await page.addStyleTag({ content: '.ascii-debug{visibility:hidden}' });

    console.log(`objetivo: ${TARGET.toFixed(1)} % de highlights (medido en good-fella.com)\n`);
    const results: Array<{ smooth: number; hlDelta: number; pct: number }> = [];

    for (const c of COMBOS) {
      await setSlider(page, 'smooth', c.smooth);
      await setSlider(page, 'hlDelta', c.hlDelta);
      await sleep(600);

      const r = await classifyOurs(page, 7.56);
      if (!r) continue;

      const total = r.accent + r.white;
      const pct = total > 0 ? (r.white / total) * 100 : 0;
      results.push({ ...c, pct });

      const name = `smooth${c.smooth}-hl${c.hlDelta}`;
      await page.screenshot({ path: join(OUT, `${name}.png`), clip: CLIP });
      console.log(
        `  smooth ${c.smooth.toFixed(1)} · hlDelta ${c.hlDelta.toFixed(2)} → ${pct.toFixed(1)} % highlights  (acento ${r.accent} · blanco ${r.white})  desvío ${(pct - TARGET >= 0 ? '+' : '') + (pct - TARGET).toFixed(1)}`,
      );
    }

    results.sort((a, b) => Math.abs(a.pct - TARGET) - Math.abs(b.pct - TARGET));
    const best = results[0];
    if (best) {
      console.log(
        `\nMás cercano al objetivo: smooth ${best.smooth} · highlightDelta ${best.hlDelta} → ${best.pct.toFixed(1)} %`,
      );
    }

    await browser.close();
  } finally {
    server.kill();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
