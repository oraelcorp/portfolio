// scripts/capture-preloader.ts — arma una tira de NUESTRO preloader para poder mirarlo junto
// al de la referencia (screenshots/spinner-strip.png). Cada viñeta se etiqueta con el ángulo
// real de los cuatro bloques y el texto del label, no con el reloj de pared: una captura cuesta
// ~150 ms y las marcas de tiempo mentirían sobre una animación de 2 s.
// Salida en screenshots/preloader-strip.png (gitignored).

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4183;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** El indicador va centrado en 1440×900. Mismo recorte que la tira de la referencia. */
const CROP = { x: 660, y: 415, width: 120, height: 70 };

interface Shot {
  png: string;
  caption: string;
}

async function state(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-preloader]');
    if (!el || getComputedStyle(el).display === 'none') return 'overlay fuera';
    const deg = [...el.querySelectorAll<HTMLElement>('[data-block]')].map((b) => {
      const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(b).transform);
      if (!m) return 0;
      const v = (m[1] ?? '').split(',').map(Number);
      return Math.round((Math.atan2(v[1] ?? 0, v[0] ?? 1) * 180) / Math.PI);
    });
    const lab = el.querySelector('[data-loading-label]');
    return `${deg.join('/')}°  "${lab?.textContent ?? ''}"`;
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const preview = startPreview(PORT);
  await sleep(2500);

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: 'commit' });

  const shots: Shot[] = [];
  for (let i = 0; i < 20; i++) {
    const caption = await state(page);
    const buf = await page.screenshot({ clip: CROP });
    shots.push({ png: buf.toString('base64'), caption });
    if (caption === 'overlay fuera') break;
    await sleep(60);
  }
  console.log(`${shots.length} viñetas`);

  const cells = shots
    .map(
      (s) =>
        `<figure><img src="data:image/png;base64,${s.png}"><figcaption>${s.caption}</figcaption></figure>`,
    )
    .join('');

  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#111;font:11px ui-monospace,monospace;color:#bbb;
         display:grid;grid-template-columns:repeat(4,max-content);gap:10px;padding:12px}
    figure{margin:0}
    img{display:block;width:${CROP.width * 3}px;image-rendering:pixelated;outline:1px solid #333}
    figcaption{padding-top:3px;text-align:center}
  </style>${cells}`;

  const strip = await ctx.newPage();
  await strip.setContent(html);
  await strip.waitForLoadState('networkidle');
  await (await strip.$('body'))?.screenshot({ path: join(OUT, 'preloader-strip.png') });

  console.log(`errores de consola: ${errors.length === 0 ? 'ninguno' : errors.join(' | ')}`);
  console.log('→ screenshots/preloader-strip.png');

  await browser.close();
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
