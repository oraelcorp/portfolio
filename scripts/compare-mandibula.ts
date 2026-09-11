// scripts/compare-mandibula.ts — qué pasa DE VERDAD al bajar la mandíbula un escalón.
//
// `measure-mandibula.ts` mide el campo: cuántas celdas llegan al tope y por qué camino. Esto
// mide lo RENDERIZADO, que es lo que se ve: para cada variante se cuentan los píxeles pintados
// de la zona de la mandíbula y se clasifican por el punto de la rampa al que se parecen.
//
// La clasificación es por PROPORCIÓN entre canales, no por valor absoluto: el canvas
// premultiplica el alpha, así que el mismo color sale a mil intensidades y compararlo a pelo
// contra el hex no encontraría nada. Es el mismo truco que usa `measure-hocico-comps.ts`.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import type { VentanaSonda } from './lib/motor.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4260;
const OUT = resolve('screenshots', 'mandibula');
const T_FRAME = 4.0;
/** Bloques de la mandíbula en la rejilla 6x8, los mismos que en `measure-mandibula.ts`. */
const COLS = 6;
const ROWS = 8;
const JAW = [32, 38, 44];

const VARIANTES: Array<[string, string]> = [
  ['K-tope-junto', '?glhlsolo=0'],
  ['K-baja1-BFBCB3', '?glhlsolo=1&glhlbaja=1'],
  ['K-baja2-978E7D', '?glhlsolo=1&glhlbaja=2'],
  ['K-baja3-F2DB8E', '?glhlsolo=1&glhlbaja=3'],
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TOPE_MS = 8 * 60 * 1000;
const guardian = setTimeout(() => {
  console.error(`FATAL: la sonda pasó de ${TOPE_MS / 1000}s. Se corta para no dejar huérfanos.`);
  process.exit(1);
}, TOPE_MS);
guardian.unref?.();

interface Cuenta {
  pintados: number;
  blanco: number;
  gris: number;
  grisCalido: number;
  crema: number;
  otros: number;
  jawPintados: number;
  jawBlanco: number;
  jawGris: number;
  jawGrisCalido: number;
  jawCrema: number;
  jawOtros: number;
}

const preview = startPreview(PORT);
const L: string[] = [];
const say = (s = ''): void => {
  console.log(s);
  L.push(s);
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
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  say('== SEPARAR LA MANDÍBULA DEL BRILLO · píxeles pintados, clasificados por punto de rampa ==');
  say(`   vídeo congelado en t=${T_FRAME.toFixed(2)}s · ganancia 1.2 · bloques ${JAW.join(', ')}`);
  say('');
  say('   variante          ZONA MANDÍBULA: blanco   BFBCB3   978E7D   F2DB8E   resto │ retrato: blanco');

  for (const [nombre, query] of VARIANTES) {
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'load' });
    await page.bringToFront();
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
      null,
      { timeout: 40_000 },
    );
    await page.evaluate(async (tt) => {
      const g = (window as VentanaSonda).__asciiGL as unknown as {
        source: HTMLVideoElement;
        frozen: boolean;
        colorBase: number;
        colorTarget: number;
        colorR: number;
      };
      g.frozen = true;
      g.source.pause();
      await new Promise<void>((res) => {
        const on = (): void => {
          g.source.removeEventListener('seeked', on);
          res();
        };
        g.source.addEventListener('seeked', on);
        g.source.currentTime = tt;
        setTimeout(on, 800);
      });
      g.colorBase = 1;
      g.colorTarget = 1;
      g.colorR = 1e6;
    }, T_FRAME);
    await sleep(900);

    const r = (await page.evaluate(
      ({ cols, rows, jaw }) => {
        const c = document.querySelector<HTMLCanvasElement>('[data-ascii]')!;
        const off = document.createElement('canvas');
        off.width = c.width;
        off.height = c.height;
        const x = off.getContext('2d', { willReadFrequently: true })!;
        x.drawImage(c, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;

        // Los cuatro puntos altos de la rampa, normalizados por su canal máximo.
        const REF: Array<[string, number[]]> = [
          ['blanco', [241, 240, 234]],
          ['gris', [191, 188, 179]],
          ['grisCalido', [151, 142, 125]],
          ['crema', [242, 219, 142]],
        ];
        const norm = REF.map(([k, v]) => {
          const m = Math.max(v[0]!, v[1]!, v[2]!);
          return [k, [v[0]! / m, v[1]! / m, v[2]! / m]] as [string, number[]];
        });

        const acc: Record<string, number> = {
          pintados: 0,
          blanco: 0,
          gris: 0,
          grisCalido: 0,
          crema: 0,
          otros: 0,
          jawPintados: 0,
          jawBlanco: 0,
          jawGris: 0,
          jawGrisCalido: 0,
          jawCrema: 0,
          jawOtros: 0,
        };

        for (let i = 0; i < d.length; i += 4) {
          const R = d[i]!;
          const G = d[i + 1]!;
          const B = d[i + 2]!;
          if (R + G + B < 60) continue;
          const p = i / 4;
          const px = p % c.width;
          const py = Math.floor(p / c.width);
          const bloque =
            Math.min(rows - 1, Math.floor((py * rows) / c.height)) * cols +
            Math.min(cols - 1, Math.floor((px * cols) / c.width));
          const enJaw = jaw.includes(bloque);

          const mx = Math.max(R, G, B) || 1;
          let mejor = 'otros';
          let dist = 0.09; // umbral: más allá, no se parece a ninguno de los cuatro
          for (const [k, v] of norm) {
            const dd = Math.abs(R / mx - v[0]!) + Math.abs(G / mx - v[1]!) + Math.abs(B / mx - v[2]!);
            if (dd < dist) {
              dist = dd;
              mejor = k;
            }
          }
          acc.pintados = (acc.pintados ?? 0) + 1;
          acc[mejor] = (acc[mejor] ?? 0) + 1;
          if (enJaw) {
            acc.jawPintados = (acc.jawPintados ?? 0) + 1;
            const clave = 'jaw' + mejor.charAt(0).toUpperCase() + mejor.slice(1);
            acc[clave] = (acc[clave] ?? 0) + 1;
          }
        }
        return acc as unknown as Cuenta;
      },
      { cols: COLS, rows: ROWS, jaw: JAW },
    )) as Cuenta;

    await page.locator('[data-ascii]').screenshot({ path: join(OUT, `${nombre}.png`) });
    const pj = (v: number): string => ((v / Math.max(1, r.jawPintados)) * 100).toFixed(1).padStart(6);
    const pt = (v: number): string => ((v / Math.max(1, r.pintados)) * 100).toFixed(1).padStart(6);
    say(
      `   ${nombre.padEnd(16)} ${pj(r.jawBlanco)} % ${pj(r.jawGris)} % ${pj(r.jawGrisCalido)} % ${pj(r.jawCrema)} % ${pj(r.jawOtros)} % │ ${pt(r.blanco)} %`,
    );
    await page.close();
  }

  say('');
  say(`Capturas en ${OUT}`);
  writeFileSync(join(OUT, 'compare-mandibula.txt'), L.join('\n'), 'utf8');
  await ctx.close();
  await browser.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
