// scripts/sweep-bleed.ts — ¿cuánto se puede endurecer la puerta tonal antes de que la
// irregularidad se rompa o desaparezca?
//
// CON EL CURSOR QUIETO, que es la clave. Con el ratón en movimiento cualquier configuración
// parece orgánica, porque las celdas fuera del alcance conservan su valor y el derrame acumula
// una estela (ver la entrada del 2026-09-07 en CLAUDE.md). Quieto, lo que queda de forma es
// atribuible a la anatomía y al término radial, no al rastro.
//
// El barrido va sobre el SHADER REAL, no sobre una simulación: `setBleedConstants()` cambia
// `u_tone`/`u_edge` en caliente y `clearBleed()` borra la estela entre combinaciones. Así no
// hay modelo propio que validar — un riesgo que en este proyecto ya ha costado tres errores
// de medición.
//
// Aviso heredado (2026-09-04): un modelo multiplicativo por la cadena murió a 3-4 celdas.
// Aquí la puerta es por celda contra la semilla, así que no compone geométricamente — pero es
// exactamente lo que hay que comprobar, no suponer. Por eso se mide el ÁREA además de la forma.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4207;
const OUT = resolve('screenshots', 'gl');
const CORTE = 0.02;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Combinaciones a barrer. La primera fila es la actual. */
const TONES = [3.2, 8, 14, 22, 32];
const EDGES = [1.4, 6, 14];

interface Medida {
  area: number;
  pctFuera: number;
  radioEquiv: number;
  min: number;
  max: number;
  alcance: number[];
}

/** Aplica constantes, borra la estela, espera a que converja y mide la forma resultante. */
async function medir(page: Page, tone: number, edge: number): Promise<Medida> {
  await page.evaluate(
    ({ t, e }) => {
      const g = (
        window as unknown as {
          __asciiGL: { setBleedConstants: (a: number, b: number) => void; clearBleed: () => void };
        }
      ).__asciiGL;
      g.setBleedConstants(t, e);
      g.clearBleed();
    },
    { t: tone, e: edge },
  );
  // rise = 3.4/s: en ~1.6 s el frente ya llegó a su alcance y el valor está asentado.
  await sleep(1500);

  return page.evaluate((corte) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const g = (window as any).__asciiGL;
    if (!g.hasPointer) throw new Error('el puntero se salió del canvas a mitad del barrido');
    const gl = document.querySelector<HTMLCanvasElement>('[data-ascii]')?.getContext('webgl2');
    if (!gl) throw new Error('sin webgl2');

    const w = g.cols as number;
    const h = g.rows as number;
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.bleedFbo[g.bleedSrc]);
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const on = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      return (buf[(y * w + x) * 4] ?? 0) / 255 > corte;
    };

    const px = g.pointerX as number;
    const py = g.pointerY as number;
    let area = 0;
    for (let i = 0; i < w * h; i++) if ((buf[i * 4] ?? 0) / 255 > corte) area++;

    const radioEquiv = area > 0 ? Math.sqrt(area / Math.PI) : 0;
    let fuera = 0;
    for (let i = 0; i < w * h; i++) {
      if ((buf[i * 4] ?? 0) / 255 <= corte) continue;
      const d = Math.hypot((i % w) - px, ((i / w) | 0) - py);
      if (d > radioEquiv) fuera++;
    }

    const dirs: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    const alcance = dirs.map(([dx, dy]) => {
      let k = 0;
      for (let s = 1; s <= 60; s++) {
        if (!on(Math.round(px) + dx * s, Math.round(py) + dy * s)) break;
        k = s;
      }
      return k;
    });

    return {
      area,
      pctFuera: area > 0 ? (fuera / area) * 100 : 0,
      radioEquiv,
      min: Math.min(...alcance),
      max: Math.max(...alcance),
      alcance,
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }, CORTE);
}

