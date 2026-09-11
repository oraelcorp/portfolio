// scripts/recon-onda.ts — ¿hay algo MEDIBLE en la referencia sobre cómo avanza su onda?
//
// Es el pendiente del prompt original: la onda de color se siente mecánica, y antes de
// inventarse una variante hay que mirar si la referencia hace algo distinto. La referencia tiene
// un reveal radial del mismo tipo (`recon/diff.md` §B1: shader Three.js con `revealOrigin` y
// ease cubic.out), así que se puede medir con la MISMA vara que la nuestra (`lib/frente.ts`).
//
// Se graba por RÁFAGA DE CAPTURAS, y las dos alternativas se descartaron midiendo:
//   · leer el canvas con `drawImage` da NEGRO — un canvas WebGL sin `preserveDrawingBuffer` no
//     se puede leer desde fuera de su frame de dibujo. En la referencia salían 2316 celdas de
//     golpe a los 6.9 s, justo cuando el sitio deja de repintar.
//   · `recordVideo` de Playwright deja el sitio a medias: el wipe del preloader se queda clavado
//     y el hero no llega a pintarse en 14 s de grabación.
// La captura una a una va a menos fps, pero pasa por el compositor y no toca el ciclo de la
// página. Los fps REALES se miden y se usan, no se suponen.
//
// Lo que esta sonda NO puede contestar: la referencia no tiene modo color, así que de su CLIC no
// hay nada que medir. Lo comparable es el reveal de entrada.
import { chromium } from 'playwright';
import {
  frenteDesdeGray,
  analizarFrente,
  ajustarEase,
  mediasPorFrame,
  frameDeArranque,
} from './lib/frente.ts';
import { rafagaGris, rafagaAMp4, type Caja } from './lib/video.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon');
const VID = resolve('screenshots', 'onda');
const TMP = resolve('screenshots', 'onda', 'tmp-ref');
/** Se graba desde antes del preloader: el reveal arranca cuando el wipe EMPIEZA. */
const GRABAR_MS = 14_000;
const ANCHO = 160;
const ALTO = 100;
/** Umbral de tinta sobre la rejilla remuestreada. Alto a propósito: ver la nota del informe. */
const UMBRAL = 40;

const TOPE_MS = 6 * 60 * 1000;
const guardian = setTimeout(() => {
  console.error(`FATAL: la sonda pasó de ${TOPE_MS / 1000}s. Se corta para no dejar huérfanos.`);
  process.exit(1);
}, TOPE_MS);
guardian.unref?.();

const L: string[] = [];
const say = (s = ''): void => {
  console.log(s);
  L.push(s);
};

try {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(VID, { recursive: true });
  const browser = await chromium
    .launch({ channel: 'chrome', headless: false })
    .catch(() => chromium.launch({ headless: false }));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.bringToFront();
  await page.waitForSelector('canvas', { timeout: 60_000 });

  const caja = (await page.evaluate(`(() => {
    const c = document.querySelectorAll('canvas')[0];
    const r = c.getBoundingClientRect();
    const x = Math.max(0, Math.round(r.left)), y = Math.max(0, Math.round(r.top));
    return { x, y, w: Math.min(1440 - x, Math.round(r.width)), h: Math.min(900 - y, Math.round(r.height)) };
  })()`)) as Caja;

  const raf = await rafagaGris(page, caja, GRABAR_MS, ANCHO, ALTO, TMP);
  await ctx.close();
  await browser.close();

  const medias = mediasPorFrame(raf.buf, ANCHO, ALTO);
  const arranque = frameDeArranque(medias);
  const f = frenteDesdeGray(raf.buf, ANCHO, ALTO, raf.fps, UMBRAL, arranque);
  const a = analizarFrente(f, 10);
  const ease = ajustarEase(a.curva);
  rafagaAMp4(TMP, join(VID, 'referencia-reveal.mp4'), raf.fps);

  say('== REFERENCIA · good-fella.com · cómo avanza el frente de su reveal ==');
  say(
    `   ${raf.nFrames} capturas a ${raf.fps.toFixed(1)} fps reales · canvas ${caja.w}x${caja.h} en (${caja.x},${caja.y}) · rejilla ${ANCHO}x${ALTO} · umbral ${UMBRAL}`,
  );
  say('');
  say('   luminancia media por fotograma (ms:valor, uno de cada 10):');
  say(
    '     ' +
      medias
        .map((m, i) => [i, m] as [number, number])
        .filter(([i]) => i % 10 === 0)
        .map(([i, m]) => `${((i / raf.fps) * 1000).toFixed(0)}:${m.toFixed(0)}`)
        .join('  '),
  );
  say('');
  say(
    `   arranque (fotograma más oscuro) ${arranque} · ${((arranque / raf.fps) * 1000).toFixed(0)} ms · media ${(medias[arranque] ?? 0).toFixed(1)}/255`,
  );
  say(`   celdas que se encienden         ${a.n} de ${ANCHO * ALTO}`);
  say(`   origen ajustado                 ${a.ox}, ${a.oy}  (centro = ${ANCHO / 2}, ${ALTO / 2})`);
  say(`   duración del frente             ${a.duracionMs.toFixed(0)} ms`);
  say(`   GROSOR del frente               ${a.grosor.toFixed(2)} celdas`);
  say(`   cuantización del muestreo       ${a.cuantizacion.toFixed(2)} celdas`);
  say(`   PERTURBACIÓN (grosor − cuant.)  ${a.perturbacion.toFixed(2)} celdas`);
  say(`   ease que mejor ajusta           ${ease.nombre}  (error ${ease.error.toFixed(3)})`);
  say('');
  say('   radio del frente en el tiempo (ms, celdas):');
  const paso = Math.max(1, Math.floor(a.curva.length / 12));
  for (let i = 0; i < a.curva.length; i += paso) {
    const p = a.curva[i]!;
    say(`     ${String(Math.round(p[0])).padStart(6)} ms   ${p[1].toFixed(1).padStart(6)}`);
  }

  writeFileSync(join(OUT, 'onda.txt'), L.join('\n'), 'utf8');
  writeFileSync(
    join(OUT, 'onda.json'),
    JSON.stringify({ ...a, ease, ancho: ANCHO, alto: ALTO, fps: raf.fps }),
    'utf8',
  );
  say('');
  say(`Vídeo en ${join(VID, 'referencia-reveal.mp4')} · datos en ${join(OUT, 'onda.txt')}`);
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
