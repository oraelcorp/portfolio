// scripts/check-gl-parity.ts — ¿el motor WebGL produce el MISMO retrato que el Canvas 2D?
//
// La comparación se hace con la MISMA fuente (la foto) en los dos motores, con `?glphoto`.
// Comparar GL+vídeo contra 2D+foto mezclaría el cambio de motor con el cambio de material y
// no demostraría nada sobre la paridad.
//
// Se clasifica sobre la CAPTURA de pantalla, no leyendo el canvas desde la página. Primera
// versión de esta sonda hacía `drawImage(canvasWebGL)` a un canvas 2D y contaba ahí: daba 178
// celdas con tinta frente a las 9517 del 2D, o sea "el motor WebGL no pinta nada" — mientras
// que la captura del mismo render mostraba el retrato completo y la textura de luma tenía
// 9442 celdas por encima del umbral. El error estaba en la LECTURA, no en el render. La
// captura pasa por el compositor, que es lo que ve el usuario, y funciona igual en los dos
// motores; leer el drawing buffer de WebGL desde la página, no.
//
// Clasificación por CELDA con el mismo criterio de saturación que `verify-color-mapping.ts`
// usa sobre la referencia: color medio de la tinta de la celda y umbral de saturación. Contar
// por píxel no sería comparable entre motores porque el antialiasing del rasterizador de
// texto y el del muestreo del atlas no son iguales.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4194;
const OUT = resolve('screenshots', 'gl');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Celda en px CSS. El DPR de la captura lo aporta `deviceScaleFactor`. */
const CELL = 4;
const DPR = 2;

interface Classified {
  accent: number;
  white: number;
  other: number;
  inked: number;
  hlPct: number;
  ink: number;
  grid: string;
}

/** Caja del canvas del retrato en px CSS, leída de la página (cambia con el layout). */
async function canvasBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
    if (!c) throw new Error('sin canvas');
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return box;
}

/** PNG -> RGBA cruda con ffmpeg, para no meter un decodificador de imágenes como dependencia. */
function toRaw(png: string, w: number, h: number): Buffer {
  const raw = png.replace(/\.png$/, '.rgba');
  execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgba', raw, '-y']);
  const b = readFileSync(raw);
  if (b.length !== w * h * 4) throw new Error(`Tamaño inesperado: ${b.length} vs ${w * h * 4}`);
  return b;
}

function classify(d: Buffer, w: number, h: number): Classified {
  const px = CELL * DPR;
  const cols = Math.floor(w / px);
  const rows = Math.floor(h / px);
  let accent = 0;
  let white = 0;
  let other = 0;
  let inkTotal = 0;

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let ink = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      const x0 = cx * px;
      const y0 = cy * px;

      for (let y = y0; y < Math.min(h, y0 + px); y++) {
        for (let x = x0; x < Math.min(w, x0 + px); x++) {
          const i = (y * w + x) * 4;
          const pr = d[i] ?? 0;
          const pg = d[i + 1] ?? 0;
          const pb = d[i + 2] ?? 0;
          const lum = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
          if (lum < 26) continue;
          ink += lum;
          r += pr * lum;
          g += pg * lum;
          b += pb * lum;
        }
      }

      if (ink === 0) continue;
      inkTotal += ink;
      r /= ink;
      g /= ink;
      b /= ink;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max < 12) continue;
      const sat = (max - min) / max;
      if (sat < 0.18) white++;
      else if (sat > 0.3 && g === max) accent++;
      else other++;
    }
  }

  const inked = accent + white + other;
  return {
    accent,
    white,
    other,
    inked,
    hlPct: accent + white > 0 ? (white / (accent + white)) * 100 : 0,
    ink: inkTotal / (w * h),
    grid: `${cols}x${rows}`,
  };
}

async function shoot(page: Page, name: string): Promise<Classified> {
  const box = await canvasBox(page);
  const clip = {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
  const png = join(OUT, `${name}.png`);
  await page.screenshot({ path: png, clip });
  const w = clip.width * DPR;
  const h = clip.height * DPR;
  return classify(toRaw(png, w, h), w, h);
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });

    say('== PARIDAD 2D vs WebGL — MISMA FOTO en los dos motores ==');
    say('');

    // ---- Canvas 2D
    await page.goto(`http://localhost:${PORT}/?debug`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
    await sleep(4500);
    await page.addStyleTag({ content: '.ascii-debug{visibility:hidden}' });
    const a = await shoot(page, 'parity-2d');

    // ---- WebGL con la misma foto
    await page.goto(`http://localhost:${PORT}/?gl&glphoto`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReady === '1',
      null,
      { timeout: 20_000 },
    );
    // Esperar a que la onda de entrada TERMINE: medir a mitad del barrido no compara nada.
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
      null,
      { timeout: 25_000 },
    );
    await sleep(800);
    const b = await shoot(page, 'parity-gl');

    const row = (label: string, x: number, y: number, fmt = 0): void => {
      const delta = y - x;
      const pct = x !== 0 ? (delta / x) * 100 : 0;
      say(
        `   ${label.padEnd(28)} ${x.toFixed(fmt).padStart(9)}  ${y.toFixed(fmt).padStart(9)}   ${(delta >= 0 ? '+' : '') + delta.toFixed(fmt)}  (${(pct >= 0 ? '+' : '') + pct.toFixed(1)} %)`,
      );
    };

    say(`   grid: 2D ${a.grid} · GL ${b.grid}`);
    say('');
    say('                                    Canvas 2D      WebGL       diferencia');
    row('celdas con tinta', a.inked, b.inked);
    row('celdas de acento', a.accent, b.accent);
    row('celdas blancas (highlight)', a.white, b.white);
    row('% highlights sobre tinta', a.hlPct, b.hlPct, 1);
    row('peso visual (tinta media)', a.ink, b.ink, 2);
    say('');
    say('   Referencia de good-fella.com: 24.0 % de highlights.');

    await browser.close();
    writeFileSync(join(OUT, 'parity.txt'), report.join('\n'), 'utf8');
    console.log(`\nReport en ${join(OUT, 'parity.txt')}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
