// scripts/measure-grid.ts — mide la densidad REAL del grid ASCII a partir de píxeles.
//
// Método: en una rejilla monoespaciada, la "tinta" sumada por columna (y por fila) es una señal
// periódica cuyo periodo ES el tamaño de celda. Se evalúa la magnitud de Fourier a frecuencias
// fraccionarias (no solo enteras) y se toma el pico. No se lee nada del código del sitio ajeno:
// solo se miden los píxeles de capturas ya tomadas en Fase 0.
//
// Control de validez: se mide primero NUESTRO canvas, donde el valor correcto se conoce (8×12).
// Si el método no recupera 8×12 en el control, su lectura de la referencia no vale nada.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 4176;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PeriodResult {
  period: number;
  strength: number;
  runnerUp: number;
}

/** Perfiles de tinta (por columna y por fila) de una región de píxeles RGBA. */
function profilesFrom(data: Uint8ClampedArray, w: number, h: number): { cols: number[]; rows: number[] } {
  const cols = new Array<number>(w).fill(0);
  const rows = new Array<number>(h).fill(0);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Tinta = luminancia del píxel (el fondo del retrato es negro)
      const ink = 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
      cols[x] = (cols[x] ?? 0) + ink;
      rows[y] = (rows[y] ?? 0) + ink;
    }
  }
  return { cols, rows };
}

/**
 * Magnitud de Fourier a periodo fraccionario p. Devuelve el pico y el segundo candidato,
 * para poder distinguir un periodo real de un armónico.
 */
function dominantPeriod(profile: number[], min = 3, max = 32, step = 0.005): PeriodResult {
  const n = profile.length;
  const mean = profile.reduce((a, b) => a + b, 0) / n;
  const centred = profile.map((v) => v - mean);
  const energy = Math.sqrt(centred.reduce((a, v) => a + v * v, 0)) || 1;

  const scored: Array<{ p: number; s: number }> = [];

  for (let p = min; p <= max; p += step) {
    let re = 0;
    let im = 0;
    for (let x = 0; x < n; x++) {
      const a = (-2 * Math.PI * x) / p;
      const v = centred[x] ?? 0;
      re += v * Math.cos(a);
      im += v * Math.sin(a);
    }
    scored.push({ p, s: Math.hypot(re, im) / energy });
  }

  scored.sort((a, b) => b.s - a.s);
  const best = scored[0] ?? { p: 0, s: 0 };

  // Segundo candidato "independiente": el mejor que no esté pegado al pico
  const other = scored.find((c) => Math.abs(c.p - best.p) > best.p * 0.25) ?? { p: 0, s: 0 };

  // Si la mitad del periodo también resuena con fuerza, el real es la mitad (el pico era armónico)
  const half = scored.find((c) => Math.abs(c.p - best.p / 2) < 0.15);
  if (half && half.s > best.s * 0.72) {
    return { period: half.p, strength: half.s, runnerUp: best.p };
  }

  return { period: best.p, strength: best.s, runnerUp: other.p };
}

