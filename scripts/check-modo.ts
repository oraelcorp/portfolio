// scripts/check-modo.ts — ¿el retrato arranca en ASCII o en color? Comprobación mínima tras ver
// un recorte del barrido en ámbares en vez de en verde.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { LEER_ACENTO, ES_ACENTO_FN } from './lib/acento.ts';
const PORT = 4240;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const g = setTimeout(
  () => {
    console.error('FATAL: tope');
    process.exit(1);
  },
  4 * 60 * 1000,
);
g.unref?.();
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
  await sleep(1500);
  const r = (await page.evaluate(`(() => {
    const ACC = ${LEER_ACENTO};
    ${ES_ACENTO_FN}
    const c = document.querySelector('[data-ascii]');
    const off = document.createElement('canvas');
    off.width = c.width; off.height = c.height;
    const x = off.getContext('2d', { willReadFrequently: true });
    x.drawImage(c, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let verde = 0, calido = 0, blanco = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i+1], B = d[i+2];
      if (R + G + B < 60) continue;
      if (esAcento(R, G, B)) verde++;
      else if (R > G * 1.15 && R > B * 1.3) calido++;
      else blanco++;
    }
    return { verde, calido, blanco, modo: c.dataset.glMode, mix: c.dataset.glMix, gain: c.dataset.glGain };
  })()`)) as Record<string, unknown>;
  console.log(JSON.stringify(r));
  await page.locator('[data-ascii]').screenshot({ path: 'screenshots/gain/modo-actual.png' });
  await b.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
