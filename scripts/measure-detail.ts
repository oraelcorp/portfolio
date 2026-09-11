// scripts/measure-detail.ts — ¿cuánto detalle cuesta el suavizado previo (§6.3 punto 3) y
// dónde está el techo de resolución de la foto fuente? Sonda previa a la decisión sobre WebGL.
//
// Cuatro bloques:
//   A) TECHO DE LA FUENTE. Se degrada la foto (100/75/50/35/25/15 %) y se vuelve a muestrear.
//      Si el campo de luminancia por celda no cambia al BAJAR la resolución de la fuente, es
//      que el pipeline no está limitado por ella y una foto mejor no compra nada a esta celda.
//   B) BARRIDO DE BLUR. Detalle destruido (RMS contra smooth 0), amplitud (sd), gradiente local.
//   C) ¿VUELVE EL RUIDO DE PELAJE? Los highlights se separan en AISLADOS (celda sin vecino
//      highlight: la firma del moteado) y en CADENAS >=4 (bordes estructurales). Es la métrica
//      que decide si se puede bajar el suavizado, no el % total de highlights.
//   D) Parejas (smooth, hlDelta) que mantienen la proporción de highlights de la referencia.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4181;
const URL = `http://localhost:${PORT}/?debug`;
const OUT = resolve('screenshots', 'detail');
const CLIP = { x: 792, y: 0, width: 648, height: 900 };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Umbral de "celda con tinta" idéntico al del render (§6.3 punto 5): L < 0.12 -> vacío. */
const INK = 0.12;

interface Metrics {
  cols: number;
  rows: number;
  cells: number;
  inked: number;
  sd: number;
  grad: number;
  hlPct: number;
  hlIsolated: number;
  hlChains: number;
  hlComps: number;
  entropy: number;
}

/** Lee el campo de luminancia por celda de la instancia viva y lo resume. */
async function metrics(page: Page): Promise<Metrics> {
  return page.evaluate((ink) => {
    const p = (window as unknown as { __asciiPortrait: Record<string, unknown> }).__asciiPortrait;
    const cols = p.cols as number;
    const rows = p.rows as number;
    const luma = p.luma as Float32Array;
    const highlight = p.highlight as Uint8Array;
    const chars = p.chars as string[];
    const total = cols * rows;

    let inked = 0;
    let sum = 0;
    for (let i = 0; i < total; i++) {
      const l = luma[i] ?? 0;
      if (l > ink) {
        inked++;
        sum += l;
      }
    }
    const mean = inked ? sum / inked : 0;

    let varSum = 0;
    for (let i = 0; i < total; i++) {
      const l = luma[i] ?? 0;
      if (l > ink) varSum += (l - mean) ** 2;
    }
    const sd = inked ? Math.sqrt(varSum / inked) : 0;

    // Gradiente local medio: |dL| a los vecinos derecha y abajo, solo entre celdas con tinta
    let gSum = 0;
    let gN = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const l = luma[i] ?? 0;
        if (l <= ink) continue;
        const r = luma[i + 1] ?? 0;
        const d = luma[i + cols] ?? 0;
        if (x + 1 < cols && r > ink) {
          gSum += Math.abs(l - r);
          gN++;
        }
        if (y + 1 < rows && d > ink) {
          gSum += Math.abs(l - d);
          gN++;
        }
      }
    }

    // Highlights: aislados (moteado) vs cadenas (borde estructural). Componentes conexos a 8.
    const seen = new Uint8Array(total);
    const sizes: number[] = [];
    let hl = 0;
    for (let i = 0; i < total; i++) if (highlight[i]) hl++;

    for (let s = 0; s < total; s++) {
      if (!highlight[s] || seen[s]) continue;
      let n = 0;
      const stack: number[] = [s];
      seen[s] = 1;
      while (stack.length) {
        const c = stack.pop() as number;
        n++;
        const cx = c % cols;
        const cy = (c / cols) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const j = ny * cols + nx;
            if (highlight[j] && !seen[j]) {
              seen[j] = 1;
              stack.push(j);
            }
          }
        }
      }
      sizes.push(n);
    }

    const isolated = sizes.filter((n) => n === 1).length;
    const inChains = sizes.filter((n) => n >= 4).reduce((a, b) => a + b, 0);

    // Entropía de la distribución de glifos: cuántos niveles distintos usa de verdad la rampa
    const freq = new Map<string, number>();
    for (let i = 0; i < total; i++) {
      if ((luma[i] ?? 0) <= ink) continue;
      const c = chars[i] ?? ' ';
      freq.set(c, (freq.get(c) ?? 0) + 1);
    }
    let H = 0;
    for (const n of freq.values()) {
      const q = n / inked;
      H -= q * Math.log2(q);
    }

    return {
      cols,
      rows,
      cells: total,
      inked,
      sd,
      grad: gN ? gSum / gN : 0,
      hlPct: inked ? (hl / inked) * 100 : 0,
      hlIsolated: hl ? (isolated / hl) * 100 : 0,
      hlChains: hl ? (inChains / hl) * 100 : 0,
      hlComps: sizes.length,
      entropy: H,
    };
  }, INK);
}

