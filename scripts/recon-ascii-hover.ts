// scripts/recon-ascii-hover.ts — ¿cómo afecta el puntero al retrato ASCII de la referencia?
// La pregunta concreta: la zona afectada, ¿es un círculo uniforme o sigue los bordes y el
// contraste del sujeto? Y ¿aclara hacia blanco o revela color?
//
// Método: se captura el canvas sin puntero y con el puntero en varios sitios, se restan las
// imágenes y se analiza la MÁSCARA de píxeles que cambian — su radio, su circularidad y su
// correlación con la luminancia del retrato en reposo. Eso responde "círculo vs orgánico"
// con números en vez de a ojo.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon');

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForTimeout(7000);

  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
  if (!box) throw new Error('no encuentro el canvas del retrato');
  console.log(`canvas: ${box.x},${box.y} ${box.w}×${box.h}`);

  /**
   * Captura compuesta del área del canvas. NO se usa `toDataURL`: el retrato de la referencia
   * es WebGL y, sin `preserveDrawingBuffer`, leerlo tras presentar el frame devuelve un búfer
   * vacío — la primera versión de esta sonda daba diferencia cero en todo.
   */
  const grab = async (): Promise<string> => {
    const buf = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
    return 'data:image/png;base64,' + buf.toString('base64');
  };

  // El shimmer cambia caracteres al azar por todo el canvas, así que UNA captura no permite
  // separarlo del efecto del puntero: la primera versión de esta sonda daba un "radio" de 419
  // px sobre un canvas de 564 y un llenado del 3.8 %, que es la firma del shimmer, no del
  // puntero. Se promedian VARIAS capturas de cada estado: lo aleatorio se cancela y lo que
  // persiste en un sitio fijo sobrevive.
  const N = 7;
  const P1 = { x: box.x + Math.round(box.w * 0.32), y: box.y + Math.round(box.h * 0.34) };
  const P2 = { x: box.x + Math.round(box.w * 0.68), y: box.y + Math.round(box.h * 0.7) };

  // Series INTERCALADAS entre dos posiciones del puntero. El shimmer se decorrelaciona igual
  // en ambas y queda como ruido uniforme; el efecto del puntero, en cambio, se MUEVE, así que
  // la resta de medias tiene que enseñar dos lóbulos localizados, uno en cada posición.
  const a: string[] = [];
  const c: string[] = [];
  for (let i = 0; i < N; i++) {
    await page.mouse.move(P1.x, P1.y, { steps: 8 });
    await page.waitForTimeout(700);
    a.push(await grab());
    await page.mouse.move(P2.x, P2.y, { steps: 8 });
    await page.waitForTimeout(700);
    c.push(await grab());
  }
  const reposo = a;
  const conPuntero = c;

  // El análisis se hace dentro de una página aparte, con canvas 2D.
  const lab = await ctx.newPage();
  await lab.setContent('<canvas id=a></canvas><canvas id=b></canvas><canvas id=c></canvas>');
  const stats = await lab.evaluate(
    async ([serieA, serieC, px, py, qx, qy]) => {
      const load = (src: string): Promise<HTMLImageElement> =>
        new Promise((res) => {
          const i = new Image();
          i.onload = () => res(i);
          i.src = src;
        });
      const data = async (src: string): Promise<ImageData> => {
        const img = await load(src);
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        const g = cv.getContext('2d')!;
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, cv.width, cv.height);
      };

      /** Media por píxel de una serie de capturas: cancela el shimmer. */
      const media = async (srcs: string[]): Promise<ImageData> => {
        const first = await data(srcs[0]!);
        const acc = new Float64Array(first.data.length);
        for (const src of srcs) {
          const d0 = await data(src);
          for (let i = 0; i < acc.length; i++) acc[i] = (acc[i] ?? 0) + (d0.data[i] ?? 0);
        }
        for (let i = 0; i < acc.length; i++) first.data[i] = Math.round(acc[i]! / srcs.length);
        return first;
      };

      const A = await media(serieA);
      const C = await media(serieC);
      // El ruido residual se estima partiendo la serie de reposo en dos mitades promediadas.
      const B = await media(serieA.slice(0, Math.ceil(serieA.length / 2)));
      const A2 = await media(serieA.slice(Math.ceil(serieA.length / 2)));
      const W = A.width;
      const H = A.height;

      /** Diferencia por píxel entre dos imágenes. */
      const diff = (X: ImageData, Y: ImageData): Float32Array => {
        const out = new Float32Array(W * H);
        for (let i = 0; i < W * H; i++) {
          const j = i * 4;
          out[i] =
            Math.abs(X.data[j]! - Y.data[j]!) +
            Math.abs(X.data[j + 1]! - Y.data[j + 1]!) +
            Math.abs(X.data[j + 2]! - Y.data[j + 2]!);
        }
        return out;
      };

      const ruido = diff(B, A2); // dos mitades del reposo: solo shimmer residual
      const efecto = diff(A, C); // shimmer + puntero

      const p95 = (arr: Float32Array): number => {
        const s = Array.from(arr).sort((x, y) => x - y);
        return s[Math.floor(s.length * 0.95)] ?? 0;
      };
      // Umbral por encima del ruido residual, con un suelo bajo porque ya está promediado.
      const umbral = Math.max(10, p95(ruido) * 2);

      // Perfil radial alrededor de CADA posición del puntero: si el efecto es local, la
      // diferencia media cae con la distancia; si es plano, es shimmer y nada más.
      const perfil = (px0: number, py0: number): number[] => {
        const bins = new Array(10).fill(0);
        const cuenta = new Array(10).fill(0);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const d = Math.hypot(x - px0, y - py0);
            const b = Math.floor(d / 30);
            if (b >= 10) continue;
            bins[b] += efecto[y * W + x]!;
            cuenta[b]++;
          }
        }
        return bins.map((v, i) => Number((v / Math.max(1, cuenta[i])).toFixed(2)));
      };

      const p1 = perfil(px, py);
      const p2 = perfil(qx, qy);

      // Máscara del efecto, para el análisis de forma alrededor de P1.
      const mask: number[] = [];
      for (let i = 0; i < W * H; i++) if (efecto[i]! > umbral) mask.push(i);

      // Cerca de P1: ¿el disco se llena de forma pareja o solo donde hay tinta?
      const R = 90;
      let enDisco = 0;
      let conTinta = 0;
      let cambian = 0;
      let cambianConTinta = 0;
      for (let y = Math.max(0, py - R); y < Math.min(H, py + R); y++) {
        for (let x = Math.max(0, px - R); x < Math.min(W, px + R); x++) {
          if (Math.hypot(x - px, y - py) > R) continue;
          enDisco++;
          const j = (y * W + x) * 4;
          const lum = 0.2126 * A.data[j]! + 0.7152 * A.data[j + 1]! + 0.0722 * A.data[j + 2]!;
          const tinta = lum > 30;
          if (tinta) conTinta++;
          if (efecto[y * W + x]! > umbral) {
            cambian++;
            if (tinta) cambianConTinta++;
          }
        }
      }

      const sat = (D: ImageData): number => {
        let s2 = 0;
        let n = 0;
        for (let y = Math.max(0, py - R); y < Math.min(H, py + R); y++) {
          for (let x = Math.max(0, px - R); x < Math.min(W, px + R); x++) {
            if (Math.hypot(x - px, y - py) > R) continue;
            const j = (y * W + x) * 4;
            const r = D.data[j]!;
            const g = D.data[j + 1]!;
            const bl = D.data[j + 2]!;
            const mx2 = Math.max(r, g, bl);
            if (mx2 < 30) continue;
            s2 += (mx2 - Math.min(r, g, bl)) / mx2;
            n++;
          }
        }
        return n === 0 ? 0 : s2 / n;
      };

      return {
        vacio: false,
        umbral: Math.round(umbral),
        // Perfil radial: diferencia media por anillos de 30 px desde cada posición
        perfilDesdeP1: p1,
        perfilDesdeP2: p2,
        pxAfectados: mask.length,
        // Alrededor de P1, en un radio de 90 px
        discoP1_llenado: Number((cambian / enDisco).toFixed(3)),
        discoP1_tintaDisponible: Number((conTinta / enDisco).toFixed(3)),
        discoP1_delCambioTieneTinta: Number((cambianConTinta / Math.max(1, cambian)).toFixed(3)),
        satEnP1_lejos: Number(sat(A).toFixed(3)),
        satEnP1_cerca: Number(sat(C).toFixed(3)),
      };
    },
    [reposo, conPuntero, P1.x - box.x, P1.y - box.y, P2.x - box.x, P2.y - box.y] as [
      string[],
      string[],
      number,
      number,
      number,
      number,
    ],
  );

  writeFileSync(join(OUT, 'ascii-hover.json'), JSON.stringify(stats, null, 1), 'utf8');
  console.log('\n=== efecto del puntero sobre el retrato de la referencia ===');
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(20)}: ${JSON.stringify(v)}`);

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
