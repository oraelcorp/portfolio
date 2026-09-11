// scripts/check-gl-palette.ts — checkpoint 2.2: ¿la paleta `bands` del shader cae en las
// mismas bandas que la del Canvas 2D, y qué costó no poder portar las componentes conexas?
//
// Se compara el CAMPO DE LUMINANCIA por celda, no el color renderizado. La banda de Otsu se
// decide por luminancia, así que ahí es donde vive la respuesta.
//
// PRIMERA VERSIÓN DESCARTADA, y por qué: clasificaba cada celda por el ancla más cercana a su
// color medio de tinta. Dos sesgos la invalidaban. (a) Siena [124,46,22] y cobre [206,94,32]
// tienen casi la misma cromaticidad, así que el clasificador no las separaba: la banda 0 daba
// CERO celdas en LOS DOS motores, lo cual era la pista de que el medidor estaba roto. (b) Las
// celdas oscuras usan glifos ralos (".'`") y su tinta media caía bajo el umbral, así que se
// perdían. Con ese sesgo la sonda reportaba un +306 % en cobre que no era un error de la
// paleta sino del medidor — y estuve a punto de reportarlo como si lo fuera.
//
// El hocico: en 2D es tono + erosión + componentes conexas quedándose SOLO con la mayor. En un
// shader cada píxel ve su vecindad, no el grafo, así que se portaron tono y erosión pero no el
// paso de componentes (y precalcular la máscara en CPU tampoco vale: con vídeo la región se
// mueve). Aquí se aplica la MISMA regla a los dos campos desde Node para aislar exactamente
// ese coste, en vez de compararlo contra el recuento de píxeles rojos del render.

import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4199;
const OUT = resolve('screenshots', 'gl');
const CORTES = [0.328, 0.523, 0.727];
const INK = 0.12;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Field {
  cols: number;
  rows: number;
  luma: number[];
  rgb: number[]; // 0-1, tres por celda
}

function bandHistogram(f: Field): { bands: number[]; inked: number } {
  const bands = [0, 0, 0, 0];
  let inked = 0;
  for (const l of f.luma) {
    if (l < INK) continue;
    inked++;
    const b = l < CORTES[0]! ? 0 : l < CORTES[1]! ? 1 : l < CORTES[2]! ? 2 : 3;
    bands[b] = (bands[b] ?? 0) + 1;
  }
  return { bands, inked };
}

/** Tono + erosión: la parte del detector de hocico que SÍ se puede hacer en un shader. */
function hocicoErosionado(f: Field): Uint8Array {
  const { cols, rows } = f;
  const total = cols * rows;
  const cand = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if ((f.luma[i] ?? 0) < INK) continue;
    const r = f.rgb[i * 3] ?? 0;
    const g = f.rgb[i * 3 + 1] ?? 0;
    const b = f.rgb[i * 3 + 2] ?? 0;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const d = mx - mn;
    if (d === 0) continue;
    const sector = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const h = (sector * 60 + 360) % 360;
    if (h >= 300 || h < 10) cand[i] = 1;
  }
  const ero = new Uint8Array(total);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (cand[i] !== 1) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (cand[ny * cols + nx] === 1) n++;
        }
      }
      if (n >= 3) ero[i] = 1;
    }
  }
  return ero;
}

/** Tamaños de las componentes conexas de una máscara, de mayor a menor. */
function componentes(mask: Uint8Array, cols: number, rows: number): number[] {
  const total = cols * rows;
  const seen = new Uint8Array(total);
  const sizes: number[] = [];
  for (let s = 0; s < total; s++) {
    if (!mask[s] || seen[s]) continue;
    let n = 0;
    const stack = [s];
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
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    sizes.push(n);
  }
  return sizes.sort((a, b) => b - a);
}

async function field2D(browser: Browser): Promise<Field> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  try {
    // `?2d` es OBLIGATORIO aquí, no decorativo. Cuando se escribió esta sonda el motor por
    // defecto era el Canvas 2D y `?debug` bastaba; al invertirlo en la Fase 8, `?debug` a secas
    // pasó a cargar WebGL —que publica `glReveal`, no `reveal`, y no monta `__asciiPortrait`—
    // y la espera de abajo se quedaba colgada hasta agotar el timeout. Eso es lo que tumbaba
    // `npm run verify -- all` (2026-09-08 y 09).
    await page.goto(`http://localhost:${PORT}/?2d&debug`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.reveal === '1.000',
      null,
      { timeout: 25_000 },
    );
    return await page.evaluate(() => {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const p = (window as any).__asciiPortrait;
      return {
        cols: p.cols as number,
        rows: p.rows as number,
        luma: Array.from(p.luma as Float32Array),
        rgb: Array.from(p.rgb as Uint8ClampedArray, (v: number) => v / 255),
      };
    });
  } finally {
    await page.close();
  }
}

