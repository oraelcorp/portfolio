// scripts/recon-palette.ts — Fase 8, parte 1(a): mide el histograma de luminancia POR CELDA
// de nuestro portrait.png y busca dónde caen los cortes naturales del sujeto.
//
// Los datos salen de la instancia viva del retrato (`?debug`), no de un muestreo propio: son
// exactamente los mismos `luma`/`rgb`/`highlight` que el renderizador usa para pintar, así que
// cualquier banda que se derive de aquí cae donde debe cuando se aplique.
//
// Los cortes NO se eligen a ojo: se calculan con Otsu multinivel, que busca los umbrales que
// maximizan la varianza ENTRE clases (equivalente a minimizar la de dentro). Es el método
// estándar para "dónde se separa solo este histograma".

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4220;
const URL = `http://localhost:${PORT}/?debug`;
const OUT = resolve('screenshots', 'palette');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const BINS = 128;
/** Por debajo de esto el renderizador no dibuja la celda: no es parte del sujeto. */
const INK = 0.12;

interface Celdas {
  cols: number;
  rows: number;
  luma: number[];
  rgb: number[];
  highlight: number[];
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      /* aún no */
    }
    await sleep(400);
  }
  throw new Error(`El preview no respondió en ${URL}`);
}

async function leerCeldas(page: Page): Promise<Celdas> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __asciiPortrait?: {
        cols: number;
        rows: number;
        luma: Float32Array;
        rgb: Uint8ClampedArray;
        highlight: Uint8Array;
      };
    };
    const p = w.__asciiPortrait;
    if (!p) throw new Error('sin instancia (¿falta ?debug?)');
    return {
      cols: p.cols,
      rows: p.rows,
      luma: Array.from(p.luma),
      rgb: Array.from(p.rgb),
      highlight: Array.from(p.highlight),
    };
  });
}

/**
 * Otsu multinivel: devuelve los `k-1` umbrales que parten el histograma en `k` clases
 * maximizando la varianza entre clases. Búsqueda exhaustiva sobre `BINS` niveles — con 128
 * bins y hasta 4 cortes son unos pocos millones de combinaciones, que en Node sobra.
 */
function otsu(hist: number[], k: number): { cortes: number[]; varianza: number } {
  const n = hist.length;
  // Momentos acumulados para poder evaluar cualquier intervalo en O(1)
  const p: number[] = [0];
  const s: number[] = [0];
  for (let i = 0; i < n; i++) {
    p.push((p[i] ?? 0) + (hist[i] ?? 0));
    s.push((s[i] ?? 0) + i * (hist[i] ?? 0));
  }
  const total = p[n] ?? 0;
  if (total === 0) return { cortes: [], varianza: 0 };

  /** Varianza entre clases que aporta el intervalo [a, b). */
  const aporte = (a: number, b: number): number => {
    const w = (p[b] ?? 0) - (p[a] ?? 0);
    if (w === 0) return 0;
    const m = ((s[b] ?? 0) - (s[a] ?? 0)) / w;
    return (w / total) * m * m;
  };

  let mejor = -1;
  let mejores: number[] = [];
  const cortes = new Array<number>(k - 1).fill(0);

  const buscar = (nivel: number, desde: number): void => {
    if (nivel === k - 1) {
      let v = 0;
      let a = 0;
      for (const c of cortes) {
        v += aporte(a, c);
        a = c;
      }
      v += aporte(a, n);
      if (v > mejor) {
        mejor = v;
        mejores = [...cortes];
      }
      return;
    }
    for (let c = desde; c <= n - (k - 1 - nivel); c++) {
      cortes[nivel] = c;
      buscar(nivel + 1, c + 1);
    }
  };
  buscar(0, 1);
  return { cortes: mejores, varianza: mejor };
}

function sparkline(hist: number[], ancho = 96): string {
  const paso = Math.ceil(hist.length / ancho);
  const barras = ' ▁▂▃▄▅▆▇█';
  const agrup: number[] = [];
  for (let i = 0; i < hist.length; i += paso) {
    agrup.push(hist.slice(i, i + paso).reduce((a, b) => a + b, 0));
  }
  const max = Math.max(...agrup, 1);
  return agrup.map((v) => barras[Math.min(8, Math.round((v / max) * 8))] ?? ' ').join('');
}

