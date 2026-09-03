// src/effects/ascii/charRamp.ts — rampas de caracteres por luminancia (§6.3 punto 5). Fase 3.
// Rampa GRADUAL de 10 bandas: los 4 escalones bruscos anteriores producían manchas sólidas
// en zonas de textura. `#%@` queda reservado al 13 % más brillante, no desde L > 0.35.

/** Rampa clásica de densidad creciente (~70 niveles). */
export const DENSE = ` .'\`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$`;

/**
 * Bandas de densidad progresiva. Cada una aporta varios glifos para que el shimmer
 * tenga de dónde elegir sin cambiar el peso visual de la celda.
 */
const BANDS: ReadonlyArray<{ max: number; chars: string }> = [
  { max: 0.2, chars: ".'`" },
  { max: 0.28, chars: ':,;' },
  { max: 0.36, chars: '-~+' },
  { max: 0.45, chars: '17cr' },
  { max: 0.54, chars: '23ae' },
  { max: 0.63, chars: '56bd' },
  { max: 0.72, chars: '89AE' },
  { max: 0.8, chars: '04BC' },
  { max: 0.87, chars: 'DF68' },
  { max: 1.01, chars: '#%@' }, // solo el ~13 % superior
];

/** Por debajo de esto la celda queda vacía. */
const EMPTY = 0.12;

/**
 * Hash determinista por celda: la misma celda elige siempre el mismo carácter mientras
 * no cambie su semilla, así el retrato no "hierve" solo (§6.3 punto 5).
 */
export function seededIndex(seed: number, length: number): number {
  let h = seed * 2654435761;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return Math.abs(h) % length;
}

/**
 * Mapea luminancia (0–1) a carácter.
 * `salt` desplaza la elección dentro de la banda: el shimmer solo cambia ese valor.
 */
export function charForLuma(luma: number, cell: number, salt = 0): string {
  if (luma < EMPTY) return ' ';

  const seed = cell + salt * 7919;
  for (const band of BANDS) {
    if (luma < band.max) return band.chars[seededIndex(seed, band.chars.length)] ?? '.';
  }
  return '@';
}

/** Variante densa: la usa el puntero, que sube la luminancia y densifica el glifo (§6.3 punto 8). */
export function denseChar(luma: number, cell: number, salt = 0): string {
  // Se fuerza al menos la banda 7 para que la zona tocada destaque sobre su entorno
  return charForLuma(Math.max(luma, 0.66), cell, salt);
}