async function colocarPuntero(page: Page, fx: number, fy: number): Promise<void> {
  const box = await page.evaluate(() => {
    const r = document.querySelector<HTMLCanvasElement>('[data-ascii]')?.getBoundingClientRect();
    return { x: r?.x ?? 0, y: r?.y ?? 0, w: r?.width ?? 0, h: r?.height ?? 0 };
  });
  const px = box.x + box.w * fx;
  const py = box.y + box.h * fy;
  let sobre = false;
  for (let i = 0; i < 12 && !sobre; i++) {
    await page.mouse.move(px + (i % 2), py, { steps: 8 });
    await sleep(250);
    sobre = await page.evaluate(
      () => (window as unknown as { __asciiGL?: { hasPointer: boolean } }).__asciiGL?.hasPointer === true,
    );
  }
  if (!sobre) throw new Error('el puntero no llegó al canvas');
  // Un último movimiento exacto y ya no se toca más: a partir de aquí el cursor está QUIETO.
  await page.mouse.move(px, py);
  await sleep(400);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  const report: string[] = [];
  // Escritura INCREMENTAL: un barrido largo que se corta por timeout dejaba cero datos, y
  // los parciales ya valen. El informe se reescribe entero en cada línea, que a este tamaño
  // es gratis y evita perder la corrida.
  const say = (s = ''): void => {
    console.log(s);
    report.push(s);
    writeFileSync(join(OUT, 'sweep-bleed.txt'), report.join(String.fromCharCode(10)), 'utf8');
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

    const browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(`http://localhost:${PORT}/?gl`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
      null,
      { timeout: 25_000 },
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(700);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);

    say('== BARRIDO DE LA PUERTA TONAL, CON EL CURSOR QUIETO ==');
    say('');
    say('   Con el cursor quieto no hay estela: la forma que quede es atribuible a la anatomía');
    say('   y al término radial. Actual = tone 3.2 / edge 1.4.');
    say('');

    const resultados: Array<{ tone: number; edge: number; m: Medida }> = [];

    await colocarPuntero(page, 0.62, 0.62);
    say('   --- Posición A: sobre el cuerpo (0.62, 0.62) ---');
    say('');
    say('   tone  edge    área   radio eq.   % fuera   alcance min-max');
    for (const tone of TONES) {
      for (const edge of EDGES) {
        const m = await medir(page, tone, edge);
        resultados.push({ tone, edge, m });
        const marca = tone === 3.2 && edge === 1.4 ? '  <- actual' : '';
        say(
          `   ${tone.toFixed(1).padStart(4)}  ${edge.toFixed(1).padStart(4)}   ${String(m.area).padStart(5)}     ${m.radioEquiv.toFixed(1).padStart(5)}     ${m.pctFuera.toFixed(1).padStart(5)}     ${String(m.min).padStart(2)}-${String(m.max).padStart(2)}${marca}`,
        );
      }
    }

    // Segunda posición para los candidatos que no colapsaron: la forma no puede depender
    // de un solo punto del retrato.
    const vivos = resultados.filter((r) => r.m.area >= 150);
    vivos.sort((a, b) => b.m.pctFuera - a.m.pctFuera);
    const candidatos = vivos.slice(0, 4);

    say('');
    say('   --- Posición B: sobre el borde de la mandíbula (0.42, 0.52) ---');
    say('   (solo los 4 más irregulares que no colapsaron, para ver si la forma generaliza)');
    say('');
    await colocarPuntero(page, 0.42, 0.52);
    say('   tone  edge    área   % fuera   alcance min-max');
    for (const c of candidatos) {
      const m = await medir(page, c.tone, c.edge);
      say(
        `   ${c.tone.toFixed(1).padStart(4)}  ${c.edge.toFixed(1).padStart(4)}   ${String(m.area).padStart(5)}     ${m.pctFuera.toFixed(1).padStart(5)}     ${String(m.min).padStart(2)}-${String(m.max).padStart(2)}`,
      );
    }

    // Deja el retrato como estaba
    await page.evaluate(() => {
      (
        window as unknown as { __asciiGL: { setBleedConstants: (a: number, b: number) => void } }
      ).__asciiGL.setBleedConstants(3.2, 1.4);
    });
    await browser.close();

    say('');
    say('   COLAPSO = área por debajo de ~150 celdas: la puerta mata el derrame, que es el');
    say('   modo de fallo del modelo multiplicativo descartado el 2026-09-04.');

    writeFileSync(join(OUT, 'sweep-bleed.txt'), report.join('\n'), 'utf8');
    console.log(`\nReport en ${join(OUT, 'sweep-bleed.txt')}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
