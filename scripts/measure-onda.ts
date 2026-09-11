// scripts/measure-onda.ts — la GEOMETRÍA del frente de las dos ondas, medida sobre el shader
// de verdad.
//
// La pregunta de Javier es por qué la onda del clic se siente mecánica. La respuesta tiene una
// parte medible: el frente es un círculo perfecto, y un círculo perfecto es exactamente lo que
// el ojo lee como "gráfico". Aquí se mide cuánto se aparta del círculo.
//
// Método: en vez de grabar la animación y pelearse con los fotogramas, se congela el vídeo y se
// BARRE EL RADIO a mano (`colorR` / `revealR`), leyendo el lienzo en cada paso. Así se separa la
// geometría del frente de su ritmo, y lo que se mide es el shader real, sin replicar su fórmula
// en Node — que es justo el error que se paga cuando la copia y el original se separan.
//
// La vara es la de `lib/frente.ts`: para cada paso, la desviación típica de la distancia al
// origen de las celdas que acaban de entrar. Círculo perfecto = solo la cuantización del paso.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { residuoRadial, type Frente } from './lib/frente.ts';
import type { VentanaSonda } from './lib/motor.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4262;
const OUT = resolve('screenshots', 'onda');
const T_FRAME = 4.0;
/** Pasos del barrido de radio. Más pasos = frente más fino y medida más limpia. */
const PASOS = 44;

