// scripts/measure-expo.ts — mide la constante de exposición del retrato en vez de suponerla.
//
// El control de exposición necesita un OBJETIVO. La primera versión usó un brillo medio puesto
// a ojo (0.2246), y la segunda midió la densidad en un lienzo de 32x44 mientras el control la
// aplicaba a 160x225: a esa resolución la distribución es mucho más ancha, el percentil pedido
// salía muy bajo y la ganancia se quedaba SATURADA en su tope (1.85) todo el loop. Se mide: la media subió de 7 712 a 8 407 celdas cuando la foto rinde
// 10 450. Aquí se mide sobre el mismo lienzo de 32x44 que usa el motor, y no el brillo sino la
// DENSIDAD —la fracción de muestras que pasan el umbral de tinta tras la curva de contraste—,
// que es lo que de verdad se quiere mantener constante.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import type { VentanaSonda } from './lib/motor.ts';

const PORT = 4232;
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

  const stat = async (ruta: string, veces: number): Promise<void> => {
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/${ruta}`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => (document.querySelector('[data-ascii]') as HTMLElement)?.dataset.glReveal === '1.000',
      null,
      { timeout: 40_000 },
    );
    for (let i = 0; i < veces; i++) {
      const r = await page.evaluate(() => {
        const g = (window as VentanaSonda).__asciiGL!;
        const src = g.source as HTMLVideoElement | HTMLImageElement;
        const esVideo = 'videoWidth' in src;
        const vw = esVideo ? 580 : (src as HTMLImageElement).naturalWidth;
        const vh = esVideo ? 806 : (src as HTMLImageElement).naturalHeight;
        const COLS = 160,
          ROWS = 225,
          ZOOM = 1.2,
          FX = 0.1,
          FY = 1;
        const target = COLS / ROWS,
          srcA = vw / vh;
        let w = 1,
          h = 1;
        if (srcA > target) w = target / srcA;
        else h = srcA / target;
        w /= ZOOM;
        h /= ZOOM;
        const EW = 80,
          EH = 113;
        const c = document.createElement('canvas');
        c.width = EW;
        c.height = EH;
        const x = c.getContext('2d', { willReadFrequently: true })!;
        x.drawImage(
          src as CanvasImageSource,
          (1 - w) * FX * vw,
          (1 - h) * FY * vh,
          w * vw,
          h * vh,
          0,
          0,
          EW,
          EH,
        );
        const d = x.getImageData(0, 0, EW, EH).data;
        let suma = 0,
          conTinta = 0;
        const N = d.length / 4;
        for (let i2 = 0; i2 < d.length; i2 += 4) {
          const l = (0.2126 * (d[i2] ?? 0) + 0.7152 * (d[i2 + 1] ?? 0) + 0.0722 * (d[i2 + 2] ?? 0)) / 255;
          suma += l;
          if (Math.max(0, Math.min(1, (l - 0.15) * 1.4)) >= 0.12) conTinta++;
        }
        return {
          media: suma / N,
          densidad: conTinta / N,
          t: esVideo ? (src as HTMLVideoElement).currentTime : -1,
          gain: Number((document.querySelector('[data-ascii]') as HTMLElement).dataset.glGain ?? 1),
        };
      });
      console.log(
        `   ${ruta.padEnd(12)} t=${r.t.toFixed(2).padStart(5)}  mediaLuma=${r.media.toFixed(4)}  densidad=${(r.densidad * 100).toFixed(1)}%  gain=${r.gain.toFixed(3)}`,
      );
      await sleep(700);
    }
    await page.close();
  };

  console.log('== CONSTANTE DE EXPOSICIÓN, medida sobre el lienzo de 32x44 del motor ==');
  console.log('   densidad = % de muestras que pasan el umbral de tinta tras la curva\n');
  await stat('?glphoto', 3);
  console.log('');
  await stat('', 12);
  await b.close();
} finally {
  preview.stop();
}
