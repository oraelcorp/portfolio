// scripts/measure-pelaje.ts — ¿qué detector aísla el PELAJE del cuerpo, para forzarlo a dorado?
//
// Cambio de estrategia de Javier: en vez de esperar que el dorado salga de la luminancia, se
// fuerza por REGIÓN, como el acento rojo del hocico. Pero el hocico tenía una señal propia —el
// tono magenta— y el pelaje no: el sujeto entero cabe en 11° de tono (medido en Fase 8 parte 1),
// así que aquí no hay color que separar. La región hay que definirla con lo que sí distingue al
// pelaje de las demás zonas claras:
//
//   · LUMINANCIA ALTA — es justo lo que hoy lo manda a blanco/gris.
//   · NO ES HIGHLIGHT — los dientes y la punta de la nariz son brillo puntual (contraste local
//     alto) y deben quedarse blancos. El pelaje es estructura.
//   · SUPERFICIE GRANDE — el mismo truco que salvó al hocico: en una ventana 5x5 hay 24 vecinas,
//     y una mancha pequeña no puede tenerlas. Es la aproximación local a la conectividad.
//
// El riesgo real está medido aquí también: la MANDÍBULA cumple los tres criterios, y acabamos de
// separarla del blanco a propósito. Por eso la sonda mide por zonas y no en total — un detector
// que se come la mandíbula no vale, por buenos que sean sus números globales.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import type { VentanaSonda } from './lib/motor.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4266;
const OUT = resolve('screenshots', 'pelaje');
const T_FRAME = 4.0;
const COLS = 6;
const ROWS = 8;

/** Zonas del fotograma congelado en t=4.00 s (ver la nota de `measure-mandibula.ts`). */
const ZONAS: Array<[string, number[]]> = [
  ['hombro y flanco (objetivo)', [39, 40, 41, 45, 46, 47]],
  ['mandíbula (NO tocar)', [32, 38, 44]],
  ['coronilla (NO tocar)', [19, 20, 21, 22]],
  ['cara y morro', [26, 27, 28, 33, 34, 35]],
];

/**
 * Detectores a barrer: umbral de luminancia, vecinas mínimas en la ventana 5x5 y, opcionalmente,
 * una FRANJA ESPACIAL (fracciones de la rejilla) que acota dónde puede aplicarse.
 *
 * Lo espacial entra porque la primera tanda lo dejó claro: **ningún umbral separa el hombro de
 * la mandíbula** —42 % contra 33 % con l>=0.60 n=12, 21 % contra 16 % con n=18—. Para un
 * detector local son la misma cosa: superficie grande, clara y sin contraste. Y la mandíbula
 * acaba de separarse del blanco a propósito, así que no puede volver a pintarse. La única forma
 * de distinguirlas es DÓNDE están, que es exactamente la decisión de diseño explícita que pidió
 * Javier en vez de derivarla del dato.
 */
