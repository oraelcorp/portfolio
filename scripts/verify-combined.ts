// scripts/verify-combined.ts — verifica la combinación celda 4.00 + smooth 0.6 + hlDelta 0.16
// ANTES de fijarla como configuración definitiva.
//
// Por qué hace falta: celda y umbral se calibraron por separado y NO son independientes. El
// highlight se decide por contraste contra las 8 vecinas; al reducir la celda, esas vecinas
// caen más juntas en la foto, el contraste local baja y el MISMO umbral produce MENOS
// highlights. La pareja 0.6/0.16 se calibró a celda 7.56, así que a 4.00 hay que remedirla.
//
// Mide la matriz de 4 configuraciones + un barrido de hlDelta a celda 4.00 para dar el valor
// corregido si la proporción se sale del 24 % de la referencia.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4184;
const URL = `http://localhost:${PORT}/?debug`;
const OUT = resolve('screenshots', 'combined');
const CLIP = { x: 792, y: 0, width: 648, height: 900 };
const BUDGET = 4.0;
const TARGET = 24.0; // % de highlights sobre celdas con tinta, medido en good-fella.com
const INK = 0.12;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Cfg {
  name: string;
  cell: number;
  smooth: number;
  hlDelta: number;
}

const MATRIX: Cfg[] = [
  { name: 'A actual        ', cell: 7.56, smooth: 1.0, hlDelta: 0.12 },
  { name: 'B pareja @7.56  ', cell: 7.56, smooth: 0.6, hlDelta: 0.16 },
  { name: 'C celda4 vieja  ', cell: 4.0, smooth: 1.0, hlDelta: 0.12 },
  { name: 'D COMBINADA     ', cell: 4.0, smooth: 0.6, hlDelta: 0.16 },
];

interface Metrics {
  cols: number;
  rows: number;
  cells: number;
  inked: number;
  sd: number;
  grad: number;
  hlPct: number;
  hlIsolated: number;
  hlChains: number;
  hlComps: number;
  fsDevice: number;
}

async function apply(page: Page, c: Cfg): Promise<void> {
  await page.evaluate((cfg) => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    (window as any).__asciiPortrait.update({
      cellW: cfg.cell,
      cellH: cfg.cell,
      smooth: cfg.smooth,
      highlightDelta: cfg.hlDelta,
    });
  }, c);
  await sleep(320);
}

async function metrics(page: Page): Promise<Metrics> {
  return page.evaluate((ink) => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const p = (window as any).__asciiPortrait;
    const cols = p.cols as number;
    const rows = p.rows as number;
    const luma = p.luma as Float32Array;
    const highlight = p.highlight as Uint8Array;
    const total = cols * rows;

    let inked = 0;
    let sum = 0;
    for (let i = 0; i < total; i++) {
      const l = luma[i] ?? 0;
      if (l > ink) {
        inked++;
        sum += l;
      }
    }
    const mean = inked ? sum / inked : 0;
    let varSum = 0;
    for (let i = 0; i < total; i++) {
      const l = luma[i] ?? 0;
      if (l > ink) varSum += (l - mean) ** 2;
    }

    let gSum = 0;
    let gN = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const l = luma[i] ?? 0;
        if (l <= ink) continue;
        const r = luma[i + 1] ?? 0;
        const d = luma[i + cols] ?? 0;
        if (x + 1 < cols && r > ink) {
          gSum += Math.abs(l - r);
          gN++;
        }
        if (y + 1 < rows && d > ink) {
          gSum += Math.abs(l - d);
          gN++;
        }
      }
    }

    const seen = new Uint8Array(total);
    const sizes: number[] = [];
    let hl = 0;
    for (let i = 0; i < total; i++) if (highlight[i]) hl++;
    for (let s = 0; s < total; s++) {
      if (!highlight[s] || seen[s]) continue;
      let n = 0;
      const stack: number[] = [s];
      seen[s] = 1;
      while (stack.length) {
        const c = stack.pop() as number;
        n++;
        const cx = c % cols;
        const cy = (c / cols) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const j = ny * cols + nx;
            if (highlight[j] && !seen[j]) {
              seen[j] = 1;
              stack.push(j);
            }
          }
        }
      }
      sizes.push(n);
    }

    return {
      cols,
      rows,
      cells: total,
      inked,
      sd: inked ? Math.sqrt(varSum / inked) : 0,
      grad: gN ? gSum / gN : 0,
      hlPct: inked ? (hl / inked) * 100 : 0,
      hlIsolated: hl ? (sizes.filter((n) => n === 1).length / hl) * 100 : 0,
      hlChains: hl ? (sizes.filter((n) => n >= 4).reduce((a, b) => a + b, 0) / hl) * 100 : 0,
      hlComps: sizes.length,
      fsDevice: (p.fs as number) * (p.dpr as number),
    };
  }, INK);
}

