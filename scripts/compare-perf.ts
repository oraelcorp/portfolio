// scripts/compare-perf.ts — checkpoint 2.4: Canvas 2D (foto) contra WebGL2 (vídeo), medidos
// en la MISMA corrida y la misma máquina, que es la única forma de que los números se puedan
// restar entre sí.
//
// Se miden cuatro cosas, no solo el frame:
//   1. CARGA — cuánto tarda el retrato en aparecer y cuántos bytes cuesta la fuente. El vídeo
//      pesa 4.5x más que la foto y tiene que decodificar antes de dibujar nada; en un hero eso
//      es primera impresión, no un detalle.
//   2. RÉGIMEN — ms de hilo principal por frame con el puntero moviéndose, en DOS patrones:
//      · "suite": el zigzag corto de `check-phase3`, para que el número sea comparable con la
//        línea base ya aceptada del proyecto.
//      · "estrés": barridos largos por todo el retrato, que mueven mucha más área por frame.
//      Se miden los dos a propósito. Una primera versión de esta sonda usaba solo el patrón
//      agresivo y daba p90 7.40 ms para el Canvas 2D, declarando ROTO lo que su propia suite
//      da por bueno — el patrón de movimiento cambia el resultado más que el motor.
//   3. PUNTUAL — `sample()` y repintado completo: no cuentan contra los 4 ms de §8 porque no
//      ocurren por frame, pero se ven como tirón.
//   4. MÓVIL — lo mismo con viewport de móvil y CPU estrangulada 4x. Sin esto la recomendación
//      solo valdría para un portátil, y el hero es lo primero que se ve también en un teléfono.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4208;
const OUT = resolve('screenshots', 'gl');
const ESCRITORIO = { width: 1440, height: 900 };
const MOVIL = { width: 390, height: 844 };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Regimen {
  p50: number;
  p90: number;
  max: number;
  muestras: number;
}

interface Perf {
  motor: string;
  listoMs: number;
  bytes: number;
  suite: Regimen;
  estres: Regimen;
  sampleMs: number;
}

function pct(v: number[], p: number): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
}

/**
 * Recorre el retrato con el puntero mientras se muestrea `lastFrameMs` por frame DENTRO de la
 * página. Es el patrón de `check-phase3`: muestrear desde Node daría una lectura por salto de
 * ratón, sesgada al peor frame de cada tanda.
 */
