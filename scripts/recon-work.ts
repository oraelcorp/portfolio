// scripts/recon-work.ts — mide el showcase de work de la referencia.
// La pill "VIEW PROJECT" no existe en el DOM hasta el hover: es un seguidor `position: fixed`
// en coordenadas de viewport, del que cuelga el cartel con `origin-bottom` y una rotación.
// Aquí se miden el retardo del seguimiento, el balanceo frente a la velocidad del puntero, la
// entrada/salida, y si el bullet de las pestañas salta o cae con física.
// Muestreo por rAF DENTRO de la página; el ratón se mueve en tandas con `steps`.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon');

interface Frame {
  t: number;
  mx: number;
  my: number;
  fx: number;
  fy: number;
  rot: number;
  dy: number;
  op: number;
  alive: boolean;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForTimeout(6000);

  // La sección de work, localizada por su encabezado (medido: top 4742, alto 3238).
  const sec = await page.evaluate(() => {
    const span = [...document.querySelectorAll('span')].find((e) =>
      /^selected work\.?$/i.test((e.textContent ?? '').trim()),
    );
    let n: HTMLElement | null = span as HTMLElement | null;
    while (n && n.tagName !== 'SECTION') n = n.parentElement;
    return n ? { top: n.offsetTop, h: n.offsetHeight } : null;
  });
  if (!sec) throw new Error('no encuentro la sección de work');
  console.log(`sección work: top ${sec.top} · alto ${sec.h}`);

  // Posición verificada a mano en la que el showcase tiene la media grande a la vista.
  await page.evaluate((y) => window.scrollTo(0, y), 5677);
  await page.waitForTimeout(1500);

  // La caja de la media se deduce del elemento que hay BAJO un punto que sí crea la pill,
  // no adivinando por tamaño: la primera versión de esta sonda cogió otra caja y midió basura.
  await page.mouse.move(950, 400);
  await page.waitForTimeout(700);

  // La caja de la media: se sube desde el punto del cursor hasta la primera caja del tamaño
  // medido a mano (≈912×618). Sin el techo de altura se subía hasta el contenedor sticky.
  const media = await page.evaluate(() => {
    let n = document.elementFromPoint(950, 400) as HTMLElement | null;
    for (let i = 0; i < 8 && n; i++) {
      const r = n.getBoundingClientRect();
      if (r.width > 700 && r.height > 350 && r.height < 700) {
        return {
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      }
      n = n.parentElement;
    }
    return null;
  });
  if (!media) throw new Error('no encuentro la media grande');
  console.log(`media: ${media.x},${media.y} ${media.w}×${media.h}`);

  // Hay DOS elementos con z-[9999] en la página: el seguidor bueno es el que además está
  // traducido hasta el cursor. Elegirlo por posición y no por orden en el DOM.
  const which = await page.evaluate(() => {
    const cands = [...document.querySelectorAll<HTMLElement>('div')].filter(
      (el) => el.className.includes('z-[9999]') && el.className.includes('fixed'),
    );
    return cands.map((el, i) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { i, e: Math.round(m.e), f: Math.round(m.f), cls: el.className.slice(0, 50) };
    });
  });
  console.log('candidatos z-[9999] (cursor en 950,400):');
  which.forEach((c) => console.log(`  [${c.i}] translate ${c.e},${c.f} · ${c.cls}`));
  const picked = which.find((c) => Math.hypot(c.e - 950, c.f - 400) < 60);
  if (!picked) throw new Error('ninguno de los z-[9999] sigue al cursor');
  console.log(`→ se mide el candidato ${picked.i}`);
  const pickIdx = picked.i;