/** Peor caso por frame: cursor recorriendo el retrato, con eventos reales de Playwright. */
async function frameStats(
  page: Page,
): Promise<{ p50: number; p95: number; max: number; painted: number; samples: number }> {
  await page.evaluate(() => {
    const w = window as unknown as { __fs?: number[]; __fsRaf?: number };
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const p = (window as any).__asciiPortrait;
    w.__fs = [];
    const loop = (): void => {
      w.__fs?.push(p.lastFrameMs as number);
      w.__fsRaf = requestAnimationFrame(loop);
    };
    w.__fsRaf = requestAnimationFrame(loop);
  });

  for (let i = 0; i < 110; i++) {
    const t = i / 109;
    const x = CLIP.x + CLIP.width * (0.15 + 0.7 * t);
    const y = CLIP.y + CLIP.height * (0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * Math.PI * 3)));
    await page.mouse.move(x, y);
    await sleep(16);
  }

  return page.evaluate(() => {
    const w = window as unknown as { __fs?: number[]; __fsRaf?: number };
    if (w.__fsRaf) cancelAnimationFrame(w.__fsRaf);
    const all = w.__fs ?? [];
    const hot = all.filter((v) => v > 0).sort((a, b) => a - b);
    const q = (arr: number[], pc: number): number => {
      if (!arr.length) return 0;
      const i = (arr.length - 1) * pc;
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
    };
  });
}

