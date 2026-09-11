// scripts/measure-expo-curva.ts — hornea la curva de exposición del clip del retrato.
//
// Por qué no se calcula en vivo: medir el brillo del frame en tiempo real obliga a traer el
// frame de vídeo a la CPU (`drawImage` sobre un <video>), y eso cuesta ~8 ms — medido en
// `diag-coste.ts`, con el presupuesto de §8 en 4 ms. Pero el clip es un ASSET FIJO de 7.6 s:
// la exposición de cada instante se puede medir UNA vez aquí y consultarse en tiempo real por
// `currentTime` a coste cero. Es la misma idea que el resto del proyecto: medir fuera, hornear
// la constante, y que el runtime solo la consuma.
//
// Salida: src/effects/ascii/expoCurve.ts (generado; no editar a mano).
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VentanaSonda } from './lib/motor.ts';

const PORT = 4234;
const PASO = 0.05; // s entre muestras
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

  const r = await page.evaluate(async (paso) => {
    const EW = 80,
      EH = 113,
      COLS = 160,
      ROWS = 225,
      ZOOM = 1.2,
      FX = 0.1,
      FY = 1;
    const CONTRAST = 1.4,
      EMPTY = 0.12;
    const LIMITE = EMPTY / CONTRAST + 0.15;

    const lienzo = document.createElement('canvas');
    lienzo.width = EW;
    lienzo.height = EH;
    const x = lienzo.getContext('2d', { willReadFrequently: true })!;

    const recorte = (vw: number, vh: number): [number, number, number, number] => {
      const target = COLS / ROWS,
        srcA = vw / vh;
      let w = 1,
        h = 1;
      if (srcA > target) w = target / srcA;
      else h = srcA / target;
      w /= ZOOM;
      h /= ZOOM;
      return [(1 - w) * FX * vw, (1 - h) * FY * vh, w * vw, h * vh];
    };

    /** Percentil de luminancia que deja por encima la fracción pedida. */
    const percentil = (frac: number): number => {
      const d = x.getImageData(0, 0, EW, EH).data;
      const BINS = 64;
      const hist = new Uint16Array(BINS);
      const total = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const l = (0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0)) / 255;
        hist[Math.min(BINS - 1, Math.floor(l * BINS))]!++;
      }
      const meta = total * frac;
      let acc = 0;
      for (let b2 = BINS - 1; b2 >= 0; b2--) {
        acc += hist[b2] ?? 0;
        if (acc >= meta) return (b2 + 0.5) / BINS;
      }
      return 1 / BINS;
    };

    // --- objetivo: la densidad de la FOTO ya calibrada -------------------------------------
    const img = new Image();
    img.src = '/img/portrait/portrait.png';
    await img.decode();
    let rr = recorte(img.naturalWidth, img.naturalHeight);
    x.drawImage(img, rr[0], rr[1], rr[2], rr[3], 0, 0, EW, EH);
    const dFoto = x.getImageData(0, 0, EW, EH).data;
    let sobre = 0;
    for (let i = 0; i < dFoto.length; i += 4) {
      const l =
        (0.2126 * (dFoto[i] ?? 0) + 0.7152 * (dFoto[i + 1] ?? 0) + 0.0722 * (dFoto[i + 2] ?? 0)) / 255;
      if (l >= LIMITE) sobre++;
    }
    const objetivo = sobre / (dFoto.length / 4);

    // --- curva del vídeo -------------------------------------------------------------------
    // SE MIDE REPRODUCIENDO, no haciendo seek. Con el vídeo pausado y buscando por
    // `currentTime`, `drawImage` devuelve frames en negro a medio decodificar: la primera
    // versión de esta sonda lo hizo así y horneó ganancias de hasta 4.31 que llenaban el canvas
    // entero de glifos (35 979 celdas de 36 000). Reproduciendo se mide lo que se ve.
    const v = (window as VentanaSonda).__asciiGL?.source as HTMLVideoElement;
    const dur = v.duration;
    rr = recorte(580, 806);
    const n = Math.ceil(dur / paso);
    const suma = new Float64Array(n);
    const cuenta = new Uint16Array(n);
    v.currentTime = 0;
    await v.play().catch(() => {});
    const hasta = performance.now() + (dur * 1000 + 900) * 2; // dos vueltas, por si acaso
    while (performance.now() < hasta) {
      await new Promise<void>((res) => requestAnimationFrame(() => res()));
      if (v.paused || v.readyState < 2) continue;
      x.drawImage(v, rr[0], rr[1], rr[2], rr[3], 0, 0, EW, EH);
      const g = LIMITE / Math.max(0.02, percentil(objetivo));
      const i = Math.min(n - 1, Math.floor(v.currentTime / paso));
      suma[i] = (suma[i] ?? 0) + g;
      cuenta[i] = (cuenta[i] ?? 0) + 1;
    }
    const curva: number[] = [];
    let ultimo = 1;
    for (let i = 0; i < n; i++) {
      const c = cuenta[i] ?? 0;
      // Si algún hueco se quedó sin muestras, se arrastra el anterior en vez de inventar.
      ultimo = c > 0 ? (suma[i] ?? 0) / c : ultimo;
      curva.push(Number(ultimo.toFixed(4)));
    }
    void v.play().catch(() => {});
    return { curva, objetivo, dur, limite: LIMITE };
  }, PASO);

  const min = Math.min(...r.curva),
    max = Math.max(...r.curva);
  const media = r.curva.reduce((a, c) => a + c, 0) / r.curva.length;
  console.log(`objetivo (densidad de la foto): ${(r.objetivo * 100).toFixed(1)} %`);
  console.log(`curva: ${r.curva.length} muestras cada ${PASO}s sobre ${r.dur.toFixed(2)}s`);
  console.log(`ganancia: mín ${min.toFixed(3)} · media ${media.toFixed(3)} · máx ${max.toFixed(3)}`);

  const out = `// GENERADO por scripts/measure-expo-curva.ts — no editar a mano.
//
// Exposición del clip del retrato, horneada. Cada valor es la ganancia que lleva la densidad de
// ese instante del vídeo a la de la FOTO ya calibrada (${(r.objetivo * 100).toFixed(1)} % de celdas con tinta).
// Se hornea porque medirlo en vivo obliga a traer el frame a la CPU: ~8 ms por muestra, contra
// un presupuesto de 4 ms por frame (§8). Consultarlo por currentTime cuesta cero.
//
// Medido: ganancia mín ${min.toFixed(3)} · media ${media.toFixed(3)} · máx ${max.toFixed(3)}.

/** Segundos entre muestras. */
export const EXPO_PASO = ${PASO};

/** Ganancia por instante del clip. Se interpola entre muestras. */
export const EXPO_CURVA: readonly number[] = [
  ${r.curva.map((n) => n.toFixed(4)).join(', ')},
];

/** Ganancia del clip en el segundo \`t\`, interpolada y con vuelta al principio del loop. */
export function expoEn(t: number): number {
  const n = EXPO_CURVA.length;
  if (n === 0) return 1;
  const p = (t / EXPO_PASO) % n;
  const i = Math.floor(p);
  const f = p - i;
  const a = EXPO_CURVA[i] ?? 1;
  const b = EXPO_CURVA[(i + 1) % n] ?? a;
  return a + (b - a) * f;
}
`;
  writeFileSync(resolve('src/effects/ascii/expoCurve.ts'), out, 'utf8');
  console.log('Escrito src/effects/ascii/expoCurve.ts');
  await b.close();
} finally {
  preview.stop();
}
