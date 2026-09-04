// scripts/compare-reveal.ts — compara variantes de duración/curva de la onda del retrato.
// Captura por PROGRESO del barrido (data-reveal), no por reloj: cada captura cuesta ~150 ms y
// las marcas de tiempo mentirían. Además mide cuánto tiempo real pasa la cresta en pantalla,
// que es lo que decide si el efecto se siente como un evento o como un parpadeo.
// Salida en screenshots/reveal-compare.png (gitignored).

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4185;
const URL = `http://localhost:${PORT}/?debug`;
const OUT = resolve('screenshots');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** El retrato ocupa la mitad derecha del hero. */
const CLIP = { x: 800, y: 40, width: 620, height: 720 };
/** Fracciones del barrido en las que se toma una viñeta. */
const STOPS = [0.08, 0.22, 0.4, 0.6, 0.82, 1];

interface Variant {
  label: string;
  duration: number;
  ease: string;
}

const VARIANTS: Variant[] = [
  { label: 'actual  1.9 s · silk', duration: 1.9, ease: 'silk' },
  { label: 'propuesta  3.2 s · power1.out', duration: 3.2, ease: 'power1.out' },
  { label: 'más larga  4.5 s · power1.out', duration: 4.5, ease: 'power1.out' },
];

/** Lanza el barrido con una configuración y devuelve la serie de progreso muestreada por rAF. */
async function runReveal(page: Page, v: Variant): Promise<number[]> {
  return page.evaluate(
    ({ duration, ease }) =>
      new Promise<number[]>((done) => {
        const w = window as unknown as {
          __asciiPortrait?: {
            opts: { revealDuration: number; revealEase: string };
            reveal: () => void;
          };
        };
        const p = w.__asciiPortrait;
        if (!p) {
          done([]);
          return;
        }
        p.opts.revealDuration = duration;
        p.opts.revealEase = ease;

        const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]');
        const series: number[] = [];
        p.reveal();

        const tick = (): void => {
          series.push(Number(canvas?.dataset.reveal ?? 0));
          if (series.length < 700 && Number(canvas?.dataset.reveal ?? 0) < 1) {
            requestAnimationFrame(tick);
          } else {
            done(series);
          }
        };
        requestAnimationFrame(tick);
      }),
    { duration: v.duration, ease: v.ease },
  );
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const preview = startPreview(PORT);
  await sleep(2500);

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(URL, { waitUntil: 'load' });
  await sleep(6000); // dejar pasar el preloader

  const rows: string[] = [];

  for (const v of VARIANTS) {
    // 1) Serie de progreso, para medir el ritmo real de la cresta.
    const series = await runReveal(page, v);
    const frames = series.length;
    const secs = frames / 60;
    // Cuánto del barrido ocurre en el primer 25 % del tiempo: si es casi todo, se ve un flash.
    const q = series[Math.floor(frames * 0.25)] ?? 0;
    // Tiempo que la cresta tarda en cruzar del 10 % al 90 % del recorrido: el tramo que se mira.
    const i10 = series.findIndex((s) => s >= 0.1);
    const i90 = series.findIndex((s) => s >= 0.9);
    const cruce = i10 >= 0 && i90 > i10 ? ((i90 - i10) / 60).toFixed(2) + ' s' : 'n/d';
    console.log(
      `${v.label.padEnd(30)} → ${secs.toFixed(2)} s reales · en el primer 25 % del tiempo ya va por el ${(q * 100).toFixed(0)} % · del 10 al 90 % tarda ${cruce}`,
    );

    // 2) Viñetas por progreso, no por tiempo.
    const shots: string[] = [];
    for (const stop of STOPS) {
      await page.evaluate(
        ({ duration, ease }) => {
          const w = window as unknown as {
            __asciiPortrait?: { opts: { revealDuration: number; revealEase: string }; reveal: () => void };
          };
          const p = w.__asciiPortrait;
          if (!p) return;
          p.opts.revealDuration = duration;
          p.opts.revealEase = ease;
          p.reveal();
        },
        { duration: v.duration, ease: v.ease },
      );
      await page.waitForFunction(
        (target) =>
          Number(document.querySelector('[data-ascii]')?.getAttribute('data-reveal') ?? 0) >= target,
        stop,
        { timeout: 15_000 },
      );
      const buf = await page.screenshot({ clip: CLIP });
      shots.push(
        `<figure><img src="data:image/png;base64,${buf.toString('base64')}"><figcaption>${Math.round(stop * 100)} %</figcaption></figure>`,
      );
    }
    rows.push(`<h2>${v.label} — del 10 al 90 % en ${cruce}</h2><div class="row">${shots.join('')}</div>`);
  }

  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0d0d0d;font:12px ui-monospace,monospace;color:#ddd;padding:14px}
    h2{font-size:13px;font-weight:400;color:#39ff6a;margin:16px 0 6px}
    .row{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}
    figure{margin:0}
    img{display:block;width:100%;outline:1px solid #2a2a2a}
    figcaption{padding-top:2px;text-align:center;color:#888}
  </style>${rows.join('')}`;

  const out = await ctx.newPage();
  await out.setContent(html);
  await out.waitForLoadState('networkidle');
  await (await out.$('body'))?.screenshot({ path: join(OUT, 'reveal-compare.png') });

  console.log(`\nerrores de consola: ${errors.length === 0 ? 'ninguno' : errors.join(' | ')}`);
  console.log('→ screenshots/reveal-compare.png');

  await browser.close();
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
