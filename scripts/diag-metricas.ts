// scripts/diag-metricas.ts — métricas EFECTIVAS de cada motor (celda, fuente, estirado).
// En las ampliaciones de `compare-nitidez.ts` los glifos del 2D llenan la celda y los de WebGL
// dejan un canal negro entre columnas. Antes de tocar el shader hay que saber con qué números
// está dibujando cada uno, en vez de deducirlos del código.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import type { VentanaSonda } from './lib/motor.ts';

const PORT = 4226;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
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

  const page2 = await ctx.newPage();
  await page2.goto(`http://localhost:${PORT}/?2d&debug`, { waitUntil: 'load' });
  await page2.waitForFunction(() => Boolean((window as VentanaSonda).__asciiPortrait), null, {
    timeout: 40_000,
  });
  await sleep(2000);
  console.log(
    '2D   ',
    JSON.stringify(
      await page2.evaluate(() => {
        const p = (window as VentanaSonda).__asciiPortrait!;
        const c = document.querySelector<HTMLCanvasElement>('[data-ascii]')!;
        const ctx2 = document.createElement('canvas').getContext('2d')!;
        ctx2.font = `${p.metrics.fs}px "JetBrains Mono", ui-monospace, monospace`;
        return {
          ...p.metrics,
          dpr: p.dpr,
          stepX: p.stepX,
          avance: ctx2.measureText('0').width,
          canvas: `${c.width}x${c.height}`,
          celdaDisp: p.metrics.cw * p.dpr,
        };
      }),
    ),
  );

  const pageG = await ctx.newPage();
  await pageG.goto(`http://localhost:${PORT}/?glphoto`, { waitUntil: 'load' });
  await pageG.waitForFunction(
    () => (document.querySelector('[data-ascii]') as HTMLElement)?.dataset.glReady === '1',
    null,
    { timeout: 40_000 },
  );
  await sleep(2000);
  console.log(
    'WebGL',
    JSON.stringify(
      await pageG.evaluate(() => {
        const g = (window as VentanaSonda).__asciiGL!;
        const c = document.querySelector<HTMLCanvasElement>('[data-ascii]')!;
        // Se recalcula el mismo `fs` que usa resize() para el atlas, con la misma sonda.
        const ctx2 = document.createElement('canvas').getContext('2d')!;
        ctx2.font = `${g.ch}px "JetBrains Mono", ui-monospace, monospace`;
        let ink = 0;
        for (const ch of `.'\`:,;-~+17cr23ae56bd89AE04BCDF68#%@`) {
          const m = ctx2.measureText(ch);
          ink = Math.max(ink, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
        }
        const fs = ink > 0 ? g.ch * (g.ch / ink) : g.ch;
        ctx2.font = `${fs}px "JetBrains Mono", ui-monospace, monospace`;
        return {
          cw: g.cw,
          ch: g.ch,
          fs,
          dpr: g.dpr,
          stretchX: 'no aplica',
          avance: ctx2.measureText('0').width,
          canvas: `${c.width}x${c.height}`,
          celdaDisp: g.cw * g.dpr,
          tile: Math.round(g.cw * g.dpr),
        };
      }),
    ),
  );

  await b.close();
} finally {
  preview.stop();
}
