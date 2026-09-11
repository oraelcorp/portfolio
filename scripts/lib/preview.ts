// scripts/lib/preview.ts — levanta y APAGA de verdad el servidor de preview.
// Con `spawn('npx', …, { shell: true })` en Windows, kill() mata el shell y deja vivo el proceso
// de vite: en una sesión se acumularon 22 servidores huérfanos que dispararon la CPU y llegaron a
// hacer fallar la medición de jank de check-phase4. Aquí se lanza node directamente sobre el
// binario de vite, así que el pid que se mata es el del servidor.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFreshBuild } from './fresh.ts';

/**
 * El bin de vite no se puede pedir con `require.resolve('vite/bin/vite.js')`: el mapa de
 * `exports` del paquete no lo publica y Node responde ERR_PACKAGE_PATH_NOT_EXPORTED.
 * Los scripts se ejecutan siempre desde la raíz del proyecto, así que se resuelve por ruta.
 */
function viteBin(): string {
  const p = resolve('node_modules/vite/bin/vite.js');
  if (!existsSync(p)) throw new Error(`No encuentro el bin de vite en ${p}`);
  return p;
}

export interface Preview {
  url: string;
  stop: () => void;
}

/**
 * Arranca `vite preview` en el puerto dado y devuelve su URL y cómo pararlo. No espera por
 * defecto: cada script ya tiene su propia forma de saber que el servidor responde.
 */
export function startPreview(port: number, opts: { skipFreshCheck?: boolean } = {}): Preview {
  // `vite preview` sirve dist/. Si dist/ está obsoleto la sonda mediría el build anterior y
  // lo reportaría como si fuera el actual: pasó dos veces (errores nº 7 y nº 9 de CLAUDE.md).
  // La guarda va aquí porque es el punto por el que pasan TODAS las sondas de nuestro build.
  if (!opts.skipFreshCheck) assertFreshBuild('esta sonda');
  const bin = viteBin();
  const child: ChildProcess = spawn(
    process.execPath,
    [bin, 'preview', '--port', String(port), '--strictPort'],
    {
      stdio: 'ignore',
    },
  );

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    child.kill('SIGTERM');
  };

  // Si el script muere por una excepción, que no quede el servidor colgado.
  process.once('exit', stop);
  process.once('SIGINT', () => {
    stop();
    process.exit(130);
  });

  armarGuardian(stop);

  return { url: `http://localhost:${port}/`, stop };
}

/** Tope de vida de una sonda. Ninguna de las que hay tarda ni de lejos esto. */
const TOPE_MS = 7 * 60 * 1000;
let guardianPuesto = false;

/**
 * Corta la sonda si se pasa del tope, y se asegura de que el proceso MUERA.
 *
 * Por qué está aquí y no en cada sonda: el 2026-09-09 tres sondas se quedaron vivas toda la
 * noche compitiendo por la CPU (`sweep-gain`, `compare-nitidez` y el `check-gl-palette` de la
 * suite), y una de ellas ya había impreso sus resultados — con `headless: false`,
 * `browser.close()` puede no retornar nunca. Contaminó una medida de fps que llegué a reportar,
 * y dejó `npm run verify -- all` colgado sin terminar. Poniéndolo en `startPreview()`, que es
 * por donde pasan TODAS las sondas, ninguna puede olvidarse de él. Es la misma decisión que se
 * tomó con `assertFreshBuild`, y por la misma razón: que el error deje de ser posible, no que
 * haya que acordarse de evitarlo.
 *
 * Si una sonda muere por aquí DESPUÉS de haber impreso resultados, lo que falló es el cierre
 * del navegador, no la medición: el mensaje lo dice para que nadie lea un cuelgue como un fallo
 * de la comprobación.
 */
function armarGuardian(stop: () => void): void {
  if (guardianPuesto) return;
  guardianPuesto = true;
  const t = setTimeout(() => {
    console.error(
      `\nGUARDIÁN: la sonda pasó de ${TOPE_MS / 60000} min y se corta para no quedarse huérfana.\n` +
        '  Si ya había impreso resultados, lo que se colgó fue el cierre del navegador, no la medición.',
    );
    stop();
    process.exit(1);
  }, TOPE_MS);
  // No mantiene vivo el proceso por sí solo: si la sonda termina bien, no estorba.
  t.unref();
}
