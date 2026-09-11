// scripts/sweep-zoom.ts — barrido de encuadre del retrato WebGL para decidir el zoom.
//
// El zoom SOLO puede ir hacia dentro. El corte recto de la fuente quedó clavado en el borde
// inferior del frame del vídeo, y `cover` hace coincidir ese borde con el del canvas: si se
// retira al animal aparece negro debajo y la recta vuelve a flotar, que es lo que fuimos a
// arreglar. Por eso el barrido va 1.0 -> 1.3 y no al revés.
//
// El foco NO es centrado: con recorte centrado el zoom se come los bigotes, que en el frame
// donde más se extienden dejan solo 16 px de margen sobre 580. `focus.x = 0.10` mantiene ese
// borde; `focus.y = 1` recorta todo por arriba (que es negro muerto) y conserva el borde
// inferior, así que subir el zoom SUBE la cabeza en vez de recortarla por abajo.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4201;
const OUT = resolve('screenshots', 'gl');
const VIEW = { width: 1440, height: 900 };
const FOCUS = { x: 0.1, y: 1 };
const ZOOMS = [1, 1.15, 1.3];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function dataUrl(file: string): string {
  return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
}

async function compose(
  page: Page,
  panels: Array<{ title: string; sub: string; img: string }>,
  out: string,
): Promise<void> {
  const html = `<!doctype html><meta charset="utf-8"><style>
    :root { color-scheme: dark; }
    body { margin:0; background:#0b0b0b; font-family: ui-monospace, monospace; }
    .wrap { display:flex; gap:16px; padding:16px; }
    figure { margin:0; flex:1; }
    figcaption { color:#eee; font-size:14px; padding:0 0 8px; letter-spacing:-0.02em; }
    figcaption b { color:#39ff6a; font-weight:500; }
    figcaption span { display:block; color:#818081; font-size:11px; margin-top:3px; }
    img { width:100%; display:block; border:1px solid rgba(238,238,238,.14); }
  </style><div class="wrap">
    ${panels.map((p) => `<figure><figcaption><b>${p.title}</b><span>${p.sub}</span></figcaption><img src="${p.img}"></figure>`).join('')}
  </div>`;
  await page.setContent(html, { waitUntil: 'load' });
  const wrap = await page.$('.wrap');
  await wrap?.screenshot({ path: out });
}

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

    const browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
    await page.goto(`http://localhost:${PORT}/?gl`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
      null,
      { timeout: 25_000 },
    );

    const shots: string[] = [];
    for (const z of ZOOMS) {
      await page.evaluate(
        ({ zoom, focus }) => {
          (window as unknown as { __asciiGL: { setFrame: (o: unknown) => void } }).__asciiGL.setFrame({
            zoom,
            focus,
          });
        },
        { zoom: z, focus: FOCUS },
      );
      await sleep(900);
      // Lenis interpola el scroll, así que un solo scrollTo no basta: el primer panel salía
      // desplazado y la comparación no comparaba el mismo encuadre.
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(700);
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(400);
      const f = join(OUT, `zoom-${z.toFixed(2)}.png`);
      await page.screenshot({ path: f });
      shots.push(f);
      console.log(`zoom ${z.toFixed(2)} -> ${f}`);
    }

    const sheet = await browser.newPage({ viewport: { width: 2200, height: 560 }, deviceScaleFactor: 1 });
    await compose(
      sheet,
      ZOOMS.map((z, i) => ({
        title: `zoom ${z.toFixed(2)}${z === 1 ? '  (actual)' : ''}`,
        sub: `foco x ${FOCUS.x} · y ${FOCUS.y} — recorta por arriba, conserva el borde inferior`,
        img: dataUrl(shots[i] ?? ''),
      })),
      join(OUT, 'ZOOM-SWEEP.png'),
    );

    await browser.close();
    console.log(join(OUT, 'ZOOM-SWEEP.png'));
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
