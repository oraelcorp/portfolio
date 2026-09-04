// scripts/record-work.ts — graba un VÍDEO de la pill entrando desde cuatro direcciones
// distintas, para poder juzgar el genie en movimiento (en fotogramas sueltos no se aprecia).
// El puntero se mueve a ritmo humano, no con los `steps` instantáneos de Playwright, que
// atraviesan la pantalla en dos frames y harían parecer un salto lo que es un barrido.
// Salida en screenshots/work-genie.webm (gitignored).

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4189;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots');
const TMP = resolve('screenshots', '.video-tmp');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

/** Última posición conocida del puntero, para encadenar recorridos sin saltos. */
let atX = 0;
let atY = 0;

/** Mueve el puntero hasta un punto en tiempo real, ~60 posiciones por segundo. */
async function glide(page: Page, x1: number, y1: number, ms: number): Promise<void> {
  const x0 = atX;
  const y0 = atY;
  const n = Math.max(2, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    // Arranque y frenada suaves, para que se parezca a una mano y no a un raíl.
    const t = i / n;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e);
    await sleep(16);
  }
  atX = x1;
  atY = y1;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const preview = startPreview(PORT);
  await waitForServer();

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: TMP, size: { width: 1440, height: 900 } },
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
  await sleep(600);
  await page.evaluate(() =>
    document.querySelector('[data-section="work"]')?.scrollIntoView({ block: 'start' }),
  );
  await sleep(1600);

  const fig = await page.evaluate(() => {
    const f = document.querySelector<HTMLElement>('.work__figure');
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
  if (!fig) throw new Error('no hay figura');

  const cx = fig.x + fig.w / 2;
  const cy = fig.y + fig.h / 2;
  const far = { x: 60, y: 60 };

  atX = far.x;
  atY = far.y;
  await page.mouse.move(atX, atY);

  /** Un pase: alejarse para replegar, acercarse desde `from`, pasear dentro y salir. */
  const pass = async (fx: number, fy: number, tx: number, ty: number): Promise<void> => {
    // Todos los desplazamientos son continuos: un salto de ratón no existe en uso real y
    // además falsearía el origen desde el que se mide el eje del genie.
    await glide(page, far.x, far.y, 600);
    await sleep(700); // que se repliegue del todo y se reinicie el origen del genie
    await glide(page, fx, fy, 700);
    await sleep(500);
    await glide(page, tx, ty, 1100); // el despliegue: lo que hay que mirar
    await sleep(600);
    await glide(page, cx, cy, 700); // paseo dentro
    await sleep(500);
    await glide(page, fx, fy, 900); // salir por donde entró: se repliega
    await sleep(700);
  };

  // Cuatro direcciones: el eje del genie tiene que seguir a cada una.
  await pass(fig.x - 300, cy, fig.x + 90, cy); // desde la izquierda
  await pass(cx, Math.max(4, fig.y - 260), cx, fig.y + 70); // desde arriba
  await pass(fig.x - 260, Math.max(4, fig.y - 240), fig.x + 80, fig.y + 70); // en diagonal
  await pass(fig.x + fig.w + 260, cy, fig.x + fig.w - 90, cy); // desde la derecha

  // Y un barrido rápido dentro, para ver el balanceo y el estiramiento por velocidad.
  await glide(page, fig.x + fig.w - 90, cy, 600);
  await sleep(500);
  await glide(page, fig.x + 90, cy, 380);
  await sleep(900);

  await page.close();
  await ctx.close(); // el vídeo se escribe al cerrar el contexto
  await browser.close();

  const file = readdirSync(TMP).find((f) => f.endsWith('.webm'));
  if (!file) throw new Error('Playwright no dejó ningún .webm');
  const dest = join(OUT, 'work-genie.webm');
  rmSync(dest, { force: true });
  renameSync(join(TMP, file), dest);
  rmSync(TMP, { recursive: true, force: true });

  console.log(`errores de consola: ${errors.length === 0 ? 'ninguno' : errors.join(' | ')}`);
  console.log('→ screenshots/work-genie.webm');
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
