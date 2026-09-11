// scripts/measure-density.ts — ¿cuál es la celda mínima viable en Canvas 2D antes de romper el
// presupuesto de pintado de §8 (4 ms/frame)? Sonda previa a la decisión sobre WebGL.
//
// Mide, para cada tamaño de celda, TRES costes distintos que no hay que mezclar:
//   1. setup   — `update()` completo: re-muestreo, blur, highlights, regiones, glifos. Se paga
//                al cargar y al redimensionar, no por frame. Se ve como un tirón, no como jank.
//   2. paintAll— repintado completo del retrato. Tampoco es por frame (§ decisión 2026-09-02),
//                pero es el coste del cambio de modo y del resize.
//   3. frame   — el que SÍ cuenta contra los 4 ms: shimmer + puntero + sangría, con el cursor
//                en movimiento (el peor caso real, no el retrato en reposo).
//
// Además publica el tamaño de fuente deducido en px de dispositivo, que es el límite de
// LEGIBILIDAD — independiente del de rendimiento y probablemente el que manda antes.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4182;
const URL = `http://localhost:${PORT}/?debug`;
const OUT = resolve('screenshots', 'density');
const CLIP = { x: 792, y: 0, width: 648, height: 900 };
const BUDGET = 4.0; // ms/frame, §8
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Celdas a barrer, en px CSS. 7.56 es la medida en la referencia (el actual). */
const CELLS = [7.56, 6, 5, 4.5, 4, 3.5, 3, 2.5, 2];

interface Setup {
  cols: number;
  rows: number;
  cells: number;
  inked: number;
  fs: number;
  cw: number;
  dpr: number;
  setupMs: number;
  paintAllMs: number;
}

interface FrameStats {
  samples: number;
  painted: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

/** Aplica la celda y cronometra setup + repintado completo (mediana de 5). */
async function applyCell(page: Page, cell: number): Promise<Setup> {
  return page.evaluate((c) => {
    const p = (
      window as unknown as {
        __asciiPortrait: {
          update: (o: unknown) => void;
          paintAll: () => void;
          cols: number;
          rows: number;
          luma: Float32Array;
          fs: number;
          cw: number;
          dpr: number;
        };
      }
    ).__asciiPortrait;

    const t0 = performance.now();
    p.update({ cellW: c, cellH: c });
    const setupMs = performance.now() - t0;

    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const a = performance.now();
      p.paintAll();
      runs.push(performance.now() - a);
    }
    runs.sort((x, y) => x - y);

    let inked = 0;
    const total = p.cols * p.rows;
    for (let i = 0; i < total; i++) if ((p.luma[i] ?? 0) > 0.12) inked++;

    return {
      cols: p.cols,
      rows: p.rows,
      cells: total,
      inked,
      fs: p.fs,
      cw: p.cw,
      dpr: p.dpr,
      setupMs,
      paintAllMs: runs[2] ?? 0,
    };
  }, cell);
}

/**
 * Peor caso por frame: el cursor recorriendo el retrato. Un colector en rAF anota
 * `lastFrameMs` de la instancia viva mientras Playwright mueve el ratón de verdad —
 * los eventos sintéticos de `dispatchEvent` no ejercitan la misma ruta de entrada.
 */
