// scripts/compare-grid.ts — renderiza nuestro retrato con distintas densidades de celda
// y captura cada una, para decidir con imágenes (no con teoría) qué grid adoptar tras medir
// el de la referencia en 7.56 × 7.56 px (ver scripts/measure-grid.ts).

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4177;
const URL = `http://localhost:${PORT}/?debug`;
const OUT = resolve('screenshots', 'grid');
const CLIP = { x: 792, y: 0, width: 648, height: 900 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Variant {
  name: string;
  cellW: number;
  cellH: number;
  fontSize: number;
  note: string;
}

const VARIANTS: Variant[] = [
  { name: 'a-actual-8x12-f11', cellW: 8, cellH: 12, fontSize: 11, note: 'lo que hay hoy' },
  {
    name: 'b-cuadrada-7.5-f11',
    cellW: 7.5,
    cellH: 7.5,
    fontSize: 11,
    note: 'celda de la referencia, fuente actual',
  },
  {
    name: 'c-cuadrada-7.5-f7',
    cellW: 7.5,
    cellH: 7.5,
    fontSize: 7,
    note: 'celda de la referencia, fuente ajustada al alto',
  },
  {
    name: 'd-densa-6x9-f8',
    cellW: 6,
    cellH: 9,
    fontSize: 8,
    note: 'misma densidad que la referencia, proporción de texto',
  },
  { name: 'e-densa-6x9-f10', cellW: 6, cellH: 9, fontSize: 10, note: 'igual pero con glifo más grueso' },
];

/** Mueve un slider del panel de debug por su etiqueta. */
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

    // El panel de debug estorba en la captura del retrato, pero no se puede quitar: se oculta.
    await page.addStyleTag({ content: '.ascii-debug{visibility:hidden}' });

    for (const v of VARIANTS) {
      // fontSize primero: cambiar cellW/cellH fuerza el re-muestreo completo
      await setSlider(page, 'fontSize', v.fontSize);
      await setSlider(page, 'cellW', v.cellW);
      await setSlider(page, 'cellH', v.cellH);
      await sleep(700);

      const info = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
        return { frameMs: c?.dataset.frameMs ?? '—' };
      });

      await page.screenshot({ path: join(OUT, `${v.name}.png`), clip: CLIP });
      console.log(
        `  ${v.name}.png — ${v.note} (celda ${v.cellW}×${v.cellH}, fuente ${v.fontSize}px, ${info.frameMs} ms)`,
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
