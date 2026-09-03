// scripts/verify-color-mapping.ts — comprueba con PÍXELES si en la referencia el acento es el
// color BASE y el blanco el HIGHLIGHT, o al revés (§6.3 punto 6, nota de duda).
//
// No se inspecciona el DOM ni variables CSS: su ASCII es WebGL y no expone color por celda.
// Se binea la imagen con el grid ya medido (7.56 px CSS) y por cada celda se calcula:
//   - color medio de su tinta  → clase (acento / blanco / otro) por tono y saturación
//   - cantidad de tinta        → proxy de la luminancia de la foto en esa celda
//   - contraste local          → tinta de la celda menos la media de sus 8 vecinas
// La hipótesis "acento = base, blanco = highlight" predice: (1) muchas más celdas acento que
// blancas, (2) las blancas con más tinta, y (3) las blancas con mayor contraste local.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Grid medido en scripts/measure-grid.ts (px CSS). */
const CELL = 7.56;

interface CellData {
  ink: number;
  r: number;
  g: number;
  b: number;
}

interface Sample {
  label: string;
  file: string;
  region: { x: number; y: number; w: number; h: number };
  scale: number;
}

const SAMPLES: Sample[] = [
  {
    label: 'good-fella.com (DPR 2)',
    file: 'recon/reference/hero-base-2x.png',
    region: { x: 1688, y: 104, w: 1128, h: 1696 },
    scale: 2,
  },
  {
    label: 'good-fella.com (DPR 1)',
    file: 'recon/reference/hero-base.png',
    region: { x: 844, y: 52, w: 564, h: 848 },
    scale: 1,
  },
];

/** Extrae, por celda del grid, tinta total y color medio ponderado por tinta. */
async function cellsFrom(page: Page, s: Sample): Promise<{ cells: CellData[]; cols: number; rows: number }> {
  const dataUrl = `data:image/png;base64,${readFileSync(resolve(s.file)).toString('base64')}`;
  const cellPx = CELL * s.scale;

  const result = await page.evaluate(
    async ({ dataUrl, region, cellPx }) => {
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

      const cols = Math.floor(region.w / cellPx);
      const rows = Math.floor(region.h / cellPx);
      const cells: Array<{ ink: number; r: number; g: number; b: number }> = [];

      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          let ink = 0;
          let r = 0;
          let g = 0;
          let b = 0;

          const x0 = Math.floor(cx * cellPx);
          const y0 = Math.floor(cy * cellPx);
          const x1 = Math.min(region.w, Math.floor((cx + 1) * cellPx));
          const y1 = Math.min(region.h, Math.floor((cy + 1) * cellPx));

          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const i = (y * region.w + x) * 4;
              const pr = d[i] ?? 0;
              const pg = d[i + 1] ?? 0;
              const pb = d[i + 2] ?? 0;
              const lum = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
              // Solo píxeles con tinta real: el fondo del retrato es negro
              if (lum < 26) continue;
              ink += lum;
              r += pr * lum;
              g += pg * lum;
              b += pb * lum;
            }
          }

          cells.push(ink > 0 ? { ink, r: r / ink, g: g / ink, b: b / ink } : { ink: 0, r: 0, g: 0, b: 0 });
        }
      }

      return { cells, cols, rows };
    },
    { dataUrl, region: s.region, cellPx },
  );

  if (!result) throw new Error(`No se pudo leer ${s.file}`);
  return result;
}

/** Clasifica el color medio de una celda por saturación y tono. */
function classify(c: CellData): 'accent' | 'white' | 'other' {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  if (max < 12) return 'other';

  const sat = (max - min) / max;

  // Neutro = los tres canales juntos → blanco/crema
  if (sat < 0.18) return 'white';
  // Cálido saturado con R dominante → el naranja de marca (#FD551D)
  if (sat > 0.3 && c.r === max && c.r > c.g && c.g >= c.b) return 'accent';
  return 'other';
}

