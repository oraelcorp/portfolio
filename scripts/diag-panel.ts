// scripts/diag-panel.ts — comprueba que el panel de `?diag` funciona antes de pedirle a Javier
// que lo use en su teléfono. Un panel de diagnóstico que mienta es peor que no tenerlo.
import { webkit, devices } from 'playwright';
import { startPreview } from './lib/preview.ts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const PORT = 4222;

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
  const b = await webkit.launch({ headless: true });
  const ctx = await b.newContext(devices['iPhone 13']);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?diag`, { waitUntil: 'load' });
  await sleep(9000);
  console.log(
    await page.evaluate(() => (document.body.lastElementChild as HTMLElement)?.innerText ?? 'SIN PANEL'),
  );
  await page.screenshot({ path: 'screenshots/movil/panel-diag.png' });
  await b.close();
} finally {
  preview.stop();
}
