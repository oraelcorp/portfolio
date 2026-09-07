// scripts/palette-regions.ts — Fase 8, parte 1(c): ¿hay regiones (boca, colmillos, ojo) que se
// puedan aislar con la información que YA tenemos, o hace falta segmentar aparte?
//
// El histograma de luminancia dijo que las bandas están entrelazadas espacialmente (todos los
// centroides en el mismo punto), así que aquí se buscan otras señales: tono, saturación y el
// flag de contraste local. Se pintan como mapas para poder MIRARLOS, que es la única forma de
// saber si un cúmulo corresponde a la boca o es ruido repartido por el pelaje.

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4221;
const URL = `http://localhost:${PORT}/?debug`;
const OUT = resolve('screenshots', 'palette');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  await waitForServer();
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
  await sleep(1500);

  const stats = await page.evaluate(() => {
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
    if (!p) throw new Error('sin instancia');
    const { cols, rows, luma, rgb, highlight } = p;

    const hs = (r: number, g: number, b: number): { h: number; s: number } => {
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
      return { h, s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)) };
    };

    const ESC = 7;
    const cv = document.createElement('canvas');
    cv.width = cols * ESC * 5 + 30 * 4;
    cv.height = rows * ESC + 26;
    cv.id = 'mapa';
    cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#0b0b0b';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    if (!g) throw new Error('sin 2d');
    g.fillStyle = '#0b0b0b';
    g.fillRect(0, 0, cv.width, cv.height);
    g.font = '12px monospace';

    // Cortes de Otsu para 4 bandas, medidos en recon-palette.ts
    const CORTES = [0.328, 0.523, 0.727];
    const BANDA = ['#1f4fd8', '#12a150', '#e8a33d', '#ffffff'];

    const hueHist = new Array<number>(36).fill(0);
    const satHist = new Array<number>(20).fill(0);
    let rojizas = 0;
    let sumRojX = 0;
    let sumRojY = 0;

    const panel = (idx: number, titulo: string, color: (i: number) => string | null): void => {
      const x0 = idx * (cols * ESC + 30);
      g.fillStyle = '#9a9a9a';
      g.fillText(titulo, x0, 14);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const c = color(i);
          if (!c) continue;
          g.fillStyle = c;
          g.fillRect(x0 + x * ESC, 26 + y * ESC, ESC - 1, ESC - 1);
        }
      }
    };

    for (let i = 0; i < cols * rows; i++) {
      const l = luma[i] ?? 0;
      if (l < 0.12) continue;
      const { h, s } = hs(rgb[i * 3] ?? 0, rgb[i * 3 + 1] ?? 0, rgb[i * 3 + 2] ?? 0);
      hueHist[Math.min(35, Math.floor(h / 10))] = (hueHist[Math.min(35, Math.floor(h / 10))] ?? 0) + 1;
      satHist[Math.min(19, Math.floor(s * 20))] = (satHist[Math.min(19, Math.floor(s * 20))] ?? 0) + 1;
      // "Rojizo" = tono fuera del pardo dominante y con algo de saturación
      if ((h < 14 || h > 340) && s > 0.25) {
        rojizas++;
        sumRojX += (i % cols) / cols;
        sumRojY += Math.floor(i / cols) / rows;
      }
    }

    // Una region compacta tiene DISPERSION espacial pequena; el ruido de pelaje se reparte
    // por todo el sujeto y da una dispersion parecida a la del sujeto entero. Ese cociente es
    // lo que decide si el hocico es una region aislable o solo celdas sueltas con otro tono.
    const magenta: number[] = [];
    const todas: number[] = [];
    for (let i = 0; i < cols * rows; i++) {
      const l = luma[i] ?? 0;
      if (l < 0.12) continue;
      todas.push(i);
      const { h } = hs(rgb[i * 3] ?? 0, rgb[i * 3 + 1] ?? 0, rgb[i * 3 + 2] ?? 0);
      if (h >= 300 || h < 10) magenta.push(i);
    }
    const disp = (idx: number[]): { cx: number; cy: number; sx: number; sy: number } => {
      const n = idx.length || 1;
      const xs = idx.map((i) => (i % cols) / cols);
      const ys = idx.map((i) => Math.floor(i / cols) / rows);
      const cx = xs.reduce((a, b) => a + b, 0) / n;
      const cy = ys.reduce((a, b) => a + b, 0) / n;
      return {
        cx,
        cy,
        sx: Math.sqrt(xs.reduce((a, b) => a + (b - cx) ** 2, 0) / n),
        sy: Math.sqrt(ys.reduce((a, b) => a + (b - cy) ** 2, 0) / n),
      };
    };
    const dMag = disp(magenta);
    const dTodo = disp(todas);
    const setMag = new Set(magenta);

    panel(0, 'luminancia', (i) => {
      const l = luma[i] ?? 0;
      if (l < 0.12) return null;
      const v = Math.round(l * 255);
      return `rgb(${v},${v},${v})`;
    });
    panel(1, 'banda de Otsu (k=4)', (i) => {
      const l = luma[i] ?? 0;
      if (l < 0.12) return null;
      const b = l < (CORTES[0] ?? 0) ? 0 : l < (CORTES[1] ?? 0) ? 1 : l < (CORTES[2] ?? 0) ? 2 : 3;
      return BANDA[b] ?? '#fff';
    });
    panel(2, 'tono de la foto', (i) => {
      const l = luma[i] ?? 0;
      if (l < 0.12) return null;
      const { h, s } = hs(rgb[i * 3] ?? 0, rgb[i * 3 + 1] ?? 0, rgb[i * 3 + 2] ?? 0);
      return `hsl(${h}, ${Math.round(s * 100)}%, 50%)`;
    });
    panel(3, 'contraste local (highlight)', (i) => {
      const l = luma[i] ?? 0;
      if (l < 0.12) return null;
      return highlight[i] === 1 ? '#ffffff' : '#2a2a2a';
    });

    panel(4, 'tono magenta (300-10 grados)', (i) => {
      const l = luma[i] ?? 0;
      if (l < 0.12) return null;
      return setMag.has(i) ? '#ff2f6d' : '#242424';
    });

    return {
      cols,
      rows,
      magenta: magenta.length,
      dMag,
      dTodo,
      hueHist,
      satHist,
      rojizas,
      centroRojo: rojizas > 0 ? { x: sumRojX / rojizas, y: sumRojY / rojizas } : null,
      w: cv.width,
      h: cv.height,
    };
  });

  await page.locator('#mapa').screenshot({ path: join(OUT, 'mapas.png') });

  console.log(`rejilla ${stats.cols} × ${stats.rows}\n`);
  console.log('Tono de la foto, celdas por cada 10°:');
  const maxH = Math.max(...stats.hueHist);
  stats.hueHist.forEach((v, i) => {
    if (v > 0) {
      const barra = '█'.repeat(Math.max(1, Math.round((v / maxH) * 40)));
      console.log(
        `  ${String(i * 10).padStart(3)}°–${String(i * 10 + 10).padStart(3)}°  ${String(v).padStart(5)}  ${barra}`,
      );
    }
  });

  console.log('\nSaturación de la foto, celdas por cada 0.05:');
  const maxS = Math.max(...stats.satHist);
  stats.satHist.forEach((v, i) => {
    if (v > 0) {
      const barra = '█'.repeat(Math.max(1, Math.round((v / maxS) * 40)));
      console.log(
        `  ${(i / 20).toFixed(2)}–${((i + 1) / 20).toFixed(2)}  ${String(v).padStart(5)}  ${barra}`,
      );
    }
  });

  console.log(
    `\nCeldas "rojizas" (tono <14° o >340° con sat > 0.25): ${stats.rojizas}` +
      (stats.centroRojo
        ? ` · centro x${stats.centroRojo.x.toFixed(2)} y${stats.centroRojo.y.toFixed(2)}`
        : ''),
  );
  console.log(`\n→ ${join(OUT, 'mapas.png')}`);

  console.log(`
Mancha magenta (tono 300-10 grados, SIN filtrar saturacion): ${stats.magenta} celdas`);
  console.log(
    `  centro x${stats.dMag.cx.toFixed(2)} y${stats.dMag.cy.toFixed(2)}  dispersion sx ${stats.dMag.sx.toFixed(3)} sy ${stats.dMag.sy.toFixed(3)}`,
  );
  console.log(
    `  sujeto x${stats.dTodo.cx.toFixed(2)} y${stats.dTodo.cy.toFixed(2)}  dispersion sx ${stats.dTodo.sx.toFixed(3)} sy ${stats.dTodo.sy.toFixed(3)}`,
  );
  const rel = (stats.dMag.sx + stats.dMag.sy) / (stats.dTodo.sx + stats.dTodo.sy);
  console.log(
    `  dispersion relativa ${rel.toFixed(2)} (cerca de 1 = repartido; mucho menor = region compacta)`,
  );

  await browser.close();
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
