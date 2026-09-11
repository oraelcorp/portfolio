// scripts/measure-hocico-comps.ts — dos preguntas que el porcentaje no contesta.
//
// 1. ¿Sigue SALPICADO el rojo del hocico? El % de tinta roja no lo dice: 6 % concentrado en la
//    boca y 6 % repartido en veinte manchitas se ven completamente distintos. Aquí se cuentan
//    las componentes conexas del rojo YA RENDERIZADO, que es lo que ve el ojo.
// 2. ¿Aparecen los 11 colores de la rampa? Con 5 escalones, dos no salían nunca. Se comprueba
//    cuáles están presentes en pantalla, no cuántos tonos distintos hay.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4252;
const OUT = resolve('screenshots', 'paleta');
const T_FRAME = 4.0;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const VARIANTES: [string, string][] = [
  ['3x3 (antes)', '?glsnap=0&glhocicon=0'],
  ['5x5 n=12', '?glsnap=0&glhocicon=12'],
  ['5x5 n=16', '?glsnap=0&glhocicon=16'],
  ['5x5 n=20', '?glsnap=0&glhocicon=20'],
];
const ESCALONES: [string, string][] = [
  ['poster 5', '?glsnap=0&glposter=5'],
  ['poster 6', '?glsnap=0&glposter=6'],
  ['poster 7', '?glsnap=0&glposter=7'],
  ['poster 9', '?glsnap=0&glposter=9'],
  ['snap 11', '?glsnap=1'],
];

const preview = startPreview(PORT);
const L: string[] = [];
const say = (s = ''): void => {
  console.log(s);
  L.push(s);
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
  const b = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  const abrir = async (q: string) => {
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/${q}`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
      null,
      { timeout: 40_000 },
    );
    await page.evaluate(`(async (tt) => {
      const g = window.__asciiGL;
      g.frozen = true; g.source.pause();
      await new Promise((res) => { const on = () => { g.source.removeEventListener('seeked', on); res(); };
        g.source.addEventListener('seeked', on); g.source.currentTime = tt; setTimeout(on, 800); });
      g.colorBase = 1; g.colorTarget = 1; g.colorR = 1e6;
    })(${T_FRAME})`);
    await sleep(900);
    return page;
  };

  say('== ¿SIGUE SALPICADO EL ROJO? · componentes conexas del rojo ya renderizado ==');
  say('   filtro        celdas rojas   componentes   mayor   2ª    3ª   % en la mayor');
  for (const [nombre, q] of VARIANTES) {
    const page = await abrir(q);
    const r = (await page.evaluate(`(() => {
      const c = document.querySelector('[data-ascii]');
      const off = document.createElement('canvas');
      off.width = c.width; off.height = c.height;
      const x = off.getContext('2d', { willReadFrequently: true });
      x.drawImage(c, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      // A CELDAS de 8 px: una celda es roja si tiene algun pixel del acento.
      const cols = Math.floor(c.width / 8), rows = Math.floor(c.height / 8);
      const rojo = new Uint8Array(cols * rows);
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        let hay = 0;
        for (let j = 0; j < 8 && !hay; j++) for (let i = 0; i < 8; i++) {
          const p = ((cy * 8 + j) * c.width + cx * 8 + i) * 4;
          const R = d[p], G = d[p + 1], B = d[p + 2];
          if (R > 120 && G < R * 0.55 && B < R * 0.8 && B >= G) { hay = 1; break; }
        }
        rojo[cy * cols + cx] = hay;
      }
      const visto = new Int32Array(cols * rows).fill(-1);
      const tam = [];
      for (let s = 0; s < rojo.length; s++) {
        if (!rojo[s] || visto[s] !== -1) continue;
        const id = tam.length; let n = 0; const pila = [s]; visto[s] = id;
        while (pila.length) {
          const i = pila.pop(); n++;
          const cx = i % cols, cy = (i - cx) / cols;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const j = ny * cols + nx;
            if (rojo[j] && visto[j] === -1) { visto[j] = id; pila.push(j); }
          }
        }
        tam.push(n);
      }
      tam.sort((a, z) => z - a);
      const total = tam.reduce((a, z) => a + z, 0);
      return { total, comps: tam.length, top: tam.slice(0, 3) };
    })()`)) as { total: number; comps: number; top: number[] };
    say(
      `   ${nombre.padEnd(13)} ${String(r.total).padStart(12)}   ${String(r.comps).padStart(11)}   ${String(r.top[0] ?? 0).padStart(5)}  ${String(r.top[1] ?? 0).padStart(3)}  ${String(r.top[2] ?? 0).padStart(3)}   ${((100 * (r.top[0] ?? 0)) / Math.max(1, r.total)).toFixed(0).padStart(11)} %`,
    );
    await page.close();
  }

  say('');
  say('== ¿APARECEN LOS 11 COLORES? · presencia de cada punto de la rampa en pantalla ==');
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
  say('   escalones   ' + HEX.map((h) => h.slice(1, 4)).join('  '));
  for (const [nombre, q] of ESCALONES) {
    const page = await abrir(q);
    const pres = (await page.evaluate(`(() => {
      const RAMPA = [[0,0,0],[28,15,8],[66,31,9],[108,58,19],[152,88,26],[198,126,38],[223,172,80],[242,219,142],[151,142,125],[191,188,179],[241,240,234]];
      const c = document.querySelector('[data-ascii]');
      const off = document.createElement('canvas');
      off.width = c.width; off.height = c.height;
      const x = off.getContext('2d', { willReadFrequently: true });
      x.drawImage(c, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const cuenta = new Array(RAMPA.length).fill(0);
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i+1], B = d[i+2];
        if (R + G + B < 40) continue;
        // El alpha del canvas premultiplica: se compara por PROPORCION, no por valor absoluto.
        let mejor = -1, dist = 1e9;
        const mx = Math.max(R, G, B) || 1;
        for (let k = 0; k < RAMPA.length; k++) {
          const m2 = Math.max(RAMPA[k][0], RAMPA[k][1], RAMPA[k][2]) || 1;
          const dd = Math.abs(R/mx - RAMPA[k][0]/m2) + Math.abs(G/mx - RAMPA[k][1]/m2) + Math.abs(B/mx - RAMPA[k][2]/m2);
          if (dd < dist) { dist = dd; mejor = k; }
        }
        if (dist < 0.10) cuenta[mejor]++;
      }
      return cuenta;
    })()`)) as number[];
    say(`   ${nombre.padEnd(11)} ` + pres.map((n) => (n > 300 ? '  SÍ' : '  --')).join('  '));
    await page.close();
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'hocico-comps.txt'), L.join('\n'), 'utf8');
  await b.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
