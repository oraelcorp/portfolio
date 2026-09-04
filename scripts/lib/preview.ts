// scripts/lib/preview.ts — levanta y APAGA de verdad el servidor de preview.
// Con `spawn('npx', …, { shell: true })` en Windows, kill() mata el shell y deja vivo el proceso
// de vite: en una sesión se acumularon 22 servidores huérfanos que dispararon la CPU y llegaron a
// hacer fallar la medición de jank de check-phase4. Aquí se lanza node directamente sobre el
// binario de vite, así que el pid que se mata es el del servidor.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
export function startPreview(port: number): Preview {
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

  return { url: `http://localhost:${port}/`, stop };
}