/** Variantes a comparar. `ruido` y `tono` en celdas; `escala` en celdas por lóbulo. */
const VARIANTES: Array<{ nombre: string; ruido: number; escala: number; tono: number }> = [
  { nombre: 'círculo (hoy)', ruido: 0, escala: 14, tono: 0 },
  { nombre: 'ruido 3', ruido: 3, escala: 14, tono: 0 },
  { nombre: 'ruido 6', ruido: 6, escala: 14, tono: 0 },
  { nombre: 'ruido 6 · lóbulo 26', ruido: 6, escala: 26, tono: 0 },
  { nombre: 'ruido 6 + tono 5', ruido: 6, escala: 14, tono: 5 },
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TOPE_MS = 9 * 60 * 1000;
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
  }, T_FRAME);
  await sleep(900);

  const rejilla = (await page.evaluate(`(() => {
    const g = window.__asciiGL;
    return { cols: g.cols, rows: g.rows };
  })()`)) as { cols: number; rows: number };

  /**
   * Barre un radio y devuelve el mapa de llegada por celda, en unidades de PASO.
   *
   * `cual` = 'color' barre la onda del clic (celda entra cuando deja de ser el verde del ASCII);
   * 'reveal' barre la onda de entrada (celda entra cuando aparece tinta).
   */
  const barrer = async (
    cual: 'color' | 'reveal',
    v: { ruido: number; escala: number; tono: number },
  ): Promise<Frente> =>
    (await page.evaluate(
      async ({ cual: q, v: vv, pasos }) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const g = (window as any).__asciiGL;
        // Shimmer apagado durante el barrido: cambia el glifo del 3 % de las celdas cada 120 ms
        // y eso se colaba como "llegadas" falsas. Con `reduced` el epoch se queda en 0.
        g.reduced = true;
        g.opts.ondaRuido = vv.ruido;
        g.opts.ondaEscala = vv.escala;
        g.opts.ondaTono = vv.tono;
        const c = document.querySelector('[data-ascii]') as HTMLCanvasElement;
        const cols = g.cols as number;
        const rows = g.rows as number;
        const cw = c.width / cols;
        const ch = c.height / rows;
        const max = Math.hypot(cols, rows) + 12;
        const llegada = new Array<number>(cols * rows).fill(-1);

        const off = document.createElement('canvas');
        off.width = c.width;
        off.height = c.height;
        const x = off.getContext('2d', { willReadFrequently: true })!;

        /** RGB del píxel más luminoso de cada celda: es lo que decide el color de la celda. */
        const leer = (): Uint8ClampedArray => {
          x.clearRect(0, 0, c.width, c.height);
          x.drawImage(c, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data;
          const out = new Uint8ClampedArray(cols * rows * 4);
          for (let cy = 0; cy < rows; cy++) {
            for (let cx = 0; cx < cols; cx++) {
              let mejor = -1;
              let lm = -1;
              const x0 = Math.floor(cx * cw);
              const y0 = Math.floor(cy * ch);
              for (let j = 0; j < ch; j++) {
                for (let k = 0; k < cw; k++) {
                  const p = ((y0 + j) * c.width + x0 + k) * 4;
                  const l = 0.2126 * d[p]! + 0.7152 * d[p + 1]! + 0.0722 * d[p + 2]!;
                  if (l > lm) {
                    lm = l;
                    mejor = p;
                  }
                }
              }
              const o = (cy * cols + cx) * 4;
              out[o] = mejor < 0 ? 0 : d[mejor]!;
              out[o + 1] = mejor < 0 ? 0 : d[mejor + 1]!;
              out[o + 2] = mejor < 0 ? 0 : d[mejor + 2]!;
              out[o + 3] = Math.max(0, Math.round(lm));
            }
          }
          return out;
        };

        // Origen de la onda en el centro del lienzo, para que el frente quepa entero y no se
        // salga por un borde a mitad del barrido.
        if (q === 'color') {
          g.colorOX = cols / 2;
          g.colorOY = rows / 2;
          g.colorBase = 0;
          g.colorTarget = 1;
        } else {
          // El origen del reveal vive en `opts` como fracción, no como celda.
          g.opts.revealOrigin = { x: 0.5, y: 0.5 };
        }

        // LÍNEA BASE de la onda de color: el retrato entero en ASCII, con el radio a cero. Una
        // celda "llega" cuando su color se aparta de AHÍ. Comparar contra "es verde" no vale:
        // en ASCII los highlights ya se pintan en blanco, así que una cuarta parte de las
        // celdas contaba como color desde el primer paso (medido: residuo 32 celdas, o sea
        // ruido puro).
        let base: Uint8ClampedArray | null = null;
        if (q === 'color') {
          g.colorR = 0;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          base = leer();
        }

        for (let s = 0; s < pasos; s++) {
          const R = (max * (s + 1)) / pasos;
          if (q === 'color') g.colorR = R;
          else g.revealR = R;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const cur = leer();
          for (let i = 0; i < cols * rows; i++) {
            if (llegada[i]! >= 0) continue;
            const o = i * 4;
            if ((cur[o + 3] ?? 0) < 26) continue;
            if (q === 'reveal') {
              llegada[i] = s;
            } else if (base) {
              const dif =
                Math.abs((cur[o] ?? 0) - (base[o] ?? 0)) +
                Math.abs((cur[o + 1] ?? 0) - (base[o + 1] ?? 0)) +
                Math.abs((cur[o + 2] ?? 0) - (base[o + 2] ?? 0));
              if (dif > 45) llegada[i] = s;
            }
          }
        }
        return { llegada, ancho: cols, alto: rows };
        /* eslint-enable @typescript-eslint/no-explicit-any */
      },
      { cual, v, pasos: PASOS },
    )) as Frente;

  say('== GEOMETRÍA DEL FRENTE · barrido de radio sobre el shader real ==');
  say(
    `   rejilla ${rejilla.cols}x${rejilla.rows} · ${PASOS} pasos de radio · vídeo congelado en t=${T_FRAME}s`,
  );
  say('   grosor = sd de la distancia al origen de las celdas que entran en cada paso, en celdas');
  say('');
  say('   variante                 ONDA DEL CLIC        REVEAL DE ENTRADA');
  say('                            residuo  celdas      residuo  celdas');

  const max = Math.hypot(rejilla.cols, rejilla.rows) + 12;
  const radioDe = (paso: number): number => (max * (paso + 1)) / PASOS;
  const ox = rejilla.cols / 2;
  const oy = rejilla.rows / 2;
  const resultados: Record<string, unknown>[] = [];
  let suelo = 0;
  for (const v of VARIANTES) {
    const rc = residuoRadial(await barrer('color', v), ox, oy, radioDe);
    const rr = residuoRadial(await barrer('reveal', v), ox, oy, radioDe);
    suelo = rc.suelo;
    resultados.push({ ...v, color: rc, reveal: rr });
    say(
      `   ${v.nombre.padEnd(22)} ${rc.residuo.toFixed(2).padStart(8)}  ${String(rc.n).padStart(6)}     ${rr.residuo.toFixed(2).padStart(8)}  ${String(rr.n).padStart(6)}`,
    );
  }
  say('');
  say(`   suelo de la medida (discretización del barrido): ${suelo.toFixed(2)} celdas`);

  // Se deja el motor como estaba, para no dejar la página en un estado raro si alguien mira.
  await page.evaluate(`(() => {
    const g = window.__asciiGL;
    g.reduced = false;
    g.opts.ondaRuido = 0; g.opts.ondaTono = 0;
    g.colorR = 0; g.colorBase = 0; g.colorTarget = 0; g.revealR = 1e6;
  })()`);

  writeFileSync(join(OUT, 'onda-geometria.txt'), L.join('\n'), 'utf8');
  writeFileSync(join(OUT, 'onda-geometria.json'), JSON.stringify(resultados), 'utf8');
  say('');
  say(`Guardado en ${join(OUT, 'onda-geometria.txt')}`);
  await ctx.close();
  await browser.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
