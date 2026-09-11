// scripts/shot-ascii.ts — captura suelta del retrato del hero tal y como queda en el build
// publicado. Sirve para enseñar el resultado de un cambio de configuración sin arrastrar
// toda la suite de `npm run shots`.
//
// Uso: node scripts/shot-ascii.ts [nombre-de-salida]

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4186;
const OUT = resolve('screenshots', 'combined');
const CLIP = { x: 792, y: 0, width: 648, height: 900 };
const name = process.argv[2] ?? 'ascii';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
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

    const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
    await sleep(4200); // que el reveal de 3.2 s termine

    const stats = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
      return { w: c?.width ?? 0, h: c?.height ?? 0, frameMs: c?.dataset.frameMs ?? '—' };
    });

    await page.screenshot({ path: join(OUT, `${name}.png`), clip: CLIP });

    // Y una con el puntero encima, que es donde se ve la sangría de color
    await page.mouse.move(CLIP.x + CLIP.width * 0.42, CLIP.y + CLIP.height * 0.45, { steps: 20 });
    await sleep(1400);
    await page.screenshot({ path: join(OUT, `${name}-hover.png`), clip: CLIP });

    console.log(`canvas ${stats.w}x${stats.h} px disp. · frameMs publicado ${stats.frameMs}`);
    console.log(`${join(OUT, `${name}.png`)}`);
    console.log(`${join(OUT, `${name}-hover.png`)}`);
    await browser.close();
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
