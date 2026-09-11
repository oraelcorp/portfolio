// scripts/verify.ts — corre sondas SIEMPRE contra un build recién hecho.
//
// Se invoca por `npm run verify`, que es literalmente `npm run build && node scripts/verify.ts`.
// El `&&` es lo que impide el error nº 7 / nº 9 (medir un `dist` viejo porque `tsc` falló y
// el `;` dejó continuar igual). Además cada sonda vuelve a comprobarlo por su cuenta en
// `startPreview()`, así que ejecutar una a mano tampoco puede mentir.
//
//   npm run verify                      -> suite de aceptación del ASCII (check-phase3)
//   npm run verify -- gl                 -> paridad y paleta del motor WebGL
//   npm run verify -- check-gl-parity    -> una sonda concreta, por nombre de archivo
//   npm run verify -- all                -> todo lo anterior, en orden

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Atajos: un nombre corto que expande a varias sondas, en el orden en que conviene correrlas. */
const GRUPOS: Record<string, string[]> = {
  // Por defecto se verifica el camino por defecto (WebGL) y el fallback (Canvas 2D).
  default: ['check-phase8', 'check-phase3'],
  gl: ['check-phase8', 'check-gl-parity', 'check-gl-palette', 'check-gl-bleed'],
  all: ['check-phase8', 'check-phase3', 'check-gl-parity', 'check-gl-palette', 'check-gl-bleed'],
};

function main(): void {
  const args = process.argv.slice(2);
  const pedido = args.length === 0 ? GRUPOS.default : (GRUPOS[args[0] ?? ''] ?? args);
  if (!pedido || pedido.length === 0) throw new Error('Nada que verificar');

  const faltan = pedido.filter((n) => !existsSync(resolve('scripts', `${n}.ts`)));
  if (faltan.length > 0) {
    console.error(`No encuentro estas sondas en scripts/: ${faltan.join(', ')}`);
    console.error(`Grupos disponibles: ${Object.keys(GRUPOS).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Build recién hecho. Sondas a correr: ${pedido.join(' → ')}\n`);

  for (const nombre of pedido) {
    console.log(`\n${'='.repeat(70)}\n  ${nombre}\n${'='.repeat(70)}`);
    const r = spawnSync(process.execPath, [resolve('scripts', `${nombre}.ts`)], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`\n✗ ${nombre} falló (código ${r.status}). Se detiene aquí.`);
      process.exitCode = r.status ?? 1;
      return;
    }
  }

  console.log('\n✓ Todas las sondas terminaron sobre el build actual.');
}

main();
