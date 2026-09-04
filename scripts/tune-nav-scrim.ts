// scripts/tune-nav-scrim.ts — barre opacidad del tinte y radio del desenfoque del scrim del
// nav y mide, para cada combinación, cuánto contenido de detrás sigue leyéndose en la franja
// donde vive el texto del nav. Sirve para elegir el punto con datos en vez de a ojo.
//
// El caso de prueba es el peor conocido: el titular "Tools." del stack cruzando el wordmark.
// Métrica: luminancia máxima y desviación de los píxeles de esa región. Con el nav sin nada
// detrás, el titular llega a 238 (blanco pleno) sobre una superficie de 19.

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4200;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Región donde el titular del stack cruza la franja del nav, medida antes. */
const ZONA = { x0: 45, x1: 210, y0: 52, y1: 74 };

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
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
  await sleep(700);

  // Peor caso: el titular del stack cruzando el nav. El nav se auto-oculta al bajar, así que
  // hay que subir un poco para que reaparezca antes de medir.
  await page.evaluate(() =>
    document.querySelector('[data-section="stack"]')?.scrollIntoView({ block: 'start' }),
  );
  await sleep(900);
  await page.evaluate(() => window.scrollBy(0, 190));
  await sleep(700);
  await page.evaluate(() => window.scrollBy(0, -70));
  await sleep(1300);

  const analiza = await ctx.newPage();
  await analiza.setContent('<div></div>');

  const medir = async (): Promise<{ max: number; desv: number; media: number }> => {
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 90 } });
    return analiza.evaluate(
      async ([b64, z]) => {
        const img = new Image();
        await new Promise((r) => {
          img.onload = r;
          img.src = 'data:image/png;base64,' + (b64 as string);
        });
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        const g = cv.getContext('2d');
        if (!g) return { max: -1, desv: -1, media: -1 };
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        const zz = z as { x0: number; x1: number; y0: number; y1: number };
        const lum: number[] = [];
        for (let y = zz.y0; y < zz.y1; y++)
          for (let x = zz.x0; x < zz.x1; x++) {
            const i = (y * cv.width + x) * 4;
            lum.push(0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0));
          }
        const m = lum.reduce((a, b) => a + b, 0) / lum.length;
        const sd = Math.sqrt(lum.reduce((a, b) => a + (b - m) ** 2, 0) / lum.length);
        return { max: Math.max(...lum), desv: sd, media: m };
      },
      [buf.toString('base64'), ZONA],
    );
  };

  const aplicar = async (op: string, blur: string): Promise<void> => {
    await page.evaluate(
      ({ o, b }) => {
        const r = document.documentElement;
        r.style.setProperty('--nav-scrim', o);
        r.style.setProperty('--nav-scrim-blur', b);
      },
      { o: op, b: blur },
    );
    await sleep(500);
  };

  console.log('El titular de detrás llega a luminancia 238 sin nada que lo tape.');
  console.log('La superficie del nav en esa zona es 19. Cuanto más bajos, mejor.\n');
  console.log('  tinte   blur    lum.máx   desviación   media');

  const filas: Array<{ op: string; blur: string; max: number; desv: number }> = [];
  for (const [op, blur] of [
    ['0%', '0px'],
    ['10%', '0px'],
    ['14%', '0px'],
    ['10%', '4px'],
    ['14%', '6px'],
    ['14%', '8px'],
    ['14%', '12px'],
    ['20%', '8px'],
    ['28%', '10px'],
    ['40%', '10px'],
  ] as const) {
    await aplicar(op, blur);
    const r = await medir();
    filas.push({ op, blur, max: r.max, desv: r.desv });
    console.log(
      `  ${op.padEnd(6)}  ${blur.padEnd(5)}   ${r.max.toFixed(0).padStart(6)}   ${r.desv.toFixed(1).padStart(9)}   ${r.media.toFixed(1).padStart(6)}`,
    );
  }

  // Coste en scroll del backdrop-filter: se compara con y sin desenfoque, midiendo frames
  // desde dentro de la página como en check-phase4.
  const jank = async (blur: string): Promise<{ mediana: number; pct: number }> => {
    await aplicar('14%', blur);
    return page.evaluate(async () => {
      const frames: number[] = [];
      let last = performance.now();
      const start = window.scrollY;
      await new Promise<void>((done) => {
        let n = 0;
        const tick = (): void => {
          const now = performance.now();
          frames.push(now - last);
          last = now;
          window.scrollTo(0, start + n * 22);
          if (++n < 140) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      const s = frames.slice(5).sort((a, b) => a - b);
      const med = s[s.length >> 1] ?? 0;
      return { mediana: med, pct: (s.filter((f) => f > med * 1.5).length / s.length) * 100 };
    });
  };

  console.log('\nCoste del desenfoque al scrollear:');
  for (const b of ['0px', '8px', '12px']) {
    await page.evaluate(() => window.scrollTo(0, 3000));
    await sleep(600);
    const r = await jank(b);
    console.log(
      `  blur ${b.padEnd(5)} → mediana ${r.mediana.toFixed(1)} ms · ${r.pct.toFixed(1)} % de frames por encima de 1.5×`,
    );
  }

  await page.screenshot({
    path: join(OUT, 'nav-scrim-tuned.png'),
    clip: { x: 0, y: 0, width: 1440, height: 120 },
  });
  console.log('\n→ screenshots/nav-scrim-tuned.png');
  await browser.close();
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
