// scripts/side-by-side.ts — compone nuestro retrato terminado junto al de la referencia,
// al mismo viewport y a la misma escala, para revisarlos de un vistazo.
// Salida en screenshots/ (gitignored). Las capturas de referencia son solo de comparación
// local: ningún asset de terceros entra en el build (§10.6).

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Región del retrato en cada sitio, en px CSS a 1440 de ancho. */
const REF_CROP = { x: 844, y: 52, w: 564, h: 848 };
const OURS_CLIP = { x: 792, y: 0, width: 648, height: 900 };

function dataUrl(file: string): string {
  return `data:image/png;base64,${readFileSync(resolve(file)).toString('base64')}`;
}

async function compose(page: Page, panels: Array<{ title: string; sub: string; img: string }>, out: string) {
  await page.setViewportSize({ width: 1560, height: 1000 });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
    <style>
      body{margin:0;background:#141314;color:#eee;font:13px/1.4 ui-monospace,monospace;
           display:flex;gap:24px;padding:24px;align-items:flex-start}
      figure{margin:0;display:grid;gap:10px}
      img{display:block;height:880px;width:auto;border:1px solid rgba(238,238,238,.14)}
      h2{margin:0;font-size:13px;font-weight:500;letter-spacing:-.02em;text-transform:uppercase}
      p{margin:0;color:#818081}
    </style>
    ${panels.map((p) => `<figure><img src="${p.img}"><h2>${p.title}</h2><p>${p.sub}</p></figure>`).join('')}`,
    { waitUntil: 'load' },
  );
  await sleep(600);
  await page.screenshot({ path: join(OUT, out), fullPage: true });
  console.log(`  screenshots/${out}`);
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
        if ((await fetch(URL)).ok) break;
      } catch {
        /* aún no */
      }
      await sleep(400);
    }

    const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.reveal === '1.000',
      null,
      { timeout: 15_000 },
    );
    await sleep(600);

    // Modo ASCII
    const asciiShot = await page.screenshot({ clip: OURS_CLIP });
    // Modo color: clic en el canvas y esperar al crossfade
    await page.click('[data-ascii]', { position: { x: 300, y: 500 } });
    await sleep(1400);
    const colorShot = await page.screenshot({ clip: OURS_CLIP });

    const ours = `data:image/png;base64,${asciiShot.toString('base64')}`;
    const oursColor = `data:image/png;base64,${colorShot.toString('base64')}`;

    // Recorte equivalente de la referencia
    await page.goto('about:blank');
    const refCropped = await page.evaluate(
      async ({ url, crop }) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = crop.w;
        c.height = crop.h;
        c.getContext('2d')?.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
        return c.toDataURL();
      },
      { url: dataUrl('recon/reference/hero-base.png'), crop: REF_CROP },
    );

    await compose(
      page,
      [
        {
          title: 'Referencia — good-fella.com',
          sub: 'celda 7.56 × 7.56 (medida) · acento base + blanco en bordes',
          img: refCropped,
        },
        {
          title: 'Nuestro hero — modo ASCII',
          sub: 'celda 7.56 × 7.56 · jaguar propio · verde base + blanco en bordes',
          img: ours,
        },
        {
          title: 'Nuestro hero — modo color (clic)',
          sub: 'mismo grid, color real por celda (§6.3 punto 12)',
          img: oursColor,
        },
      ],
      'side-by-side.png',
    );

    await browser.close();
  } finally {
    server.kill();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
