// scripts/record-secciones.ts — el barrido de las tres secciones, tal y como se ve al scrollear.
//
// A diferencia del hero, estos titulares entran por ScrollTrigger, así que el efecto solo
// significa algo dentro del gesto que lo dispara: se graba un recorrido continuo, no tres saltos.
// El scroll va a velocidad constante y lenta, como quien lee.
//
// Aquí sí sirve `recordVideo` de Playwright —es nuestra página, no la referencia— así que la
// grabación va a su ritmo real sin el truco del reloj lento.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { aMp4, type Caja } from './lib/video.ts';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4276;
const OUT = resolve('screenshots', 'titular');
const TMP = join(OUT, 'tmp-sec');
/** Píxeles por segundo del recorrido. Lento a propósito: es la velocidad a la que se lee. */
const VELOCIDAD = Number(process.argv[5] ?? 780);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TOPE_MS = 10 * 60 * 1000;
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
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: TMP, size: { width: 1440, height: 900 } },
  });
  const page = await ctx.newPage();

  // Primera carga: se consume el preloader (queda marcado en sessionStorage).
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.bringToFront();
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, {
    timeout: 60_000,
  });
  // Segunda: arranca ya en el hero, sin overlay que se coma el principio del recorrido.
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await sleep(2500);

  const limites = (await page.evaluate(`(() => {
    const y = (s) => {
      const el = document.querySelector('[data-section="' + s + '"]');
      return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
    };
    const ultima = '${process.argv[2] || 'principles'}';
    return { process: y('process'), work: y('work'), principles: y('principles'), contact: y('contact'),
             fin: (y(ultima) || 5000) + (document.querySelector('[data-section="' + ultima + '"]')?.offsetHeight || 900) };
  })()`)) as Record<string, number>;
  console.log(
    `   process ${limites.process} · work ${limites.work} · principles ${limites.principles} · contact ${limites.contact}`,
  );

  // Recorrido continuo a velocidad constante. Se mueve con `scrollTo` en pasos pequeños en vez
  // de con la rueda: así la velocidad es exactamente la que se pide y el vídeo es comparable
  // entre corridas, que es lo que hace falta para juzgar un ritmo.
  // Cuarto argumento: cuánto ANTES del final parar. Sirve para dejar un titular a media altura
  // y verlo entrar entero en vez de que el propio recorrido se lo lleve fuera de pantalla, que
  // es lo que pasaba con el de contacto a 780 px/s.
  // El destino NO se fija con un número calculado antes de empezar: el layout crece mientras
  // cargan fuentes e imágenes, y una parada calculada al principio cae donde no toca (pasó: se
  // apuntó a contacto y el recorrido paró en FAQ). Cuando se pide parar en un titular, se mira
  // su posición EN VIVO en cada paso y se frena cuando entra en el encuadre.
  const pararEn = process.argv[4];
  const destino = (limites.fin ?? 9000) - 0;
  const t0 = Date.now();
  for (;;) {
    const t = (Date.now() - t0) / 1000;
    const y = Math.round(t * VELOCIDAD);
    if (y > destino) break;
    await page.evaluate(`window.scrollTo(0, ${y})`);
    if (pararEn) {
      const listo = (await page.evaluate(
        `(() => { const h = document.querySelector('[data-section="${pararEn}"] h2');
          if (!h) return false; const r = h.getBoundingClientRect();
          return r.top < innerHeight * 0.55; })()`,
      )) as boolean;
      if (listo) break;
    }
    await sleep(16);
  }
  // Se aguanta al final para que el último titular termine su entrada dentro del encuadre.
  await sleep(pararEn ? 3200 : 1800);

  const caja: Caja = { x: 0, y: 0, w: 1440, h: 900 };
  const video = page.video();
  await ctx.close();
  await browser.close();
  const webm = await video?.path();
  if (!webm) throw new Error('Playwright no devolvió el vídeo');
  const nombre = process.argv[3] ?? 'secciones-barrido.mp4';
  aMp4(webm, join(OUT, nombre), caja, { anchoMax: 900 });
  console.log(`\nVídeo en ${join(OUT, 'secciones-barrido.mp4')}`);
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
