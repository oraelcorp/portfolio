// scripts/compare-fuente-luma.ts — la FUENTE, comparada en crudo: foto PNG vs frame de vídeo.
//
// `compare-nitidez.ts` deja el rasterizado descartado (el filtro del atlas no cambia un solo
// píxel) y señala a otro sitio: con la foto el retrato dibuja 10 450 celdas y con el vídeo
// 5 906. Aquí se mira la causa de eso donde nace, antes de shaders y de glifos: se muestrean
// las dos fuentes EXACTAMENTE con el mismo recorte que usa el retrato (cover + zoom 1.2 + foco
// 0.1/1) sobre la misma rejilla, y se comparan sus luminancias.
//
// Si el vídeo llega más oscuro o con menos contraste que la foto, el mismo `contrast` deja más
// celdas por debajo del umbral de tinta y el retrato sale medio vacío — que es justo el
// «se ve cool pero no se aprecia el arte».
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { VentanaSonda } from './lib/motor.ts';

const PORT = 4228;
const OUT = resolve('screenshots', 'nitidez');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const preview = startPreview(PORT);
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
    } catch {
      /* aún no */
    }
    await sleep(400);
  }
  const b = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => (document.querySelector('[data-ascii]') as HTMLElement)?.dataset.glReady === '1',
    null,
    { timeout: 40_000 },
  );
  await sleep(3000);

  const r = await page.evaluate(async () => {
    const COLS = 160,
      ROWS = 225,
      ZOOM = 1.2,
      FX = 0.1,
      FY = 1,
      CONTRAST = 1.4,
      EMPTY = 0.12;

    interface Expo {
      media: number;
      desv: number;
      vacias: number;
      b0: number;
      b1: number;
      b2: number;
      b3: number;
      b4: number;
    }
    const muestrear = (src: CanvasImageSource, vw: number, vh: number): Expo => {
      const cv = document.createElement('canvas');
      cv.width = COLS;
      cv.height = ROWS;
      const x = cv.getContext('2d', { willReadFrequently: true })!;
      // Mismo recorte que srcRect(): cover contra la proporción del área, luego zoom y foco.
      const target = COLS / ROWS,
        srcA = vw / vh;
      let w = 1,
        h = 1;
      if (srcA > target) w = target / srcA;
      else h = srcA / target;
      w /= ZOOM;
      h /= ZOOM;
      const sx = (1 - w) * FX * vw,
        sy = (1 - h) * FY * vh;
      x.drawImage(src, sx, sy, w * vw, h * vh, 0, 0, COLS, ROWS);
      const d = x.getImageData(0, 0, COLS, ROWS).data;
      let suma = 0,
        vacias = 0,
        sumaSq = 0;
      const bandas = [0, 0, 0, 0, 0];
      for (let i = 0; i < d.length; i += 4) {
        const l = (0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0)) / 255;
        const aj = Math.max(0, Math.min(1, (l - 0.15) * CONTRAST));
        suma += aj;
        sumaSq += aj * aj;
        if (aj < EMPTY) vacias++;
        bandas[Math.min(4, Math.floor(aj * 5))]!++;
      }
      const n = d.length / 4;
      const media = suma / n;
      const pc = (i: number): number => ((bandas[i] ?? 0) / n) * 100;
      return {
        media,
        desv: Math.sqrt(sumaSq / n - media * media),
        vacias: (vacias / n) * 100,
        b0: pc(0),
        b1: pc(1),
        b2: pc(2),
        b3: pc(3),
        b4: pc(4),
      };
    };

    const img = new Image();
    img.src = '/img/portrait/portrait.png';
    await img.decode();
    const v = (window as VentanaSonda).__asciiGL?.source as HTMLVideoElement;
    return {
      foto: muestrear(img, img.naturalWidth, img.naturalHeight),
      video: muestrear(v, v.videoWidth || 580, v.videoHeight || 806),
      tamFoto: `${img.naturalWidth}x${img.naturalHeight}`,
      tamVideo: `${v.videoWidth}x${v.videoHeight}`,
      t: v.currentTime,
    };
  });

  const L: string[] = [];
  const say = (s = '') => {
    console.log(s);
    L.push(s);
  };
  say('== LA FUENTE EN CRUDO · foto PNG vs frame de vídeo, mismo recorte y misma curva ==');
  say(`   foto ${r.tamFoto} · vídeo ${r.tamVideo} (t=${r.t.toFixed(2)}s) · rejilla 160x225 · contraste 1.4`);
  say('');
  say('   fuente   media   desv    vacías%   b0%    b1%    b2%    b3%    b4%');
  for (const [n, m] of [
    ['foto', r.foto],
    ['vídeo', r.video],
  ] as const) {
    say(
      `   ${n.padEnd(8)} ${m.media.toFixed(3)}  ${m.desv.toFixed(3)}  ${m.vacias.toFixed(1).padStart(6)}  ${m.b0.toFixed(1).padStart(5)}  ${m.b1.toFixed(1).padStart(5)}  ${m.b2.toFixed(1).padStart(5)}  ${m.b3.toFixed(1).padStart(5)}  ${m.b4.toFixed(1).padStart(5)}`,
    );
  }
  say('');
  say(
    `   >>> celdas por debajo del umbral de tinta: foto ${r.foto.vacias.toFixed(1)} % · vídeo ${r.video.vacias.toFixed(1)} %`,
  );
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'fuente-luma.txt'), L.join('\n'), 'utf8');
  await b.close();
} finally {
  preview.stop();
}
