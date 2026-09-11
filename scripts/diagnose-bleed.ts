// scripts/diagnose-bleed.ts — ¿por qué la sangría se ve como un círculo?
//
// Javier lo ve redondo en vivo. Hay dos hipótesis y hay que separarlas ANTES de tocar nada:
//
//   A) La máscara de conectividad YA es irregular y lo que la redondea es el alpha, porque
//      `objetivo = tono * borde * (1 - d/R)` multiplica por un cono radial perfecto sobre la
//      distancia EN LÍNEA RECTA al cursor.
//   B) La máscara ya es un disco desde el origen, y entonces el problema está antes, en el
//      paso de conectividad / tolerancia tonal.
//
// Se pintan tres mapas sobre la misma rejilla:
//   1. INTENSIDAD actual — lo que se ve hoy.
//   2. MÁSCARA BINARIA de lo actual — las mismas celdas, sin degradado. Si esto es un disco,
//      estamos en (B).
//   3. PROPAGACIÓN PURA — BFS desde la celda del cursor aplicando tono y borde pero SIN el
//      término radial, coloreada por número de pasos. Es la forma que la conectividad daría
//      si el alpha no la aplastara, y a la vez el dato que necesita el arreglo propuesto
//      (decaer por orden de propagación en vez de por distancia recta).

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4205;
const OUT = resolve('screenshots', 'gl');
const ESCALA = 4;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Mismas constantes que el shader
const BLEED_TONE = 3.2;
const BLEED_EDGE = 1.4;
const BLEED_CELLS = 26;
const CORTE = 0.02;

interface Campo {
  cols: number;
  rows: number;
  luma: number[];
  bleed: number[];
  px: number;
  py: number;
}

