// scripts/measure-reparto.ts — ¿cuánto dibujo del retrato cae en cada tramo de la rampa?
//
// La rampa de 11 tonos no es monótona: en t=0.80 la luminancia cae un 35 % (#F2DB8E ->
// #978E7D). Que eso importe o no depende de CUÁNTAS celdas caen ahí, y eso no se adivina: se
// mide sobre el campo de luminancia real del retrato.
//
// Se lee del Canvas 2D con `?2d&debug`, que expone `luma` y el flag de highlight por celda —
// es el mismo camino que usa `check-gl-palette`, y da el campo ya muestreado y con la curva
// de contraste aplicada.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import type { VentanaSonda } from './lib/motor.ts';

const PORT = 4242;
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
  await page.goto(`http://localhost:${PORT}/?2d&debug`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.reveal === '1.000',
    null,
    { timeout: 40_000 },
  );
  await sleep(800);

  const r = await page.evaluate(() => {
    const p = (window as VentanaSonda).__asciiPortrait!;
    const luma = p.luma;
    const EMPTY = 0.12;
    const bins = new Array(10).fill(0);
    let conTinta = 0;
    for (let i = 0; i < luma.length; i++) {
      const l = luma[i] ?? 0;
      if (l < EMPTY) continue;
      conTinta++;
      bins[Math.min(9, Math.floor(l * 10))]++;
    }
    // Pregunta 3 del checkpoint: ¿el highlight sigue haciendo falta como capa aparte, o la
    // rampa ya lo cubre? Depende de DÓNDE caen los highlights: si ya están arriba, la rampa
    // les da un casi-blanco por sí sola y la capa sobra; si están repartidos, quitarla apaga
    // los que viven en zonas oscuras.
    const hi = (p as unknown as { highlight: Uint8Array }).highlight;
    const binsHi = new Array(10).fill(0);
    let nHi = 0;
    for (let i = 0; i < luma.length; i++) {
      if (hi[i] !== 1) continue;
      const l = luma[i] ?? 0;
      if (l < EMPTY) continue;
      nHi++;
      binsHi[Math.min(9, Math.floor(l * 10))]++;
    }
    return { bins, conTinta, total: luma.length, binsHi, nHi };
  });

  console.log('== REPARTO DEL DIBUJO POR TRAMO DE LA RAMPA ==');
  console.log(`   celdas con tinta: ${r.conTinta} de ${r.total}`);
  console.log('');
  console.log('   tramo t        color del tramo        celdas    % del dibujo');
  const HEX = [
    '#000000',
    '#1C0F08',
    '#421F09',
    '#6C3A13',
    '#98581A',
    '#C67E26',
    '#DFAC50',
    '#F2DB8E',
    '#978E7D',
    '#BFBCB3',
    '#F1F0EA',
  ];
  let acumAlto = 0;
  r.bins.forEach((n: number, i: number) => {
    const pct = (n / r.conTinta) * 100;
    const marca = i === 7 ? '  <-- aquí empieza la inversión' : '';
    if (i >= 7) acumAlto += n;
    console.log(
      `   ${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}   ${HEX[i]} → ${HEX[i + 1]}   ${String(n).padStart(6)}   ${pct.toFixed(1).padStart(5)} %${marca}`,
    );
  });
  console.log('');
  console.log(
    `   >>> dibujo por encima de t=0.7 (la zona de los grises): ${acumAlto} celdas, ${((acumAlto / r.conTinta) * 100).toFixed(1)} % del total`,
  );
  console.log('');
  console.log('== ¿DÓNDE CAEN LOS HIGHLIGHTS? (pregunta 3: capa aparte o cubierta por la rampa) ==');
  console.log(`   highlights: ${r.nHi} celdas, ${((r.nHi / r.conTinta) * 100).toFixed(1)} % del dibujo`);
  let hiAlto = 0;
  r.binsHi.forEach((n: number, i: number) => {
    if (i >= 7) hiAlto += n;
    const pct = r.nHi > 0 ? (n / r.nHi) * 100 : 0;
    console.log(
      `   t ${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}   ${String(n).padStart(5)}   ${pct.toFixed(1).padStart(5)} % de los highlights`,
    );
  });
  console.log('');
  console.log(
    `   >>> highlights que la rampa ya deja en casi-blanco (t>0.7): ${hiAlto} de ${r.nHi} (${((hiAlto / Math.max(1, r.nHi)) * 100).toFixed(1)} %)`,
  );
  console.log(
    `   >>> highlights en zona oscura o media, que perderían el blanco si se quita la capa: ${r.nHi - hiAlto} (${(((r.nHi - hiAlto) / Math.max(1, r.nHi)) * 100).toFixed(1)} %)`,
  );
  await b.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
