// scripts/compare-engines.ts — Canvas 2D (aprobado, foto) vs WebGL2 (vídeo reencuadrado),
// mismo viewport y misma corrida, uno al lado del otro para decidir el encuadre.
//
// Se capturan los DOS en la misma sesión de navegador y con el mismo `deviceScaleFactor`:
// comparar capturas de corridas distintas mete diferencias de layout (la barra de scroll
// cambia el ancho del canvas y con él la rejilla) que no tienen nada que ver con el motor.
//
// Cada leg va en su propia página: la versión anterior de esta captura reutilizaba una y
// murió con "Target page has been closed" a mitad, dejando media comparación.

import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4197;
const OUT = resolve('screenshots', 'gl');
const VIEW = { width: 1440, height: 900 };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function dataUrl(file: string): string {
  return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
}

/** Captura el hero completo de una URL, esperando a que el retrato esté del todo dibujado. */
async function shootHero(browser: Browser, url: string, out: string, isGL: boolean): Promise<void> {
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });

    if (isGL) {
      await page.waitForFunction(
        () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReady === '1',
        null,
        { timeout: 20_000 },
      );
      await page.waitForFunction(
        () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
        null,
        { timeout: 25_000 },
      );
      await sleep(600);
    } else {
      // El 2D publica su progreso de onda en `dataset.reveal`
      await page.waitForFunction(
        () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.reveal === '1.000',
        null,
        { timeout: 25_000 },
      );
      await sleep(600);
      await page.addStyleTag({ content: '.ascii-debug{visibility:hidden}' });
    }

    // Al tope antes de capturar: el reveal del WebGL tarda más y en esa espera la página
    // acababa desplazada, así que un panel salía scrolleado y la comparación no comparaba
    // el mismo encuadre. Lenis interpola, así que hay que darle un frame para asentarse.
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(600);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    await page.screenshot({ path: out });
  } finally {
    await page.close();
  }
}

async function compose(
  page: Page,
  panels: Array<{ title: string; sub: string; img: string }>,
  out: string,
): Promise<void> {
  const html = `<!doctype html><meta charset="utf-8"><style>
    :root { color-scheme: dark; }
    body { margin:0; background:#0b0b0b; font-family: ui-monospace, monospace; }
    .wrap { display:flex; gap:20px; padding:20px; }
    figure { margin:0; flex:1; }
    figcaption { color:#eee; font-size:15px; padding:0 0 10px; letter-spacing:-0.02em; }
    figcaption b { color:#39ff6a; font-weight:500; }
    figcaption span { display:block; color:#818081; font-size:12px; margin-top:3px; }
    img { width:100%; display:block; border:1px solid rgba(238,238,238,.14); }
  </style><div class="wrap">
    ${panels
      .map(
        (p) =>
          `<figure><figcaption><b>${p.title}</b><span>${p.sub}</span></figcaption><img src="${p.img}"></figure>`,
      )
      .join('')}
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

    const a = join(OUT, 'cmp-2d.png');
    const b = join(OUT, 'cmp-gl.png');
    await shootHero(browser, `http://localhost:${PORT}/?debug`, a, false);
    await shootHero(browser, `http://localhost:${PORT}/?gl`, b, true);

    const page = await browser.newPage({ viewport: { width: 2000, height: 700 }, deviceScaleFactor: 1 });
    await compose(
      page,
      [
        {
          title: 'Canvas 2D — APROBADO',
          sub: 'foto portrait.png · celda 4.00 · smooth 0.6 / hlDelta 0.11',
          img: dataUrl(a),
        },
        {
          title: 'WebGL2 — NUEVO',
          sub: 'jaguar-loop.mp4 reencuadrado · zoom 1 (encuadre nativo del clip)',
          img: dataUrl(b),
        },
      ],
      join(OUT, 'COMPARATIVA.png'),
    );

    await browser.close();
    console.log(join(OUT, 'COMPARATIVA.png'));
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
