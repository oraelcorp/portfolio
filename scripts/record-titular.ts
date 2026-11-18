// scripts/record-titular.ts — el barrido de entrada del titular, nuestro y el de la referencia,
// lado a lado y a la misma escala.
//
// El problema de grabar esto: el efecto dura ~1 s y contra la referencia solo se puede capturar
// por ráfaga de pantallazos, que en su sitio llega a 8 fps (`recordVideo` deja su página a
// medias, medido). Ocho fotogramas no sirven para juzgar un desfase de 156 ms.
//
// La salida: **se ralentiza el reloj de las animaciones**, en las DOS páginas y por el mismo
// factor. Se envuelve `requestAnimationFrame` para que entregue una marca de tiempo escalada; GSAP
// usa esa marca, así que sus líneas de tiempo corren a cámara lenta mientras la ráfaga sigue
// capturando a su ritmo. Con factor 4, un efecto de 1 s pasa a durar 4 s y la misma ráfaga le saca
// 32 fotogramas. Es el mismo truco de estrangular el reloj que se usó con el preloader.
//
// Lo que se entrega es cámara lenta a propósito: para juzgar ritmo y desfase hay que poder verlo.
import { chromium, type Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { rafagaAMp4, mosaico, RELOJ_LENTO, type Caja } from './lib/video.ts';
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4272;
const OUT = resolve('screenshots', 'titular');
const TMP = join(OUT, 'tmp');
const REF = 'https://good-fella.com/';
/** Cuánto se estira el tiempo de las animaciones. 4 = un efecto de 1 s dura 4 s. */
const LENTO = 4;
const GRABAR_MS = 9000;
/** Ancho de cada panel del montaje: los dos titulares se llevan al mismo tamaño. */
const ANCHO_PANEL = 560;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TOPE_MS = 12 * 60 * 1000;
const guardian = setTimeout(() => {
  console.error(`FATAL: la sonda pasó de ${TOPE_MS / 1000}s. Se corta para no dejar huérfanos.`);
  process.exit(1);
}, TOPE_MS);
guardian.unref?.();

/** Ráfaga de capturas recortada a una caja, con los fps reales medidos. */
async function rafaga(page: Page, caja: Caja, ms: number, dir: string): Promise<{ fps: number; n: number }> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const clip = {
    x: Math.round(caja.x),
    y: Math.round(caja.y),
    width: Math.round(caja.w) - (Math.round(caja.w) % 2),
    height: Math.round(caja.h) - (Math.round(caja.h) % 2),
  };
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < ms) {
    try {
      const b = await page.screenshot({ clip, type: 'jpeg', quality: 60, animations: 'allow' });
      writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.jpg`), b);
      i++;
    } catch {
      break;
    }
  }
  return { fps: i / ((Date.now() - t0) / 1000), n: i };
}

const opciones: ExecFileSyncOptions = { stdio: ['ignore', 'ignore', 'pipe'] };

try {
  mkdirSync(OUT, { recursive: true });
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const preview = startPreview(PORT);
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
    } catch {
      /* aún no */
    }
    await sleep(400);
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const clips: Array<{ mp4: string; rotulo: string }> = [];

  // ---------------------------------------------------------------- la referencia
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(RELOJ_LENTO(LENTO));
    const page = await ctx.newPage();
    await page.goto(REF, { waitUntil: 'load', timeout: 90_000 });
    await page.bringToFront();
    await sleep(14_000);
    // La caja del titular ANTES de dispararlo: hay que recortar ahí, no al viewport entero.
    const caja = (await page.evaluate(`(() => {
      const h = Array.from(document.querySelectorAll('h2')).find((e) => (e.textContent || '').includes('How we work'));
      const r = h.getBoundingClientRect();
      const y = r.top + window.scrollY;
      // Se devuelve la caja EN LA PÁGINA; el recorte se calcula tras el scroll.
      return { xPag: r.left, yPag: y, w: r.width, h: r.height };
    })()`)) as { xPag: number; yPag: number; w: number; h: number };

    const dir = join(TMP, 'ref');
    // Se coloca el titular en un sitio conocido de la pantalla y se graba desde ANTES de que
    // entre: el efecto se dispara una sola vez.
    await page.evaluate(`window.scrollTo(0, ${Math.round(caja.yPag - 1400)})`);
    await sleep(1500);
    const caja2 = (await page.evaluate(`(() => {
      const h = Array.from(document.querySelectorAll('h2')).find((e) => (e.textContent || '').includes('How we work'));
      const r = h.getBoundingClientRect();
      return { x: Math.max(0, r.left - 20), y: Math.max(0, r.top + window.scrollY), w: r.width + 40, h: r.height + 20 };
    })()`)) as Caja;
    void caja2;
    const objetivoY = Math.round(caja.yPag - 380);
    const capturando = rafaga(
      page,
      { x: Math.max(0, caja.xPag - 20), y: 380, w: caja.w + 40, h: caja.h + 24 },
      GRABAR_MS,
      dir,
    );
    await sleep(600);
    await page.evaluate(`window.scrollTo(0, ${objetivoY})`);
    const r = await capturando;
    const mp4 = join(TMP, 'ref.mp4');
    rafagaAMp4(dir, mp4, r.fps, ANCHO_PANEL);
    clips.push({ mp4, rotulo: `REFERENCIA  x${LENTO} lento` });
    console.log(`   referencia: ${r.n} capturas a ${r.fps.toFixed(1)} fps`);
    await ctx.close();
  }

  // ---------------------------------------------------------------- el nuestro
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(RELOJ_LENTO(LENTO));
    const page = await ctx.newPage();
    const dir = join(TMP, 'nuestro');
    // PRIMERA carga: se deja correr entera para que el preloader se marque como visto. Hace
    // falta porque el reloj lento lo ralentiza a él también y se comía toda la grabación.
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.bringToFront();
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, {
      timeout: 60_000,
    });
    const caja = (await page.evaluate(`(() => {
      const r = document.querySelector('[data-hero-title]').getBoundingClientRect();
      return { x: Math.max(0, r.left - 20), y: Math.max(0, r.top - 12), w: r.width + 40, h: r.height + 24 };
    })()`)) as Caja;
    // SEGUNDA carga: el preloader ya está visto (vive en sessionStorage), así que el titular
    // entra de inmediato y la ráfaga lo pilla desde el primer fotograma.
    const capturando2 = page.goto(`http://localhost:${PORT}/`, { waitUntil: 'commit' });
    void capturando2;
    const r = await rafaga(page, caja, GRABAR_MS, dir);
    const mp4 = join(TMP, 'nuestro.mp4');
    rafagaAMp4(dir, mp4, r.fps, ANCHO_PANEL);
    clips.push({ mp4, rotulo: `NUESTRO  x${LENTO} lento` });
    console.log(`   nuestro: ${r.n} capturas a ${r.fps.toFixed(1)} fps`);
    await ctx.close();
  }

  await browser.close();
  preview.stop();

  // Los dos paneles a la misma altura antes de pegarlos: `hstack` lo exige. Las medidas se
  // calculan AQUÍ en números, no con expresiones de ffmpeg: la versión con `(oh-ih)/2` fallaba
  // al evaluar, y depurar una expresión dentro de un filtro no es sitio donde perder el tiempo.
  const dims = clips.map((c) =>
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0',
        c.mp4,
      ],
      { encoding: 'utf8' },
    )
      .trim()
      .split(',')
      .map(Number),
  );
  const escalados = dims.map(([w, h]) => {
    const alto = Math.round((h! * ANCHO_PANEL) / w!);
    return alto - (alto % 2);
  });
  const alto = Math.max(...escalados);
  const ajustados = clips.map((c, i) => {
    const dst = join(TMP, `pan${i}.mp4`);
    const relleno = Math.round((alto - escalados[i]!) / 2);
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        c.mp4,
        '-vf',
        `scale=${ANCHO_PANEL}:${escalados[i]},pad=${ANCHO_PANEL}:${alto}:0:${relleno}:black`,
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        dst,
      ],
      opciones,
    );
    return { mp4: dst, rotulo: c.rotulo };
  });
  mosaico(ajustados, join(OUT, 'titular-comparativa.mp4'));
  console.log(`\nComparativa en ${join(OUT, 'titular-comparativa.mp4')}`);
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
