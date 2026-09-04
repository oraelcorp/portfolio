// scripts/capture-cta.ts — tira + vídeo del hover del CTA (item 3). Las viñetas se etiquetan
// con el estado MEDIDO (escala de cada "+", desplazamiento del label, posición del destello y
// texto del scramble), no con el reloj: una captura cuesta ~150 ms y la transición dura 700.
// Salida: screenshots/cta-strip.png y screenshots/cta-hover.webm (gitignored).

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4194;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots');
const TMP = resolve('screenshots', '.cta-video');
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

/** Movimiento a ritmo humano: los `steps` de Playwright cruzan la pantalla en dos frames. */
async function glide(page: Page, x0: number, y0: number, x1: number, y1: number, ms: number): Promise<void> {
  const n = Math.max(2, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e);
    await sleep(16);
  }
}

/** Estado real del CTA en este instante. */
async function state(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = document.querySelector<HTMLElement>('.nav__cta');
    const txt = g?.querySelector<HTMLElement>('[data-cta-text]');
    const inI = g?.querySelector<HTMLElement>('.btn--icon-in');
    const outI = g?.querySelector<HTMLElement>('.btn--icon-out');
    const lab = g?.querySelector<HTMLElement>('.btn--label');
    if (!txt || !inI || !outI || !lab) return 'sin CTA';
    const sc = (el: HTMLElement): string => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return Math.hypot(m.a, m.b).toFixed(2);
    };
    const lx = Math.round(new DOMMatrixReadOnly(getComputedStyle(lab).transform).m41);
    const bg = getComputedStyle(txt).backgroundPositionX;
    return `+izq ${sc(inI)} · +der ${sc(outI)} · label ${lx}px\ndestello ${bg} · "${(txt.textContent ?? '').trim()}"`;
  });
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
  await sleep(900);

  const box = await page.evaluate(() => {
    const el = document.querySelector('.nav__cta .btn--label');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
  });
  if (!box) throw new Error('no encuentro el CTA');

  const clip = { x: 1050, y: 4, width: 390, height: 88 };

  // --- Tira: se dispara la transición y se captura mientras corre.
  await page.mouse.move(box.cx, box.cy - 220);
  await sleep(700);
  const cells: string[] = [];
  const shot = async (): Promise<void> => {
    const cap = await state(page);
    const buf = await page.screenshot({ clip });
    cells.push(
      `<figure><img src="data:image/png;base64,${buf.toString('base64')}"><figcaption>${cap}</figcaption></figure>`,
    );
  };
  await shot(); // reposo
  await page.mouse.move(box.cx, box.cy);
  for (let i = 0; i < 7; i++) await shot(); // durante el relevo
  await sleep(900);
  await shot(); // asentado

  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0d0d0d;font:11px ui-monospace,monospace;color:#ccc;padding:12px}
    h2{font-size:12px;font-weight:400;color:#39ff6a;margin:0 0 8px}
    .row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    figure{margin:0} img{display:block;width:100%;outline:1px solid #2a2a2a}
    figcaption{padding-top:3px;text-align:center;color:#8a8a8a;white-space:pre-line;line-height:1.4;font-size:10px}
  </style>
  <h2>CTA en hover: el "+" hace el relevo encogiendo y girando, el label se desliza, y el destello barre el texto mientras scramblea</h2>
  <div class="row">${cells.join('')}</div>`;

  const out = await ctx.newPage();
  await out.setContent(html);
  await out.waitForLoadState('networkidle');
  await (await out.$('body'))?.screenshot({ path: join(OUT, 'cta-strip.png') });
  await out.close();

  // --- Los dos lados del relevo, en las dos instancias, con el hueco medido en cada uno.
  // El "+" derecho va fuera del flujo (como en la referencia): si estuviera dentro, su caja
  // dejaría 56 px de hueco en reposo contra los 6 del hover.
  const sides: string[] = [];
  for (const [nombre, sel] of [
    ['nav', '.nav__cta'],
    ['hero', '.hero__actions .btn-group'],
  ] as const) {
    // El recorte se saca de la caja REAL del grupo, no a ojo: con coordenadas fijas el del
    // hero encuadraba el logo del nav en vez del botón.
    const crop = await page.evaluate((q) => {
      const el = document.querySelector(q);
      if (!el) return { x: 0, y: 0, width: 320, height: 88 };
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.round(r.left) - 26),
        y: Math.max(0, Math.round(r.top) - 22),
        width: 320,
        height: 88,
      };
    }, sel);
    for (const hovered of [false, true]) {
      if (hovered) await page.hover(`${sel} .btn--label`);
      else await page.mouse.move(700, 700);
      await sleep(1200);
      const m = await page.evaluate(
        ({ s: q, h }) => {
          const g = document.querySelector<HTMLElement>(q);
          if (!g) return 'sin CTA';
          const box = (x: string): DOMRect => g.querySelector<HTMLElement>(x)!.getBoundingClientRect();
          const gb = g.getBoundingClientRect();
          const lab = box('.btn--label');
          const icon = box(h ? '.btn--icon-in' : '.btn--icon-out');
          const hueco = Math.round(h ? lab.left - icon.right : icon.left - lab.right);
          const sobra = Math.round(gb.right - (h ? lab.right : icon.right));
          return `hueco ${hueco}px · sobra ${sobra}px`;
        },
        { s: sel, h: hovered },
      );
      const buf = await page.screenshot({ clip: crop });
      sides.push(
        `<figure><img src="data:image/png;base64,${buf.toString('base64')}"><figcaption>${nombre} · "+" a la ${hovered ? 'IZQUIERDA' : 'DERECHA'}
${m}</figcaption></figure>`,
      );
    }
  }

  const html2 = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0d0d0d;font:11px ui-monospace,monospace;color:#ccc;padding:12px}
    h2{font-size:12px;font-weight:400;color:#39ff6a;margin:0 0 8px}
    .row{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;max-width:820px}
    figure{margin:0} img{display:block;width:100%;outline:1px solid #2a2a2a}
    figcaption{padding-top:3px;text-align:center;color:#8a8a8a;white-space:pre-line;line-height:1.4;font-size:10px}
  </style>
  <h2>El hueco es de 6 px con el "+" a cualquiera de los dos lados, en las dos instancias del CTA</h2>
  <div class="row">${sides.join('')}</div>`;

  const out2 = await ctx.newPage();
  await out2.setContent(html2);
  await out2.waitForLoadState('networkidle');
  await (await out2.$('body'))?.screenshot({ path: join(OUT, 'cta-gap.png') });
  await out2.close();
  await page.mouse.move(700, 700);
  await sleep(600);

  // --- Vídeo: tres pasadas a ritmo humano, entrando y saliendo.
  for (let i = 0; i < 3; i++) {
    await glide(page, box.cx, box.cy - 220, box.cx, box.cy, 550);
    await sleep(1100);
    await glide(page, box.cx, box.cy, box.cx, box.cy - 220, 550);
    await sleep(900);
  }

  await page.close();
  await ctx.close(); // el vídeo se escribe al cerrar el contexto
  await browser.close();

  const file = readdirSync(TMP).find((f) => f.endsWith('.webm'));
  if (file) {
    const dest = join(OUT, 'cta-hover.webm');
    rmSync(dest, { force: true });
    renameSync(join(TMP, file), dest);
    console.log('→ screenshots/cta-hover.webm');
  }
  rmSync(TMP, { recursive: true, force: true });

  console.log(`errores de consola: ${errors.length === 0 ? 'ninguno' : errors.join(' | ')}`);
  console.log('→ screenshots/cta-strip.png');
  console.log('→ screenshots/cta-gap.png');
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