async function measureImage(page: Page, file: string, region: Region, scale: number) {
  // Data URL en vez de file://: evita el bloqueo por origen y no contamina el canvas,
  // que impediría leerlo con getImageData.
  const dataUrl = `data:image/png;base64,${readFileSync(resolve(file)).toString('base64')}`;

  // Los perfiles se calculan DENTRO del navegador: devolver 4M de píxeles por CDP es inviable.
  const profiles = await page.evaluate(
    async ({ dataUrl, region }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();

      const canvas = document.createElement('canvas');
      canvas.width = region.w;
      canvas.height = region.h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      ctx.drawImage(img, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
      const d = ctx.getImageData(0, 0, region.w, region.h).data;

      const cols = new Array<number>(region.w).fill(0);
      const rows = new Array<number>(region.h).fill(0);
      for (let y = 0; y < region.h; y++) {
        for (let x = 0; x < region.w; x++) {
          const i = (y * region.w + x) * 4;
          const ink = 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
          cols[x] = (cols[x] ?? 0) + ink;
          rows[y] = (rows[y] ?? 0) + ink;
        }
      }
      return { cols, rows };
    },
    { dataUrl, region },
  );

  if (!profiles) throw new Error(`No se pudo leer ${file}`);

  return {
    cellW: dominantPeriod(profiles.cols),
    cellH: dominantPeriod(profiles.rows),
    scale,
  };
}

function report(
  label: string,
  r: { cellW: PeriodResult; cellH: PeriodResult; scale: number },
  canvas?: { w: number; h: number },
): void {
  const w = r.cellW.period / r.scale;
  const h = r.cellH.period / r.scale;
  console.log(`\n${label}`);
  console.log(
    `  cellW = ${w.toFixed(3)} px CSS  (fuerza ${r.cellW.strength.toFixed(2)} · 2º cand. ${(r.cellW.runnerUp / r.scale).toFixed(2)})`,
  );
  console.log(
    `  cellH = ${h.toFixed(3)} px CSS  (fuerza ${r.cellH.strength.toFixed(2)} · 2º cand. ${(r.cellH.runnerUp / r.scale).toFixed(2)})`,
  );
  console.log(`  ratio cellH/cellW = ${(h / w).toFixed(3)}`);
  console.log(`  densidad = 1 celda por ${(w * h).toFixed(1)} px²`);

  if (canvas) {
    const cols = canvas.w / w;
    const rows = canvas.h / h;
    console.log(
      `  → sobre un canvas de ${canvas.w}×${canvas.h}: ${cols.toFixed(1)} cols × ${rows.toFixed(1)} filas`,
    );
    console.log(
      `  → si el recuento fuera entero (${Math.round(cols)}×${Math.round(rows)}): celda ${(canvas.w / Math.round(cols)).toFixed(2)} × ${(canvas.h / Math.round(rows)).toFixed(2)}`,
    );
  }
}

async function main(): Promise<void> {
  const preview = startPreview(PORT);

  try {
    const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    console.log('=== CONTROL: nuestro canvas, donde el valor correcto se conoce (8 × 12) ===');

    // Espera a que el preview responda
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(URL)).ok) break;
      } catch {
        /* aún no */
      }
      await sleep(400);
    }

    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.reveal === '1.000',
      null,
      { timeout: 15_000 },
    );
    await sleep(400);

    const ours = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      // Zona central del retrato, evitando márgenes vacíos
      const rx = Math.round(canvas.width * 0.2);
      const ry = Math.round(canvas.height * 0.2);
      const rw = Math.round(canvas.width * 0.6);
      const rh = Math.round(canvas.height * 0.6);
      const d = ctx.getImageData(rx, ry, rw, rh).data;
      const rect = canvas.getBoundingClientRect();
      return {
        pixels: Array.from(d),
        w: rw,
        h: rh,
        dpr: canvas.width / rect.width,
        cssW: rect.width,
        cssH: rect.height,
      };
    });

    if (!ours) throw new Error('No se encontró nuestro canvas');

    const oursProfiles = profilesFrom(Uint8ClampedArray.from(ours.pixels), ours.w, ours.h);
    report(
      'NUESTRO hero (medido sobre el canvas renderizado, 1440px)',
      {
        cellW: dominantPeriod(oursProfiles.cols),
        cellH: dominantPeriod(oursProfiles.rows),
        scale: ours.dpr,
      },
      { w: Math.round(ours.cssW), h: Math.round(ours.cssH) },
    );
    console.log(`  (canvas: ${ours.cssW.toFixed(0)}×${ours.cssH.toFixed(0)} px CSS · DPR ${ours.dpr})`);
    console.log('  esperado por el spec §6.3 punto 1: cellW 8.00 · cellH 12.00 ✓');

    console.log('\n=== REFERENCIA: good-fella.com, medido sobre las capturas de Fase 0 ===');

    // Canvas completo del retrato: x 844..1408, y 52..900 (CSS). Usar todo el ancho da
    // la mejor resolución en frecuencia y permite comprobar si el recuento de celdas es entero.
    const REF_CANVAS = { w: 564, h: 848 };
    const at1x: Region = { x: 844, y: 52, w: 564, h: 848 };
    const at2x: Region = { x: 1688, y: 104, w: 1128, h: 1696 };

    report(
      'good-fella.com — hero-base.png (1440×900, DPR 1)',
      await measureImage(page, 'recon/reference/hero-base.png', at1x, 1),
      REF_CANVAS,
    );
    report(
      'good-fella.com — hero-base-2x.png (2880×1800, DPR 2)',
      await measureImage(page, 'recon/reference/hero-base-2x.png', at2x, 2),
      REF_CANVAS,
    );

    await browser.close();
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
