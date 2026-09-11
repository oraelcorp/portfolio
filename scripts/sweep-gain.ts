// scripts/sweep-gain.ts — barrido de la ganancia de exposición sobre EL MISMO FOTOGRAMA.
//
// El conteo de celdas no mide lo que importa. Javier lo dijo bien: con ganancia alta el retrato
// se ve «lleno» pero puede perder la textura, y el objetivo es que se lean bigotes, dientes y
// pelaje como en el Canvas 2D calibrado, no igualar el número de celdas de la foto.
//
// Aquí se congela el vídeo en un instante y se barren varias ganancias sobre ESE fotograma, así
// que lo único que cambia entre capturas es la ganancia. De cada una se guarda un recorte
// ampliado y se mide:
//
//   celdas    — celdas con tinta (contexto, no criterio)
//   textura   — contraste medio entre celdas VECINAS. Es la métrica de detalle: si al subir la
//               ganancia todo satura al mismo glifo denso, las celdas se parecen entre sí y
//               esto BAJA. «Lleno pero sin textura» es exactamente textura baja con celdas altas.
//   saturadas — % de celdas con tinta que ya están al máximo. Cuanto más alto, menos margen
//               queda para que el glifo describa nada.
//
// El recorte se elige UNA vez, en la zona de más detalle, y se reutiliza en todas las ganancias.

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { VentanaSonda } from './lib/motor.ts';

const PORT = 4236;
const OUT = resolve('screenshots', 'gain');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Ganancias a comparar. 1.0 = sin corrección; 2.6 = el tope actual. */
const GANANCIAS = [1.0, 1.2, 1.4, 1.5, 1.6, 1.8, 2.0, 2.6];
/** Instante del clip. 7.00 s cae en el tramo OSCURO, que es donde la corrección decide. */
const T_OSCURO = 7.0;
/** Y uno claro, para ver que la ganancia baja no rompe lo que ya iba bien. */
const T_CLARO = 4.0;
const CROP = 140;
const ZOOM = 5;

interface Punto {
  gain: number;
  celdas: number;
  textura: number;
  saturadas: number;
  png: string;
}