async function frameStats(page: Page): Promise<FrameStats> {
  await page.evaluate(() => {
    const w = window as unknown as { __fs?: number[]; __fsRaf?: number };
    const p = (window as unknown as { __asciiPortrait: { lastFrameMs: number } }).__asciiPortrait;
    w.__fs = [];
    const loop = (): void => {
      w.__fs?.push(p.lastFrameMs);
      w.__fsRaf = requestAnimationFrame(loop);
    };
    w.__fsRaf = requestAnimationFrame(loop);
  });

  // Recorrido en diagonal + zigzag sobre el canvas del hero, ~90 pasos a ~16 ms
  const x0 = CLIP.x;
  const y0 = CLIP.y;
  for (let i = 0; i < 90; i++) {
    const t = i / 89;
    const x = x0 + CLIP.width * (0.15 + 0.7 * t);
    const y = y0 + CLIP.height * (0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * Math.PI * 3)));
    await page.mouse.move(x, y);
    await sleep(16);
  }

  return page.evaluate(() => {
    const w = window as unknown as { __fs?: number[]; __fsRaf?: number };
    if (w.__fsRaf) cancelAnimationFrame(w.__fsRaf);
    const all = w.__fs ?? [];
    const hot = all.filter((v) => v > 0).sort((a, b) => a - b);
    const q = (arr: number[], p: number): number => {
      if (!arr.length) return 0;
      const i = (arr.length - 1) * p;
      const lo = Math.floor(i);
      const hi = Math.ceil(i);
      return (arr[lo] ?? 0) + ((arr[hi] ?? 0) - (arr[lo] ?? 0)) * (i - lo);
    };
    return {
      samples: all.length,
      painted: hot.length,
      p50: q(hot, 0.5),
      p95: q(hot, 0.95),
      max: hot.length ? (hot[hot.length - 1] as number) : 0,
      mean: hot.length ? hot.reduce((a, b) => a + b, 0) / hot.length : 0,
    };
  });
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

    const dpr = await page.evaluate(() => window.devicePixelRatio);
    say(
      `Canvas del hero ${CLIP.width}x${CLIP.height} px CSS · DPR ${dpr} · presupuesto §8 = ${BUDGET.toFixed(1)} ms/frame`,
    );
    say(
      'Chrome headless en esta máquina. Los ms son de ESTA máquina: lo que importa es la CURVA y dónde cruza el presupuesto.',
    );
    say('');
    say(
      '  celda   grid        celdas    tinta    fuente     setup    paintAll   ---- ms/frame con el cursor moviendose ----',
    );
    say(
      '  px CSS              totales            px disp.     ms        ms      p50      p95      max     % frames pintan',
    );

    const rows: Array<{ cell: number; s: Setup; f: FrameStats }> = [];

    for (const cell of CELLS) {
      const s = await applyCell(page, cell);
      await sleep(400);
      const f = await frameStats(page);
      rows.push({ cell, s, f });

      say(
        `  ${cell.toFixed(2).padStart(5)}   ${String(s.cols).padStart(3)}x${String(s.rows).padEnd(3)}   ${String(s.cells).padStart(7)}  ${String(s.inked).padStart(7)}   ${(s.fs * s.dpr).toFixed(1).padStart(5)}    ${s.setupMs.toFixed(1).padStart(6)}   ${s.paintAllMs.toFixed(2).padStart(7)}   ${f.p50.toFixed(2).padStart(6)}  ${f.p95.toFixed(2).padStart(6)}  ${f.max.toFixed(2).padStart(6)}   ${((f.painted / Math.max(1, f.samples)) * 100).toFixed(0).padStart(4)} %`,
      );

      await page.screenshot({ path: join(OUT, `cell-${cell.toFixed(2)}.png`), clip: CLIP });
    }

    say('');
    say('== DONDE CRUZA EL PRESUPUESTO ==');
    const overP95 = rows.filter((r) => r.f.p95 > BUDGET);
    const lastOk = [...rows].reverse().find((r) => r.f.p95 <= BUDGET);
    if (lastOk) {
      say(
        `   Celda mas pequeña con p95 <= ${BUDGET} ms:  ${lastOk.cell.toFixed(2)} px  (${lastOk.s.cols}x${lastOk.s.rows} = ${lastOk.s.cells} celdas, p95 ${lastOk.f.p95.toFixed(2)} ms)`,
      );
      say(
        `   Densidad respecto al actual (7.56): x${((7.56 / lastOk.cell) ** 2).toFixed(2)} celdas · x${(7.56 / lastOk.cell).toFixed(2)} en cada eje`,
      );
    } else {
      say('   Ninguna celda del barrido cumple el presupuesto (revisar la sonda).');
    }
    if (overP95.length) {
      say(
        `   Primera que lo rompe: ${(overP95[0] as (typeof rows)[number]).cell.toFixed(2)} px -> p95 ${(overP95[0] as (typeof rows)[number]).f.p95.toFixed(2)} ms`,
      );
    }
    say('');
    say('   Recordatorio: `paintAll` y `setup` NO cuentan contra los 4 ms (no ocurren por frame),');
    say('   pero un paintAll largo se ve como tiron al cambiar de modo o al redimensionar.');

    // Se deja el retrato como estaba
    await applyCell(page, 7.56);
    await browser.close();
    writeFileSync(join(OUT, 'report.txt'), report.join('\n'), 'utf8');
    writeFileSync(join(OUT, 'raw.json'), JSON.stringify(rows, null, 2), 'utf8');
    console.log(`\nCapturas y report en ${OUT}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