async function routeCosts(
  page: Page,
): Promise<{ sampleMs: number; paintAllMs: number; shimmerMs: number; pointerMs: number }> {
  return page.evaluate(() => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const p = (window as any).__asciiPortrait;
    const med = (a: number[]): number => {
      const s = [...a].sort((x, y) => x - y);
      return s[Math.floor(s.length / 2)] ?? 0;
    };
    const sam: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      p.sample();
      sam.push(performance.now() - t);
    }
    const pa: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t = performance.now();
      p.paintAll();
      pa.push(performance.now() - t);
    }
    const sh: number[] = [];
    for (let i = 0; i < 25; i++) {
      p.lastShimmer = 0;
      const t = performance.now();
      if (p.shimmer()) p.paintCells(p.shimmerDirty);
      sh.push(performance.now() - t);
    }
    const po: number[] = [];
    p.hasPointer = true;
    for (let i = 0; i < 25; i++) {
      const prevX = p.pointerX;
      const prevY = p.pointerY;
      p.pointerX = p.cols * (0.3 + 0.4 * Math.random());
      p.pointerY = p.rows * (0.3 + 0.4 * Math.random());
      const t = performance.now();
      p.paintPointerRegion(prevX, prevY);
      po.push(performance.now() - t);
    }
    return { sampleMs: med(sam), paintAllMs: med(pa), shimmerMs: med(sh), pointerMs: med(po) };
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

    // Calentamiento: la primera medida paga JIT y asignación de buffers
    await apply(page, MATRIX[0] as Cfg);
    await routeCosts(page);

    say(
      `Objetivo de highlights: ${TARGET.toFixed(1)} % (medido en good-fella.com) · presupuesto §8: ${BUDGET.toFixed(1)} ms/frame`,
    );
    say('');
    say('== MATRIZ ==');
    say(
      '  config             celda smooth hlD    grid      tinta    HL %   desv    AISL %  CAD %   grad     fuente',
    );
    const rows: Array<{ c: Cfg; m: Metrics }> = [];
    for (const c of MATRIX) {
      await apply(page, c);
      const m = await metrics(page);
      rows.push({ c, m });
      say(
        `  ${c.name}   ${c.cell.toFixed(2)}  ${c.smooth.toFixed(1)}   ${c.hlDelta.toFixed(2)}  ${String(m.cols).padStart(3)}x${String(m.rows).padEnd(3)}  ${String(m.inked).padStart(6)}  ${m.hlPct.toFixed(1).padStart(5)}  ${(m.hlPct - TARGET >= 0 ? '+' : '') + (m.hlPct - TARGET).toFixed(1)}   ${m.hlIsolated.toFixed(1).padStart(5)}   ${m.hlChains.toFixed(1).padStart(5)}   ${m.grad.toFixed(4)}   ${m.fsDevice.toFixed(1)} px`,
      );
      await page.screenshot({
        path: join(
          OUT,
          `${c.name.trim().split(' ')[0]}-cell${c.cell.toFixed(2)}-s${c.smooth.toFixed(1)}-d${c.hlDelta.toFixed(2)}.png`,
        ),
        clip: CLIP,
      });
    }
    say('');

    // ---------------------------------------------------------------- barrido correctivo
    say('== BARRIDO DE hlDelta A CELDA 4.00 (smooth 0.6) ==');
    say('   Para dar el umbral corregido si 0.16 se sale del objetivo a esta densidad.');
    say('');
    say('   hlDelta   HL %    desv    AISL %  CAD %   comps');
    const sweep: Array<{ d: number; m: Metrics }> = [];
    for (const d of [0.1, 0.11, 0.12, 0.13, 0.14, 0.16, 0.18]) {
      await apply(page, { name: 'sweep', cell: 4.0, smooth: 0.6, hlDelta: d });
      const m = await metrics(page);
      sweep.push({ d, m });
      say(
        `   ${d.toFixed(2)}     ${m.hlPct.toFixed(1).padStart(5)}   ${(m.hlPct - TARGET >= 0 ? '+' : '') + (m.hlPct - TARGET).toFixed(1)}   ${m.hlIsolated.toFixed(1).padStart(5)}   ${m.hlChains.toFixed(1).padStart(5)}   ${String(m.hlComps).padStart(5)}`,
      );
    }
    sweep.sort((a, b) => Math.abs(a.m.hlPct - TARGET) - Math.abs(b.m.hlPct - TARGET));
    const best = sweep[0] as (typeof sweep)[number];
    say('');
    say(
      `   Más cercano al objetivo: hlDelta ${best.d.toFixed(2)} -> ${best.m.hlPct.toFixed(1)} % (desv ${(best.m.hlPct - TARGET).toFixed(1)})`,
    );
    say('');

    // ---------------------------------------------------------------- presupuesto
    say('== PRESUPUESTO A CELDA 4.00 ==');
    for (const cfg of [
      { name: 'actual 7.56/1.0/0.12', c: MATRIX[0] as Cfg },
      { name: 'D 4.00/0.6/0.16     ', c: MATRIX[3] as Cfg },
      {
        name: `D* 4.00/0.6/${best.d.toFixed(2)}    `,
        c: { name: 'D*', cell: 4.0, smooth: 0.6, hlDelta: best.d },
      },
    ]) {
      await apply(page, cfg.c);
      await sleep(300);
      const r = await routeCosts(page);
      await apply(page, cfg.c); // routeCosts deja el canvas repintado a mano; se rehace limpio
      const f = await frameStats(page);
      say(
        `   ${cfg.name}  ->  frame p50 ${f.p50.toFixed(2)} · p95 ${f.p95.toFixed(2)} · max ${f.max.toFixed(2)} ms  ${f.p95 <= BUDGET ? 'OK' : 'ROMPE'}   |  sample ${r.sampleMs.toFixed(1)} · paintAll ${r.paintAllMs.toFixed(1)} · shimmer ${r.shimmerMs.toFixed(2)} · pointer ${r.pointerMs.toFixed(2)} ms`,
      );
    }

    // Captura final de la ganadora
    const winner: Cfg = { name: 'final', cell: 4.0, smooth: 0.6, hlDelta: best.d };
    await apply(page, winner);
    await sleep(400);
    await page.screenshot({ path: join(OUT, 'FINAL.png'), clip: CLIP });
    say('');
    say(`Captura de la configuración final en ${join(OUT, 'FINAL.png')}`);

    await browser.close();
    writeFileSync(join(OUT, 'report.txt'), report.join('\n'), 'utf8');
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
