// scripts/measure-cabeza.ts — ¿qué luminancia tiene la zona de la cabeza/oreja en NUESTRO jaguar?
//
// La referencia de Javier pone el azul en la coronilla, en teal medio-oscuro (#224657 a
// #43839E), no en el pico de blanco. Antes de reubicar el frío hay que saber en qué franja de
// luminancia cae ESA zona aquí, que no tiene por qué coincidir con la referencia: nuestro
// encuadre es otro y el material también.
//
// Se hace en dos pasos: se parte el canvas en bloques numerados y se mide cada uno sobre el
// campo de luminancia REAL del shader (leído del framebuffer, con el vídeo y la ganancia), y se
// guarda la captura con la rejilla dibujada encima para poder señalar los bloques a ojo.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4250;
const OUT = resolve('screenshots', 'paleta');
/** El MISMO instante que congelan `compare-paleta` y las sondas de mandíbula. */
const T_FRAME = 4.0;
const COLS = 6;
const ROWS = 8;
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
    () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
    null,
    { timeout: 40_000 },
  );
  await sleep(1500);
  // Modo color forzado y VIDEO CONGELADO en el mismo instante que el resto de sondas.
  //
  // Lo de congelar es un arreglo del 2026-09-09, y la lección merece quedar escrita: sin esto
  // el mapa salía de un fotograma cualquiera, y con vídeo **el animal se mueve**, así que los
  // mismos números de bloque caen sobre otra parte del jaguar según cuándo se mire. Al elegir
  // la zona de la mandíbula con este mapa salieron los bloques del HOMBRO. Una zona por bloques
  // solo significa algo atada a un fotograma.
  await page.evaluate(`(async (tt) => {
    const g = window.__asciiGL;
    g.frozen = true; g.source.pause();
    await new Promise((res) => { const on = () => { g.source.removeEventListener('seeked', on); res(); };
      g.source.addEventListener('seeked', on); g.source.currentTime = tt; setTimeout(on, 800); });
    g.colorBase = 1; g.colorTarget = 1; g.colorR = 1e6;
  })(${T_FRAME})`);
  await sleep(900);

  const r = (await page.evaluate(`(() => {
    const g = window.__asciiGL;
    const canvas = document.querySelector('[data-ascii]');
    const gl = canvas.getContext('webgl2');
    const w = g.cols, h = g.rows;
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const COLS = ${COLS}, ROWS = ${ROWS};
    const bloques = [];
    for (let by = 0; by < ROWS; by++) {
      for (let bx = 0; bx < COLS; bx++) {
        let suma = 0, n = 0, sat = 0;
        const x0 = Math.floor((bx * w) / COLS), x1 = Math.floor(((bx + 1) * w) / COLS);
        const y0 = Math.floor((by * h) / ROWS), y1 = Math.floor(((by + 1) * h) / ROWS);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            // SIN volteo: el shader lee la textura de luma con v=0 en la fila de ARRIBA
            // (frag.y = viewport.y - gl_FragCoord.y), así que la fila 0 del readPixels ya es
            // la de arriba. El volteo que había aquí espejaba el mapa respecto a la captura.
            const l = buf[((y * w) + x) * 4 + 3] / 255;
            if (l < 0.12) continue;
            suma += l; n++;
            if (l >= 0.995) sat++;
          }
        }
        bloques.push({ id: by * COLS + bx, bx, by, n, media: n ? suma / n : 0, sat: n ? sat / n : 0 });
      }
    }
    // Captura con la rejilla y los números encima.
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const c2 = off.getContext('2d');
    c2.drawImage(canvas, 0, 0);
    c2.strokeStyle = 'rgba(0,255,120,0.55)';
    c2.fillStyle = 'rgba(0,255,120,0.95)';
    c2.font = 'bold 34px monospace';
    c2.lineWidth = 2;
    for (let by = 0; by < ROWS; by++) {
      for (let bx = 0; bx < COLS; bx++) {
        const X = (bx * canvas.width) / COLS, Y = (by * canvas.height) / ROWS;
        c2.strokeRect(X, Y, canvas.width / COLS, canvas.height / ROWS);
        c2.fillText(String(by * COLS + bx), X + 10, Y + 40);
      }
    }
    return { bloques, png: off.toDataURL('image/png'), grid: w + 'x' + h };
  })()`)) as {
    bloques: Array<{ id: number; bx: number; by: number; n: number; media: number; sat: number }>;
    png: string;
    grid: string;
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'mapa-bloques.png'), Buffer.from(r.png.split(',')[1] ?? '', 'base64'));

  const L: string[] = [];
  const say = (s = ''): void => {
    console.log(s);
    L.push(s);
  };
  say(
    `== LUMINANCIA POR BLOQUE · rejilla del retrato ${r.grid} · bloques ${COLS}x${ROWS} · t=${T_FRAME.toFixed(2)}s ==`,
  );
  say('   (campo real del shader: vídeo + ganancia + curva de contraste)');
  say('');
  say('   bloque   celdas con tinta   luminancia media   % saturadas');
  for (const bl of r.bloques) {
    if (bl.n < 40) continue;
    say(
      `   ${String(bl.id).padStart(6)}   ${String(bl.n).padStart(16)}   ${bl.media.toFixed(3).padStart(16)}   ${(bl.sat * 100).toFixed(1).padStart(10)} %`,
    );
  }
  writeFileSync(join(OUT, 'mapa-bloques.txt'), L.join('\n'), 'utf8');
  say('');
  say(`Mapa con los números en ${join(OUT, 'mapa-bloques.png')}`);
  await b.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
