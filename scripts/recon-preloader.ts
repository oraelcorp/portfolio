// scripts/recon-preloader.ts — captura la secuencia de carga de la referencia frame a frame,
// para replicar el ORDEN real (bloques → letras) en vez de aproximarlo de memoria.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon', 'reference', 'preloader-seq');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'commit', timeout: 60_000 });

  // Una captura cada 120 ms durante los primeros 4 s
  for (let i = 0; i < 34; i++) {
    const ms = i * 120;
    await page.screenshot({ path: join(OUT, `t-${String(ms).padStart(4, '0')}.png`) });
    await sleep(120);
  }

  console.log(`34 capturas cada 120 ms en recon/reference/preloader-seq/`);
  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
