// scripts/compare-paleta.ts — las comparativas del checkpoint B, sobre EL MISMO FOTOGRAMA.
//
// Javier pidió decidir viendo, no leyendo:
//   4. rampa continua  vs  la misma rampa posterizada en 4-5 escalones
//   3. highlight como capa aparte  vs  plegado al gradiente  vs  capa con el neutro de la rampa
//   5. acento del hocico como excepción  vs  plegado al gradiente por su luminancia
//
// Todo con el vídeo CONGELADO en el mismo instante y el modo color forzado, así que entre
// capturas lo único que cambia es la variante. Sin eso se estarían comparando fotogramas
// distintos y cualquier diferencia sería ruido.

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import type { VentanaSonda } from './lib/motor.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4244;
const OUT = resolve('screenshots', 'paleta');
const T_FRAME = 4.0;
const CROP = 180;
const ZOOM = 4;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Ronda 2 (2026-09-09): decidido posterizado, neutros a partir de t>0.90 y highlight con el
// #F1F0EA propio. Lo que queda por ver es el tono FRÍO en la franja más alta.
// Ronda 3: el umbral del frío, medido en TINTA PINTADA y no en celdas. Atado al escalón de la
// posterización (0.875) el frío se llevaba el 50 % de los píxeles: 15.5 % de las celdas, pero
// las brillantes usan los glifos más densos y pesan mucho más de lo que su número sugiere.
// Ronda 4: el frío acotado a los highlights extremos. El umbral solo no basta — la curva de
// contraste satura el 34.7 % del dibujo en l>=0.995 y cualquier corte se traga ese pico.
// Ronda 5: frío teal en banda MEDIA sobre la coronilla (medido en measure-cabeza.ts: 0.63-0.77),
// barrido de escalones para que los 11 colores tengan sitio, y filtro 5x5 contra el salpicado.
const VARIANTES: [string, string][] = [
  ['H-teal-zona-p5', '?glsnap=0&glhocicon=12&glpelaje=0'],
  ['H-teal-banda-p5', '?glsnap=0&glhocicon=12&glfriozona=0&glpelaje=0'],
  ['H-teal-zona-p6', '?glsnap=0&glhocicon=12&glposter=6&glpelaje=0'],
  ['H-teal-zona-p7', '?glsnap=0&glhocicon=12&glposter=7&glpelaje=0'],
  ['I-hocico-3x3', '?glsnap=0&glhocicon=0&glpelaje=0'],
  ['I-hocico-5x5-n8', '?glsnap=0&glhocicon=8&glpelaje=0'],
  ['I-hocico-5x5-n16', '?glsnap=0&glhocicon=16&glpelaje=0'],
  ['I-hocico-5x5-n20', '?glsnap=0&glhocicon=20&glpelaje=0'],
  // Ronda 6: la cuantizacion a los PUNTOS de la rampa, que es lo que da opcion a los 11
  // colores. Con y sin el filtro duro del hocico, para no mezclar los dos cambios.
  ['J-snap11', '?glsnap=1&glhocicon=12&glpelaje=0'],
  ['J-snap11-n20', '?glsnap=1&glhocicon=20&glpelaje=0'],
  // Ronda 7 (2026-09-10): el pelaje del cuerpo forzado a dorado por REGION, no derivado de la
  // luminancia. Las filas de arriba fijan `glpelaje=0` porque se midieron antes de que existiera.
  ['L-sin-pelaje', '?glpelaje=0'],
  ['L-pelaje', '?glpelaje=1'],
  ['L-pelaje-i3', '?glpelaje=1&glpelajei0=3'],
  ['L-pelaje-l70', '?glpelaje=1&glpelajeluma=0.7'],
];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  const linea: string[] = [];
  const say = (s = ''): void => {
    console.log(s);
    linea.push(s);
    writeFileSync(join(OUT, 'paleta.txt'), linea.join('\n'), 'utf8');
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

    say('== CHECKPOINT B · RAMPA DE 11 TONOS — comparativas sobre el mismo fotograma ==');
    say(`   vídeo congelado en t=${T_FRAME.toFixed(2)}s · modo color forzado`);
    say('');
    say('   (porcentajes sobre la TINTA PINTADA, que es lo que pesa a la vista)');
    say('   variante          cálidas    frías   blancas   rojo hocico   tonos');

    let zona: { x: number; y: number } | null = null;

    for (const [nombre, query] of VARIANTES) {
      const page = await ctx.newPage();
      await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'load' });
      await page.waitForFunction(
        () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
        null,
        { timeout: 40_000 },
      );

      // Congelar el fotograma y forzar el color pleno, sin pasar por la onda del clic: así la
      // captura no depende de cuándo termine la animación.
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

      // La zona del hocico se localiza UNA vez, en la variante 1, por su rojo de acento, y se
      // reutiliza: comparar el acento en recortes distintos no compararía nada.
      if (!zona) {
        zona = await page.evaluate(
          ({ crop }) => {
            const c = document.querySelector<HTMLCanvasElement>('[data-ascii]')!;
            const off = document.createElement('canvas');
            off.width = c.width;
            off.height = c.height;
            const x = off.getContext('2d', { willReadFrequently: true })!;
            x.drawImage(c, 0, 0);
            const d = x.getImageData(0, 0, c.width, c.height).data;
            let sx = 0;
            let sy = 0;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) {
              const R = d[i] ?? 0;
              const G = d[i + 1] ?? 0;
              const B = d[i + 2] ?? 0;
              // Rojo del acento (224,48,74): muy saturado hacia el rojo-magenta.
              if (R > 140 && G < R * 0.55 && B < R * 0.75 && B > G) {
                const p = i / 4;
                sx += p % c.width;
                sy += Math.floor(p / c.width);
                n++;
              }
            }
            if (n < 50) return { x: Math.round(c.width * 0.45), y: Math.round(c.height * 0.55) };
            return {
              x: Math.max(0, Math.min(c.width - crop, Math.round(sx / n - crop / 2))),
              y: Math.max(0, Math.min(c.height - crop, Math.round(sy / n - crop / 2))),
            };
          },
          { crop: CROP },
        );
        say(`   (zona del hocico localizada en ${zona.x},${zona.y})`);
        say('');
      }

      const r = await page.evaluate(
        ({ z, crop, zoom }) => {
          const c = document.querySelector<HTMLCanvasElement>('[data-ascii]')!;
          const off = document.createElement('canvas');
          off.width = c.width;
          off.height = c.height;
          const x = off.getContext('2d', { willReadFrequently: true })!;
          x.drawImage(c, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data;
          let celdas = 0;
          let calidas = 0;
          let neutras = 0;
          let blancas = 0;
          let rojos = 0;
          const vistos = new Set<number>();
          for (let i = 0; i < d.length; i += 4) {
            const R = d[i] ?? 0;
            const G = d[i + 1] ?? 0;
            const B = d[i + 2] ?? 0;
            if (R + G + B < 60) continue;
            celdas++;
            const mx = Math.max(R, G, B);
            const mn = Math.min(R, G, B);
            const croma = (mx - mn) / 255;
            if (croma < 0.06) {
              if (mx > 220) blancas++;
              else neutras++;
            } else if (B > R && B > G) {
              // Frío: el azul manda. Es el tono de la franja alta.
              neutras++;
            } else if (R > 120 && G < R * 0.55 && B < R * 0.8 && B >= G) {
              rojos++;
            } else calidas++;
            // Cuantizado a 5 bits por canal: cuenta la variedad real de tonos en pantalla.
            vistos.add(((R >> 3) << 10) | ((G >> 3) << 5) | (B >> 3));
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
            celdas,
            calidas,
            neutras,
            blancas,
            rojos,
            tonos: vistos.size,
            crop: rec.toDataURL('image/png'),
          };
        },
        { z: zona, crop: CROP, zoom: ZOOM },
      );

      await page.locator('[data-ascii]').screenshot({ path: join(OUT, `${nombre}.png`) });
      writeFileSync(join(OUT, `${nombre}-hocico.png`), Buffer.from(r.crop.split(',')[1] ?? '', 'base64'));
      const pct = (n: number): string => ((n / Math.max(1, r.celdas)) * 100).toFixed(1).padStart(6);
      say(
        `   ${nombre.padEnd(16)} ${pct(r.calidas)} %  ${pct(r.neutras)} %  ${pct(r.blancas)} %  ${pct(r.rojos)} %   ${String(r.tonos).padStart(5)}`,
      );
      await page.close();
    }

    say('');
    say(`Capturas (completa y recorte del hocico) en ${OUT}`);
    await ctx.close();
    await browser.close();
  } finally {
    preview.stop();
    process.exit(process.exitCode ?? 0);
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
