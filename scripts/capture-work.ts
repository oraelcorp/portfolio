// scripts/capture-work.ts — dos tiras para revisar el item 2 de un vistazo: el viaje de la pill
// (acercarse desde fuera → entrar → balancearse → salir → volver a entrar) y la caída del
// marcador de pestañas. Cada viñeta se etiqueta con el estado MEDIDO, no con el reloj.
// Salida en screenshots/work-strip.png (gitignored).

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4188;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots');
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

/** Estado real de la pill: opacidad y ángulo, para etiquetar la viñeta con la verdad. */
async function pillState(page: Page, mx: number, my: number): Promise<string> {
  return page.evaluate(
    ({ x, y }) => {
      const fol = document.querySelector<HTMLElement>('[data-work-follower]');
      const pill = fol?.querySelector<HTMLElement>('.work__pill');
      const fig = document.querySelector<HTMLElement>('.work__figure');
      if (!fol || !pill || !fig) return 'sin pill';
      const m = new DOMMatrixReadOnly(getComputedStyle(pill).transform);
      const r = fig.getBoundingClientRect();
      const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      // Distancia REAL al rectángulo, en dos dimensiones: mirando solo la horizontal, un
      // acercamiento desde arriba salía etiquetado como "fuera 0px" en todos los fotogramas.
      const dx = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      const sx = Math.hypot(m.a, m.b);
      const sy = Math.hypot(m.c, m.d);
      return `${inside ? 'dentro' : `fuera ${Math.round(dx)}px`} · op ${Number(getComputedStyle(pill).opacity).toFixed(2)}
${sx.toFixed(2)} × ${sy.toFixed(2)} · ${(Math.atan2(m.b - m.c, m.a + m.d) * (180 / Math.PI)).toFixed(1)}°`;
    },
    { x: mx, y: my },
  );
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  await waitForServer();

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
  await sleep(1400);

  const fig = await page.evaluate(() => {
    const f = document.querySelector<HTMLElement>('.work__figure');
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
  if (!fig) throw new Error('no hay figura');

  const cy = fig.y + fig.h / 2;
  // Encuadre alrededor de la esquina superior izquierda de la figura: cubre a la vez la
  // llegada por la izquierda, la de arriba y la diagonal, así las tres tiras son comparables.
  const clip = {
    x: Math.max(0, fig.x - 260),
    y: 0,
    width: 560,
    height: Math.min(560, 900),
  };

  // --- Tiras del despliegue desde tres direcciones. El eje del genie no es fijo: es el vector
  // desde donde el cartel estaba plegado hasta el cursor, así que cada dirección da una cinta
  // orientada distinta. Se muestrea a las mismas distancias del borde en los tres casos.
  const DIST = [110, 70, 52, 36, 20, 6, -90];

  /** Un acercamiento en línea recta hacia el borde de la figura, con `ux,uy` unitario. */
  const approachRow = async (ux: number, uy: number, ex: number, ey: number): Promise<string> => {
    // Replegar del todo y reiniciar el origen del genie antes de cada dirección.
    await page.mouse.move(20, 30, { steps: 20 });
    await sleep(900);
    await page.mouse.move(ex - ux * 260, ey - uy * 260, { steps: 20 });
    await sleep(500);

    const cells: string[] = [];
    for (const d of DIST) {
      const x = Math.round(ex - ux * d);
      const y = Math.round(ey - uy * d);
      await page.mouse.move(x, y, { steps: 14 });
      await sleep(160);
      const cap = await pillState(page, x, y);
      const buf = await page.screenshot({ clip });
      cells.push(
        `<figure><img src="data:image/png;base64,${buf.toString('base64')}"><figcaption>${cap}</figcaption></figure>`,
      );
    }
    return cells.join('');
  };

  const rowLeft = await approachRow(1, 0, fig.x, cy);
  const rowTop = await approachRow(0, 1, fig.x + fig.w / 2, fig.y);
  const k = Math.SQRT1_2;
  const rowDiag = await approachRow(k, k, fig.x, fig.y);

  // --- Tira 2: la caída del marcador. El recorte se saca de la lista real, no a ojo:
  // la primera versión encuadraba el titular y el marcador no salía.
  const asideClip = await page.evaluate(() => {
    const wrap = document.querySelector<HTMLElement>('.work__list-wrap');
    if (!wrap) return { x: 40, y: 60, width: 420, height: 420 };
    const r = wrap.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(r.left) - 16),
      y: Math.max(0, Math.round(r.top) - 16),
      width: Math.round(r.width) + 32,
      height: Math.min(Math.round(r.height) + 32, 900 - Math.round(r.top) + 16),
    };
  });
  await page.mouse.move(20, 30);
  await sleep(500);

  const row2: string[] = [];
  await page.evaluate(() => {
    (window as unknown as { __drop: number[] }).__drop = [];
    const m = document.querySelector<HTMLElement>('[data-work-marker]');
    const tick = (): void => {
      if (!m) return;
      (window as unknown as { __drop: number[] }).__drop.push(
        Math.round(new DOMMatrixReadOnly(getComputedStyle(m).transform).f),
      );
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.evaluate(() => {
    document.querySelectorAll('[data-work-preview]')[1]?.scrollIntoView({ block: 'center' });
  });
  // Capturar durante la caída: cada disparo cuesta ~150 ms, así que se etiqueta con la y real.
  for (let i = 0; i < 8; i++) {
    const y = await page.evaluate(() => {
      const m = document.querySelector<HTMLElement>('[data-work-marker]');
      if (!m) return { y: -1, rot: 0 };
      const t = new DOMMatrixReadOnly(getComputedStyle(m).transform);
      return { y: Math.round(t.f), rot: Math.round(Math.atan2(t.b, t.a) * (180 / Math.PI) * 10) / 10 };
    });
    const buf = await page.screenshot({ clip: asideClip });
    row2.push(
      `<figure><img src="data:image/png;base64,${buf.toString('base64')}"><figcaption>y ${y.y} px · ${y.rot}°</figcaption></figure>`,
    );
    await sleep(70);
  }
  const traj = (await page.evaluate(() => (window as unknown as { __drop: number[] }).__drop)) as number[];

  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0d0d0d;font:11px ui-monospace,monospace;color:#ccc;padding:12px}
    h2{font-size:12px;font-weight:400;color:#39ff6a;margin:14px 0 6px}
    .row{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
    .row4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
    figure{margin:0} img{display:block;width:100%;outline:1px solid #2a2a2a}
    figcaption{padding-top:2px;text-align:center;color:#8a8a8a;white-space:pre-line;line-height:1.35;font-size:10px}
    p{color:#777;margin:6px 0 0}
  </style>
  <h2>Genie · llegando por la IZQUIERDA → la cinta se tiende en horizontal</h2>
  <div class="row">${rowLeft}</div>
  <h2>Genie · llegando desde ARRIBA → la misma cinta, ahora vertical</h2>
  <div class="row">${rowTop}</div>
  <h2>Genie · llegando en DIAGONAL → el eje queda girado</h2>
  <div class="row">${rowDiag}</div>
  <h2>Marcador de pestañas: cae al siguiente proyecto, tumba y rebota</h2>
  <div class="row4">${row2.join('')}</div>
  <p>trayectoria medida por rAF (y en px): ${traj.filter((_, i) => i % 2 === 0).join(' → ')}</p>`;

  const out = await ctx.newPage();
  await out.setContent(html);
  await out.waitForLoadState('networkidle');
  await (await out.$('body'))?.screenshot({ path: join(OUT, 'work-strip.png') });

  console.log(`errores de consola: ${errors.length === 0 ? 'ninguno' : errors.join(' | ')}`);
  console.log('→ screenshots/work-strip.png');

  await browser.close();
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
