// scripts/capture-intro.ts — tira de fotogramas de la entrada del hero: preloader, letras y
// la onda expansiva del jaguar. Sirve para juzgar el ORDEN y el ritmo, no solo el estado final.

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4187;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots', 'intro');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await page.goto(URL, { waitUntil: 'commit' });

    // Dos capturas del preloader por reloj (ahí el ritmo sí es lo que importa)
    await sleep(250);
    await page.screenshot({ path: join(OUT, 'p-01.png') });
    await sleep(450);
    await page.screenshot({ path: join(OUT, 'p-02.png') });

    // Y la onda POR PROGRESO, no por reloj: cada screenshot cuesta ~150 ms, así que
    // muestrear por tiempo se salta la animación entera.
    const marks = [0.15, 0.3, 0.5, 0.7, 1];
    const shots: string[] = ['p-01.png', 'p-02.png'];

    for (const mark of marks) {
      await page.waitForFunction(
        (m) => Number(document.querySelector<HTMLElement>('[data-ascii]')?.dataset.reveal ?? 0) >= m,
        mark,
        { timeout: 20_000 },
      );
      const name = `wave-${String(Math.round(mark * 100)).padStart(3, '0')}.png`;
      await page.screenshot({ path: join(OUT, name), clip: { x: 792, y: 0, width: 648, height: 900 } });
      shots.push(name);
    }

    // Tira montada para verla de un vistazo. Las imágenes van como data URL: una página
    // servida por http no puede cargar file:// (ya pasó al montar side-by-side).
    const picks = shots;
    const inline = picks.map((p) => ({
      name: p,
      src: `data:image/png;base64,${readFileSync(join(OUT, p)).toString('base64')}`,
    }));
    await page.goto('about:blank');
    await page.setViewportSize({ width: 1560, height: 700 });
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
      <style>
        body{margin:0;background:#141314;color:#eee;font:11px/1.4 ui-monospace,monospace;
             display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding:16px}
        figure{margin:0;display:grid;gap:6px}
        img{display:block;width:100%;border:1px solid rgba(238,238,238,.14)}
      </style>
      ${inline
        .map(
          (p) =>
            `<figure><img src="${p.src}"><figcaption>${p.name.replace('.png', '').replace('t-', '')} ms</figcaption></figure>`,
        )
        .join('')}`,
      { waitUntil: 'load' },
    );
    await sleep(900);
    await page.screenshot({ path: join(OUT, 'secuencia.png'), fullPage: true });

    console.log(`  ${shots.length} fotogramas + secuencia.png en screenshots/intro/`);
    await browser.close();
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
