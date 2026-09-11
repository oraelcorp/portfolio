// scripts/compare-nitidez.ts — ¿por qué los glifos de WebGL se ven menos nítidos que los del
// Canvas 2D ya calibrado? (Checkpoint A, 2026-09-09.)
//
// Se comparan los DOS motores con la MISMA fuente (la foto, vía `?glphoto`) y la MISMA densidad
// nominal (celda 4.00), porque comparar el vídeo contra la foto no diría nada del rasterizado.
//
// Métricas, todas sobre el recorte en píxeles de dispositivo SIN escalar:
//   · parcial% — de los píxeles CON tinta, cuántos están a cobertura parcial (entre el 15 % y
//                el 85 % del máximo DE SU PROPIA CELDA). Un glifo nítido es casi binario dentro
//                de su celda; uno difuminado llena la franja intermedia. Se normaliza por celda
//                porque el alpha varía de 0.22 a 0.72 según la luminancia, y sin normalizar se
//                estaría midiendo el alpha en vez del rasterizado. ES LA MÉTRICA DE NITIDEZ.
//   · celdas   — celdas no vacías que entraron en la medida (tamaño de la muestra).
//   · tinta    — % de píxeles con tinta sobre el canvas entero. Es DENSIDAD, no nitidez.
//
// Y se guardan recortes ampliados x8 con vecino más próximo (sin interpolar, para no meter el
// difuminado que estamos midiendo) para poder verlo a ojo además de en números.

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4224;
const OUT = resolve('screenshots', 'nitidez');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Recorte en píxeles de dispositivo del canvas del retrato. Mismo sitio en los dos motores. */
const CROP = { x: 260, y: 300, w: 80, h: 80 };
const ZOOM = 8;

