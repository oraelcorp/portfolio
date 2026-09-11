// src/effects/ascii/glyphAtlas.ts — atlas de glifos para el renderizador WebGL. Fase 8, 2.1.
//
// El Canvas 2D llama a `fillText` por celda; la GPU no puede. Se rasterizan UNA vez todos los
// glifos de la rampa en una textura y el shader muestrea el que toca. Es exactamente lo que
// hace el sitio de referencia (confirmado en Fase 0) y lo que hacía "gratis" el estirado que
// nosotros tuvimos que resolver a mano en 2D.
//
// La rampa NO se duplica: se importa de `charRamp.ts`, que es la fuente de verdad de las 10
// bandas. Si allí cambian los glifos, el atlas cambia solo.

import { BANDS } from './charRamp.ts';

/** Glifos en orden de banda, aplanados. El shader indexa aquí. */
export const ATLAS_CHARS: readonly string[] = BANDS.flatMap((b) => [...b.chars]);

/** Para cada banda: dónde empieza en `ATLAS_CHARS` y cuántos glifos tiene. */
export const BAND_OFFSET: readonly number[] = (() => {
  const out: number[] = [];
  let acc = 0;
  for (const b of BANDS) {
    out.push(acc);
    acc += b.chars.length;
  }
  return out;
})();

export const BAND_COUNT: readonly number[] = BANDS.map((b) => b.chars.length);
export const BAND_MAX: readonly number[] = BANDS.map((b) => b.max);

export interface Atlas {
  canvas: HTMLCanvasElement;
  /** Columnas y filas de baldosas en el atlas. */
  cols: number;
  rows: number;
  /** Tamaño de cada baldosa en px de textura. */
  tileW: number;
  tileH: number;
}

/**
 * Rasteriza el atlas con la MISMA geometría que usa el Canvas 2D: `textBaseline = 'top'` y el
 * glifo pegado a la esquina superior izquierda de una baldosa del tamaño exacto de la celda
 * en píxeles de dispositivo. Sin eso el retrato de WebGL saldría desplazado medio glifo
 * respecto al de 2D y la comparación de paridad no significaría nada.
 */
export function buildGlyphAtlas(
  cellW: number,
  cellH: number,
  fontSize: number,
  fontFamily: string,
  dpr: number,
): Atlas {
  const tileW = Math.max(1, Math.round(cellW * dpr));
  const tileH = Math.max(1, Math.round(cellH * dpr));

  const n = ATLAS_CHARS.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);

  const canvas = document.createElement('canvas');
  canvas.width = cols * tileW;
  canvas.height = rows * tileH;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo rasterizar el atlas de glifos');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${fontSize * dpr}px ${fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  // Blanco puro: el color real lo pone el shader, el atlas solo aporta la COBERTURA del glifo.
  ctx.fillStyle = '#fff';

  for (let i = 0; i < n; i++) {
    const tx = (i % cols) * tileW;
    const ty = Math.floor(i / cols) * tileH;
    ctx.fillText(ATLAS_CHARS[i] ?? '.', tx, ty);
  }

  return { canvas, cols, rows, tileW, tileH };
}