  // --- Grabador: sigue al seguidor fixed (z-[9999]) y al cartel que cuelga de él.
  await page.evaluate((idx: number) => {
    const w = window as unknown as { __w: { frames: Frame[]; rec: boolean } };
    interface Frame {
      t: number;
      mx: number;
      my: number;
      fx: number;
      fy: number;
      rot: number;
      dy: number;
      op: number;
      alive: boolean;
    }
    w.__w = { frames: [], rec: false };

    let mx = -1;
    let my = -1;
    addEventListener('pointermove', (e) => {
      mx = e.clientX;
      my = e.clientY;
    });

    const findFollower = (): HTMLElement | null =>
      [...document.querySelectorAll<HTMLElement>('div')].filter(
        (el) => el.className.includes('z-[9999]') && el.className.includes('fixed'),
      )[idx] ?? null;

    const t0 = performance.now();
    const tick = (): void => {
      if (w.__w.rec) {
        const f = findFollower();
        if (!f) {
          w.__w.frames.push({
            t: performance.now() - t0,
            mx,
            my,
            fx: 0,
            fy: 0,
            rot: 0,
            dy: 0,
            op: 0,
            alive: false,
          });
        } else {
          const om = new DOMMatrixReadOnly(getComputedStyle(f).transform);
          const inner = f.firstElementChild as HTMLElement | null;
          const im = inner ? new DOMMatrixReadOnly(getComputedStyle(inner).transform) : null;
          w.__w.frames.push({
            t: performance.now() - t0,
            mx,
            my,
            fx: Math.round(om.e * 10) / 10,
            fy: Math.round(om.f * 10) / 10,
            // El ángulo del cartel y su desplazamiento vertical propio.
            rot: im ? Math.round(Math.atan2(im.b, im.a) * (180 / Math.PI) * 1000) / 1000 : 0,
            dy: im ? Math.round(im.f * 10) / 10 : 0,
            op: inner ? Number(getComputedStyle(inner).opacity) : 0,
            alive: true,
          });
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, pickIdx);

  const cx = media.x + media.w / 2;
  const cy = media.y + media.h / 2;

  await page.mouse.move(media.x - 300, cy);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    (window as unknown as { __w: { rec: boolean } }).__w.rec = true;
  });

  // 1) acercarse por fuera · 2) entrar · 3) barrido rápido dentro · 4) salir · 5) volver a entrar
  await page.mouse.move(media.x - 30, cy, { steps: 40 });
  await page.waitForTimeout(300);
  await page.mouse.move(cx, cy, { steps: 40 });
  await page.waitForTimeout(700);
  await page.mouse.move(media.x + media.w - 60, cy, { steps: 12 }); // rápido: para ver el balanceo
  await page.waitForTimeout(900);
  await page.mouse.move(media.x + media.w + 250, cy, { steps: 30 }); // salir
  await page.waitForTimeout(800);
  await page.mouse.move(cx, cy - 120, { steps: 40 }); // volver a entrar
  await page.waitForTimeout(900);

  await page.evaluate(() => {
    (window as unknown as { __w: { rec: boolean } }).__w.rec = false;
  });

  const frames = (await page.evaluate(
    () => (window as unknown as { __w: { frames: Frame[] } }).__w.frames,
  )) as Frame[];

  // --- Bullet de las pestañas al cambiar de proyecto
  const bullet = await page.evaluate(async () => {
    // No se elige UN bullet a ojo (la primera versión cogió el del nav y midió una recta):
    // se siguen TODOS los cuadritos del color de marca y luego se mira cuál se mueve.
    const isBullet = (el: HTMLElement): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.width > 22 || Math.abs(r.width - r.height) > 4) return false;
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(el).backgroundColor);
      if (!m) return false;
      return Number(m[1]) > 180 && Number(m[2]) > 40 && Number(m[3]) < 90;
    };
    const els = [...document.querySelectorAll<HTMLElement>('body *')].filter(isBullet);
    if (els.length === 0) return { found: false as const, series: [] };

    const series: Array<{ t: number; y: number; scroll: number; all: number[] }> = [];
    const t0 = performance.now();
    let go = true;
    const tick = (): void => {
      const tops = els.map((e) => Math.round(e.getBoundingClientRect().top * 10) / 10);
      series.push({
        t: Math.round(performance.now() - t0),
        y: tops[0] ?? 0,
        scroll: Math.round(window.scrollY),
        all: tops,
      });
      if (go) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const start = window.scrollY;
    await new Promise<void>((done) => {
      let n = 0;
      const step = (): void => {
        window.scrollTo(0, start + n * 10);
        if (++n < 220) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    await new Promise((r) => setTimeout(r, 1200));
    go = false;
    return { found: true as const, series };
  });

  writeFileSync(join(OUT, 'work-behavior.json'), JSON.stringify({ media, frames, bullet }, null, 1), 'utf8');

  // ================= INFORME =================
  const inside = (f: Frame): boolean =>
    f.mx >= media.x && f.mx <= media.x + media.w && f.my >= media.y && f.my <= media.y + media.h;

  console.log(`\n${frames.length} frames grabados`);

  const out = frames.filter((f) => !inside(f) && f.mx >= 0);
  console.log('\n=== ¿existe la pill con el cursor FUERA de la media? ===');
  console.log(
    `  frames fuera: ${out.length} · con el seguidor en el DOM: ${out.filter((f) => f.alive).length}`,
  );

  const ins = frames.filter(inside);
  console.log(`\n=== dentro (${ins.length} frames) ===`);
  const lag = ins.filter((f) => f.alive).map((f) => Math.hypot(f.fx - f.mx, f.fy - f.my));
  if (lag.length > 0) {
    const s = [...lag].sort((a, b) => a - b);
    console.log(
      `  distancia seguidor↔cursor: mediana ${s[s.length >> 1]?.toFixed(1)} px · p95 ${s[Math.floor(s.length * 0.95)]?.toFixed(1)} px · máx ${s[s.length - 1]?.toFixed(1)} px`,
    );
  }

  // Balanceo: correlación entre la velocidad horizontal del cursor y el ángulo del cartel
  console.log('\n=== balanceo del cartel frente a la velocidad del puntero ===');
  const rows: string[] = [];
  for (let i = 4; i < frames.length; i++) {
    const a = frames[i];
    const b = frames[i - 4];
    if (!a || !b || !a.alive) continue;
    const vx = (a.mx - b.mx) / Math.max(1, a.t - b.t); // px/ms
    if (Math.abs(vx) > 0.15) rows.push(`vx ${vx.toFixed(2)} px/ms → rot ${a.rot.toFixed(2)}°`);
  }
  console.log(`  muestras con movimiento apreciable: ${rows.length}`);
  rows.slice(0, 10).forEach((r) => console.log('   ' + r));
  const maxRot = Math.max(...frames.filter((f) => f.alive).map((f) => Math.abs(f.rot)));
  console.log(`  rotación máxima observada: ${maxRot.toFixed(2)}°`);

  console.log('\n=== entrada y salida ===');
  const first = frames.findIndex((f) => f.alive);
  if (first >= 0) {
    console.log('  primeros frames tras aparecer (t · opacidad · dy · rot):');
    console.log(
      '   ' +
        frames
          .slice(first, first + 14)
          .map((f) => `${Math.round(f.t)}:${f.op.toFixed(2)}/${f.dy}/${f.rot.toFixed(1)}`)
          .join('  '),
    );
  }
  const lastAlive = frames.map((f) => f.alive).lastIndexOf(true);
  const died = frames.findIndex((f, i) => i > first && f.alive === false && (frames[i - 1]?.alive ?? false));
  if (died > 0) {
    console.log('  frames alrededor de la desaparición:');
    console.log(
      '   ' +
        frames
          .slice(Math.max(0, died - 10), died + 2)
          .map((f) => `${Math.round(f.t)}:${f.alive ? f.op.toFixed(2) : 'fuera'}`)
          .join('  '),
    );
  }
  void lastAlive;

  console.log('\n=== bullets del color de marca ===');
  if (!bullet.found) {
    console.log('  no se localizó ninguno');
  } else {
    const s = bullet.series as Array<{ t: number; scroll: number; all: number[] }>;
    const n = s[0]?.all.length ?? 0;
    console.log(`  ${s.length} muestras · ${n} cuadritos seguidos`);
    // ¿Cuál se mueve de verdad?
    let mover = -1;
    let range = 0;
    for (let i = 0; i < n; i++) {
      const col = s.map((p) => p.all[i] ?? 0);
      const r = Math.max(...col) - Math.min(...col);
      if (r > range) {
        range = r;
        mover = i;
      }
    }
    console.log(`  el que más se mueve es el ${mover} con un recorrido de ${range.toFixed(0)} px`);
    if (mover >= 0 && range > 8) {
      const col = s.map((p) => ({ t: p.t, y: p.all[mover] ?? 0 }));
      let best = { i: 0, d: 0 };
      for (let i = 1; i < col.length; i++) {
        const d = Math.abs((col[i]?.y ?? 0) - (col[i - 1]?.y ?? 0));
        if (d > best.d) best = { i, d };
      }
      console.log(`  mayor salto entre dos frames: ${best.d.toFixed(1)} px`);
      const win = col.slice(Math.max(0, best.i - 8), best.i + 26);
      console.log('  entorno del cambio (t:y):');
      console.log('   ' + win.map((p) => `${p.t}:${p.y.toFixed(0)}`).join('  '));
      // ¿Se pasa de largo y vuelve? Eso sería física, no un tween normal.
      const ys = win.map((p) => p.y);
      const from = ys[0] ?? 0;
      const to = ys[ys.length - 1] ?? 0;
      const beyond = to > from ? Math.max(...ys) - to : to - Math.min(...ys);
      console.log(
        `  de ${from.toFixed(0)} a ${to.toFixed(0)} px · rebasa el destino en ${beyond.toFixed(1)} px (0 = sin rebote)`,
      );
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  // Sin esto, un fallo deja el navegador abierto y node no termina nunca: la primera vez
  // el script se quedó ocho minutos colgado sin imprimir nada.
  process.exit(1);
});