const DETECTORES: Array<{
  nombre: string;
  luma: number;
  soporte: number;
  x0?: number;
  y0?: number;
}> = [
  { nombre: 'l>=0.60 · n=12', luma: 0.6, soporte: 12 },
  { nombre: 'l>=0.60 · n=18', luma: 0.6, soporte: 18 },
  { nombre: 'l>=0.70 · n=12', luma: 0.7, soporte: 12 },
  { nombre: 'l>=0.60 · n=12 · x>0.50', luma: 0.6, soporte: 12, x0: 0.5 },
  { nombre: 'l>=0.60 · n=12 · x>0.55', luma: 0.6, soporte: 12, x0: 0.55 },
  { nombre: 'l>=0.60 · n=12 · x>0.60', luma: 0.6, soporte: 12, x0: 0.6 },
  { nombre: 'l>=0.60 · n=12 · x>0.55 y>0.40', luma: 0.6, soporte: 12, x0: 0.55, y0: 0.4 },
  { nombre: 'l>=0.70 · n=12 · x>0.55 y>0.40', luma: 0.7, soporte: 12, x0: 0.55, y0: 0.4 },
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TOPE_MS = 6 * 60 * 1000;
const guardian = setTimeout(() => {
  console.error(`FATAL: la sonda pasó de ${TOPE_MS / 1000}s. Se corta para no dejar huérfanos.`);
  process.exit(1);
}, TOPE_MS);
guardian.unref?.();

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
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
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

  const datos = (await page.evaluate(
    ({ cols, rows, dets }) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const g = (window as any).__asciiGL;
      const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]')!;
      const gl = canvas.getContext('webgl2')!;
      const w = g.cols as number;
      const h = g.rows as number;
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      const suelo = g.opts.empty ?? 0.12;
      const hlDelta = g.opts.highlightDelta as number;
      const luma = (x: number, y: number): number => {
        const cx = Math.min(w - 1, Math.max(0, x));
        const cy = Math.min(h - 1, Math.max(0, y));
        return (buf[(cy * w + cx) * 4 + 3] ?? 0) / 255;
      };

      // Campo base: luminancia, highlight y bloque de cada celda con tinta.
      const celdas: Array<{ i: number; l: number; hi: boolean; bloque: number }> = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const l = luma(x, y);
          if (l < suelo) continue;
          let sum = 0;
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              if (i === 0 && j === 0) continue;
              sum += luma(x + i, y + j);
            }
          }
          const bx = Math.min(cols - 1, Math.floor((x * cols) / w));
          const by = Math.min(rows - 1, Math.floor((y * rows) / h));
          celdas.push({ i: y * w + x, l, hi: l - sum / 8 > hlDelta, bloque: by * cols + bx });
        }
      }

      // Para cada detector: máscara luma+!hi y luego el soporte 5x5 sobre esa máscara.
      const salida: Record<string, number[]> = {};
      for (const d of dets) {
        const cand = new Uint8Array(w * h);
        for (const c of celdas) {
          if (c.l < d.luma || c.hi) continue;
          const x = c.i % w;
          const y = (c.i - x) / w;
          if (d.x0 !== undefined && x / w < d.x0) continue;
          if (d.y0 !== undefined && y / h < d.y0) continue;
          cand[c.i] = 1;
        }
        const dentro = new Uint8Array(w * h);
        for (const c of celdas) {
          if (!cand[c.i]) continue;
          const x = c.i % w;
          const y = (c.i - x) / w;
          let n = 0;
          for (let j = -2; j <= 2; j++) {
            for (let i = -2; i <= 2; i++) {
              if (i === 0 && j === 0) continue;
              const nx = x + i;
              const ny = y + j;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              if (cand[ny * w + nx]) n++;
            }
          }
          if (n >= d.soporte) dentro[c.i] = 1;
        }
        salida[d.nombre] = celdas.filter((c) => dentro[c.i]).map((c) => c.bloque);
      }
      return {
        porZona: celdas.map((c) => c.bloque),
        detectores: salida,
        total: celdas.length,
        hlDelta,
      };
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    { cols: COLS, rows: ROWS, dets: DETECTORES },
  )) as {
    porZona: number[];
    detectores: Record<string, number[]>;
    total: number;
    hlDelta: number;
  };

  const cuenta = (bloques: number[], zona: number[]): number =>
    bloques.filter((b) => zona.includes(b)).length;

  say('== ¿QUÉ DETECTOR AÍSLA EL PELAJE DEL CUERPO? · celdas capturadas por zona ==');
  say(
    `   t=${T_FRAME.toFixed(2)}s · rejilla 6x8 · hlDelta ${datos.hlDelta} · ${datos.total} celdas con tinta`,
  );
  say('   (el detector es: luminancia alta + NO highlight + soporte 5x5)');
  say('');
  const cab = ZONAS.map(([n]) => n.split(' ')[0]!.padStart(10)).join('  ');
  say(`   detector                       ${cab}    total`);
  for (const [nombre, bloques] of Object.entries(datos.detectores)) {
    const cols2 = ZONAS.map(([, z]) => {
      const n = cuenta(bloques, z);
      const tot = datos.porZona.filter((b) => z.includes(b)).length;
      return `${((100 * n) / Math.max(1, tot)).toFixed(0).padStart(7)} %`;
    }).join('  ');
    say(`   ${nombre.padEnd(30)} ${cols2}   ${String(bloques.length).padStart(6)}`);
  }
  say('');
  say('   Cada celda es el % de la zona que el detector se llevaría.');
  say('   Lo que se busca: alto en HOMBRO, bajo en MANDÍBULA y CORONILLA.');

  writeFileSync(join(OUT, 'pelaje.txt'), L.join('\n'), 'utf8');
  say('');
  say(`Guardado en ${join(OUT, 'pelaje.txt')}`);
  await ctx.close();
  await browser.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