async function regimen(
  page: Page,
  box: { x: number; y: number; w: number; h: number },
  gl: boolean,
  patron: 'suite' | 'estres',
) {
  await page.evaluate((esGL) => {
    const w = window as unknown as { __perf?: number[]; __perfOn?: boolean };
    w.__perf = [];
    w.__perfOn = true;
    const tick = (): void => {
      if (!w.__perfOn) return;
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const inst = (window as any)[esGL ? '__asciiGL' : '__asciiPortrait'];
      const ms = esGL
        ? Number(document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glMs ?? 0)
        : Number(inst?.lastFrameMs ?? 0);
      if (ms > 0) w.__perf?.push(ms);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, gl);

  const t0 = Date.now();
  let frames = 0;
  if (patron === 'suite') {
    // Calco del recorrido de check-phase3: zigzag corto en torno a un punto.
    await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.35, { steps: 5 });
    for (let i = 0; i < 14; i++) {
      await page.mouse.move(box.x + box.w * 0.5 + (i % 2 === 0 ? 90 : -90), box.y + box.h * 0.35 + i * 22, {
        steps: 12,
      });
      frames++;
    }
  } else {
    for (let i = 0; i < 14; i++) {
      await page.mouse.move(
        box.x + box.w * (0.3 + 0.4 * ((i % 4) / 3)),
        box.y + box.h * (0.35 + 0.35 * ((i % 3) / 2)),
        { steps: 12 },
      );
      frames++;
    }
  }
  await sleep(300);

  const datos = await page.evaluate(() => {
    const w = window as unknown as { __perf: number[]; __perfOn: boolean };
    w.__perfOn = false;
    return w.__perf;
  });
  return { datos, segundos: (Date.now() - t0) / 1000, frames };
}

/**
 * Un navegador POR LEG, cerrado al terminar. Con un único navegador para las cuatro medidas,
 * una caída a mitad ("Target page, context or browser has been closed") se llevaba la corrida
 * entera y dejaba cero datos utilizables.
 */
async function medir(viewport: typeof ESCRITORIO, gl: boolean, throttle: number): Promise<Perf> {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  let bytes = 0;
  page.on('response', (r) => {
    const u = r.url();
    if (/portrait\.png|jaguar-loop\.mp4/.test(u)) {
      const len = Number(r.headers()['content-length'] ?? 0);
      if (len > bytes) bytes = len;
    }
  });

  try {
    if (throttle > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    }

    const t0 = Date.now();
    await page.goto(`http://localhost:${PORT}/${gl ? '?gl' : '?debug'}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 40_000 });
    await page.waitForFunction(
      (esGL) => {
        const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
        return esGL ? c?.dataset.glReady === '1' : Boolean(c?.dataset.reveal);
      },
      gl,
      { timeout: 40_000 },
    );
    const listoMs = Date.now() - t0;

    await page.waitForFunction(
      (esGL) => {
        const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
        return (esGL ? c?.dataset.glReveal : c?.dataset.reveal) === '1.000';
      },
      gl,
      { timeout: 40_000 },
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);

    const box = await page.evaluate(() => {
      const r = document.querySelector<HTMLCanvasElement>('[data-ascii]')?.getBoundingClientRect();
      return { x: r?.x ?? 0, y: r?.y ?? 0, w: r?.width ?? 0, h: r?.height ?? 0 };
    });

    const r1 = await regimen(page, box, gl, 'suite');
    await sleep(500);
    const r2 = await regimen(page, box, gl, 'estres');
    const resumen = (d: number[]): Regimen => ({
      p50: pct(d, 0.5),
      p90: pct(d, 0.9),
      max: d.length ? Math.max(...d) : 0,
      muestras: d.length,
    });

    // Coste puntual de re-muestrear la fuente: en 2D es lo que costaría por frame si el
    // sujeto fuese vídeo; en WebGL es lo que ya cuesta a 30 fps.
    const sampleMs = await page.evaluate((esGL) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      if (esGL)
        return Number(document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glSample ?? 0);
      const p = (window as any).__asciiPortrait;
      const runs: number[] = [];
      for (let i = 0; i < 7; i++) {
        const t = performance.now();
        p.sample();
        runs.push(performance.now() - t);
      }
      runs.sort((a, b) => a - b);
      return runs[3] ?? 0;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }, gl);

    return {
      motor: gl ? 'WebGL2 + vídeo' : 'Canvas 2D + foto',
      listoMs,
      bytes,
      suite: resumen(r1.datos),
      estres: resumen(r2.datos),
      sampleMs,
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  const report: string[] = [];
  const say = (s = ''): void => {
    console.log(s);
    report.push(s);
    writeFileSync(join(OUT, 'compare-perf.txt'), report.join(String.fromCharCode(10)), 'utf8');
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

    say('== CHECKPOINT 2.4 — Canvas 2D (foto) vs WebGL2 (vídeo) ==');
    say('   Misma corrida, misma máquina. Presupuesto §8: 4 ms de hilo principal por frame.');
    say('   El p90 es el criterio de check-phase3; el PATRÓN de movimiento se mide en dos variantes.');
    say('');

    const filas: Array<{ ctx: string; p: Perf }> = [];
    for (const [nombre, viewport, throttle] of [
      ['escritorio', ESCRITORIO, 1],
      ['móvil (CPU 4x lenta)', MOVIL, 4],
    ] as Array<[string, typeof ESCRITORIO, number]>) {
      for (const gl of [false, true]) {
        try {
          const p = await medir(viewport, gl, throttle);
          filas.push({ ctx: nombre, p });
          say(
            `   [ok] ${nombre} · ${p.motor} · suite p90 ${p.suite.p90.toFixed(2)} · estres p90 ${p.estres.p90.toFixed(2)}`,
          );
        } catch (e) {
          say(
            `   [FALLO] ${nombre} · ${gl ? 'WebGL2' : 'Canvas 2D'}: ${(e as Error).message.split(String.fromCharCode(10))[0]}`,
          );
        }
        await sleep(600);
      }
    }

    say('');
    say(
      '                                                          patron SUITE (comparable    patron ESTRES',
    );
    say(
      '                                                          con check-phase3)           (barridos largos)',
    );
    say(
      '   contexto              motor               listo   MB     p50    p90    max        p50    p90    max',
    );
    for (const { ctx, p } of filas) {
      say(
        `   ${ctx.padEnd(20)}  ${p.motor.padEnd(18)}  ${(p.listoMs / 1000).toFixed(1)}s  ${(p.bytes / 1048576).toFixed(2)}  ` +
          `${p.suite.p50.toFixed(2).padStart(5)}  ${p.suite.p90.toFixed(2).padStart(5)}  ${p.suite.max.toFixed(2).padStart(5)}   ` +
          `   ${p.estres.p50.toFixed(2).padStart(5)}  ${p.estres.p90.toFixed(2).padStart(5)}  ${p.estres.max.toFixed(2).padStart(5)}  ` +
          `${p.suite.p90 <= 4 ? '' : ' <- suite ROMPE'}`,
      );
    }
    say('');
    say('   NOTA: en móvil el canvas es mucho más pequeño, así que hay MENOS celdas. No es');
    say('   "el mismo trabajo con CPU más lenta": es menos trabajo con CPU más lenta.');

    say('');
    say('   Coste de RE-MUESTREAR la fuente (con vídeo hay que pagarlo a 30 fps):');
    for (const { ctx, p } of filas) {
      const porFrame = p.motor.startsWith('Canvas') ? p.sampleMs : p.sampleMs;
      say(
        `     ${ctx.padEnd(20)} ${p.motor.padEnd(18)} ${porFrame.toFixed(2).padStart(6)} ms  ${porFrame > 4 ? '-> ROMPE el presupuesto por sí solo' : '-> cabe'}`,
      );
    }

    // tamaño de los assets en disco, que es lo que se publica
    const kb = (f: string): number => Math.round(statSync(resolve(f)).size / 1024);
    say('');
    say(
      `   Assets publicados: portrait.png ${kb('public/img/portrait/portrait.png')} KB · jaguar-loop.mp4 ${kb('public/img/portrait/jaguar-loop.mp4')} KB`,
    );

    console.log(`\nReport en ${join(OUT, 'compare-perf.txt')}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