/** Copia cruda del campo de luminancia, para comparar dos configuraciones celda a celda. */
async function lumaOf(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from((window as unknown as { __asciiPortrait: { luma: Float32Array } }).__asciiPortrait.luma),
  );
}

function rms(a: number[], b: number[]): number {
  if (a.length !== b.length) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
  return Math.sqrt(s / a.length);
}

async function setOpts(page: Page, o: Record<string, number>): Promise<void> {
  await page.evaluate((opts) => {
    (window as unknown as { __asciiPortrait: { update: (o: unknown) => void } }).__asciiPortrait.update(opts);
  }, o);
  await sleep(140);
}

/**
 * Sustituye la foto por una versión degradada (downscale + upscale al tamaño original) y
 * re-muestrea. Simula tener una fuente de MENOS resolución; si el resultado no se mueve,
 * tener una de MÁS tampoco movería nada.
 */
async function degradeSource(page: Page, factor: number): Promise<void> {
  await page.evaluate((f) => {
    const p = (
      window as unknown as {
        __asciiPortrait: {
          image: CanvasImageSource & { width: number; height: number };
          __orig?: unknown;
          update: (o: unknown) => void;
        };
      }
    ).__asciiPortrait;
    p.__orig ??= p.image;
    const src = p.__orig as CanvasImageSource & { width: number; height: number };
    if (f >= 1) {
      p.image = src;
    } else {
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(src.width * f));
      small.height = Math.max(1, Math.round(src.height * f));
      small.getContext('2d')?.drawImage(src, 0, 0, small.width, small.height);
      const back = document.createElement('canvas');
      back.width = src.width;
      back.height = src.height;
      back.getContext('2d')?.drawImage(small, 0, 0, back.width, back.height);
      p.image = back;
    }
    p.update({});
  }, factor);
  await sleep(160);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  const report: string[] = [];
  const say = (s = ''): void => {
    console.log(s);
    report.push(s);
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

    const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
    await sleep(1800);
    await page.addStyleTag({ content: '.ascii-debug{visibility:hidden}' });

    const base = await metrics(page);
    const srcInfo = await page.evaluate(() => {
      const im = (window as unknown as { __asciiPortrait: { image: { width: number; height: number } } })
        .__asciiPortrait.image;
      return { w: im.width, h: im.height };
    });

    say(
      `GRID: ${base.cols} x ${base.rows} = ${base.cells} celdas · ${base.inked} con tinta (${((base.inked / base.cells) * 100).toFixed(1)} %)`,
    );
    say(`FUENTE: ${srcInfo.w} x ${srcInfo.h} px`);
    say(
      `MUESTREO: ${(srcInfo.h / base.rows).toFixed(2)} px de foto por celda (lineal) = ${((srcInfo.h / base.rows) ** 2).toFixed(0)} px por celda`,
    );
    say('');

    // ---------------------------------------------------------------- A) techo de la fuente
    say('== A) TECHO DE RESOLUCION DE LA FOTO ==');
    say('   Se degrada la fuente y se re-muestrea. RMS = diferencia de luminancia por celda');
    say('   contra la foto intacta (campo completo, escala 0-1).');
    say('');
    say('   fuente efectiva        px/celda   RMS vs 100%   sd       HL %');
    await setOpts(page, { smooth: 1.0, highlightDelta: 0.12 });
    await degradeSource(page, 1);
    const refLuma = await lumaOf(page);
    const refM = await metrics(page);

    for (const f of [1, 0.75, 0.5, 0.35, 0.25, 0.15]) {
      await degradeSource(page, f);
      const l = await lumaOf(page);
      const m = await metrics(page);
      const d = rms(l, refLuma);
      say(
        `   ${String(Math.round(srcInfo.w * f)).padStart(4)}x${String(Math.round(srcInfo.h * f)).padEnd(4)} (${String(Math.round(f * 100)).padStart(3)} %)     ${((srcInfo.h * f) / base.rows).toFixed(2).padStart(5)}      ${d.toFixed(4)}       ${m.sd.toFixed(4)}   ${m.hlPct.toFixed(1).padStart(5)}`,
      );
      if (f === 1 || f === 0.5 || f === 0.25)
        await page.screenshot({ path: join(OUT, `src-${Math.round(f * 100)}.png`), clip: CLIP });
    }
    await degradeSource(page, 1);
    say('');
    say(`   (intacta: sd ${refM.sd.toFixed(4)} · HL ${refM.hlPct.toFixed(1)} % · comps ${refM.hlComps})`);
    say('');

    // ---------------------------------------------------------------- B+C) barrido de blur
    say('== B+C) BARRIDO DE SUAVIZADO (hlDelta fijo en 0.12, el calibrado) ==');
    say('   RMS  = detalle destruido por el blur (contra smooth 0)');
    say('   sd   = amplitud del campo · grad = detalle local medio');
    say('   AISL = % de highlights sin ningun vecino highlight -> firma del moteado');
    say('   CAD  = % de highlights en cadenas >=4 celdas -> bordes estructurales');
    say('');
    await setOpts(page, { smooth: 0, highlightDelta: 0.12 });
    const zeroLuma = await lumaOf(page);

    say('   smooth   RMS vs 0    sd       grad     HL %    AISL %   CAD %   comps   entropia');
    for (const s of [0, 0.4, 0.6, 0.8, 1.0, 1.5, 2.0]) {
      await setOpts(page, { smooth: s, highlightDelta: 0.12 });
      const l = await lumaOf(page);
      const m = await metrics(page);
      say(
        `   ${s.toFixed(1).padStart(4)}     ${rms(l, zeroLuma).toFixed(4)}      ${m.sd.toFixed(4)}   ${m.grad.toFixed(4)}  ${m.hlPct.toFixed(1).padStart(5)}   ${m.hlIsolated.toFixed(1).padStart(5)}   ${m.hlChains.toFixed(1).padStart(5)}   ${String(m.hlComps).padStart(5)}   ${m.entropy.toFixed(2)}`,
      );
      await page.screenshot({ path: join(OUT, `blur-${s.toFixed(1)}.png`), clip: CLIP });
    }
    say('');

    // ---------------------------------------------------------------- D) parejas re-calibradas
    say('== D) BAJAR EL BLUR SUBIENDO EL UMBRAL ==');
    say('   Si una pareja con menos blur da el mismo % de highlights CON MENOS aislados,');
    say('   se puede recuperar detalle sin que vuelva el ruido de pelaje. Objetivo: 24 % (referencia).');
    say('');
    say('   smooth  hlDelta   HL %    AISL %   CAD %   grad     comps');
    const PAIRS = [
      { s: 1.0, d: 0.12 },
      { s: 0.8, d: 0.14 },
      { s: 0.6, d: 0.16 },
      { s: 0.6, d: 0.18 },
      { s: 0.4, d: 0.2 },
      { s: 0.4, d: 0.24 },
      { s: 0.0, d: 0.25 },
      { s: 0.0, d: 0.3 },
      { s: 0.0, d: 0.35 },
    ];
    for (const { s, d } of PAIRS) {
      await setOpts(page, { smooth: s, highlightDelta: d });
      const m = await metrics(page);
      say(
        `   ${s.toFixed(1).padStart(4)}    ${d.toFixed(2)}    ${m.hlPct.toFixed(1).padStart(5)}   ${m.hlIsolated.toFixed(1).padStart(5)}   ${m.hlChains.toFixed(1).padStart(5)}   ${m.grad.toFixed(4)}   ${String(m.hlComps).padStart(5)}`,
      );
      await page.screenshot({ path: join(OUT, `pair-s${s.toFixed(1)}-d${d.toFixed(2)}.png`), clip: CLIP });
    }

    await setOpts(page, { smooth: 1.0, highlightDelta: 0.12 });
    await browser.close();
    writeFileSync(join(OUT, 'report.txt'), report.join('\n'), 'utf8');
    console.log(`\nCapturas y report en ${OUT}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
