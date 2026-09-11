// scripts/verify-budget.ts — presupuesto por frame, medido bien.
//
// Corrige DOS fallos de método de las sondas anteriores:
//
//  1. measure-density.ts y verify-combined.ts empezaban a muestrear justo después de un
//     `update()`, así que los primeros frames incluían la cola del re-muestreo (de ahí un
//     `max` de 46 ms que no era trabajo de frame). Aquí se deja asentar y se descarta una
//     pasada de calentamiento antes de medir.
//
//  2. Más importante: `BLEED_CELLS = 26` y `pointerRadius = 6` están en CELDAS. Al bajar la
//     celda de 7.56 a 4.00 px el efecto del puntero y la sangría se encogen físicamente un
//     47 % — el coste por frame parecía plano porque el efecto se hacía más pequeño, no
//     porque el pintado fuese gratis. Para comparar de verdad hace falta una variante con el
//     radio escalado que conserve el tamaño físico del efecto.
//     (`BLEED_CELLS` es una constante de módulo y no se puede tocar en caliente; aquí se
//     escala solo `pointerRadius`, así que la variante 4 es una COTA INFERIOR del coste real
//     de conservar el efecto.)

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4185;
const URL = `http://localhost:${PORT}/?debug`;
const OUT = resolve('screenshots', 'combined');
const CLIP = { x: 792, y: 0, width: 648, height: 900 };
const BUDGET = 4.0;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Cfg {
  name: string;
  cellW: number;
  cellH: number;
  smooth: number;
  highlightDelta: number;
  pointerRadius: number;
}

const CFGS: Cfg[] = [
  {
    name: '1  7.56 / 1.0 / 0.12  r6   (lo que hay hoy)',
    cellW: 7.56,
    cellH: 7.56,
    smooth: 1.0,
    highlightDelta: 0.12,
    pointerRadius: 6,
  },
  {
    name: '2  7.56 / 0.6 / 0.16  r6   (pareja aprobada)',
    cellW: 7.56,
    cellH: 7.56,
    smooth: 0.6,
    highlightDelta: 0.16,
    pointerRadius: 6,
  },
  {
    name: '3  4.00 / 0.6 / 0.11  r6   (combinada, radio sin tocar)',
    cellW: 4,
    cellH: 4,
    smooth: 0.6,
    highlightDelta: 0.11,
    pointerRadius: 6,
  },
  {
    name: '4  4.00 / 0.6 / 0.11  r11  (efecto a tamaño fisico igual)',
    cellW: 4,
    cellH: 4,
    smooth: 0.6,
    highlightDelta: 0.11,
    pointerRadius: 11,
  },
];

async function apply(page: Page, c: Cfg): Promise<void> {
  await page.evaluate((cfg) => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    (window as any).__asciiPortrait.update({
      cellW: cfg.cellW,
      cellH: cfg.cellH,
      smooth: cfg.smooth,
      highlightDelta: cfg.highlightDelta,
      pointerRadius: cfg.pointerRadius,
    });
  }, c);
  await sleep(900); // asentar: que la cola del re-muestreo no caiga dentro de la ventana
}

/** Una pasada del cursor sobre el retrato. `record: false` = calentamiento a descartar. */
async function sweep(page: Page, record: boolean): Promise<void> {
  if (record) {
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
  }
  for (let i = 0; i < 110; i++) {
    const t = i / 109;
    const x = CLIP.x + CLIP.width * (0.15 + 0.7 * t);
    const y = CLIP.y + CLIP.height * (0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * Math.PI * 3)));
    await page.mouse.move(x, y);
    await sleep(16);
  }
}

async function collect(
  page: Page,
): Promise<{ p50: number; p95: number; p99: number; max: number; painted: number; samples: number }> {
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
      p99: q(hot, 0.99),
      max: hot.length ? (hot[hot.length - 1] as number) : 0,
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

    // Calentamiento global del proceso
    await apply(page, CFGS[0] as Cfg);
    await sweep(page, false);

    say(
      `Presupuesto §8: ${BUDGET.toFixed(1)} ms/frame · cursor en movimiento (peor caso) · 2 pasadas, la 1a se descarta`,
    );
    say('');
    say(
      '  configuracion                                        alcance   p50     p95     p99     max     veredicto',
    );
    say(
      '                                                       fisico    ms      ms      ms      ms      (p95)',
    );

    const rows: Array<{ c: Cfg; r: Awaited<ReturnType<typeof collect>> }> = [];
    for (const c of CFGS) {
      await apply(page, c);
      await sweep(page, false); // calentamiento por configuracion
      await sleep(300);
      await sweep(page, true);
      const r = await collect(page);
      rows.push({ c, r });

      const alcance = c.pointerRadius * c.cellW; // px CSS que abarca el disco del puntero
      say(
        `  ${c.name.padEnd(50)}  ${alcance.toFixed(0).padStart(4)} px   ${r.p50.toFixed(2).padStart(5)}   ${r.p95.toFixed(2).padStart(5)}   ${r.p99.toFixed(2).padStart(5)}   ${r.max.toFixed(2).padStart(5)}   ${r.p95 <= BUDGET ? 'OK' : 'ROMPE'}`,
      );
    }

    say('');
    say('Nota: el alcance de la SANGRIA (BLEED_CELLS = 26 celdas) no se puede escalar en caliente.');
    say('A celda 4.00 pasa de 197 a 104 px CSS: el efecto insignia se encoge a la mitad aunque');
    say('el retrato gane detalle. La fila 4 solo corrige el radio del puntero, asi que su coste');
    say('es una COTA INFERIOR del de conservar los dos efectos a su tamaño actual.');

    await browser.close();
    writeFileSync(join(OUT, 'budget.txt'), report.join('\n'), 'utf8');
    console.log(`\nReport en ${join(OUT, 'budget.txt')}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