function analyse(label: string, data: { cells: CellData[]; cols: number; rows: number }): void {
  const { cells, cols, rows } = data;
  const inked = cells.filter((c) => c.ink > 0);

  const groups: Record<string, CellData[]> = { accent: [], white: [], other: [] };
  const classOf = new Array<string>(cells.length);

  cells.forEach((c, i) => {
    const k = c.ink > 0 ? classify(c) : 'other';
    classOf[i] = k;
    if (c.ink > 0) groups[k]?.push(c);
  });

  // Contraste local: tinta de la celda menos la media de sus 8 vecinas
  const localContrast = (i: number): number => {
    const x = i % cols;
    const y = Math.floor(i / cols);
    let sum = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        sum += cells[ny * cols + nx]?.ink ?? 0;
        n++;
      }
    }
    return (cells[i]?.ink ?? 0) - (n > 0 ? sum / n : 0);
  };

  const contrastOf: Record<string, number[]> = { accent: [], white: [], other: [] };
  cells.forEach((c, i) => {
    if (c.ink > 0) contrastOf[classOf[i] ?? 'other']?.push(localContrast(i));
  });

  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const pct = (n: number): string => `${((n / inked.length) * 100).toFixed(1)} %`;

  console.log(`\n${label}`);
  console.log(`  grid ${cols}×${rows} · ${inked.length} celdas con tinta de ${cells.length}`);

  for (const k of ['accent', 'white', 'other'] as const) {
    const g = groups[k] ?? [];
    if (g.length === 0) continue;
    const avgColor = `rgb(${Math.round(mean(g.map((c) => c.r)))},${Math.round(mean(g.map((c) => c.g)))},${Math.round(mean(g.map((c) => c.b)))})`;
    console.log(
      `  ${k.padEnd(6)} ${String(g.length).padStart(5)} celdas (${pct(g.length).padStart(7)}) · color medio ${avgColor.padEnd(20)} · tinta media ${Math.round(
        mean(g.map((c) => c.ink)),
      )
        .toString()
        .padStart(6)} · contraste local ${mean(contrastOf[k] ?? [])
        .toFixed(0)
        .padStart(6)}`,
    );
  }

  const a = groups.accent ?? [];
  const w = groups.white ?? [];
  if (a.length === 0 || w.length === 0) return;

  const inkA = mean(a.map((c) => c.ink));
  const inkW = mean(w.map((c) => c.ink));
  const conA = mean(contrastOf.accent ?? []);
  const conW = mean(contrastOf.white ?? []);

  console.log('\n  Hipótesis "acento = base · blanco = highlight":');
  console.log(
    `    1) hay más celdas acento que blancas ......... ${a.length > w.length ? 'SÍ' : 'NO'}  (${a.length} vs ${w.length})`,
  );
  console.log(
    `    2) las blancas tienen más tinta (más brillo) . ${inkW > inkA ? 'SÍ' : 'NO'}  (${Math.round(inkW)} vs ${Math.round(inkA)})`,
  );
  console.log(
    `    3) las blancas tienen más contraste local .... ${conW > conA ? 'SÍ' : 'NO'}  (${conW.toFixed(0)} vs ${conA.toFixed(0)})`,
  );
}

/**
 * Densidad de tinta normalizada por píxel: permite comparar dos renders con celdas de distinto
 * tamaño en píxeles de imagen. Responde a "¿cuál pesa más visualmente?" con un número.
 */
function weight(label: string, data: { cells: CellData[] }, cellPx: number): void {
  const inked = data.cells.filter((c) => c.ink > 0);
  const area = cellPx * cellPx;
  const perPixel = inked.reduce((a, c) => a + c.ink / area, 0) / (inked.length || 1);
  const filled = (inked.length / data.cells.length) * 100;
  console.log(
    `  ${label.padEnd(34)} celdas con tinta ${filled.toFixed(1).padStart(5)} %  ·  luminancia media por píxel ${perPixel.toFixed(1).padStart(5)}`,
  );
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const page = await browser.newPage();
  await page.goto('about:blank');

  console.log('=== ¿El acento es la base y el blanco el highlight? (muestreo de píxeles) ===');
  const collected: Array<{ label: string; data: { cells: CellData[] }; cellPx: number }> = [];

  for (const s of SAMPLES) {
    const data = await cellsFrom(page, s);
    analyse(s.label, data);
    collected.push({ label: s.label, data, cellPx: CELL * s.scale });
  }

  console.log('\n=== Peso visual (para comparar densidad entre renders) ===');
  for (const c of collected) weight(c.label, c.data, c.cellPx);

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
