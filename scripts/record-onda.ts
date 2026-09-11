// scripts/record-onda.ts — los vídeos de las dos ondas, que es la única forma de juzgarlas.
//
// Javier lo pidió así desde el principio: este efecto solo se ve en movimiento. Se graban las
// variantes de una en una y se montan LADO A LADO en un solo mp4, porque comparar dos archivos
// que se reproducen por separado no es comparar — el ojo no retiene el ritmo de uno mientras
// mira el otro, y aquí lo que se juzga es justo el ritmo.
//
// Las dos ondas comparten mecanismo, así que se graban las dos: romper el círculo en la del clic
// y dejarlo perfecto en la de entrada las haría parecer dos efectos distintos.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { aMp4, mosaico, type Caja } from './lib/video.ts';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4264;
const OUT = resolve('screenshots', 'onda');
const TMP = resolve('screenshots', 'onda', 'tmp-rec');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Instante FIJO, desde que se crea la página, en el que se dispara el clic.
 *
 * Es la forma de que los cuatro paneles queden alineados sin detectar nada: si el efecto ocurre
 * siempre en el mismo segundo de la grabación, el recorte es el mismo para todos. Antes se
 * marcaba con `Date.now()` justo antes del clic y salían desfasados, porque entre el `goto`, el
 * reveal y la espera cada corrida tardaba lo suyo. Detectar el arranque en el vídeo tampoco
 * salió: el clasificador acertaba en unos clips y en otros se disparaba en el fotograma 0.
 */
const T_CLIC_MS = 9000;
/** Sólo se graba lo que se pida por argumento; sin argumento, las dos. */
const SOLO = process.argv[2];

/** Las variantes que se enseñan. La geometría de cada una está medida en `measure-onda.ts`. */
const VARIANTES: Array<{ id: string; rotulo: string; query: string }> = [
  { id: 'hoy', rotulo: 'HOY  circulo perfecto', query: '?glondaruido=0&glondatono=0' },
  { id: 'ruido', rotulo: 'RUIDO 6  borde roto', query: '?glondaruido=6&glondatono=0' },
  {
    id: 'ruido-tono',
    rotulo: 'RUIDO 6 + TONO 5  corre por las luces',
    query: '?glondaruido=6&glondatono=5',
  },
  {
    id: 'ruido-tono-cubic',
    rotulo: 'RUIDO 6 + TONO 5 + cubic.out',
    query: '?glondaruido=6&glondatono=5&glondaease=3',
  },
];

