// scripts/check-pelaje-loop.ts — la región del pelaje es ESPACIAL y el jaguar se MUEVE.
//
// El corte en x>0.55 es una decisión de diseño, no un dato, y tiene un riesgo conocido: con
// vídeo, una zona por coordenadas cae sobre partes distintas del animal según el instante. Ya
// pasó con el mapa de bloques (los números de la mandíbula eran del hombro en otra pose).
//
// Aquí se comprueba a lo largo del bucle: se congela en varios instantes y se mide el reparto
// de la tinta y, sobre todo, si el dorado se mete donde no debe.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import type { VentanaSonda } from './lib/motor.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4268;
const OUT = resolve('screenshots', 'pelaje');
const INSTANTES = [0.5, 2.0, 3.5, 5.0, 6.5];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TOPE_MS = 8 * 60 * 1000;
const guardian = setTimeout(() => {
  console.error(`FATAL: la sonda pasó de ${TOPE_MS / 1000}s. Se corta para no dejar huérfanos.`);
  process.exit(1);
}, TOPE_MS);
guardian.unref?.();

const preview = startPreview(PORT);
const L: string[] = [];
const say = (s = ''): void => {
  console.log(s);
  L.push(s);
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
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.bringToFront();
  await page.waitForFunction(
    () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
    null,
    { timeout: 40_000 },
  );
  await page.evaluate(`(() => {
    const g = window.__asciiGL;
    g.frozen = true; g.source.pause();
    g.colorBase = 1; g.colorTarget = 1; g.colorR = 1e6;
  })()`);

  say('== EL PELAJE DORADO A LO LARGO DEL BUCLE · región espacial, sujeto en movimiento ==');
  say('   (porcentajes sobre la tinta pintada; "dorado" = los tonos forzados de la rampa)');
  say('');
  say('   instante   cálidas   dorado   blancas   grises   rojo   celdas con tinta');

  for (const t of INSTANTES) {
    await page.evaluate(async (tt) => {
      const g = (window as VentanaSonda).__asciiGL as unknown as {
        source: HTMLVideoElement;
      };
      await new Promise<void>((res) => {
        const on = (): void => {
          g.source.removeEventListener('seeked', on);
          res();
        };
        g.source.addEventListener('seeked', on);
        g.source.currentTime = tt;
        setTimeout(on, 800);
      });
    }, t);
    await sleep(800);

    const r = (await page.evaluate(`(() => {
      const c = document.querySelector('[data-ascii]');
      const off = document.createElement('canvas');
      off.width = c.width; off.height = c.height;
      const x = off.getContext('2d', { willReadFrequently: true });
      x.drawImage(c, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      // Los tres tonos forzados, normalizados por su canal máximo.
      const DORADOS = [[152,88,26],[198,126,38],[223,172,80]].map((v) => {
        const m = Math.max(v[0], v[1], v[2]);
        return [v[0]/m, v[1]/m, v[2]/m];
      });
      let tinta = 0, calidas = 0, dorado = 0, blancas = 0, grises = 0, rojo = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i+1], B = d[i+2];
        if (R + G + B < 60) continue;
        tinta++;
        const mx = Math.max(R, G, B) || 1, mn = Math.min(R, G, B);
        const croma = (mx - mn) / 255;
        if (croma < 0.06) { if (mx > 220) blancas++; else grises++; continue; }
        if (B > R && B > G) { grises++; continue; }
        if (R > 120 && G < R * 0.55 && B < R * 0.8 && B >= G) { rojo++; continue; }
        calidas++;
        for (const v of DORADOS) {
          if (Math.abs(R/mx - v[0]) + Math.abs(G/mx - v[1]) + Math.abs(B/mx - v[2]) < 0.07) { dorado++; break; }
        }
      }
      return { tinta, calidas, dorado, blancas, grises, rojo };
    })()`)) as Record<string, number>;

    const pct = (v: number): string => ((v / Math.max(1, r.tinta!)) * 100).toFixed(1).padStart(7);
    say(
      `   ${t.toFixed(1).padStart(8)} s ${pct(r.calidas!)} % ${pct(r.dorado!)} % ${pct(r.blancas!)} % ${pct(r.grises!)} % ${pct(r.rojo!)} %   ${String(r.tinta).padStart(8)}`,
    );
    await page.locator('[data-ascii]').screenshot({ path: join(OUT, `loop-t${t.toFixed(1)}.png`) });
  }

  writeFileSync(join(OUT, 'pelaje-loop.txt'), L.join('\n'), 'utf8');
  say('');
  say(`Capturas del bucle en ${OUT}`);
  await ctx.close();
  await browser.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
