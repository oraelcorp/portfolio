// scripts/recon-cta.ts — mide el hover del CTA de la referencia: cómo migra el "+" al otro
// lado (¿encoge por el camino? ¿cuánto dura? ¿con qué curva?) y si el texto recibe algún
// barrido o aclarado. Muestreo por rAF DENTRO de la página, como el resto de sondas.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon');

interface Frame {
  t: number;
  plusX: number;
  plusW: number;
  plusH: number;
  plusTr: string;
  labX: number;
  labW: number;
  labColor: string;
  labBg: string;
  labImg: string;
  labTr: string;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForTimeout(6000);

  // Localizar el CTA del nav: el label naranja y el botón cuadrado "+" a su lado.
  const found = await page.evaluate(() => {
    const label = [...document.querySelectorAll<HTMLElement>('a,button')].find((el) =>
      /let'?s work together/i.test((el.textContent ?? '').trim()),
    );
    if (!label) return null;
    const lr = label.getBoundingClientRect();
    // El "+" es el hermano cuadrado más cercano en la misma fila.
    const plus = [...document.querySelectorAll<HTMLElement>('a,button')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => Math.abs(r.height - lr.height) < 6 && Math.abs(r.width - r.height) < 14)
      .filter(({ r }) => Math.abs(r.top - lr.top) < 6 && Math.abs(r.left - lr.right) < 40)[0];
    if (!plus) return null;

    const w = window as unknown as { __c: { label: HTMLElement; plus: HTMLElement } };
    w.__c = { label, plus: plus.el };
    return {
      label: `${Math.round(lr.left)},${Math.round(lr.top)} ${Math.round(lr.width)}x${Math.round(lr.height)}`,
      plus: `${Math.round(plus.r.left)},${Math.round(plus.r.top)} ${Math.round(plus.r.width)}x${Math.round(plus.r.height)}`,
      mid: [Math.round(lr.left + lr.width / 2), Math.round(lr.top + lr.height / 2)],
    };
  });
  if (!found) throw new Error('no encuentro el CTA');
  console.log(`label: ${found.label}`);
  console.log(`  "+": ${found.plus}`);

  // Grabador
  await page.evaluate(() => {
    const w = window as unknown as {
      __c: { label: HTMLElement; plus: HTMLElement };
      __f: { rows: Frame[]; rec: boolean };
    };
    interface Frame {
      t: number;
      plusX: number;
      plusW: number;
      plusH: number;
      plusTr: string;
      labX: number;
      labW: number;
      labColor: string;
      labBg: string;
      labImg: string;
      labTr: string;
    }
    w.__f = { rows: [], rec: false };
    const t0 = performance.now();
    const tick = (): void => {
      if (w.__f.rec) {
        const p = w.__c.plus.getBoundingClientRect();
        const l = w.__c.label.getBoundingClientRect();
        const pc = getComputedStyle(w.__c.plus);
        const lc = getComputedStyle(w.__c.label);
        w.__f.rows.push({
          t: Math.round(performance.now() - t0),
          plusX: Math.round(p.left * 10) / 10,
          plusW: Math.round(p.width * 10) / 10,
          plusH: Math.round(p.height * 10) / 10,
          plusTr: pc.transform,
          labX: Math.round(l.left * 10) / 10,
          labW: Math.round(l.width * 10) / 10,
          labColor: lc.color,
          labBg: lc.backgroundColor,
          labImg: lc.backgroundImage.slice(0, 60),
          labTr: lc.transform,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const [mx = 0, my = 0] = found.mid;
  await page.mouse.move(mx, my - 200);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    (window as unknown as { __f: { rec: boolean } }).__f.rec = true;
  });
  await page.waitForTimeout(300);
  await page.mouse.move(mx, my, { steps: 6 }); // entrar
  await page.waitForTimeout(1800);
  await page.mouse.move(mx, my - 200, { steps: 6 }); // salir
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    (window as unknown as { __f: { rec: boolean } }).__f.rec = false;
  });

  const rows = (await page.evaluate(
    () => (window as unknown as { __f: { rows: Frame[] } }).__f.rows,
  )) as Frame[];
  writeFileSync(join(OUT, 'cta-hover.json'), JSON.stringify(rows, null, 1), 'utf8');

  console.log(`\n${rows.length} frames`);
  const uniq = (k: keyof Frame): string[] => [...new Set(rows.map((r) => String(r[k])))];
  for (const k of ['plusW', 'plusH', 'labColor', 'labBg', 'labImg', 'labTr'] as Array<keyof Frame>) {
    const v = uniq(k);
    console.log(`  ${String(k).padEnd(9)}: ${v.length} valor(es) ${v.slice(0, 3).join(' | ').slice(0, 110)}`);
  }

  const x0 = rows[0]?.plusX ?? 0;
  const moved = rows.filter((r) => Math.abs(r.plusX - x0) > 1);
  console.log(`\nel "+" se mueve en ${moved.length} de ${rows.length} frames`);
  console.log(`  posiciones X del "+": ${[...new Set(rows.map((r) => Math.round(r.plusX)))].join(', ')}`);
  console.log(`  posiciones X del label: ${[...new Set(rows.map((r) => Math.round(r.labX)))].join(', ')}`);
  console.log('\n  trayecto (t · plusX · plusW · labX):');
  console.log(
    '   ' +
      rows
        .filter((_, i) => i % 3 === 0)
        .slice(0, 30)
        .map((r) => `${r.t}:${Math.round(r.plusX)}/${r.plusW}/${Math.round(r.labX)}`)
        .join('  '),
  );

  await page.screenshot({
    path: join(OUT, 'cta-rest.png'),
    clip: { x: mx - 240, y: my - 40, width: 400, height: 80 },
  });
  await page.mouse.move(mx, my, { steps: 6 });
  await page.waitForTimeout(900);
  await page.screenshot({
    path: join(OUT, 'cta-hover.png'),
    clip: { x: mx - 240, y: my - 40, width: 400, height: 80 },
  });

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