const TOPE_MS = 12 * 60 * 1000;
const guardian = setTimeout(() => {
  console.error(`FATAL: la sonda pasó de ${TOPE_MS / 1000}s. Se corta para no dejar huérfanos.`);
  process.exit(1);
}, TOPE_MS);
guardian.unref?.();

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
  mkdirSync(OUT, { recursive: true });
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: false });

  const clips: Record<string, Array<{ mp4: string; rotulo: string }>> = { clic: [], reveal: [] };

  for (const v of VARIANTES) {
    for (const efecto of ['clic', 'reveal'] as const) {
      if (SOLO && SOLO !== efecto) continue;
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        recordVideo: { dir: TMP, size: { width: 1440, height: 900 } },
      });
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(`http://localhost:${PORT}/${v.query}`, { waitUntil: 'load' });
      await page.bringToFront();

      /**
       * DESTELLO DE SINCRONÍA: un cuadro blanco de 24 px en la esquina del lienzo, encendido en
       * el instante exacto en que arranca el efecto y apagado 120 ms después.
       *
       * Es lo único que ha alineado bien los cuatro paneles. Marcar el instante con `Date.now()`
       * los dejaba desfasados —entre el disparo y el fotograma codificado hay una latencia que
       * cambia en cada corrida— y detectar el arranque por el color del retrato acertaba en unos
       * clips y se disparaba en el fotograma 0 en otros. Un destello dentro del recorte no
       * admite interpretación: o está encendido o no.
       */
      const marcar = `(() => {
        const c = document.querySelector('[data-ascii]');
        const r = c.getBoundingClientRect();
        const d = document.createElement('div');
        d.setAttribute('data-marca', '');
        d.style.cssText = 'position:fixed;z-index:99999;width:24px;height:24px;background:#fff;pointer-events:none;left:' + (r.left + 4) + 'px;top:' + (r.top + 4) + 'px';
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 120);
      })()`;

      let tEfecto = 0;
      if (efecto === 'reveal') {
        // El reveal arranca solo al terminar el preloader: se marca cuándo empieza a haber tinta.
        // El destello lo dispara la propia página en cuanto el reveal empieza: esperar desde
        // Node añadiría el ida y vuelta del protocolo justo en el instante que se quiere marcar.
        await page.evaluate(`(() => {
          const c = document.querySelector('[data-ascii]');
          const paso = () => {
            if (Number(c.dataset.glReveal || '0') > 0.02) { ${marcar}; return; }
            requestAnimationFrame(paso);
          };
          requestAnimationFrame(paso);
        })()`);
        await page.waitForFunction(
          () =>
            Number(document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal ?? '0') > 0.02,
          null,
          { timeout: 40_000 },
        );
        tEfecto = Date.now() - t0;
        await page.waitForFunction(
          () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
          null,
          { timeout: 40_000 },
        );
        await sleep(600);
      } else {
        await page.waitForFunction(
          () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
          null,
          { timeout: 40_000 },
        );
        // Se espera hasta el instante fijo, pase lo que pase antes.
        await sleep(Math.max(300, T_CLIC_MS - (Date.now() - t0)));
        const caja = await page.locator('[data-ascii]').boundingBox();
        tEfecto = T_CLIC_MS;
        await page.evaluate(marcar);
        // El clic va sobre la cabeza del jaguar, que es de donde sale la onda en el uso real.
        await page.mouse.click(
          (caja?.x ?? 0) + (caja?.width ?? 0) * 0.55,
          (caja?.y ?? 0) + (caja?.height ?? 0) * 0.45,
        );
        await sleep(2200);
      }

      const caja = (await page.evaluate(`(() => {
        const r = document.querySelector('[data-ascii]').getBoundingClientRect();
        const x = Math.max(0, Math.round(r.left)), y = Math.max(0, Math.round(r.top));
        return { x, y, w: Math.min(1440 - x, Math.round(r.width)), h: Math.min(900 - y, Math.round(r.height)) };
      })()`)) as Caja;

      const video = page.video();
      await ctx.close();
      const webm = await video?.path();
      if (!webm) throw new Error('Playwright no devolvió el vídeo');

      const mp4 = join(TMP, `${efecto}-${v.id}.mp4`);
      // Se guarda un tramo ANCHO: el recorte fino lo hace `alinear-onda.ts` buscando el
      // destello, y para eso tiene que estar dentro.
      // Se guarda la grabación ENTERA: el recorte fino lo hace `alinear-onda.ts` buscando el
      // destello, y recortando antes se perdía — el clip de la variante 'hoy' se quedó sin
      // destello y salió descartado del montaje.
      aMp4(webm, mp4, caja, { anchoMax: 380 });
      clips[efecto]!.push({ mp4, rotulo: v.rotulo });
      console.log(`   grabado ${efecto} · ${v.id}  (efecto a los ${(tEfecto / 1000).toFixed(2)}s)`);
    }
  }

  await browser.close();
  if (clips.clic!.length > 0) mosaico(clips.clic!, join(OUT, 'onda-clic-comparativa.mp4'));
  if (clips.reveal!.length > 0) mosaico(clips.reveal!, join(OUT, 'reveal-comparativa.mp4'));
  console.log(`\nComparativas en ${OUT}`);
  console.log('   onda-clic-comparativa.mp4');
  console.log('   reveal-comparativa.mp4');
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
