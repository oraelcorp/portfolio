// scripts/capture-bleed.ts — compara el retrato en reposo, con la sangría de color bajo el
// cursor, y con el modo color completo (clic). Recorta la zona del cursor para que se aprecie.
// Salida: screenshots/bleed-compare.png y screenshots/bleed.webm (gitignored).

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4199;
const URL = `http://localhost:${PORT}/?debug`;
const OUT = resolve('screenshots');
const TMP = resolve('screenshots', '.bleed-video');
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

/** Movimiento a ritmo humano; los `steps` de Playwright cruzan la pantalla en dos frames. */
async function glide(p: Page, x0: number, y0: number, x1: number, y1: number, ms: number): Promise<void> {
  const n = Math.max(2, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await p.mouse.move(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e);
    await sleep(16);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const preview = startPreview(PORT);
  await waitForServer();

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: TMP, size: { width: 1440, height: 900 } },
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
  await page.waitForFunction(
    () => Number(document.querySelector('[data-ascii]')?.getAttribute('data-reveal') ?? 0) >= 1,
    null,
    { timeout: 20_000 },
  );
  await sleep(800);

  const box = await page.evaluate(() => {
    const c = document.querySelector('[data-ascii]');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
  if (!box) throw new Error('sin canvas');

  // La cabeza del jaguar: es donde el spec sitúa el origen de la onda y donde hay ámbar.
  const hx = box.x + Math.round(box.w * 0.3);
  const hy = box.y + Math.round(box.h * 0.36);
  const clip = { x: hx - 150, y: Math.max(0, hy - 130), width: 300, height: 260 };

  const cells: string[] = [];
  const shot = async (label: string): Promise<void> => {
    const buf = await page.screenshot({ clip });
    cells.push(
      `<figure><img src="data:image/png;base64,${buf.toString('base64')}"><figcaption>${label}</figcaption></figure>`,
    );
  };

  await page.mouse.move(40, 780);
  await sleep(1500);
  await shot('reposo · monocromo de acento');

  await glide(page, 40, 780, hx, hy, 700);
  await sleep(1500);
  await shot('sangría bajo el cursor (hover)');

  // Modo color completo, para comparar hasta dónde puede llegar el color
  await page.mouse.move(40, 780);
  await sleep(1500);
  await page.evaluate(() => document.querySelector<HTMLElement>('[data-ascii-toggle]')?.click());
  await sleep(1600);
  await shot('modo color completo (clic)');
  await page.evaluate(() => document.querySelector<HTMLElement>('[data-ascii-toggle]')?.click());
  await sleep(1600);

  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0d0d0d;font:11px ui-monospace,monospace;color:#ccc;padding:12px}
    h2{font-size:12px;font-weight:400;color:#39ff6a;margin:0 0 8px}
    .row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:1000px}
    figure{margin:0} img{display:block;width:100%;outline:1px solid #2a2a2a;image-rendering:pixelated}
    figcaption{padding-top:4px;text-align:center;color:#8a8a8a}
  </style>
  <h2>Sangría de color: se derrama desde el cursor y se frena en los bordes del jaguar</h2>
  <div class="row">${cells.join('')}</div>`;
  const out = await ctx.newPage();
  await out.setContent(html);
  await out.waitForLoadState('networkidle');
  await (await out.$('body'))?.screenshot({ path: join(OUT, 'bleed-compare.png') });
  await out.close();

  // Vídeo: el derrame se juzga en movimiento, no en fotogramas sueltos.
  for (const [tx, ty] of [
    [hx, hy],
    [box.x + Math.round(box.w * 0.55), box.y + Math.round(box.h * 0.55)],
    [box.x + Math.round(box.w * 0.35), box.y + Math.round(box.h * 0.7)],
  ] as const) {
    await glide(page, 40, 780, tx, ty, 900);
    await sleep(1400);
    await glide(page, tx, ty, 40, 780, 900);
    await sleep(900);
  }

  await page.close();
  await ctx.close();
  await browser.close();

  const file = readdirSync(TMP).find((f) => f.endsWith('.webm'));
  if (file) {
    const dest = join(OUT, 'bleed.webm');
    rmSync(dest, { force: true });
    renameSync(join(TMP, file), dest);
    console.log('→ screenshots/bleed.webm');
  }
  rmSync(TMP, { recursive: true, force: true });
  console.log(`errores de consola: ${errors.length === 0 ? 'ninguno' : errors.join(' | ')}`);
  console.log('→ screenshots/bleed-compare.png');
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
