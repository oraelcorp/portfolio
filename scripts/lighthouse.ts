// scripts/lighthouse.ts — corre Lighthouse contra el build y guarda el reporte donde §9 pide
// (screenshots/lighthouse.html). Fase 5, bloque 3.
//
// Umbrales del §8: Performance ≥ 90, Accessibility/Best Practices/SEO ≥ 95, en desktop.
//
// Lighthouse se invoca con `npx` y NO se añade a package.json: es una herramienta de
// auditoría que se corre a mano, no una dependencia del sitio (mismo criterio que el ffmpeg
// de Playwright). El §9 lo exige por nombre, así que la elección no es discrecional.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startPreview } from './lib/preview.ts';

const PORT = 4215;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const UMBRALES: Record<string, number> = {
  performance: 90,
  accessibility: 95,
  'best-practices': 95,
  seo: 95,
};

/**
 * La dirección por la que el Chrome de Lighthouse SÍ alcanza el preview.
 * En esta máquina vite escucha solo en IPv6 (`::1`) y 127.0.0.1 devuelve ECONNREFUSED; el
 * Chrome headless resuelve `localhost` por IPv4 primero y se quedaba sin conectar, así que la
 * corrida moría antes de escribir el reporte y el único error visible era el EPERM del
 * borrado del perfil, que no tiene nada que ver. Se prueban las dos y se usa la que conteste.
 */
async function urlAlcanzable(): Promise<string> {
  for (const host of ['127.0.0.1', '[::1]']) {
    const u = `http://${host}:${PORT}/`;
    try {
      if ((await fetch(u)).ok) return u;
    } catch {
      /* la otra */
    }
  }
  return URL;
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      /* aún no */
    }
    await sleep(400);
  }
  throw new Error(`El preview no respondió en ${URL}`);
}

interface Audit {
  id: string;
  title: string;
  score: number | null;
  scoreDisplayMode: string;
  displayValue?: string;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  await waitForServer();

  const objetivo = await urlAlcanzable();
  console.log(`  auditando ${objetivo}`);
  const base = resolve(OUT, 'lh');
  // `shell: true` aquí SÍ es correcto, al contrario que para el servidor de preview: Node se
  // niega a lanzar un `.cmd` sin shell desde la CVE-2024-27980, y `spawnSync` espera a que el
  // proceso termine, así que no puede quedar ningún huérfano detrás.
  // Cada corrida usa un perfil de Chrome nuevo, o sea que el preloader SÍ aparece: se está
  // midiendo la primera visita, que es la que ve un buscador o quien llega desde un enlace.
  // El `--output-path` va ENTRECOMILLADO: la ruta del proyecto contiene un espacio y el
  // comando viaja como una sola cadena al shell, así que sin comillas se partía en dos
  // argumentos y Lighthouse abortaba. El único error visible era el EPERM del borrado del
  // perfil, que llega después y no tiene nada que ver: despistó un buen rato.
  const r = spawnSync(
    `npx --yes lighthouse@12 ${objetivo} --preset=desktop --output=html --output=json ` +
      `--output-path="${base}" --chrome-flags="--headless=new --no-sandbox" --quiet`,
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000, shell: true },
  );

  preview.stop();

  const jsonPath = `${base}.report.json`;
  const htmlPath = `${base}.report.html`;
  if (!existsSync(jsonPath)) {
    console.error('Lighthouse no dejó reporte.');
    console.error(r.stdout?.slice(-1500) ?? '');
    console.error(r.stderr?.slice(-2000) ?? '');
    process.exit(1);
  }
  // Lighthouse sale con código != 0 aunque el reporte esté escrito: en Windows revienta con
  // EPERM al borrar el perfil temporal de Chrome (chrome-launcher, destroyTmp). Es un fallo
  // de limpieza POSTERIOR a la auditoría, así que manda el archivo, no el código de salida.
  if (r.status !== 0 && /EPERM/.test(`${r.stderr ?? ''}`)) {
    console.log('  (Lighthouse falló al borrar su perfil temporal; el reporte sí se escribió)');
  }

  renameSync(htmlPath, resolve(OUT, 'lighthouse.html'));
  const data = JSON.parse(readFileSync(jsonPath, 'utf-8')) as {
    categories: Record<string, { title: string; score: number | null }>;
    audits: Record<string, Audit>;
  };

  console.log('\n=== Lighthouse (desktop) ===');
  let fallos = 0;
  for (const [id, umbral] of Object.entries(UMBRALES)) {
    const cat = data.categories[id];
    const puntos = Math.round((cat?.score ?? 0) * 100);
    const ok = puntos >= umbral;
    if (!ok) fallos++;
    console.log(
      `  ${ok ? 'OK  ' : 'FAIL'}  ${(cat?.title ?? id).padEnd(16)} ${puntos} (§8 pide ≥ ${umbral})`,
    );
  }

  console.log('\n  Métricas:');
  for (const id of [
    'first-contentful-paint',
    'largest-contentful-paint',
    'total-blocking-time',
    'cumulative-layout-shift',
    'speed-index',
  ]) {
    const a = data.audits[id];
    if (a) console.log(`    ${a.title.padEnd(30)} ${a.displayValue ?? '-'}`);
  }

  // Qué falla exactamente, para no tener que abrir el HTML a ciegas
  const suspensos = Object.values(data.audits)
    .filter((a) => a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'informative')
    .filter((a) => a.score !== null && a.score < 0.9);
  if (suspensos.length > 0) {
    console.log(`\n  ${suspensos.length} auditorías por debajo de 0.9:`);
    for (const a of suspensos) {
      console.log(
        `    ${(a.score ?? 0).toFixed(2)}  ${a.title}${a.displayValue ? ` — ${a.displayValue}` : ''}`,
      );
    }
  }

  console.log(`\n→ ${resolve(OUT, 'lighthouse.html')}`);
  if (fallos > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