async function fieldGL(browser: Browser): Promise<Field> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  try {
    await page.goto(`http://localhost:${PORT}/?gl&glphoto&glpal=bands`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReady === '1',
      null,
      { timeout: 20_000 },
    );
    await sleep(1200);
    return await page.evaluate(() => {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const g = (window as any).__asciiGL;
      const gl = document.querySelector<HTMLCanvasElement>('[data-ascii]')?.getContext('webgl2');
      if (!gl) throw new Error('sin webgl2');
      const w = g.cols as number;
      const h = g.rows as number;
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const luma: number[] = [];
      const rgb: number[] = [];
      for (let i = 0; i < w * h; i++) {
        rgb.push((buf[i * 4] ?? 0) / 255, (buf[i * 4 + 1] ?? 0) / 255, (buf[i * 4 + 2] ?? 0) / 255);
        luma.push((buf[i * 4 + 3] ?? 0) / 255);
      }
      return { cols: w, rows: h, luma, rgb };
    });
  } finally {
    await page.close();
  }
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

    const browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: ['--autoplay-policy=no-user-gesture-required'],
    });

    const a = await field2D(browser);
    const b = await fieldGL(browser);
    await browser.close();

    say('== CHECKPOINT 2.2 — paleta `bands`, MISMA FOTO, campo de luminancia por celda ==');
    say('');
    say(`   rejilla: 2D ${a.cols}x${a.rows} · GL ${b.cols}x${b.rows}`);

    if (a.cols !== b.cols || a.rows !== b.rows) {
      say('   ⚠️ Rejillas distintas: la comparación celda a celda no aplica.');
    } else {
      let s = 0;
      let n = 0;
      let flips = 0;
      const bandOf = (l: number): number =>
        l < CORTES[0]! ? 0 : l < CORTES[1]! ? 1 : l < CORTES[2]! ? 2 : 3;
      for (let i = 0; i < a.luma.length; i++) {
        const x = a.luma[i] ?? 0;
        const y = b.luma[i] ?? 0;
        s += (x - y) ** 2;
        n++;
        if ((x >= INK || y >= INK) && bandOf(x) !== bandOf(y)) flips++;
      }
      say(`   RMS de luminancia celda a celda: ${Math.sqrt(s / n).toFixed(4)}`);
      say(`   celdas que cambian de banda: ${flips} (${((flips / n) * 100).toFixed(1)} % del campo)`);
    }

    const ha = bandHistogram(a);
    const hb = bandHistogram(b);
    say('');
    say(`   celdas con tinta: 2D ${ha.inked} · GL ${hb.inked}`);
    say('');
    say('   banda                    Canvas 2D     WebGL    diferencia');
    ['0 · siena', '1 · cobre', '2 · ámbar', '3 · blanco cálido'].forEach((name, i) => {
      const x = ha.bands[i] ?? 0;
      const y = hb.bands[i] ?? 0;
      const d = y - x;
      const pct = x !== 0 ? (d / x) * 100 : 0;
      say(
        `   banda ${name.padEnd(20)} ${String(x).padStart(6)}  ${String(y).padStart(6)}   ${(d >= 0 ? '+' : '') + d}  (${(pct >= 0 ? '+' : '') + pct.toFixed(1)} %)`,
      );
    });

    // ---- hocico: misma regla en los dos campos, para aislar el coste de las componentes
    const ea = hocicoErosionado(a);
    const eb = hocicoErosionado(b);
    const ca = componentes(ea, a.cols, a.rows);
    const cb = componentes(eb, b.cols, b.rows);
    const sum = (v: number[]): number => v.reduce((x, y) => x + y, 0);
    say('');
    say('   HOCICO — tono + erosión aplicados por igual a los dos campos:');
    say(`     2D: ${sum(ca)} celdas en ${ca.length} componentes  ${ca.slice(0, 6).join(', ')}`);
    say(`     GL: ${sum(cb)} celdas en ${cb.length} componentes  ${cb.slice(0, 6).join(', ')}`);
    say(
      `   El 2D se queda solo con la mayor (${ca[0] ?? 0} celdas). El shader no puede, así que pinta las ${cb.length} → ${sum(cb) - (cb[0] ?? 0)} celdas de más.`,
    );

    writeFileSync(join(OUT, 'palette.txt'), report.join('\n'), 'utf8');
    console.log(`\nReport en ${join(OUT, 'palette.txt')}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
