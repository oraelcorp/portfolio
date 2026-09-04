// scripts/check-preloader.ts — mide NUESTRO preloader desde dentro de la página (rAF), no por
// capturas: geometría de la pista, ángulos de cada vuelco, estados del label y cuánto tarda el
// overlay en cubrir la pantalla desde el primer paint.

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4184;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Probe {
  firstPaint: number;
  overlayAt: number;
  geom: { track: number[]; blocks: number[][] } | null;
  samples: Array<{ t: number; deg: number[]; label: string; setChars: number }>;
  goneAt: number;
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
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript(() => {
    const w = window as unknown as { __pl: Probe };
    interface Probe {
      firstPaint: number;
      overlayAt: number;
      geom: { track: number[]; blocks: number[][] } | null;
      samples: Array<{ t: number; deg: number[]; label: string; setChars: number }>;
      goneAt: number;
    }
    w.__pl = { firstPaint: -1, overlayAt: -1, geom: null, samples: [], goneAt: -1 };

    // Cuándo pinta el navegador por primera vez, para saber cuánto dura el destello en blanco.
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.name === 'first-contentful-paint' && w.__pl.firstPaint < 0) {
            w.__pl.firstPaint = e.startTime;
          }
        }
      }).observe({ type: 'paint', buffered: true });
    } catch {
      /* sin soporte: se queda en -1 */
    }

    const tick = (): void => {
      const t = performance.now();
      const el = document.querySelector<HTMLElement>('[data-preloader]');
      const visible = el && !el.hasAttribute('hidden') && getComputedStyle(el).display !== 'none';

      if (visible && el) {
        if (w.__pl.overlayAt < 0) w.__pl.overlayAt = t;

        const track = el.querySelector<HTMLElement>('.preloader__track');
        const blocks = [...el.querySelectorAll<HTMLElement>('[data-block]')];
        if (!w.__pl.geom && track) {
          const r = track.getBoundingClientRect();
          w.__pl.geom = {
            track: [Math.round(r.width), Math.round(r.height)],
            blocks: blocks.map((b) => {
              const q = b.getBoundingClientRect();
              return [Math.round(q.width), Math.round(q.height)];
            }),
          };
        }

        const deg = blocks.map((b) => {
          const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(b).transform);
          if (!m) return 0;
          const v = (m[1] ?? '').split(',').map(Number);
          return Math.round((Math.atan2(v[1] ?? 0, v[0] ?? 1) * 180) / Math.PI);
        });

        const lab = el.querySelector<HTMLElement>('[data-loading-label]');
        w.__pl.samples.push({
          t,
          deg,
          label: lab?.textContent ?? '',
          setChars: lab?.querySelectorAll('.is-set').length ?? 0,
        });
      } else if (w.__pl.overlayAt >= 0 && w.__pl.goneAt < 0) {
        w.__pl.goneAt = t;
      }

      if (t < 9000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.goto(URL, { waitUntil: 'commit' });
  await sleep(9500);

  const d = (await page.evaluate(() => (window as unknown as { __pl: Probe }).__pl)) as Probe;
  writeFileSync(join(OUT, 'preloader-probe.json'), JSON.stringify(d, null, 1), 'utf8');

  console.log(`first-contentful-paint: ${d.firstPaint < 0 ? 'n/d' : Math.round(d.firstPaint) + ' ms'}`);
  console.log(`overlay visible desde:  ${Math.round(d.overlayAt)} ms`);
  console.log(`destello sin overlay:   ${Math.round(d.overlayAt - Math.max(0, d.firstPaint))} ms`);
  console.log(`overlay retirado a los: ${d.goneAt < 0 ? 'no se fue' : Math.round(d.goneAt) + ' ms'}`);
  console.log(
    `geometría: pista ${d.geom?.track.join('×')} · bloques ${d.geom?.blocks.map((b) => b.join('×')).join(' ')}`,
  );

  const n = d.samples[0]?.deg.length ?? 0;
  for (let i = 0; i < n; i++) {
    const series = d.samples.map((s) => s.deg[i] ?? 0);
    const start = d.samples.find((s) => (s.deg[i] ?? 0) > 1);
    const end = d.samples.find((s) => (s.deg[i] ?? 0) >= 89);
    console.log(
      `bloque ${i}: ${Math.min(...series)}° → ${Math.max(...series)}°` +
        (start && end ? ` · vuelca en ${Math.round(end.t - start.t)} ms` : ' · sin vuelco'),
    );
  }

  const labels = [...new Set(d.samples.map((s) => s.label))];
  const maxSet = Math.max(...d.samples.map((s) => s.setChars));
  console.log(
    `\nlabel: ${labels.length} estados · ${maxSet} caracteres con .is-set (0 = el newClass no se aplica)`,
  );
  console.log(
    '  ' +
      labels
        .slice(0, 14)
        .map((l) => JSON.stringify(l))
        .join(' → '),
  );
  console.log(`\nerrores de consola: ${errors.length === 0 ? 'ninguno' : errors.join(' | ')}`);

  await browser.close();
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
