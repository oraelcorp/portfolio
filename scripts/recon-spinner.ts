// scripts/recon-spinner.ts — averigua QUÉ anima el indicador de carga de la referencia,
// sin asumir que gira. Localiza el overlay por su color de marca, vuelca su subárbol y
// muestrea todas las propiedades candidatas de cada descendiente en cada rAF.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon');

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.addInitScript(() => {
    interface Frame {
      t: number;
      nodes: Array<{
        i: number;
        transform: string;
        w: number;
        h: number;
        x: number;
        y: number;
        opacity: string;
        bg: string;
        clip: string;
      }>;
    }

    const w = window as unknown as {
      __probe: { frames: Frame[]; html: string; overlayGoneAt: number; t0: number; cssAnim: string[] };
    };
    w.__probe = { frames: [], html: '', overlayGoneAt: -1, t0: performance.now(), cssAnim: [] };

    /** El overlay del preloader es lo único a pantalla completa con el naranja de marca. */
    const findOverlay = (): HTMLElement | null => {
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width < innerWidth * 0.9 || r.height < innerHeight * 0.9) continue;
        const bg = getComputedStyle(el).backgroundColor;
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
        if (!m) continue;
        const r0 = Number(m[1]);
        const g0 = Number(m[2]);
        const b0 = Number(m[3]);
        // Naranja saturado: R alto, G medio, B bajo
        if (r0 > 200 && g0 > 40 && g0 < 140 && b0 < 70) return el;
      }
      return null;
    };

    const tick = (): void => {
      const t = performance.now() - w.__probe.t0;
      const overlay = findOverlay();

      if (overlay) {
        if (!w.__probe.html) {
          w.__probe.html = overlay.outerHTML.slice(0, 4000);
          // Animaciones CSS declaradas en el subárbol
          for (const el of [overlay, ...overlay.querySelectorAll<HTMLElement>('*')]) {
            const cs = getComputedStyle(el);
            if (cs.animationName !== 'none') {
              w.__probe.cssAnim.push(
                `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} → ${cs.animationName} ${cs.animationDuration} ${cs.animationTimingFunction} ${cs.animationIterationCount} ${cs.animationDirection}`,
              );
            }
          }
        }

        const kids = [overlay, ...overlay.querySelectorAll<HTMLElement>('*')].slice(0, 14);
        w.__probe.frames.push({
          t,
          nodes: kids.map((el, i) => {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return {
              i,
              transform: cs.transform,
              w: Math.round(r.width * 100) / 100,
              h: Math.round(r.height * 100) / 100,
              x: Math.round(r.left * 100) / 100,
              y: Math.round(r.top * 100) / 100,
              opacity: cs.opacity,
              bg: cs.backgroundColor,
              clip: cs.clipPath,
            };
          }),
        });
      } else if (w.__probe.frames.length > 0 && w.__probe.overlayGoneAt < 0) {
        w.__probe.overlayGoneAt = t;
      }

      if (t < 7000) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });

  await page.goto(URL, { waitUntil: 'commit', timeout: 60_000 });
  await page.waitForTimeout(7500);

  const data = await page.evaluate(() => {
    const w = window as unknown as { __probe: unknown };
    return w.__probe;
  });

  writeFileSync(join(OUT, 'spinner.json'), JSON.stringify(data, null, 1), 'utf8');

  const d = data as {
    frames: Array<{ t: number; nodes: Array<Record<string, unknown>> }>;
    html: string;
    overlayGoneAt: number;
    cssAnim: string[];
  };

  console.log(
    `overlay visible durante ${d.frames.length} frames · desaparece a los ${Math.round(d.overlayGoneAt)} ms\n`,
  );

  console.log('=== animaciones CSS declaradas ===');
  console.log(d.cssAnim.length ? d.cssAnim.join('\n') : '  (ninguna)');

  console.log('\n=== estructura del overlay ===');
  console.log(d.html.replace(/></g, '>\n<').split('\n').slice(0, 14).join('\n'));

  console.log('\n=== qué propiedades cambian, por nodo ===');
  const n = d.frames[0]?.nodes.length ?? 0;
  for (let i = 0; i < n; i++) {
    const series = d.frames.map((f) => f.nodes[i] ?? {});
    const varies = (key: string): boolean => new Set(series.map((s) => String(s[key]))).size > 1;
    const changed = ['transform', 'w', 'h', 'x', 'y', 'opacity', 'bg', 'clip'].filter(varies);
    if (changed.length === 0) continue;

    const first = series[0] ?? {};
    console.log(`\nnodo ${i} (${first.w}×${first.h} px) cambia: ${changed.join(', ')}`);
    for (const key of changed.slice(0, 3)) {
      const vals = [...new Set(series.map((s) => String(s[key])))];
      console.log(
        `  ${key}: ${vals.slice(0, 6).join(' | ')}${vals.length > 6 ? ` … (${vals.length} valores)` : ''}`,
      );
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
