// scripts/repro-movil.ts — reproduce los dos bugs de móvil ANTES de tocar código.
//
// Por qué no salieron antes: TODAS las sondas de la Fase 8 lanzan Chrome con
// `--autoplay-policy=no-user-gesture-required`, o sea desactivando justo la política que
// rompe el retrato en un teléfono. Y `compare-perf` medía "móvil" solo achicando el viewport,
// que no activa ninguna política móvil. Aquí se hace al revés: contexto móvil de verdad
// (touch, UA, DPR 3) y la política de autoplay EXIGIDA.
//
//   BUG 1 — el retrato no aparece: se sospecha que `loadeddata` no llega nunca si el vídeo no
//           puede reproducirse, y `init()` se queda esperando, así que `glReady` no se pone y
//           no se dibuja nada.
//   BUG 2 — los enlaces del menú no navegan: `hide()` arranca Lenis dentro de `finish()`, tras
//           la animación de cierre, mientras el salto del ancla nativa ocurre en el clic.

import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4210;
const OUT = resolve('screenshots', 'movil');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

async function abrir(browser: Browser): Promise<Page> {
  const page = await browser.newPage(IPHONE);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 30_000 });
  return page;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  const report: string[] = [];
  const say = (s = ''): void => {
    console.log(s);
    report.push(s);
    writeFileSync(join(OUT, 'repro.txt'), report.join(String.fromCharCode(10)), 'utf8');
  };

  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
      } catch {
        /* aún no */
      }
      await sleep(400);
    }

    // LA DIFERENCIA CLAVE con el resto de sondas: se EXIGE gesto para reproducir.
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: ['--autoplay-policy=user-gesture-required'],
    });

    say('== REPRODUCCIÓN EN MÓVIL (política de autoplay EXIGIDA) ==');
    say('   Contexto: 390x844, DPR 3, touch, UA de iPhone.');
    say('');

    // ---------------------------------------------------------------- BUG 1
    const page = await abrir(browser);
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(e.message));

    let listo = false;
    for (let i = 0; i < 20; i++) {
      listo = await page.evaluate(
        () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReady === '1',
      );
      if (listo) break;
      await sleep(500);
    }

    const estado = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const g = (window as any).__asciiGL;
      const v = g?.source as HTMLVideoElement | undefined;
      let tinta = 0;
      if (c) {
        const off = document.createElement('canvas');
        off.width = c.width;
        off.height = c.height;
        const ctx = off.getContext('2d');
        if (ctx) {
          ctx.drawImage(c, 0, 0);
          const d = ctx.getImageData(0, 0, off.width, off.height).data;
          for (let i = 0; i < d.length; i += 4) {
            if (0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0) >= 26) tinta++;
          }
        }
      }
      return {
        hayInstancia: Boolean(g),
        glReady: c?.dataset.glReady ?? '(sin poner)',
        glReveal: c?.dataset.glReveal ?? '(sin poner)',
        canvas: c ? `${c.width}x${c.height}` : 'no hay canvas',
        tinta,
        videoEnDOM: Boolean(document.querySelector('video')),
        readyState: v?.readyState ?? -1,
        networkState: v?.networkState ?? -1,
        paused: v?.paused ?? null,
        currentTime: v?.currentTime ?? -1,
        videoW: v?.videoWidth ?? -1,
      };
    });

    say('   BUG 1 — retrato en móvil');
    say(`     glReady: ${estado.glReady} · glReveal: ${estado.glReveal}`);
    say(`     canvas ${estado.canvas} · píxeles con tinta: ${estado.tinta}`);
    say(
      `     vídeo: readyState ${estado.readyState} · networkState ${estado.networkState} · paused ${estado.paused} · t ${estado.currentTime} · ${estado.videoW}px de ancho`,
    );
    say(
      `     ¿el <video> está en el DOM?: ${estado.videoEnDOM ? 'sí' : 'NO (creado por JS y nunca insertado)'}`,
    );
    say(`     errores de consola: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
    say(
      `     >>> ${estado.tinta < 1000 ? 'BUG REPRODUCIDO: el retrato NO se dibuja' : 'no reproducido: el retrato sí se dibuja'}`,
    );
    await page.screenshot({ path: join(OUT, 'bug1-retrato.png') });
    say('');

    // ---------------------------------------------------------------- BUG 2
    const p2 = await abrir(browser);
    await sleep(2500);
    const antes = await p2.evaluate(() => window.scrollY);
    const destino = await p2.evaluate(() => {
      const a = document.querySelector<HTMLAnchorElement>('[data-menu-panel] a[href^="#"]');
      return a?.getAttribute('href') ?? '(sin enlaces)';
    });

    await p2.tap('[data-menu-toggle]');
    await sleep(1200);
    const abierto = await p2.evaluate(
      () => document.querySelector<HTMLElement>('[data-menu-panel]')?.dataset.open === 'true',
    );
    await p2.tap('[data-menu-panel] a[href^="#"]');
    await sleep(2500);
    const despues = await p2.evaluate(() => window.scrollY);
    const objetivoY = await p2.evaluate((sel) => {
      const el = sel && sel.startsWith('#') ? document.querySelector<HTMLElement>(sel) : null;
      return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : -1;
    }, destino);

    say('   BUG 2 — enlaces del menú');
    say(`     enlace probado: ${destino} · su posición en la página: y=${objetivoY}`);
    say(`     menú se abrió: ${abierto ? 'sí' : 'NO'}`);
    say(`     scrollY antes: ${antes} · después: ${despues}`);
    say(
      `     >>> ${Math.abs(despues - antes) < 50 ? 'BUG REPRODUCIDO: no navega' : `navegó ${despues - antes} px`}`,
    );
    await p2.screenshot({ path: join(OUT, 'bug2-menu.png') });

    await browser.close();
    console.log(`\nEvidencia en ${OUT}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