interface Medida {
  medios: number;
  grad: number;
  tinta: number;
  max: number;
  grid: string;
  png: string;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  const linea: string[] = [];
  const say = (s = ''): void => {
    console.log(s);
    linea.push(s);
    writeFileSync(join(OUT, 'nitidez.txt'), linea.join('\n'), 'utf8');
  };

  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
      } catch {
        /* aún no */
      }
      await sleep(400);
    }

    const browser = await chromium.launch({ channel: 'chrome', headless: false });
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });

    const medir = async (ruta: string): Promise<Medida> => {
      const page = await ctx.newPage();
      await page.goto(`http://localhost:${PORT}/${ruta}`, { waitUntil: 'load' });
      await page.waitForFunction(
        () => {
          const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
          // Los dos motores publican el progreso con `toFixed(3)`, así que el final es '1.000'
          // en ambos. Esperar '1' aquí dejaba la sonda colgada 40 s contra el Canvas 2D.
          return c?.dataset.glReveal === '1.000' || c?.dataset.reveal === '1.000';
        },
        null,
        { timeout: 40_000 },
      );
      await sleep(1200);

      const r = await page.evaluate(
        ({ crop, zoom, cellPx }) => {
          const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
          if (!c) throw new Error('sin canvas');

          const W = c.width;
          const H = c.height;
          const off = document.createElement('canvas');
          off.width = W;
          off.height = H;
          const x = off.getContext('2d', { willReadFrequently: true });
          if (!x) throw new Error('sin 2d');
          x.drawImage(c, 0, 0);
          const d = x.getImageData(0, 0, W, H).data;

          const lum = new Float64Array(W * H);
          let max = 0;
          for (let i = 0, k = 0; i < d.length; i += 4, k++) {
            const l = 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
            lum[k] = l;
            if (l > max) max = l;
          }

          // Nitidez NORMALIZADA POR CELDA. Sin normalizar, el alpha por celda (0.22-0.72 según
          // luminancia) hace que una celda tenue tenga todos sus píxeles en la franja media
          // aunque el glifo sea perfectamente nítido: mediría el alpha, no el rasterizado.
          // Aquí cada celda se mide contra SU propio máximo.
          let parciales = 0;
          let solidos = 0;
          let celdas = 0;
          let mejor = { x: 0, y: 0, tinta: -1 };
          for (let cy = 0; cy + cellPx <= H; cy += cellPx) {
            for (let cx = 0; cx + cellPx <= W; cx += cellPx) {
              let cmax = 0;
              for (let j = 0; j < cellPx; j++) {
                for (let i = 0; i < cellPx; i++) {
                  const l = lum[(cy + j) * W + cx + i] ?? 0;
                  if (l > cmax) cmax = l;
                }
              }
              if (cmax < 20) continue; // celda vacía: no dice nada del rasterizado
              celdas++;
              for (let j = 0; j < cellPx; j++) {
                for (let i = 0; i < cellPx; i++) {
                  const l = lum[(cy + j) * W + cx + i] ?? 0;
                  if (l >= cmax * 0.85) solidos++;
                  else if (l >= cmax * 0.15) parciales++;
                }
              }
            }
          }

          // Zona más densa, para que el recorte ampliado caiga sobre dibujo en los dos motores
          // (los encuadres NO coinciden: WebGL aplica zoom 1.2 y foco desplazado).
          for (let cy = 0; cy + crop.h <= H; cy += 20) {
            for (let cx = 0; cx + crop.w <= W; cx += 20) {
              let t = 0;
              for (let j = 0; j < crop.h; j += 2) {
                for (let i = 0; i < crop.w; i += 2) {
                  if ((lum[(cy + j) * W + cx + i] ?? 0) > 26) t++;
                }
              }
              if (t > mejor.tinta) mejor = { x: cx, y: cy, tinta: t };
            }
          }

          const rec = document.createElement('canvas');
          rec.width = crop.w;
          rec.height = crop.h;
          const rx = rec.getContext('2d');
          if (!rx) throw new Error('sin 2d');
          rx.drawImage(c, mejor.x, mejor.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

          const big = document.createElement('canvas');
          big.width = crop.w * zoom;
          big.height = crop.h * zoom;
          const bx = big.getContext('2d');
          if (!bx) throw new Error('sin 2d');
          bx.imageSmoothingEnabled = false;
          bx.fillStyle = '#000';
          bx.fillRect(0, 0, big.width, big.height);
          bx.drawImage(rec, 0, 0, big.width, big.height);

          const conTinta = parciales + solidos;
          return {
            medios: conTinta > 0 ? (parciales / conTinta) * 100 : -1,
            grad: celdas,
            tinta: (conTinta / (W * H)) * 100,
            max,
            grid: `${c.dataset.glGrid ?? '(2D)'} · canvas ${W}x${H} · zona (${mejor.x},${mejor.y})`,
            png: big.toDataURL('image/png'),
          };
        },
        { crop: CROP, zoom: ZOOM, cellPx: 8 },
      );
      await page
        .locator('[data-ascii]')
        .screenshot({ path: join(OUT, `canvas-${ruta.replace(/\W+/g, '_') || 'prod'}.png`) });
      await page.close();
      return r;
    };

    // Cuatro variantes, cambiando UNA cosa cada vez:
    //   2d           Canvas 2D + FOTO      (la referencia ya calibrada)
    //   gl-foto      WebGL   + FOTO        (aísla el motor: misma fuente que el 2D)
    //   gl-nearest   WebGL   + FOTO + atlas sin filtrar (aísla el filtro bilineal)
    //   gl-video     WebGL   + VÍDEO       (lo que se ve en producción)
    const variantes: [string, string][] = [
      ['2d', '?2d'],
      ['gl-foto', '?glphoto'],
      ['gl-video-antes', '?glexpo=0'],
      ['gl-video-despues', '/'],
    ];
    const medidas: [string, Medida][] = [];
    for (const [nombre, ruta] of variantes) {
      const m = await medir(ruta === '/' ? '' : ruta);
      medidas.push([nombre, m]);
      writeFileSync(join(OUT, `zoom-${nombre}.png`), Buffer.from(m.png.split(',')[1] ?? '', 'base64'));
    }
    const dosD = medidas[0]?.[1] as Medida;
    const gl = medidas[1]?.[1] as Medida;

    say('== NITIDEZ DE LOS GLIFOS · Canvas 2D vs WebGL, misma foto, misma celda ==');
    say(`   recorte ${CROP.w}x${CROP.h} px de dispositivo en (${CROP.x},${CROP.y}), ampliado x${ZOOM}`);
    say('');
    say('   motor    parcial%  celdas    tinta%   maxLum   contexto');
    const fila = (n: string, m: Medida): void =>
      say(
        `   ${n.padEnd(8)} ${m.medios.toFixed(2).padStart(7)}  ${m.grad.toFixed(2).padStart(7)}   ${m.tinta.toFixed(2).padStart(6)}   ${m.max.toFixed(0).padStart(6)}   ${m.grid}`,
      );
    for (const [nombre, m] of medidas) fila(nombre, m);
    say('');
    const peor = gl.medios - dosD.medios;
    say(
      `   >>> "medios" (menos = más nítido): WebGL ${peor > 0 ? `+${peor.toFixed(2)}` : peor.toFixed(2)} puntos frente al 2D`,
    );
    say(
      peor > 2
        ? '       El WebGL es MEDIBLEMENTE más blando. Hay algo que difumina.'
        : '       No hay diferencia apreciable de nitidez: la causa está en otro sitio.',
    );

    await ctx.close();
    await browser.close();
    say('');
    say(`Recortes ampliados en ${OUT}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