/** HSL aproximado, solo el tono y la saturación, que es lo que interesa aquí. */
function hs(r: number, g: number, b: number): { h: number; s: number } {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  await waitForServer();
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
  await sleep(1500);

  const c = await leerCeldas(page);
  const total = c.cols * c.rows;
  console.log(`rejilla ${c.cols} × ${c.rows} = ${total} celdas`);

  // Solo las celdas que el renderizador dibuja: el resto es fondo, y meterlo en el
  // histograma pondría un pico enorme en 0 que se comería todos los cortes.
  const tinta: number[] = [];
  for (let i = 0; i < total; i++) {
    const l = c.luma[i] ?? 0;
    if (l >= INK) tinta.push(i);
  }
  console.log(
    `con tinta (luma ≥ ${INK}): ${tinta.length} (${((tinta.length / total) * 100).toFixed(1)} %)\n`,
  );

  const hist = new Array<number>(BINS).fill(0);
  for (const i of tinta) {
    const b = Math.min(BINS - 1, Math.floor((c.luma[i] ?? 0) * BINS));
    hist[b] = (hist[b] ?? 0) + 1;
  }
  console.log('Histograma de luminancia (solo celdas con tinta), 0 → 1:');
  console.log(`  ${sparkline(hist)}`);
  console.log(`  ${'0'.padEnd(24)}${'0.25'.padEnd(24)}${'0.5'.padEnd(24)}${'0.75'.padEnd(23)}1\n`);

  // Percentiles: dicen dónde está la masa, independientemente de los cortes
  const ordenadas = tinta.map((i) => c.luma[i] ?? 0).sort((a, b) => a - b);
  const pct = (q: number): number => ordenadas[Math.floor(q * (ordenadas.length - 1))] ?? 0;
  console.log(
    `Percentiles: p10 ${pct(0.1).toFixed(3)} · p25 ${pct(0.25).toFixed(3)} · mediana ${pct(0.5).toFixed(3)} · ` +
      `p75 ${pct(0.75).toFixed(3)} · p90 ${pct(0.9).toFixed(3)} · máx ${pct(1).toFixed(3)}\n`,
  );

  const resultados: Record<string, unknown> = { cols: c.cols, rows: c.rows, conTinta: tinta.length };

  for (const k of [3, 4, 5]) {
    const { cortes, varianza } = otsu(hist, k);
    const umbrales = cortes.map((x) => x / BINS);
    console.log(
      `── ${k} bandas · cortes en ${umbrales.map((u) => u.toFixed(3)).join(' / ')}  (σ²entre = ${varianza.toFixed(4)})`,
    );

    const limites = [INK, ...umbrales, 1.0001];
    const bandas: Array<Record<string, number | string>> = [];
    for (let b = 0; b < k; b++) {
      const lo = limites[b] ?? 0;
      const hi = limites[b + 1] ?? 1;
      const cells = tinta.filter((i) => {
        const l = c.luma[i] ?? 0;
        return l >= lo && l < hi;
      });
      if (cells.length === 0) continue;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sx = 0;
      let sy = 0;
      let hi_n = 0;
      for (const i of cells) {
        sr += c.rgb[i * 3] ?? 0;
        sg += c.rgb[i * 3 + 1] ?? 0;
        sb += c.rgb[i * 3 + 2] ?? 0;
        sx += (i % c.cols) / c.cols;
        sy += Math.floor(i / c.cols) / c.rows;
        if (c.highlight[i] === 1) hi_n++;
      }
      const n = cells.length;
      const { h, s } = hs(sr / n, sg / n, sb / n);
      const fila = {
        banda: b,
        rango: `${lo.toFixed(3)}–${hi >= 1 ? '1.000' : hi.toFixed(3)}`,
        celdas: n,
        pct: `${((n / tinta.length) * 100).toFixed(1)} %`,
        rgbMedio: `#${[sr / n, sg / n, sb / n].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`,
        tono: `${h.toFixed(0)}°`,
        sat: s.toFixed(2),
        centro: `x${(sx / n).toFixed(2)} y${(sy / n).toFixed(2)}`,
        highlights: `${((hi_n / n) * 100).toFixed(0)} %`,
      };
      bandas.push(fila);
      console.log(
        `     banda ${b}  ${fila.rango}  ${String(n).padStart(5)} celdas (${String(fila.pct).padStart(6)})  ` +
          `foto ${fila.rgbMedio} tono ${String(fila.tono).padStart(4)} sat ${fila.sat}  ` +
          `centro ${fila.centro}  highlights ${String(fila.highlights).padStart(4)}`,
      );
    }
    resultados[`k${k}`] = { umbrales, varianza, bandas };
    console.log('');
  }

  writeFileSync(join(OUT, 'histograma.json'), JSON.stringify(resultados, null, 2));
  console.log(`→ ${join(OUT, 'histograma.json')}`);

  await browser.close();
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
