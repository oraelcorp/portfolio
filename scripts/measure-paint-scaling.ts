// scripts/measure-paint-scaling.ts — segunda pasada sobre measure-density.ts.
//
// Por qué existe: el barrido de densidad dio un ms/frame casi PLANO entre 10 k y 146 k celdas,
// que es un resultado sospechoso hasta que se mira qué trabajo hay por frame. El puntero y la
// sangría recorren una caja acotada en CELDAS (radio 6), así que su coste no depende de lo denso
// que sea el grid; el único trabajo que escala con el total es el shimmer, y solo se dispara cada
// 120 ms, así que en un percentil sobre frames sale enterrado bajo el ruido de planificación.
// Aquí se cronometra cada ruta POR SEPARADO y en caliente, para obtener la ley de escalado real
// en vez de un p95 ruidoso.
//
// Bloque final: churn de BANDAS. Premisa de Javier — si el modo color posteriza a 4 bandas,
// quizá el detalle extra de bajar el blur se cuantiza y da igual. Se mide qué % de celdas
// CAMBIA de banda al variar `smooth`: si es alto, el blur sí importa también en modo bandas.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4183;
const URL = `http://localhost:${PORT}/?debug`;
const OUT = resolve('screenshots', 'density');
const BUDGET = 4.0;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const CELLS = [7.56, 6, 5, 4, 3.5, 3, 2.5, 2];

interface Scaling {
  cols: number;
  rows: number;
  cells: number;
  fsDevice: number;
  shimmerPicks: number;
  shimmerMs: number;
  pointerMs: number;
  paintAllMs: number;
  sampleMs: number;
}

async function scalingAt(page: Page, cell: number): Promise<Scaling> {
  return page.evaluate((c) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const p = (window as any).__asciiPortrait;

    p.update({ cellW: c, cellH: c });

    const med = (a: number[]): number => {
      const s = [...a].sort((x, y) => x - y);
      return s[Math.floor(s.length / 2)] ?? 0;
    };

    // --- re-muestreo completo (blur + luminancia + highlights + regiones + glifos)
    const sampleRuns: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      p.sample();
      sampleRuns.push(performance.now() - t);
    }

    // --- repintado completo
    const paintRuns: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t = performance.now();
      p.paintAll();
      paintRuns.push(performance.now() - t);
    }

    // --- shimmer: la unica ruta por frame que escala con el total de celdas.
    //     Hay que resetear la puerta de 120 ms para poder cronometrarlo repetido.
    const shimmerRuns: number[] = [];
    let picks = 0;
    for (let i = 0; i < 25; i++) {
      p.lastShimmer = 0;
      const t = performance.now();
      if (p.shimmer()) p.paintCells(p.shimmerDirty);
      shimmerRuns.push(performance.now() - t);
      picks = Math.max(picks, p.shimmerDirty.length);
    }

    // --- puntero: caja acotada en celdas, no deberia escalar
    const pointerRuns: number[] = [];
    p.hasPointer = true;
    for (let i = 0; i < 25; i++) {
      const px = p.cols * (0.3 + 0.4 * Math.random());
      const py = p.rows * (0.3 + 0.4 * Math.random());
      const prevX = p.pointerX;
      const prevY = p.pointerY;
      p.pointerX = px;
      p.pointerY = py;
      const t = performance.now();
      p.paintPointerRegion(prevX, prevY);
      pointerRuns.push(performance.now() - t);
    }

    return {
      cols: p.cols,
      rows: p.rows,
      cells: p.cols * p.rows,
      fsDevice: p.fs * p.dpr,
      shimmerPicks: picks,
      shimmerMs: med(shimmerRuns),
      pointerMs: med(pointerRuns),
      paintAllMs: med(paintRuns),
      sampleMs: med(sampleRuns),
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }, cell);
}

