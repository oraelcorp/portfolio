// scripts/check-cta.ts — comprueba el item 3: el CTA ya no persigue al puntero, el "+" hace
// el relevo encogiendo y girando, y el texto scramblea con un destello que lo barre de
// izquierda a derecha. Mide con la misma metodología que scripts/recon-cta.ts sobre la
// referencia, para que las cifras se puedan comparar.

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4193; // el 4190 no acepta conexiones en esta máquina aunque vite diga que escucha
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots', 'cta');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const results: string[] = [];
const failures: string[] = [];
const consoleErrors: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  const line = `${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`;
  results.push(line);
  if (!ok) failures.push(line);
  console.log(line);
}

interface Row {
  t: number;
  txt: string;
  bgPos: string;
  inS: number;
  outS: number;
  inRot: number;
  labX: number;
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

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  await waitForServer();

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
  await sleep(700);

  // Grabador por rAF sobre el CTA del nav
  await page.evaluate(() => {
    const w = window as unknown as { __t: { rows: Row[]; rec: boolean } };
    interface Row {
      t: number;
      txt: string;
      bgPos: string;
      inS: number;
      outS: number;
      inRot: number;
      labX: number;
    }
    const g = document.querySelector<HTMLElement>('.nav__cta');
    const txt = g?.querySelector<HTMLElement>('[data-cta-text]');
    const inI = g?.querySelector<HTMLElement>('.btn--icon-in');
    const outI = g?.querySelector<HTMLElement>('.btn--icon-out');
    const lab = g?.querySelector<HTMLElement>('.btn--label');
    w.__t = { rows: [], rec: false };
    if (!txt || !inI || !outI || !lab) return;

    const norm = (el: HTMLElement): { s: number; r: number } => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return {
        s: Math.round(Math.hypot(m.a, m.b) * 1000) / 1000,
        r: Math.round(Math.atan2(m.b, m.a) * (180 / Math.PI) * 10) / 10,
      };
    };
    const t0 = performance.now();
    const tick = (): void => {
      if (w.__t.rec) {
        const a = norm(inI);
        const b = norm(outI);
        w.__t.rows.push({
          t: Math.round(performance.now() - t0),
          txt: (txt.textContent ?? '').trim(),
          bgPos: getComputedStyle(txt).backgroundPositionX,
          inS: a.s,
          outS: b.s,
          inRot: a.r,
          labX: Math.round(new DOMMatrixReadOnly(getComputedStyle(lab).transform).m41),
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const box = await page.evaluate(() => {
    const el = document.querySelector('.nav__cta .btn--label');
    if (!el) return { cx: 0, cy: 0 };
    const r = el.getBoundingClientRect();
    return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
  });

  await page.mouse.move(box.cx, box.cy - 200);
  await sleep(400);
  await page.evaluate(() => {
    (window as unknown as { __t: { rec: boolean } }).__t.rec = true;
  });
  await sleep(200);
  await page.mouse.move(box.cx, box.cy, { steps: 6 });
  await sleep(1500);
  await page.screenshot({
    path: join(OUT, 'cta-hover.png'),
    clip: { x: 1060, y: 6, width: 380, height: 84 },
  });
  await page.mouse.move(box.cx, box.cy - 200, { steps: 6 });
  await sleep(1200);
  await page.evaluate(() => {
    (window as unknown as { __t: { rec: boolean } }).__t.rec = false;
  });
  await page.screenshot({ path: join(OUT, 'cta-rest.png'), clip: { x: 1060, y: 6, width: 380, height: 84 } });

  const rows = (await page.evaluate(() => (window as unknown as { __t: { rows: Row[] } }).__t.rows)) as Row[];
  console.log(`\n${rows.length} frames\n`);

  // --- El relevo del "+"
  const inMin = Math.min(...rows.map((r) => r.inS));
  const inMax = Math.max(...rows.map((r) => r.inS));
  const outMin = Math.min(...rows.map((r) => r.outS));
  const outMax = Math.max(...rows.map((r) => r.outS));
  check(
    'el "+" izquierdo crece de 0 a 1 y el derecho hace lo contrario',
    inMin < 0.05 && inMax > 0.95 && outMin < 0.05 && outMax > 0.95,
    `izq ${inMin}→${inMax} · der ${outMin}→${outMax}`,
  );

  const maxRot = Math.max(...rows.map((r) => Math.abs(r.inRot)));
  check(
    'y el que entra lo hace girando desde −45°',
    maxRot > 40 && maxRot < 50,
    `giro máximo ${maxRot.toFixed(1)}° (referencia: 45°)`,
  );

  const mid = rows.filter((r) => r.inS > 0.1 && r.inS < 0.9).length;
  check('el encogimiento es progresivo, no un salto', mid > 8, `${mid} frames a media escala`);

  const labMin = Math.min(...rows.map((r) => r.labX));
  const labMax = Math.max(...rows.map((r) => r.labX));
  check(
    'el label se desliza al hueco que deja el "+"',
    labMin < -40 && Math.abs(labMax) < 2,
    `de ${labMin}px a ${labMax}px`,
  );

  // --- El scramble
  const txts = [...new Set(rows.map((r) => r.txt))];
  check('el texto scramblea al entrar', txts.length > 8, `${txts.length} estados distintos`);
  check(
    'y acaba restituido al salir',
    rows[rows.length - 1]?.txt === rows[0]?.txt,
    `"${rows[0]?.txt}" → "${rows[rows.length - 1]?.txt}"`,
  );
  console.log(
    `      estados: ${txts
      .slice(0, 9)
      .map((t) => `"${t}"`)
      .join(' → ')}`,
  );

  // --- El barrido del destello
  const nums = rows.map((r) => parseFloat(r.bgPos)).filter((n) => !Number.isNaN(n));
  const pos = [...new Set(rows.map((r) => r.bgPos))];
  check(
    'el destello barre el texto en vez de encenderlo de golpe',
    pos.length > 8,
    `${pos.length} posiciones del degradado, de ${Math.max(...nums).toFixed(0)} a ${Math.min(...nums).toFixed(0)}`,
  );

  // --- Sincronía con la referencia. La duración se lee DECLARADA, no del intervalo en que
  // la escala cruza dos umbrales: con una curva tan agresiva como cubic-bezier(0.83,0,0.17,1)
  // el valor se queda pegado a 0 el primer 20 % y llega a 0.99 sobre el 80 %, así que ese
  // intervalo mide 0.48 s para una transición que dura 0.7 s de verdad.
  const timing = await page.evaluate(() => {
    const g = document.querySelector('.nav__cta');
    const icon = g?.querySelector('.btn--icon-in');
    const txt = g?.querySelector('[data-cta-text]');
    if (!icon || !txt) return null;
    const a = getComputedStyle(icon);
    const b = getComputedStyle(txt);
    return {
      iconDur: a.transitionDuration,
      iconEase: a.transitionTimingFunction,
      iconProp: a.transitionProperty,
      textDur: b.transitionDuration,
      textEase: b.transitionTimingFunction,
    };
  });
  check(
    'el relevo declara los 0.7 s y la curva medidos en la referencia',
    timing?.iconDur === '0.7s' && timing?.iconEase === 'cubic-bezier(0.83, 0, 0.17, 1)',
    `${timing?.iconDur} ${timing?.iconEase} sobre ${timing?.iconProp}`,
  );
  check(
    'el destello del texto va en la misma duración y curva que el "+"',
    timing?.textDur === timing?.iconDur && timing?.textEase === timing?.iconEase,
    `texto ${timing?.textDur} ${timing?.textEase}`,
  );
  const firstMove = rows.findIndex((r) => r.inS > 0.02);
  const settled = rows.findIndex((r, i) => i > firstMove && r.inS > 0.99);
  console.log(
    `      tramo visible del relevo (de 2 % a 99 % de escala): ${(((rows[settled]?.t ?? 0) - (rows[firstMove]?.t ?? 0)) / 1000).toFixed(2)} s de los 0.7 s declarados`,
  );

  // --- REGRESIÓN: el hueco entre el "+" y el label debe ser el mismo en los DOS estados.
  // El "+" izquierdo, aunque esté a scale(0), ocupa su caja; si el derecho está en el flujo
  // se queda 50 px de más a la derecha. Medido antes del fix: 56 px en reposo, 6 en hover.
  const gapIn = async (sel: string, hovered: boolean): Promise<{ hueco: number; sobra: number }> => {
    if (hovered) await page.hover(`${sel} .btn--label`);
    else await page.mouse.move(20, 700);
    await sleep(1100);
    return page.evaluate(
      ({ s, h }) => {
        const g = document.querySelector<HTMLElement>(s);
        if (!g) return { hueco: -1, sobra: -1 };
        const box = (q: string): DOMRect => g.querySelector<HTMLElement>(q)!.getBoundingClientRect();
        const gb = g.getBoundingClientRect();
        const lab = box('.btn--label');
        const icon = box(h ? '.btn--icon-in' : '.btn--icon-out');
        return {
          hueco: Math.round(h ? lab.left - icon.right : icon.left - lab.right),
          sobra: Math.round(gb.right - (h ? lab.right : icon.right)),
        };
      },
      { s: sel, h: hovered },
    );
  };

  for (const [nombre, sel] of [
    ['nav', '.nav__cta'],
    ['hero', '.hero__actions .btn-group'],
  ] as const) {
    const rest = await gapIn(sel, false);
    const hov = await gapIn(sel, true);
    check(
      `${nombre}: el hueco es igual con el "+" a un lado y al otro`,
      Math.abs(rest.hueco - 6) <= 1 && Math.abs(hov.hueco - 6) <= 1,
      `reposo ${rest.hueco}px · hover ${hov.hueco}px`,
    );
    check(
      `${nombre}: la caja no reserva sitio de más`,
      Math.abs(rest.sobra) <= 1 && Math.abs(hov.sobra) <= 1,
      `sobra reposo ${rest.sobra}px · hover ${hov.sobra}px`,
    );
  }
  await page.mouse.move(20, 700);
  await sleep(900);

  // --- Sin magnetismo
  const drift = await page.evaluate(() => {
    const el = document.querySelector('.nav__cta');
    if (!el) return 99;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return Math.hypot(m.m41, m.m42);
  });
  check('el grupo no se desplaza hacia el puntero', drift < 1.5, `desplazamiento ${drift.toFixed(2)} px`);

  // --- reduced-motion: sin scramble
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => consoleErrors.push(`[reduced] ${e.message}`));
  await p2.goto(URL, { waitUntil: 'load' });
  await sleep(1400);
  const before = await p2.evaluate(() => document.querySelector('[data-cta-text]')?.textContent ?? '');
  await p2.hover('.nav__cta .btn--label');
  await sleep(400);
  const during = await p2.evaluate(() => document.querySelector('[data-cta-text]')?.textContent ?? '');
  check('con reduced-motion el texto no scramblea', before === during && before !== '', `"${during}"`);
  await ctx2.close();

  console.log(`\n${results.length - failures.length}/${results.length} comprobaciones OK`);
  console.log(
    consoleErrors.length === 0 ? 'Sin errores de consola.' : `ERRORES:\n${consoleErrors.join('\n')}`,
  );
  if (failures.length > 0 || consoleErrors.length > 0) process.exitCode = 1;

  await browser.close();
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
