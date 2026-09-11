// scripts/measure-mandibula.ts — ¿la mandíbula y los brillos puntuales caen en el MISMO punto?
//
// Javier lo ve en pantalla: la mandíbula y los highlights se leen con el mismo blanco, cuando
// en la referencia la mandíbula tiene un crema/hueso propio y el blanco puro se reserva para
// dientes y punta de nariz. La sospecha es que se están fundiendo en el escalón más alto de la
// rampa, y hay dos caminos distintos para llegar ahí:
//
//   1. por LUMINANCIA — `colorSnap` lleva al punto #F1F0EA todo lo que pasa de t=0.9833;
//   2. por HIGHLIGHT — la capa de highlight (`hlModo 2`) pinta #F1F0EA en las celdas con
//      contraste local alto, independientemente de su luminancia.
//
// Si la mandíbula llega por (1) y los dientes por (2), separar es posible: basta reservar el
// tope para las celdas de (2). Esto se mide ANTES de tocar nada.
//
// El campo se lee del FBO de luma —la misma textura que consume el shader— y el highlight se
// recalcula con la MISMA fórmula del fragment (contraste contra las 8 vecinas > hlDelta), así
// que no es una aproximación: es lo que el shader ve.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import type { VentanaSonda } from './lib/motor.ts';
import { POSICIONES } from '../src/effects/ascii/palette.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4258;
const OUT = resolve('screenshots', 'mandibula');
const T_FRAME = 4.0;
/** La MISMA segmentación que se usó para la coronilla (`measure-cabeza.ts`). */
const COLS = 6;
const ROWS = 8;

/**
 * Zonas, en números de bloque de esa rejilla. Salen de mirar `zona-mandibula.png`, que lleva
 * los números pintados encima del retrato CONGELADO en t=4.00 s.
 *
 * ⚠️ Lección de la primera versión de esta sonda: se cogieron los bloques de `mapa-bloques.png`
 * (el de la coronilla) y salieron mal. Ese mapa se sacó **sin congelar el vídeo**, así que el
 * jaguar estaba en otra pose y los mismos números caen sobre otra parte del animal: los bloques
 * 39-47 que parecían mandíbula ahí son el HOMBRO aquí. Con vídeo, una zona por bloques solo
 * significa algo **atada a un fotograma**.
 */