/** % de celdas que cambian de banda de Otsu al pasar de `a` a `b` en `smooth`. */
async function bandChurn(page: Page, a: number, b: number): Promise<{ churn: number; inked: number }> {
  const bandsOf = async (s: number): Promise<number[]> => {
    await page.evaluate((sm) => {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (window as any).__asciiPortrait.update({ smooth: sm });
    }, s);
    await sleep(140);
    return page.evaluate(() => {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const p = (window as any).__asciiPortrait;
      const CORTES = [0.328, 0.523, 0.727];
      const out: number[] = [];
      const total = p.cols * p.rows;
      for (let i = 0; i < total; i++) {
        const l = p.luma[i] as number;
        if (l <= 0.12) {
          out.push(-1);
          continue;
        }
        out.push(l < CORTES[0]! ? 0 : l < CORTES[1]! ? 1 : l < CORTES[2]! ? 2 : 3);
      }
      return out;
    });
  };

  const A = await bandsOf(a);
  const B = await bandsOf(b);
  let inked = 0;
  let diff = 0;
  for (let i = 0; i < A.length; i++) {
    if (A[i] === -1 && B[i] === -1) continue;
    inked++;
    if (A[i] !== B[i]) diff++;
  }
  return { churn: inked ? (diff / inked) * 100 : 0, inked };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  const report: string[] = [];
  const say = (s = ''): void => {
    console.log(s);
    report.push(s);
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

    const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
    await sleep(1800);
    await page.addStyleTag({ content: '.ascii-debug{visibility:hidden}' });

    // ------------------------------------------------- churn de bandas (antes de cronometrar)
    say('== PREMISA DE BANDS: ¿la posterizacion se come el detalle del blur? ==');
    say('   % de celdas con tinta que CAMBIAN de banda de Otsu al mover `smooth`.');
    say('   Si fuera ~0, el blur daria igual en modo color y solo importaria en ASCII.');
    say('');
    for (const [a, b] of [
      [1.0, 0.6],
      [1.0, 0.0],
      [0.6, 0.0],
    ] as Array<[number, number]>) {
      const r = await bandChurn(page, a, b);
      say(
        `   smooth ${a.toFixed(1)} -> ${b.toFixed(1)} :  ${r.churn.toFixed(1)} % de ${r.inked} celdas cambian de banda`,
      );
    }
    await page.evaluate(() => {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (window as any).__asciiPortrait.update({ smooth: 1.0 });
    });
    say('');

    // ------------------------------------------------- escalado de pintado
    say('== ESCALADO DE PINTADO POR RUTA (medianas, en caliente) ==');
    say('   sample   = re-muestreo completo: blur + luminancia + highlights + regiones + glifos');
    say('   paintAll = repintado completo del retrato');
    say('   shimmer  = LA UNICA ruta por frame que escala con el total (3 % de celdas / 120 ms)');
    say('   pointer  = repintado de la caja del cursor (radio 6 CELDAS -> no deberia escalar)');
    say('');
    say(
      '  celda    grid        celdas   fuente    sample   paintAll   shimmer   (picks)   pointer   celdas/ms',
    );
    say(
      '  px CSS                        px disp.    ms        ms        ms                  ms      (paintAll)',
    );

    // Calentamiento: la primera medida siempre paga JIT y asignacion de buffers
    await scalingAt(page, 7.56);

    const rows: Array<{ cell: number; s: Scaling }> = [];
    for (const cell of CELLS) {
      const s = await scalingAt(page, cell);
      rows.push({ cell, s });
      say(
        `  ${cell.toFixed(2).padStart(5)}   ${String(s.cols).padStart(3)}x${String(s.rows).padEnd(3)}   ${String(s.cells).padStart(7)}   ${s.fsDevice.toFixed(1).padStart(5)}   ${s.sampleMs.toFixed(1).padStart(6)}   ${s.paintAllMs.toFixed(1).padStart(7)}   ${s.shimmerMs.toFixed(2).padStart(7)}   ${String(s.shimmerPicks).padStart(6)}   ${s.pointerMs.toFixed(2).padStart(6)}   ${(s.cells / Math.max(0.01, s.paintAllMs)).toFixed(0).padStart(7)}`,
      );
      await sleep(120);
    }

    say('');
    say(`== VEREDICTO CONTRA EL PRESUPUESTO DE ${BUDGET.toFixed(1)} ms/frame ==`);
    const worstFrame = (s: Scaling): number => s.shimmerMs + s.pointerMs;
    for (const { cell, s } of rows) {
      const w = worstFrame(s);
      say(
        `   celda ${cell.toFixed(2).padStart(5)}  ->  peor frame (shimmer + puntero) ${w.toFixed(2).padStart(6)} ms  ${w <= BUDGET ? 'OK' : 'ROMPE'}   ·  fuente ${s.fsDevice.toFixed(1)} px disp.`,
      );
    }

    const ok = rows.filter((r) => worstFrame(r.s) <= BUDGET);
    const smallest = ok[ok.length - 1];
    if (smallest) {
      say('');
      say(
        `   Celda mas pequeña que respeta el presupuesto: ${smallest.cell.toFixed(2)} px CSS  (${smallest.s.cols}x${smallest.s.rows} = ${smallest.s.cells} celdas)`,
      );
      say(`   Margen de densidad frente al 7.56 actual: x${((7.56 / smallest.cell) ** 2).toFixed(1)} celdas`);
    }

    await scalingAt(page, 7.56);
    await browser.close();
    writeFileSync(join(OUT, 'scaling.txt'), report.join('\n'), 'utf8');
    writeFileSync(join(OUT, 'scaling.json'), JSON.stringify(rows, null, 2), 'utf8');
    console.log(`\nReport en ${join(OUT, 'scaling.txt')}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