// Guardián contra cuelgues. Ayer tres sondas se quedaron VIVAS toda la noche compitiendo por
// la CPU (`sweep-gain`, `compare-nitidez` y `check-gl-palette`), y una de ellas ya había
// impreso sus resultados: con `headless: false`, `browser.close()` puede no retornar nunca y el
// proceso se queda. Es el mismo problema de huérfanos que documenta CLAUDE.md con los servidores
// de vite, y contamina cualquier medida de rendimiento que se tome después.
const TOPE_MS = 6 * 60 * 1000;
const guardian = setTimeout(() => {
  console.error(`FATAL: la sonda pasó de ${TOPE_MS / 1000}s. Se corta para no dejar huérfanos.`);
  process.exit(1);
}, TOPE_MS);
guardian.unref?.();

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  const linea: string[] = [];
  const say = (s = ''): void => {
    console.log(s);
    linea.push(s);
    writeFileSync(join(OUT, 'gain.txt'), linea.join('\n'), 'utf8');
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
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
      null,
      { timeout: 40_000 },
    );

    /** Congela el clip en `t` sin que el guardián de reproducción lo relance. */
    const congelar = async (t: number): Promise<void> => {
      await page.evaluate(async (tt) => {
        const g = (window as VentanaSonda).__asciiGL!;
        const v = g.source as HTMLVideoElement;
        g.frozen = true;
        v.pause();
        await new Promise<void>((res) => {
          const on = (): void => {
            v.removeEventListener('seeked', on);
            res();
          };
          v.addEventListener('seeked', on);
          v.currentTime = tt;
          setTimeout(on, 800);
        });
      }, t);
      await sleep(700); // que el bucle vuelva a muestrear el frame ya congelado
    };

    /**
     * Quita el puntero del canvas y espera a que la sangría se apague. SIN esto el barrido
     * midió en modo COLOR: al cerrar la pestaña del ancla 2D entra un `pointermove`, la
     * sangría del hover derrama color en un radio de 26 celdas (208 px de dispositivo) y el
     * recorte de 140 px cae entero dentro. Es el mismo fallo que CLAUDE.md ya tiene anotado
     * para `check-gl-bleed`, `sweep-bleed` y `check-phase8`.
     */
    const limpiarPuntero = async (): Promise<void> => {
      await page.mouse.move(5, 5);
      await page.evaluate(() => {
        document.querySelector('[data-ascii]')?.dispatchEvent(new PointerEvent('pointerleave'));
      });
      await sleep(1600); // la sangría cae con constante 4.5; 1.6 s la deja en nada
    };

    /** Se niega a medir si el retrato no está en ASCII: un número en modo color no vale. */
    const exigirAscii = async (donde: string): Promise<void> => {
      const cal = await page.evaluate(`(() => {
        const c = document.querySelector('[data-ascii]');
        const off = document.createElement('canvas');
        off.width = c.width; off.height = c.height;
        const x = off.getContext('2d', { willReadFrequently: true });
        x.drawImage(c, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let calido = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i+1], B = d[i+2];
          if (R + G + B < 60) continue;
          if (R > G * 1.15 && R > B * 1.3) calido++;
        }
        return calido;
      })()`);
      if (typeof cal === 'number' && cal > 500) {
        throw new Error(`${donde}: el retrato está en color (${cal} píxeles cálidos). Medida inválida.`);
      }
    };

    const aplicar = async (gain: number): Promise<void> => {
      await page.evaluate((g) => {
        const m = (window as VentanaSonda).__asciiGL;
        if (m) m.gainOverride = g;
      }, gain);
      await sleep(500);
    };

    /** Elige el recorte con más detalle. Se hace UNA vez y vale para todo el barrido. */
    const elegirRecorte = async (): Promise<{ x: number; y: number }> =>
      page.evaluate(
        ({ crop }) => {
          const c = document.querySelector<HTMLCanvasElement>('[data-ascii]')!;
          const off = document.createElement('canvas');
          off.width = c.width;
          off.height = c.height;
          const x = off.getContext('2d', { willReadFrequently: true })!;
          x.drawImage(c, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data;
          const lum = (i: number): number =>
            0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
          let mejor = { x: 0, y: 0, e: -1 };
          for (let cy = 0; cy + crop <= c.height; cy += 40) {
            for (let cx = 0; cx + crop <= c.width; cx += 40) {
              let e = 0;
              for (let j = 0; j < crop; j += 4) {
                for (let i = 0; i < crop - 4; i += 4) {
                  const p = ((cy + j) * c.width + cx + i) * 4;
                  e += Math.abs(lum(p) - lum(p + 16));
                }
              }
              if (e > mejor.e) mejor = { x: cx, y: cy, e };
            }
          }
          return { x: mejor.x, y: mejor.y };
        },
        { crop: CROP },
      );

    const medir = async (gain: number, zona: { x: number; y: number }): Promise<Punto> =>
      page.evaluate(
        ({ g, zona: z, crop, zoom }) => {
          const c = document.querySelector<HTMLCanvasElement>('[data-ascii]')!;
          const off = document.createElement('canvas');
          off.width = c.width;
          off.height = c.height;
          const x = off.getContext('2d', { willReadFrequently: true })!;
          x.drawImage(c, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data;
          const W = c.width;
          const cols = Math.floor(W / 8);
          const rows = Math.floor(c.height / 8);

          // Luminancia media por celda: es el nivel que el glifo está describiendo.
          const cel = new Float64Array(cols * rows);
          let celdas = 0;
          let saturadas = 0;
          for (let cy = 0; cy < rows; cy++) {
            for (let cx = 0; cx < cols; cx++) {
              let suma = 0;
              let mx = 0;
              for (let j = 0; j < 8; j++) {
                for (let i = 0; i < 8; i++) {
                  const p = ((cy * 8 + j) * W + cx * 8 + i) * 4;
                  const l = 0.2126 * (d[p] ?? 0) + 0.7152 * (d[p + 1] ?? 0) + 0.0722 * (d[p + 2] ?? 0);
                  suma += l;
                  if (l > mx) mx = l;
                }
              }
              cel[cy * cols + cx] = suma / 64;
              if (mx >= 20) {
                celdas++;
                if (mx >= 245) saturadas++;
              }
            }
          }

          // Textura = contraste medio entre celdas vecinas, solo donde hay dibujo.
          let dif = 0;
          let n = 0;
          for (let cy = 0; cy < rows; cy++) {
            for (let cx = 0; cx + 1 < cols; cx++) {
              const a = cel[cy * cols + cx] ?? 0;
              const b = cel[cy * cols + cx + 1] ?? 0;
              if (a < 4 && b < 4) continue;
              dif += Math.abs(a - b);
              n++;
            }
          }

          const rec = document.createElement('canvas');
          rec.width = crop * zoom;
          rec.height = crop * zoom;
          const rx = rec.getContext('2d')!;
          rx.imageSmoothingEnabled = false;
          rx.fillStyle = '#000';
          rx.fillRect(0, 0, rec.width, rec.height);
          rx.drawImage(c, z.x, z.y, crop, crop, 0, 0, rec.width, rec.height);

          return {
            gain: g,
            celdas,
            textura: n > 0 ? dif / n : 0,
            saturadas: celdas > 0 ? (saturadas / celdas) * 100 : 0,
            png: rec.toDataURL('image/png'),
          };
        },
        { g: gain, zona, crop: CROP, zoom: ZOOM },
      );

    // ANCLA: la textura del Canvas 2D ya calibrado. El objetivo de Javier no es igualar el
    // conteo de celdas de la foto, es que se lea el detalle como allí — así que ese número es
    // el que hay que alcanzar, y sin él el barrido no tendría contra qué compararse.
    {
      // El ancla se mide en una pestaña aparte y se vuelve a limpiar el puntero después.
      const p2 = await ctx.newPage();
      await p2.goto(`http://localhost:${PORT}/?2d`, { waitUntil: 'load' });
      let hayRef = true;
      try {
        await p2.waitForFunction(
          () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.reveal === '1.000',
          null,
          { timeout: 25_000 },
        );
      } catch {
        hayRef = false; // el ancla es contexto, no puede tumbar el barrido
      }
      await sleep(1200);
      const ref = await p2.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('[data-ascii]')!;
        const off = document.createElement('canvas');
        off.width = c.width;
        off.height = c.height;
        const x = off.getContext('2d', { willReadFrequently: true })!;
        x.drawImage(c, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        const W = c.width;
        const cols = Math.floor(W / 8);
        const rows = Math.floor(c.height / 8);
        const cel = new Float64Array(cols * rows);
        let celdas = 0;
        for (let cy = 0; cy < rows; cy++) {
          for (let cx = 0; cx < cols; cx++) {
            let suma = 0;
            let mx = 0;
            for (let j = 0; j < 8; j++) {
              for (let i = 0; i < 8; i++) {
                const p = ((cy * 8 + j) * W + cx * 8 + i) * 4;
                const l = 0.2126 * (d[p] ?? 0) + 0.7152 * (d[p + 1] ?? 0) + 0.0722 * (d[p + 2] ?? 0);
                suma += l;
                if (l > mx) mx = l;
              }
            }
            cel[cy * cols + cx] = suma / 64;
            if (mx >= 20) celdas++;
          }
        }
        let dif = 0;
        let n = 0;
        for (let cy = 0; cy < rows; cy++) {
          for (let cx = 0; cx + 1 < cols; cx++) {
            const a = cel[cy * cols + cx] ?? 0;
            const b = cel[cy * cols + cx + 1] ?? 0;
            if (a < 4 && b < 4) continue;
            dif += Math.abs(a - b);
            n++;
          }
        }
        return { celdas, textura: n > 0 ? dif / n : 0 };
      });
      await p2.close();
      say(
        hayRef
          ? `== ANCLA · Canvas 2D calibrado (foto): celdas ${ref.celdas} · textura ${ref.textura.toFixed(2)} ==`
          : '== ANCLA · el Canvas 2D no llegó a completar la onda; su medida no es fiable ==',
      );
      say('');
    }

    for (const [etiqueta, t] of [
      ['oscuro', T_OSCURO],
      ['claro', T_CLARO],
    ] as const) {
      await congelar(t);
      await limpiarPuntero();
      await exigirAscii(`fotograma ${etiqueta}`);
      await aplicar(2.0);
      const zona = await elegirRecorte();
      say(
        `== FOTOGRAMA ${etiqueta.toUpperCase()} · t=${t.toFixed(2)}s · recorte ${CROP}px en (${zona.x},${zona.y}) ampliado x${ZOOM} ==`,
      );
      say('   ganancia   celdas   textura   saturadas%');
      for (const g of GANANCIAS) {
        await aplicar(g);
        const p = await medir(g, zona);
        writeFileSync(
          join(OUT, `${etiqueta}-gain-${g.toFixed(1)}.png`),
          Buffer.from(p.png.split(',')[1] ?? '', 'base64'),
        );
        say(
          `   ${p.gain.toFixed(1).padStart(8)}   ${String(p.celdas).padStart(6)}   ${p.textura.toFixed(2).padStart(7)}   ${p.saturadas.toFixed(1).padStart(9)}`,
        );
      }
      say('');
    }

    await ctx.close();
    await browser.close();
    say(`Recortes en ${OUT}`);
  } finally {
    preview.stop();
  }
}

main()
  .catch((e) => {
    console.error('FATAL:', e);
    process.exitCode = 1;
  })
  // Salida explícita: cerrar el navegador no basta para que Node termine.
  .finally(() => process.exit(process.exitCode ?? 0));