/** Guarda un mapa de la rejilla como PNG, ampliado por vecino más cercano. */
function guardarMapa(
  nombre: string,
  cols: number,
  rows: number,
  color: (i: number) => [number, number, number],
): string {
  const raw = Buffer.alloc(cols * rows * 4);
  for (let i = 0; i < cols * rows; i++) {
    const [r, g, b] = color(i);
    raw[i * 4] = r;
    raw[i * 4 + 1] = g;
    raw[i * 4 + 2] = b;
    raw[i * 4 + 3] = 255;
  }
  const bin = join(OUT, `${nombre}.rgba`);
  const png = join(OUT, `${nombre}.png`);
  writeFileSync(bin, raw);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${cols}x${rows}`,
    '-i',
    bin,
    '-vf',
    `scale=${cols * ESCALA}:${rows * ESCALA}:flags=neighbor`,
    png,
    '-y',
  ]);
  return png;
}

/**
 * BFS de propagación SIN el término radial. Devuelve, por celda, en cuántos pasos de
 * conectividad llegó el frente (-1 = nunca llegó).
 */
function propagacionPura(c: Campo): { pasos: number[]; alcanzadas: number } {
  const { cols, rows, luma } = c;
  const total = cols * rows;
  const pasos = new Array<number>(total).fill(-1);
  const cx = Math.round(c.px);
  const cy = Math.round(c.py);
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return { pasos, alcanzadas: 0 };

  const seed = luma[cy * cols + cx] ?? 0;
  const inicio = cy * cols + cx;
  pasos[inicio] = 0;
  let frente = [inicio];
  let paso = 0;
  let alcanzadas = 1;

  // El tope de 26 celdas del shader es un radio; aquí se usa como tope de PASOS, que es el
  // equivalente geodésico y lo único que evita que el derrame se coma el retrato entero.
  while (frente.length > 0 && paso < BLEED_CELLS) {
    paso++;
    const siguiente: number[] = [];
    for (const i of frente) {
      const x = i % cols;
      const y = (i / cols) | 0;
      const li = luma[i] ?? 0;
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as Array<[number, number]>) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (pasos[j] !== -1) continue;
        const lj = luma[j] ?? 0;
        const tono = Math.exp(-BLEED_TONE * Math.abs(lj - seed));
        const borde = Math.exp(-BLEED_EDGE * Math.abs(lj - li));
        // Sin (1 - d/R): solo tono y freno de borde deciden si el frente pasa.
        if (tono * borde < CORTE) continue;
        pasos[j] = paso;
        siguiente.push(j);
        alcanzadas++;
      }
    }
    frente = siguiente;
  }
  return { pasos, alcanzadas };
}

/** Cuánto se aleja una máscara de ser un disco del mismo área centrado en el cursor. */
function irregularidad(mask: boolean[], cols: number, rows: number, px: number, py: number) {
  let n = 0;
  for (const m of mask) if (m) n++;
  if (n === 0) return { n: 0, radioEquiv: 0, fuera: 0, pctFuera: 0, alcance: [] as number[] };

  const radioEquiv = Math.sqrt(n / Math.PI);
  let fuera = 0;
  for (let i = 0; i < cols * rows; i++) {
    if (!mask[i]) continue;
    const d = Math.hypot((i % cols) - px, ((i / cols) | 0) - py);
    if (d > radioEquiv) fuera++;
  }

  const pasos: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  const alcance = pasos.map(([dx, dy]) => {
    let k = 0;
    for (let s = 1; s <= 60; s++) {
      const x = Math.round(px) + dx * s;
      const y = Math.round(py) + dy * s;
      if (x < 0 || y < 0 || x >= cols || y >= rows) break;
      if (!mask[y * cols + x]) break;
      k = s;
    }
    return k;
  });

  return { n, radioEquiv, fuera, pctFuera: (fuera / n) * 100, alcance };
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
    await sleep(400);

    const box = await page.evaluate(() => {
      const r = document.querySelector<HTMLCanvasElement>('[data-ascii]')?.getBoundingClientRect();
      return { x: r?.x ?? 0, y: r?.y ?? 0, w: r?.width ?? 0, h: r?.height ?? 0 };
    });
    const mx = box.x + box.w * 0.62;
    const my = box.y + box.h * 0.62;

    let sobre = false;
    for (let i = 0; i < 12 && !sobre; i++) {
      await page.mouse.move(mx + (i % 2), my, { steps: 8 });
      await sleep(250);
      sobre = await page.evaluate(
        () => (window as unknown as { __asciiGL?: { hasPointer: boolean } }).__asciiGL?.hasPointer === true,
      );
    }
    if (!sobre) throw new Error('el puntero no llegó al canvas');
    await sleep(2500);

    const campo: Campo = await page.evaluate(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const g = (window as any).__asciiGL;
      const gl = document.querySelector<HTMLCanvasElement>('[data-ascii]')?.getContext('webgl2');
      if (!gl) throw new Error('sin webgl2');
      const w = g.cols as number;
      const h = g.rows as number;

      const leer = (fbo: WebGLFramebuffer): Uint8Array => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        const b = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return b;
      };

      const bl = leer(g.bleedFbo[g.bleedSrc]);
      const lu = leer(g.fbo);
      const luma: number[] = [];
      const bleed: number[] = [];
      for (let i = 0; i < w * h; i++) {
        luma.push((lu[i * 4 + 3] ?? 0) / 255);
        bleed.push((bl[i * 4] ?? 0) / 255);
      }
      return { cols: w, rows: h, luma, bleed, px: g.pointerX as number, py: g.pointerY as number };
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });
    // ---- MISMA MÉTRICA sobre el Canvas 2D, del que se copió la regla. Sin esto no se sabe
    // si hay que restaurar un comportamiento que existía o construir uno que nunca existió.
    const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    let campo2D: Campo | null = null;
    try {
      await page2.goto(`http://localhost:${PORT}/?debug`, { waitUntil: 'load' });
      await page2.waitForFunction(() => !document.querySelector('[data-preloader]'), null, {
        timeout: 20_000,
      });
      await page2.waitForFunction(
        () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.reveal === '1.000',
        null,
        { timeout: 25_000 },
      );
      await page2.evaluate(() => window.scrollTo(0, 0));
      await sleep(700);
      await page2.evaluate(() => window.scrollTo(0, 0));
      await sleep(400);
      const b2box = await page2.evaluate(() => {
        const r = document.querySelector<HTMLCanvasElement>('[data-ascii]')?.getBoundingClientRect();
        return { x: r?.x ?? 0, y: r?.y ?? 0, w: r?.width ?? 0, h: r?.height ?? 0 };
      });
      let s2 = false;
      for (let i = 0; i < 12 && !s2; i++) {
        await page2.mouse.move(b2box.x + b2box.w * 0.62 + (i % 2), b2box.y + b2box.h * 0.62, { steps: 8 });
        await sleep(250);
        s2 = await page2.evaluate(
          () =>
            (window as unknown as { __asciiPortrait?: { hasPointer: boolean } }).__asciiPortrait
              ?.hasPointer === true,
        );
      }
      if (s2) {
        await sleep(2500);
        campo2D = await page2.evaluate(() => {
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          const p = (window as any).__asciiPortrait;
          return {
            cols: p.cols as number,
            rows: p.rows as number,
            luma: Array.from(p.luma as Float32Array),
            bleed: Array.from(p.bleed as Float32Array),
            px: p.pointerX as number,
            py: p.pointerY as number,
          };
        });
      }
    } finally {
      await page2.close();
    }

    await browser.close();

    const { cols, rows } = campo;
    say('== DIAGNÓSTICO DE LA SANGRÍA ==');
    say(`   rejilla ${cols}x${rows} · cursor en celda (${campo.px.toFixed(0)}, ${campo.py.toFixed(0)})`);
    say('');

    // 1) intensidad actual
    const m1 = guardarMapa('bleed-1-intensidad', cols, rows, (i) => {
      const v = campo.bleed[i] ?? 0;
      const c = Math.round(v * 255);
      return [c, Math.round(c * 0.7), 20];
    });

    // 2) máscara binaria de lo actual
    const maskActual = campo.bleed.map((v) => v > CORTE);
    const m2 = guardarMapa('bleed-2-mascara', cols, rows, (i) =>
      maskActual[i] ? [255, 190, 60] : [16, 16, 18],
    );
    const irrA = irregularidad(maskActual, cols, rows, campo.px, campo.py);

    // 3) propagación pura, por número de pasos
    const { pasos, alcanzadas } = propagacionPura(campo);
    const maskPura = pasos.map((p) => p >= 0);
    const irrB = irregularidad(maskPura, cols, rows, campo.px, campo.py);
    const m3 = guardarMapa('bleed-3-propagacion', cols, rows, (i) => {
      const p = pasos[i] ?? -1;
      if (p < 0) return [16, 16, 18];
      const t = 1 - p / BLEED_CELLS;
      return [Math.round(60 + 195 * t), Math.round(40 + 150 * t), Math.round(20 + 40 * t)];
    });

    const fmt = (r: ReturnType<typeof irregularidad>): void => {
      say(`     celdas encendidas: ${r.n}`);
      say(`     radio del disco de igual área: ${r.radioEquiv.toFixed(1)} celdas`);
      say(`     celdas FUERA de ese disco: ${r.fuera} (${r.pctFuera.toFixed(1)} %)`);
      say(
        `     alcance por dirección: ${r.alcance.join(', ')} (min ${Math.min(...r.alcance)}, max ${Math.max(...r.alcance)})`,
      );
    };

    say('   [2] MÁSCARA BINARIA de la sangría ACTUAL:');
    fmt(irrA);
    say('');
    say('   [3] PROPAGACIÓN PURA (tono + borde, SIN el término radial):');
    fmt(irrB);
    say(`     celdas alcanzadas por el BFS: ${alcanzadas}`);
    if (campo2D) {
      const m2d = campo2D.bleed.map((v) => v > CORTE);
      const irr2d = irregularidad(m2d, campo2D.cols, campo2D.rows, campo2D.px, campo2D.py);
      say('');
      say('   [4] CANVAS 2D — misma métrica sobre la implementación de la que se copió la regla:');
      fmt(irr2d);
      guardarMapa('bleed-4-canvas2d', campo2D.cols, campo2D.rows, (i) =>
        m2d[i] ? [120, 220, 255] : [16, 16, 18],
      );
    } else {
      say('');
      say('   [4] CANVAS 2D — no se pudo medir (el puntero no llegó al canvas).');
    }
    say('');
    say('   Un disco perfecto daría ~0 % de celdas fuera del disco de igual área y un alcance');
    say('   parecido en las 8 direcciones. Cuanto mayor el % y la dispersión, más irregular.');

    // hoja de contactos
    const b2 = await chromium.launch({ channel: 'chrome' });
    const p2 = await b2.newPage({ viewport: { width: 2100, height: 1050 }, deviceScaleFactor: 1 });
    const url = (f: string): string => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
    await p2.setContent(
      `<!doctype html><meta charset="utf-8"><style>
        body{margin:0;background:#0b0b0b;font-family:ui-monospace,monospace}
        .w{display:flex;gap:14px;padding:14px}
        figure{margin:0;flex:1}
        figcaption{color:#eee;font-size:13px;padding:0 0 8px}
        figcaption b{color:#39ff6a;font-weight:500}
        figcaption span{display:block;color:#818081;font-size:11px;margin-top:3px}
        img{width:100%;display:block;border:1px solid rgba(238,238,238,.14);image-rendering:pixelated}
      </style><div class="w">
        <figure><figcaption><b>1. intensidad actual</b><span>lo que se ve hoy: valor de la sangría por celda</span></figcaption><img src="${url(m1)}"></figure>
        <figure><figcaption><b>2. máscara binaria</b><span>las mismas celdas, sin degradado — ${irrA.pctFuera.toFixed(0)} % fuera del disco de igual área</span></figcaption><img src="${url(m2)}"></figure>
        <figure><figcaption><b>3. propagación pura</b><span>BFS sin término radial, color por nº de pasos — ${irrB.pctFuera.toFixed(0)} % fuera</span></figcaption><img src="${url(m3)}"></figure>
      </div>`,
      { waitUntil: 'load' },
    );
    const w = await p2.$('.w');
    await w?.screenshot({ path: join(OUT, 'DIAGNOSTICO-SANGRIA.png') });
    await b2.close();

    writeFileSync(join(OUT, 'diagnose-bleed.txt'), report.join('\n'), 'utf8');
    console.log(`\n${join(OUT, 'DIAGNOSTICO-SANGRIA.png')}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
