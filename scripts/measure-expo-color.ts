// scripts/measure-expo-color.ts — la ganancia de exposición medida por LOS DOS criterios a la vez.
//
// Por qué existe: el checkpoint A calibró la ganancia en 1.4 midiendo TEXTURA, y la textura se
// midió en ASCII, donde saturar no cambia el color — solo el glifo. En el modo color sí cambia:
// el checkpoint B midió que la curva satura el 34.7 % del dibujo, y el retrato lee blanco/crema
// (55.6 % de la tinta) donde la referencia es cálida. O sea que la ganancia está acoplada a dos
// criterios que se calibraron por separado, y bajarla puede recuperar color a costa de detalle.
//
// Aquí se barre la ganancia sobre EL MISMO FOTOGRAMA y de cada valor se mide:
//
//   ASCII  → celdas, TEXTURA (contraste medio entre celdas vecinas) y % de celdas saturadas.
//            Es el criterio del checkpoint A, con su misma métrica para poder comparar.
//   COLOR  → reparto de la tinta pintada en cálidas / frías / blancas / rojo del hocico.
//            Es el criterio nuevo. La unidad es el píxel pintado, no la celda (checkpoint B).
//
// Los dos en la MISMA carga de página y el MISMO fotograma, que es lo que pidió Javier: si se
// miden por separado, cada uno "gana" en su propia corrida y el trade-off no se ve.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import type { VentanaSonda } from './lib/motor.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4256;
const OUT = resolve('screenshots', 'expo-color');
/** 1.4 es lo calibrado hoy. Se baja en pasos finos porque la pregunta es si hay margen pequeño. */
const GANANCIAS = [1.0, 1.1, 1.2, 1.3, 1.4];
/** El mismo instante que usa `compare-paleta`, para que las cifras de color sean comparables. */
const T_CLARO = 4.0;
/** Y el tramo oscuro, que es donde la ganancia decide (mismo instante que `sweep-gain`). */
const T_OSCURO = 7.0;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Guardián contra huérfanos: con `headless: false`, `browser.close()` puede no retornar.
const TOPE_MS = 8 * 60 * 1000;
const guardian = setTimeout(() => {
  console.error(`FATAL: la sonda pasó de ${TOPE_MS / 1000}s. Se corta para no dejar huérfanos.`);
  process.exit(1);
}, TOPE_MS);
guardian.unref?.();

interface Medida {
  celdas: number;
  textura: number;
  saturadas: number;
  calidas: number;
  frias: number;
  blancas: number;
  rojo: number;
  tinta: number;
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
  await page.waitForFunction(
    () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
    null,
    { timeout: 40_000 },
  );

  /** Congela el vídeo en `t`. Sin esto se compararían fotogramas distintos, no ganancias. */
  const congelar = async (t: number): Promise<void> => {
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
    }, t);
    await sleep(700);
  };

  /** `modo` 0 = ASCII (acento/blanco), 1 = color pleno. La onda se salta poniendo el radio al máximo. */
  const poner = async (gain: number, modo: 0 | 1): Promise<void> => {
    await page.evaluate(
      ({ g, m }) => {
        const gl = (window as VentanaSonda).__asciiGL as unknown as {
          gainOverride: number | null;
          colorBase: number;
          colorTarget: number;
          colorR: number;
        };
        gl.gainOverride = g;
        gl.colorBase = m;
        gl.colorTarget = m;
        gl.colorR = m === 1 ? 1e6 : 0;
      },
      { g: gain, m: modo },
    );
    await sleep(650);
  };

  /**
   * Las DOS métricas sobre la MISMA imagen: la textura por celda (criterio del checkpoint A) y
   * el reparto de la tinta (criterio del checkpoint B). Se devuelven juntas aunque cada llamada
   * solo use una de las dos, porque así el que lee el número sabe con qué imagen se sacó.
   */
  const medir = async (): Promise<Medida> =>
    (await page.evaluate(`(() => {
      const c = document.querySelector('[data-ascii]');
      const off = document.createElement('canvas');
      off.width = c.width; off.height = c.height;
      const x = off.getContext('2d', { willReadFrequently: true });
      x.drawImage(c, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const W = c.width, cols = Math.floor(W / 8), rows = Math.floor(c.height / 8);

      // --- criterio A: celdas, textura y saturacion. MISMA metrica que sweep-gain.ts.
      const cel = new Float64Array(cols * rows);
      let celdas = 0, saturadas = 0;
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        let suma = 0, mx = 0;
        for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
          const p = ((cy * 8 + j) * W + cx * 8 + i) * 4;
          const l = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
          suma += l;
          if (l > mx) mx = l;
        }
        cel[cy * cols + cx] = suma / 64;
        if (mx >= 20) { celdas++; if (mx >= 245) saturadas++; }
      }
      let dif = 0, n = 0;
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx + 1 < cols; cx++) {
        const a = cel[cy * cols + cx], b = cel[cy * cols + cx + 1];
        if (a < 4 && b < 4) continue;
        dif += Math.abs(a - b); n++;
      }

      // --- criterio B: reparto de la TINTA PINTADA. Mismo clasificador que compare-paleta.ts.
      let tinta = 0, calidas = 0, frias = 0, blancas = 0, rojo = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2];
        if (R + G + B < 60) continue;
        tinta++;
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        const croma = (mx - mn) / 255;
        if (croma < 0.06) { if (mx > 220) blancas++; }
        else if (B > R && B > G) frias++;
        else if (R > 120 && G < R * 0.55 && B < R * 0.8 && B >= G) rojo++;
        else calidas++;
      }
      return { celdas, textura: n > 0 ? dif / n : 0, saturadas: celdas > 0 ? (saturadas / celdas) * 100 : 0,
               tinta, calidas, frias, blancas, rojo };
    })()`)) as Medida;

  for (const [etiqueta, t] of [
    ['claro', T_CLARO],
    ['oscuro', T_OSCURO],
  ] as const) {
    await congelar(t);
    say('');
    say(
      `== FOTOGRAMA ${etiqueta.toUpperCase()} · t=${t.toFixed(2)}s · los dos criterios sobre el mismo píxel ==`,
    );
    say('   ganancia │ ASCII: celdas  textura  saturadas │ COLOR: cálidas   frías  blancas    rojo');
    for (const g of GANANCIAS) {
      await poner(g, 0);
      const a = await medir();
      await page
        .locator('[data-ascii]')
        .screenshot({ path: join(OUT, `${etiqueta}-g${g.toFixed(1)}-ascii.png`) });
      await poner(g, 1);
      const c = await medir();
      await page
        .locator('[data-ascii]')
        .screenshot({ path: join(OUT, `${etiqueta}-g${g.toFixed(1)}-color.png`) });
      const pct = (v: number): string => ((v / Math.max(1, c.tinta)) * 100).toFixed(1).padStart(6);
      say(
        `   ${g.toFixed(1).padStart(8)} │ ${String(a.celdas).padStart(12)} ${a.textura.toFixed(2).padStart(8)} ${a.saturadas.toFixed(1).padStart(10)} % │ ${pct(c.calidas)} % ${pct(c.frias)} % ${pct(c.blancas)} % ${pct(c.rojo)} %`,
      );
    }
  }

  say('');
  say(`Capturas (ASCII y color de cada ganancia) en ${OUT}`);
  writeFileSync(join(OUT, 'expo-color.txt'), L.join('\n'), 'utf8');
  await ctx.close();
  await browser.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
