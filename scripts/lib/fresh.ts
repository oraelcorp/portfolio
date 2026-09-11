// scripts/lib/fresh.ts — impide medir un `dist/` viejo.
//
// Por qué existe: dos veces se encadenó `npm run build` con una sonda usando `;` en vez de
// `&&`; `tsc` falló, `vite build` no llegó a correr y la sonda midió el build ANTERIOR. Las dos
// veces los números salieron casi idénticos a la corrida previa, que fue la única pista. Está
// documentado como los errores nº 7 y nº 9 en CLAUDE.md.
//
// `npm run verify` encadena bien, pero eso solo protege a quien lo use. Esta guarda vive en
// `startPreview()`, por donde pasan TODAS las sondas que miden nuestro build, así que ejecutar
// una a mano sobre un `dist` obsoleto falla en vez de mentir.

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Fecha del archivo más reciente bajo una ruta, recorriendo subcarpetas. */
function newestMtime(path: string): number {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;

  let newest = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    const m = entry.isDirectory() ? newestMtime(child) : statSync(child).mtimeMs;
    if (m > newest) newest = m;
  }
  return newest;
}

/** Lo que entra al build. Si algo de aquí es más nuevo que `dist/`, el build está obsoleto. */
const ENTRADAS = ['src', 'index.html', 'vite.config.ts', 'package.json'];

/**
 * Lanza si `dist/` no existe o es más viejo que las fuentes.
 * @param motivo texto para el mensaje de error, normalmente el nombre de la sonda.
 */
export function assertFreshBuild(motivo = 'esta sonda'): void {
  const dist = resolve('dist');
  if (!existsSync(dist)) {
    throw new Error(`No hay dist/. Ejecuta "npm run verify" (build + sonda) antes de ${motivo}.`);
  }

  const built = newestMtime(dist);
  let newest = 0;
  let culpable = '';
  for (const e of ENTRADAS) {
    const m = newestMtime(resolve(e));
    if (m > newest) {
      newest = m;
      culpable = e;
    }
  }

  if (newest > built) {
    const seg = Math.round((newest - built) / 1000);
    throw new Error(
      `dist/ está OBSOLETO: "${culpable}" es ${seg} s más nuevo que el build.\n` +
        `  ${motivo} habría medido el build anterior — que es exactamente el error que esta guarda existe para impedir.\n` +
        `  Ejecuta:  npm run verify -- <sonda>     (encadena build y medición con &&)`,
    );
  }
}