const ZONAS: Array<[string, number[]]> = [
  ['mandíbula (morro/boca/barbilla)', [32, 38, 44]],
  ['hombro y flanco', [39, 40, 41, 45, 46, 47]],
  ['coronilla (referencia)', [19, 20, 21, 22]],
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TOPE_MS = 6 * 60 * 1000;
const guardian = setTimeout(() => {
  console.error(`FATAL: la sonda pasó de ${TOPE_MS / 1000}s. Se corta para no dejar huérfanos.`);
  process.exit(1);
}, TOPE_MS);
guardian.unref?.();

interface Celda {
  bloque: number;
  paso: number;
  hi: boolean;
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
    ({ pos, cols, rows }) => {
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

      const celdas: Array<{ bloque: number; paso: number; hi: boolean }> = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const l = luma(x, y);
          if (l < suelo) continue;
          // Highlight: MISMA fórmula que el fragment shader (contraste contra las 8 vecinas).
          let sum = 0;
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              if (i === 0 && j === 0) continue;
              sum += luma(x + i, y + j);
            }
          }
          const hi = l - sum / 8 > hlDelta;
          // Escalón de colorSnap: la POSICION más cercana.
          let paso = 0;
          let d = 2;
          for (let k = 0; k < pos.length; k++) {
            const dd = Math.abs(l - (pos[k] as number));
            if (dd < d) {
              d = dd;
              paso = k;
            }
          }
          const bx = Math.min(cols - 1, Math.floor((x * cols) / w));
          const by = Math.min(rows - 1, Math.floor((y * rows) / h));
          celdas.push({ bloque: by * cols + bx, paso, hi });
        }
      }
      return { celdas, grid: `${w}x${h}`, hlDelta, suelo };
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    { pos: [...POSICIONES], cols: COLS, rows: ROWS },
  )) as { celdas: Celda[]; grid: string; hlDelta: number; suelo: number };

  const TOPE = POSICIONES.length - 1;
  const HEX = [
    '#000000',
    '#1C0F08',
    '#421F09',
    '#6C3A13',
    '#98581A',
    '#C67E26',
    '#DFAC50',
    '#F2DB8E',
    '#978E7D',
    '#BFBCB3',
    '#F1F0EA',
  ];

  say('== ¿SE FUNDEN MANDÍBULA Y HIGHLIGHT EN EL MISMO PUNTO? ==');
  say(
    `   rejilla ${datos.grid} · bloques ${COLS}x${ROWS} · hlDelta ${datos.hlDelta} · t=${T_FRAME.toFixed(2)}s`,
  );
  say('   (unidad: CELDAS. El escalón lo decide la luminancia; el highlight, el contraste local.)');
  say('');
  say(
    '   zona                        celdas   en el tope   de ellas hi   de ellas NO hi   % del tope sin brillo',
  );

  const filas: Array<[string, number[]]> = [...ZONAS, ['TODO el retrato', []]];
  for (const [nombre, bloques] of filas) {
    const dentro = bloques.length ? datos.celdas.filter((c) => bloques.includes(c.bloque)) : datos.celdas;
    const tope = dentro.filter((c) => c.paso === TOPE);
    const topeHi = tope.filter((c) => c.hi).length;
    const topeNo = tope.length - topeHi;
    say(
      `   ${nombre.padEnd(26)} ${String(dentro.length).padStart(6)}   ${String(tope.length).padStart(10)}   ${String(topeHi).padStart(11)}   ${String(topeNo).padStart(14)}   ${((100 * topeNo) / Math.max(1, tope.length)).toFixed(1).padStart(20)} %`,
    );
  }

  say('');
  say('== SI SE REASIGNAN UN ESCALÓN ABAJO · a dónde irían las celdas del tope SIN brillo ==');
  say('   (solo se mueven las que llegan al tope por LUMINANCIA; las de highlight no se tocan)');
  say('');
  say('   bajada   color destino   celdas de la mandíbula   celdas de todo el retrato');
  const jaw = ZONAS[0]![1];
  for (const baja of [1, 2, 3]) {
    const destino = HEX[Math.max(0, TOPE - baja)] ?? '?';
    const enJaw = datos.celdas.filter((c) => c.paso === TOPE && !c.hi && jaw.includes(c.bloque)).length;
    const enTodo = datos.celdas.filter((c) => c.paso === TOPE && !c.hi).length;
    say(
      `   ${String(baja).padStart(6)}   ${destino.padStart(13)}   ${String(enJaw).padStart(22)}   ${String(enTodo).padStart(25)}`,
    );
  }

  say('');
  say('== REPARTO POR ESCALÓN EN LA MANDÍBULA · para ver de dónde viene y a dónde va ==');
  say('   escalón   color      celdas   de ellas con highlight');
  const dentroJaw = datos.celdas.filter((c) => jaw.includes(c.bloque));
  for (let k = 0; k < HEX.length; k++) {
    const enK = dentroJaw.filter((c) => c.paso === k);
    if (enK.length === 0) continue;
    say(
      `   ${String(k).padStart(7)}   ${(HEX[k] ?? '').padEnd(9)}  ${String(enK.length).padStart(6)}   ${String(enK.filter((c) => c.hi).length).padStart(22)}`,
    );
  }

  // Captura con la rejilla y la zona de mandíbula marcada, para que la elección sea revisable.
  const png = (await page.evaluate(
    ({ cols, rows, jawIds }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]')!;
      const off = document.createElement('canvas');
      off.width = canvas.width;
      off.height = canvas.height;
      const c2 = off.getContext('2d')!;
      c2.drawImage(canvas, 0, 0);
      c2.lineWidth = 2;
      c2.font = 'bold 34px monospace';
      for (let by = 0; by < rows; by++) {
        for (let bx = 0; bx < cols; bx++) {
          const id = by * cols + bx;
          const X = (bx * canvas.width) / cols;
          const Y = (by * canvas.height) / rows;
          const esJaw = jawIds.includes(id);
          c2.strokeStyle = esJaw ? 'rgba(255,90,120,0.95)' : 'rgba(0,255,120,0.35)';
          c2.fillStyle = esJaw ? 'rgba(255,90,120,0.95)' : 'rgba(0,255,120,0.6)';
          c2.lineWidth = esJaw ? 4 : 2;
          c2.strokeRect(X, Y, canvas.width / cols, canvas.height / rows);
          c2.fillText(String(id), X + 10, Y + 40);
        }
      }
      return off.toDataURL('image/png');
    },
    { cols: COLS, rows: ROWS, jawIds: jaw },
  )) as string;
  writeFileSync(join(OUT, 'zona-mandibula.png'), Buffer.from(png.split(',')[1] ?? '', 'base64'));

  say('');
  say(`Zona marcada en ${join(OUT, 'zona-mandibula.png')}`);
  writeFileSync(join(OUT, 'mandibula.txt'), L.join('\n'), 'utf8');
  await ctx.close();
  await browser.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
