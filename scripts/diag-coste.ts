// scripts/diag-coste.ts — ¿cuánto cuesta presentar el <video> a tamaño completo?
//
// El arreglo del bug 1 obliga a que el <video> esté en el DOM y PRESENTADO a un tamaño real
// (con una caja de 2 px, WebKit deja la mitad de los frames en negro — medido en
// `diag-parpadeo.ts`). Pero al hacerlo, `glSeq` en `diag-movil.ts` bajó de ~150 a ~20 muestras
// en 15 s, o sea que el bucle iba mucho más despacio. Antes de dar el arreglo por bueno hay que
// saber si eso es coste real o es el rasterizador por software del WebKit de escritorio.
//
// Se miden, para cada tamaño de caja: fps reales del rAF de la página, y `glMs` (el coste de
// pintar un frame que ya publica el retrato, §8 lo presupuesta en 4 ms).
//
// Uso:  node scripts/diag-coste.ts [webkit|chrome]

import { chromium, webkit, devices } from 'playwright';
import type { Browser } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MOTOR = (process.argv[2] === 'chrome' ? 'chrome' : 'webkit') as 'chrome' | 'webkit';
const PORT = MOTOR === 'webkit' ? 4220 : 4219;
const OUT = resolve('screenshots', 'movil', `coste-${MOTOR}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const CAJAS: [string, string][] = [
  [
    'cubre el hero (el arreglo)',
    'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;pointer-events:none',
  ],
  [
    '2 px (parpadeaba)',
    'position:absolute;left:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none',
  ],
  ['sin vídeo presentado (fuera del DOM)', 'FUERA'],
];

async function lanzar(): Promise<Browser> {
  if (MOTOR === 'webkit') return webkit.launch({ headless: true });
  return chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--autoplay-policy=user-gesture-required'],
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  const linea: string[] = [];
  const say = (s = ''): void => {
    console.log(s);
    linea.push(s);
    writeFileSync(join(OUT, 'coste.txt'), linea.join('\n'), 'utf8');
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

    const browser = await lanzar();
    const ctx = await browser.newContext(devices['iPhone 13']);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
      null,
      { timeout: 30_000 },
    );
    await sleep(1500);

    say(`== COSTE DE PRESENTAR EL VÍDEO · motor=${MOTOR} ==`);
    say('   fps = ticks de requestAnimationFrame en 3 s · glMs = lo que publica el retrato (§8: 4 ms)');
    say('');
    say('   caja                                    fps    muestras/s   glMs p50   glMs p90');

    for (const [nombre, css] of CAJAS) {
      await page.evaluate((c) => {
        const v = document
          .querySelector<HTMLCanvasElement>('[data-ascii]')
          ?.parentElement?.querySelector('video');
        if (!v) return;
        if (c === 'FUERA') v.remove();
        else v.style.cssText = c;
      }, css);
      await sleep(1500);

      const r = await page.evaluate(async () => {
        const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
        const ms: number[] = [];
        let frames = 0;
        const seq0 = Number(c?.dataset.glSeq ?? 0);
        const t0 = performance.now();
        await new Promise<void>((res) => {
          const tick = (): void => {
            frames++;
            const v = Number(c?.dataset.glMs ?? 0);
            if (v > 0) ms.push(v);
            if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
            else res();
          };
          requestAnimationFrame(tick);
        });
        const dt = (performance.now() - t0) / 1000;
        ms.sort((a, b) => a - b);
        return {
          fps: frames / dt,
          muestras: (Number(c?.dataset.glSeq ?? 0) - seq0) / dt,
          p50: ms[Math.floor(ms.length * 0.5)] ?? -1,
          p90: ms[Math.floor(ms.length * 0.9)] ?? -1,
        };
      });

      say(
        `   ${nombre.padEnd(38)} ${r.fps.toFixed(1).padStart(5)}   ${r.muestras.toFixed(1).padStart(10)}   ${r.p50.toFixed(2).padStart(8)}   ${r.p90.toFixed(2).padStart(8)}`,
      );
    }

    await ctx.close();
    await browser.close();
    say('');
    say(`Evidencia en ${OUT}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
