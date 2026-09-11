// scripts/measure-frio.ts — ¿qué porción del retrato caería en el tono FRÍO?
//
// Javier pide el frío en «la franja más alta», y avisa de no repetir el error de que sea una
// porción demasiado grande (con los neutros a intervalos iguales eran el 38.7 % y el retrato
// leía plateado). Con la posterización, esa franja es el escalón superior: con N escalones
// cubre las luminancias por encima de 1 - 0.5/(N-1).
//
// Se mide sobre el campo real del retrato, y se separa lo que es luminancia alta de lo que es
// highlight: son dos cosas distintas y el frío solo debe gobernar la primera.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import type { VentanaSonda } from './lib/motor.ts';

const PORT = 4246;
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
    const hi = (p as unknown as { highlight: Uint8Array }).highlight;
    const EMPTY = 0.12;
    const salida: Record<string, number> = {};
    let conTinta = 0;
    let nHi = 0;
    for (let i = 0; i < luma.length; i++) {
      if ((luma[i] ?? 0) < EMPTY) continue;
      conTinta++;
      if (hi[i] === 1) nHi++;
    }
    for (const n of [4, 5, 6]) {
      const tope = 1 - 0.5 / (n - 1);
      let enFranja = 0;
      let enFranjaHi = 0;
      for (let i = 0; i < luma.length; i++) {
        const l = luma[i] ?? 0;
        if (l < EMPTY) continue;
        if (l >= tope) {
          enFranja++;
          if (hi[i] === 1) enFranjaHi++;
        }
      }
      salida[`tope${n}`] = tope;
      salida[`franja${n}`] = enFranja;
      salida[`franjaHi${n}`] = enFranjaHi;
    }
    // ¿Se llega alguna vez a los neutros intermedios (#978E7D en t=0.9333, #BFBCB3 en 0.9667)?
    let entre90y100 = 0;
    for (let i = 0; i < luma.length; i++) {
      const l = luma[i] ?? 0;
      if (l >= 0.9 && l < 1) entre90y100++;
    }
    salida.entre90y100 = entre90y100;
    salida.conTinta = conTinta;
    salida.nHi = nHi;
    return salida;
  });

  console.log('== ¿CUÁNTO RETRATO CAERÍA EN EL TONO FRÍO? ==');
  console.log(
    `   celdas con tinta: ${r.conTinta} · highlights: ${r.nHi} (${((r.nHi! / r.conTinta!) * 100).toFixed(1)} %)`,
  );
  console.log('');
  console.log('   escalones   umbral    celdas en la franja   % del dibujo   de ellas, highlights');
  for (const n of [4, 5, 6]) {
    const f = r[`franja${n}`]!;
    const fh = r[`franjaHi${n}`]!;
    console.log(
      `   ${String(n).padStart(6)}      l >= ${r[`tope${n}`]!.toFixed(3)}   ${String(f).padStart(14)}   ${((f / r.conTinta!) * 100).toFixed(1).padStart(9)} %   ${String(fh).padStart(10)} (${((fh / Math.max(1, f)) * 100).toFixed(0)} %)`,
    );
  }
  console.log('');
  console.log(
    `   celdas con luminancia entre 0.90 y 1.00 (donde viven los dos neutros intermedios): ${r.entre90y100}`,
  );
  console.log(`   >>> con posterización esos dos neutros NO se alcanzan: la cuantización lleva todo`);
  console.log(`       lo que pasa el umbral directamente al punto más alto. La familia neutra se`);
  console.log(`       reduce, en la práctica, a ese único escalón — que es el que pasa a ser frío.`);
  await b.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
