// scripts/check-work.ts — comprueba el item 2: la pill acompaña al cursor desde fuera, no se
// queda pegada al borde al salir y volver a entrar, y el marcador de pestañas cae con física.
// Mide con la MISMA metodología que scripts/recon-work.ts sobre la referencia, para que las
// cifras se puedan comparar: muestreo por rAF dentro de la página y ratón movido en tandas.

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4187;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots', 'work');
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

interface Frame {
  t: number;
  mx: number;
  my: number;
  fx: number;
  fy: number;
  rot: number;
  op: number;
  sx: number;
  sy: number;
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
  await sleep(600);

  // Colocar el primer proyecto a la vista
  await page.evaluate(() => {
    document.querySelector('[data-section="work"]')?.scrollIntoView({ block: 'start' });
  });
  await sleep(1400);

  const fig = await page.evaluate(() => {
    const f = document.querySelector<HTMLElement>('.work__figure');
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
  if (!fig) throw new Error('no hay figura de work');
  console.log(`figura: ${fig.x},${fig.y} ${fig.w}×${fig.h}\n`);

  // --- Grabador por rAF, igual que en la referencia
  await page.evaluate(() => {
    const w = window as unknown as { __k: { f: Frame[]; rec: boolean } };
    interface Frame {
      t: number;
      mx: number;
      my: number;
      fx: number;
      fy: number;
      rot: number;
      op: number;
      sx: number;
      sy: number;
    }
    w.__k = { f: [], rec: false };
    let mx = -1;
    let my = -1;
    addEventListener('pointermove', (e) => {
      mx = e.clientX;
      my = e.clientY;
    });
    const t0 = performance.now();
    const tick = (): void => {
      if (w.__k.rec) {
        const fol = document.querySelector<HTMLElement>('[data-work-follower]');
        const pill = fol?.querySelector<HTMLElement>('.work__pill');
        if (fol && pill) {
          const fm = new DOMMatrixReadOnly(getComputedStyle(fol).transform);
          const pm = new DOMMatrixReadOnly(getComputedStyle(pill).transform);
          w.__k.f.push({
            t: performance.now() - t0,
            mx,
            my,
            fx: Math.round(fm.e * 10) / 10,
            fy: Math.round(fm.f * 10) / 10,
            rot: Math.round(Math.atan2(pm.b, pm.a) * (180 / Math.PI) * 100) / 100,
            op: Number(getComputedStyle(pill).opacity),
            sx: Math.round(Math.hypot(pm.a, pm.b) * 1000) / 1000,
            sy: Math.round(Math.hypot(pm.c, pm.d) * 1000) / 1000,
          });
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // --- Caja del cartel: debe coincidir con la medida en la referencia, no aproximarse.
  // offsetWidth/Height y no getBoundingClientRect: el rect ya viene escalado por el genie.
  const box = await page.evaluate(() => {
    const p = document.querySelector<HTMLElement>('.work__pill');
    if (!p) return null;
    const cs = getComputedStyle(p);
    return {
      w: p.offsetWidth,
      h: p.offsetHeight,
      font: cs.fontSize,
      pad: `${cs.paddingTop} ${cs.paddingRight}`,
    };
  });
  const REF = { w: 111.56, h: 28.6 };
  console.log(`      caja del cartel: ${box?.w} × ${box?.h} px · tipo ${box?.font} · relleno ${box?.pad}`);
  console.log(`      referencia:      ${REF.w} × ${REF.h} px · tipo 13.7388px · relleno 4px 8px`);
  check(
    'el cartel mide lo mismo que el de la referencia',
    !!box && Math.abs(box.w - REF.w) <= 1.5 && Math.abs(box.h - REF.h) <= 1.5,
    `desvío ${box ? Math.abs(box.w - REF.w).toFixed(1) : '?'} × ${box ? Math.abs(box.h - REF.h).toFixed(1) : '?'} px`,
  );

  const cx = fig.x + fig.w / 2;
  const cy = fig.y + fig.h / 2;

  await page.mouse.move(fig.x - 400, cy);
  await sleep(500);
  await page.evaluate(() => {
    (window as unknown as { __k: { rec: boolean } }).__k.rec = true;
  });

  /** Opacidad y escalas de la pill en este instante. */
  const pillNow = async (): Promise<{ op: number; sx: number; sy: number }> =>
    page.evaluate(() => {
      const p = document.querySelector<HTMLElement>('.work__pill');
      if (!p) return { op: -1, sx: -1, sy: -1 };
      const m = new DOMMatrixReadOnly(getComputedStyle(p).transform);
      // Con rotación, las escalas son las normas de las columnas de la matriz.
      return {
        op: Number(getComputedStyle(p).opacity),
        sx: Math.round(Math.hypot(m.a, m.b) * 1000) / 1000,
        sy: Math.round(Math.hypot(m.c, m.d) * 1000) / 1000,
      };
    });

  // A 120 px del borde ya NO debe verse: antes empezaba a los 140 y asomaba muy pronto.
  await page.mouse.move(fig.x - 120, cy, { steps: 30 });
  await sleep(400);
  const far = await pillNow();
  check('a 120 px del borde todavía no se ve', far.op < 0.03, `opacidad ${far.op.toFixed(2)}`);

  await page.mouse.move(fig.x - 30, cy, { steps: 40 }); // acercarse por fuera
  await sleep(300);
  const near = await pillNow();
  const approach = near.op;
  // Genie: a medio desplegar las dos escalas tienen que ser MUY distintas entre sí.
  check(
    'a medio desplegar el cartel está achatado, no escalado por igual',
    near.sy < near.sx * 0.85,
    `scaleX ${near.sx} · scaleY ${near.sy}`,
  );

  await page.mouse.move(cx, cy, { steps: 40 }); // entrar
  await sleep(600);
  await page.screenshot({
    path: join(OUT, 'pill-inside.png'),
    clip: { x: fig.x - 60, y: fig.y - 40, width: fig.w + 120, height: 320 },
  });

  await page.mouse.move(fig.x + fig.w - 40, cy, { steps: 12 }); // barrido rápido: balanceo
  // (12 pasos, los mismos que en recon-work.ts sobre la referencia, para poder comparar)
  await sleep(120);
  await page.screenshot({
    path: join(OUT, 'pill-swing.png'),
    clip: { x: fig.x - 60, y: fig.y - 40, width: fig.w + 120, height: 320 },
  });
  await sleep(700);

  // Salida equivalente a la de la sonda sobre la referencia, para que el retardo medido
  // dentro se pueda comparar con su mediana de 15.8 px.
  await page.mouse.move(fig.x + fig.w + 250, cy, { steps: 30 });
  await sleep(900);

  // Y aquí se corta la grabación: el viaje siguiente cruza la figura a toda velocidad solo
  // para comprobar el desvanecido, y si entrara en la serie inflaría el retardo.
  await page.evaluate(() => {
    (window as unknown as { __k: { rec: boolean } }).__k.rec = false;
  });

  // Alejarse DE VERDAD: a la derecha el viewport se acaba en 1440 y el cursor quedaba a 31 px
  // del borde de la figura, todavía dentro del margen de acercamiento.
  await page.mouse.move(20, 40, { steps: 30 });
  await sleep(900);
  const away = await page.evaluate(() => {
    const p = document.querySelector<HTMLElement>('.work__pill');
    const f = document.querySelector<HTMLElement>('[data-work-follower]');
    const m = f ? new DOMMatrixReadOnly(getComputedStyle(f).transform) : null;
    return {
      op: p ? Number(getComputedStyle(p).opacity) : -1,
      x: m ? Math.round(m.e) : -1,
      y: m ? Math.round(m.f) : -1,
    };
  });

  // --- EL BUG: salir y volver a entrar. La pill debe estar bajo el cursor, no en el borde.
  await page.evaluate(() => {
    (window as unknown as { __k: { rec: boolean } }).__k.rec = true;
  });
  await page.mouse.move(cx, cy - 100, { steps: 35 });
  await sleep(900);
  const back = await page.evaluate(() => {
    const f = document.querySelector<HTMLElement>('[data-work-follower]');
    const p = document.querySelector<HTMLElement>('.work__pill');
    const m = f ? new DOMMatrixReadOnly(getComputedStyle(f).transform) : null;
    return {
      x: m ? Math.round(m.e) : -1,
      y: m ? Math.round(m.f) : -1,
      op: p ? Number(getComputedStyle(p).opacity) : -1,
    };
  });
  await page.screenshot({
    path: join(OUT, 'pill-reenter.png'),
    clip: { x: fig.x - 60, y: fig.y - 140, width: fig.w + 120, height: 320 },
  });

  await page.evaluate(() => {
    (window as unknown as { __k: { rec: boolean } }).__k.rec = false;
  });
  const frames = (await page.evaluate(() => (window as unknown as { __k: { f: Frame[] } }).__k.f)) as Frame[];

  // ================== comprobaciones de la pill ==================
  console.log('== Pill "VIEW PROJECT"');

  const inside = (f: Frame): boolean =>
    f.mx >= fig.x && f.mx <= fig.x + fig.w && f.my >= fig.y && f.my <= fig.y + fig.h;
  const out = frames.filter((f) => !inside(f) && f.mx >= 0);
  const movedOutside = new Set(out.map((f) => `${f.fx},${f.fy}`)).size;

  check(
    'la pill sigue al cursor con el puntero FUERA de la figura',
    movedOutside > 10,
    `${movedOutside} posiciones distintas en ${out.length} frames fuera`,
  );
  check(
    'y ya es visible al acercarse, antes de entrar',
    approach > 0.05 && approach < 0.98,
    `opacidad a 30 px del borde: ${approach.toFixed(2)}`,
  );

  const ins = frames.filter(inside);
  const lag = ins.map((f) => Math.hypot(f.fx - f.mx, f.fy - f.my)).sort((a, b) => a - b);
  const med = lag[lag.length >> 1] ?? 0;
  const p95 = lag[Math.floor(lag.length * 0.95)] ?? 0;
  console.log(
    `      retardo dentro: mediana ${med.toFixed(1)} px · p95 ${p95.toFixed(1)} px  (referencia: 15.8 / 80.9)`,
  );
  check(
    'el retardo del seguimiento es del orden del medido',
    med > 3 && med < 45,
    `mediana ${med.toFixed(1)} px`,
  );

  const maxRot = Math.max(...frames.map((f) => Math.abs(f.rot)));
  check(
    'el cartel se balancea al moverse rápido',
    maxRot > 4,
    `rotación máxima ${maxRot.toFixed(1)}° (referencia: 14.1°)`,
  );

  // Genie en movimiento: al desplazarse en horizontal debe estirarse en X y comprimirse en Y.
  const moving = frames.filter((f) => f.op > 0.9);
  const maxRatio = Math.max(...moving.map((f) => f.sx / Math.max(0.01, f.sy)));
  const flat = moving.find((f) => f.sx / Math.max(0.01, f.sy) === maxRatio);
  check(
    'al moverse se estira en el eje del movimiento y se comprime en el otro',
    maxRatio > 1.25,
    `mayor desproporción scaleX/scaleY: ${maxRatio.toFixed(2)} (sx ${flat?.sx} · sy ${flat?.sy})`,
  );
  // Y en reposo tiene que volver a ser un rectángulo sin deformar.
  const rest = frames[frames.length - 1];
  check(
    'en reposo vuelve a su forma, sin deformación residual',
    !!rest && Math.abs(rest.sx - 1) < 0.08 && Math.abs(rest.sy - 1) < 0.08,
    `scaleX ${rest?.sx} · scaleY ${rest?.sy}`,
  );

  check('se desvanece al alejarse', away.op < 0.05, `opacidad lejos: ${away.op.toFixed(2)}`);

  // El bug: al re-entrar debe estar junto al cursor, no clavada en el borde de la figura.
  const dist = Math.hypot(back.x - cx, back.y - (cy - 100));
  check(
    'al salir y volver a entrar NO se queda pegada al borde',
    dist < 40 && back.op > 0.9,
    `pill a ${dist.toFixed(0)} px del cursor · opacidad ${back.op.toFixed(2)}`,
  );

  // ================== marcador de pestañas ==================
  console.log('\n== Marcador de pestañas');
  const drop = await page.evaluate(async () => {
    const marker = document.querySelector<HTMLElement>('[data-work-marker]');
    const previews = [...document.querySelectorAll<HTMLElement>('[data-work-preview]')];
    if (!marker || previews.length < 2) return null;
    const size = marker.offsetWidth;

    const mtx = (): DOMMatrixReadOnly => new DOMMatrixReadOnly(getComputedStyle(marker).transform);
    const y = (): number => mtx().f;
    const series: Array<{ t: number; y: number; rot: number }> = [];
    let go = true;
    const t0 = performance.now();
    const tick = (): void => {
      const m = mtx();
      series.push({
        t: Math.round(performance.now() - t0),
        y: Math.round(m.f * 10) / 10,
        rot: Math.round(Math.atan2(m.b, m.a) * (180 / Math.PI) * 10) / 10,
      });
      if (go) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const from = y();
    previews[1]?.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 2200));
    go = false;
    return { from, to: y(), series, size };
  });

  if (!drop) {
    check('hay marcador y al menos dos proyectos', false);
  } else {
    const moving = drop.series.filter((p, i) => i > 0 && p.y !== drop.series[i - 1]?.y);
    check(
      'el marcador cambia de proyecto',
      Math.abs(drop.to - drop.from) > 4,
      `de y=${drop.from.toFixed(0)} a y=${drop.to.toFixed(0)}`,
    );
    check(
      'no salta: recorre el trayecto en varios frames',
      moving.length > 6,
      `${moving.length} frames en tránsito`,
    );

    // Física: `bounce.out` NO rebasa el destino — llega, "toca suelo" y vuelve hacia atrás.
    // Lo que delata el rebote es que el movimiento cambie de sentido varias veces, no que
    // se pase de largo (mi primera comprobación medía lo segundo y por eso fallaba).
    const ys = drop.series.map((p) => p.y);
    let turns = 0;
    let dir = 0;
    for (let i = 1; i < ys.length; i++) {
      const d = Math.sign((ys[i] ?? 0) - (ys[i - 1] ?? 0));
      if (d !== 0 && dir !== 0 && d !== dir) turns++;
      if (d !== 0) dir = d;
    }
    const rebound = Math.max(...ys.map((v) => Math.abs(v - drop.to)).slice(ys.indexOf(Math.max(...ys))));
    check(
      'aterriza rebotando en vez de frenar en seco',
      turns >= 2,
      `${turns} cambios de sentido · mayor rebote de ${rebound.toFixed(0)} px`,
    );

    check('el marcador mide 10 px', drop.size === 10, `${drop.size} px`);

    // El giro: tumba mientras cae y se endereza al posarse.
    const rots = drop.series.map((p) => p.rot);
    const maxSpin = Math.max(...rots.map(Math.abs));
    const settled = rots[rots.length - 1] ?? 99;
    check('tumba un poco mientras cae', maxSpin > 4 && maxSpin < 30, `giro máximo ${maxSpin.toFixed(1)}°`);
    check('y se endereza al llegar', Math.abs(settled) < 0.6, `giro final ${settled.toFixed(2)}°`);
    console.log(
      `      giro (t:°): ${drop.series
        .filter((_, i) => i % 3 === 0)
        .slice(0, 22)
        .map((p) => `${p.t}:${p.rot.toFixed(0)}`)
        .join(' ')}`,
    );
    console.log(
      `      trayecto (t:y): ${drop.series
        .filter((_, i) => i % 3 === 0)
        .slice(0, 26)
        .map((p) => `${p.t}:${p.y.toFixed(0)}`)
        .join(' ')}`,
    );
  }

  await page.screenshot({ path: join(OUT, 'tabs.png'), clip: { x: 0, y: 0, width: 620, height: 900 } });

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
