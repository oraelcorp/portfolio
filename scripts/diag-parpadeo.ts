// scripts/diag-parpadeo.ts — ¿el retrato parpadea de verdad, o es la sonda la que mide mal?
//
// En `diag-movil.ts` sobre WebKit la tinta alterna entre ~50 000 y 0 de una muestra a otra. Esa
// medida se toma con `drawImage()` del canvas WebGL a uno 2D desde fuera del frame, así que
// puede estar leyendo el buffer a medio pintar. Si el retrato parpadeara DE VERDAD, se vería en
// las capturas: una captura de Playwright pasa por el compositor, que es lo mismo que ve el ojo.
//
// Se toman 24 capturas seguidas SOLO del canvas del retrato y se compara su peso en bytes: un
// PNG de un canvas en negro se comprime a nada; uno lleno de glifos ASCII pesa mucho más. No
// hace falta descodificar nada para distinguir "vacío" de "dibujado".
//
// Uso:  node scripts/diag-parpadeo.ts [webkit|chrome]

import { chromium, webkit, devices } from 'playwright';
import type { Browser } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MOTOR = (process.argv[2] === 'chrome' ? 'chrome' : 'webkit') as 'chrome' | 'webkit';
const PORT = MOTOR === 'webkit' ? 4218 : 4217;
const OUT = resolve('screenshots', 'movil', `parpadeo-${MOTOR}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function lanzar(): Promise<Browser> {
  if (MOTOR === 'webkit') return webkit.launch({ headless: true });
  return chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--autoplay-policy=user-gesture-required'],
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  const linea: string[] = [];
  const say = (s = ''): void => {
    console.log(s);
    linea.push(s);
    writeFileSync(join(OUT, 'parpadeo.txt'), linea.join('\n'), 'utf8');
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

    const browser = await lanzar();
    const ctx = await browser.newContext(devices['iPhone 13']);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
      null,
      { timeout: 30_000 },
    );
    // Se deja pasar una vuelta entera del loop del vídeo (dura ~7.6 s) antes de medir.
    await sleep(9000);

    say(`== ¿PARPADEA EL RETRATO? · motor=${MOTOR} ==`);
    say('   24 capturas del canvas, ~250 ms entre ellas. Peso del PNG y tinta leída a la vez.');
    say('');

    // Barrido de la CAJA del <video>: la sospecha es que WebKit sube a la textura el tamaño
    // PRESENTADO, no el decodificado, y con una caja de 2 px la mitad de los frames salen
    // vacíos. Se cambia el estilo del elemento vivo, sin recompilar, y se vuelve a medir.
    const CAJAS: [string, string][] = [
      [
        '2 px (lo que hay ahora)',
        'position:absolute;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none',
      ],
      [
        'tamaño natural, opacidad 1 %',
        'position:absolute;left:0;bottom:0;width:580px;height:806px;opacity:0.01;pointer-events:none',
      ],
      [
        'cubre el hero, opacidad 1 %',
        'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.01;pointer-events:none',
      ],
      [
        'cubre el hero, opacidad 0',
        'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;pointer-events:none',
      ],
      [
        'cubre el hero, visibility hidden',
        'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;visibility:hidden',
      ],
    ];

    for (const [nombre, css] of CAJAS) {
      await page.evaluate((c) => {
        const v = document
          .querySelector<HTMLVideoElement>('[data-ascii]')
          ?.parentElement?.querySelector('video');
        if (v) v.style.cssText = c;
      }, css);
      await sleep(1500);
      await medirRafaga(nombre);
    }

    async function medirRafaga(titulo: string): Promise<void> {
      say(`   --- caja: ${titulo} ---`);
      say('   #   bytes PNG   tinta (drawImage)   t vídeo');

      const canvas = page.locator('[data-ascii]');
      const pesos: number[] = [];
      let tintaCero = 0;
      for (let i = 0; i < 24; i++) {
        const [png, medida] = await Promise.all([
          canvas.screenshot(),
          page.evaluate(() => {
            const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
            const v = (window as any).__asciiGL?.source as HTMLVideoElement | undefined;
            let tinta = 0;
            if (c && c.width) {
              const off = document.createElement('canvas');
              off.width = c.width;
              off.height = c.height;
              const x = off.getContext('2d');
              if (x) {
                x.drawImage(c, 0, 0);
                const d = x.getImageData(0, 0, off.width, off.height).data;
                for (let k = 0; k < d.length; k += 4) {
                  if (0.2126 * (d[k] ?? 0) + 0.7152 * (d[k + 1] ?? 0) + 0.0722 * (d[k + 2] ?? 0) >= 26)
                    tinta++;
                }
              }
            }
            return { tinta, t: Number((v?.currentTime ?? -1).toFixed(2)), paused: v?.paused };
          }),
        ]);
        pesos.push(png.length);
        if (medida.tinta === 0) tintaCero++;
        if (i < 3) writeFileSync(join(OUT, `${titulo.slice(0, 12).replace(/\W+/g, '-')}-${i}.png`), png);
        say(
          `   ${String(i).padStart(2)}  ${String(png.length).padStart(9)}   ${String(medida.tinta).padStart(17)}   ${medida.t}${medida.paused ? ' PAUSADO' : ''}`,
        );
        await sleep(250);
      }

      const min = Math.min(...pesos);
      const max = Math.max(...pesos);
      const media = Math.round(pesos.reduce((a, b) => a + b, 0) / pesos.length);
      say('');
      say(`   peso PNG: mín ${min} · media ${media} · máx ${max}`);
      say(
        `   capturas por debajo del 40 % de la media (candidatas a "en negro"): ${pesos.filter((p) => p < media * 0.4).length} de ${pesos.length}`,
      );
      say(`   muestras de drawImage que dieron tinta 0: ${tintaCero} de ${pesos.length}`);
      say('');
      say(
        min > media * 0.4
          ? '   >>> NINGUNA captura sale vacía: el compositor entrega el retrato siempre.'
          : '   >>> HAY capturas vacías: el parpadeo es real y se ve.',
      );
      say('');
    }

    await ctx.close();
    await browser.close();
    say('');
    say(`Evidencia en ${OUT}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
