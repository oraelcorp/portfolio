// scripts/check-gl-bleed.ts — checkpoint 2.3: sangría orgánica + onda de color en el shader.
//
// Lo que hay que verificar de la sangría NO es que aparezca color, sino que **siga la forma
// del sujeto**. La firma medida en el Canvas 2D (CLAUDE.md, 2026-09-04) es un alcance de
// **7 a 21 celdas según la dirección** — un factor 3. Un disco limpio, con alcance parecido en
// todas las direcciones, significaría que la conectividad por tolerancia tonal no está
// funcionando y que solo estamos pintando un círculo.
//
// Se lee la textura de sangría directamente con `readPixels` sobre su FBO: es el estado real
// del autómata, sin pasar por el render ni por el alpha de las celdas.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { confirmarPuntero } from './lib/pointer.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4202;
const OUT = resolve('screenshots', 'gl');
const VIEW = { width: 1440, height: 900 };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function dataUrl(file: string): string {
  return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
}

async function compose(
  page: Page,
  panels: Array<{ title: string; sub: string; img: string }>,
  out: string,
): Promise<void> {
  const html = `<!doctype html><meta charset="utf-8"><style>
    :root { color-scheme: dark; }
    body { margin:0; background:#0b0b0b; font-family: ui-monospace, monospace; }
    .wrap { display:flex; gap:14px; padding:14px; }
    figure { margin:0; flex:1; }
    figcaption { color:#eee; font-size:13px; padding:0 0 8px; letter-spacing:-0.02em; }
    figcaption b { color:#39ff6a; font-weight:500; }
    figcaption span { display:block; color:#818081; font-size:11px; margin-top:3px; }
    img { width:100%; display:block; border:1px solid rgba(238,238,238,.14); }
  </style><div class="wrap">
    ${panels
      .map(
        (p) =>
          `<figure><figcaption><b>${p.title}</b><span>${p.sub}</span></figcaption><img src="${p.img}"></figure>`,
      )
      .join('')}
  </div>`;
  await page.setContent(html, { waitUntil: 'load' });
  const wrap = await page.$('.wrap');
  await wrap?.screenshot({ path: out });
}

/** Alcance de la sangría en 8 direcciones desde la celda del puntero, leído del FBO. */
interface Reach {
  dirs: number[];
  teñidas: number;
  max: number;
  min: number;
  cx: number;
  cy: number;
  centro: number[];
  valorMax: number;
  enPuntero: number;
}

async function reach(page: Page): Promise<Reach> {
  return page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const g = (window as any).__asciiGL;
    const gl = document.querySelector<HTMLCanvasElement>('[data-ascii]')?.getContext('webgl2');
    if (!gl) throw new Error('sin webgl2');
    const w = g.cols as number;
    const h = g.rows as number;
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.bleedFbo[g.bleedSrc]);
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const at = (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      return (buf[(y * w + x) * 4] ?? 0) / 255;
    };

    const cx = Math.round(g.pointerX as number);
    const cy = Math.round(g.pointerY as number);
    const UMBRAL = 0.06;

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
    const dirs = pasos.map(([dx, dy]) => {
      let n = 0;
      for (let k = 1; k <= 40; k++) {
        if (at(cx + dx * k, cy + dy * k) <= UMBRAL) break;
        n = k;
      }
      return n;
    });

    let teñidas = 0;
    let sx = 0;
    let sy = 0;
    let mx = 0;
    for (let i = 0; i < w * h; i++) {
      const v = (buf[i * 4] ?? 0) / 255;
      if (v > mx) mx = v;
      if (v > UMBRAL) {
        teñidas++;
        sx += i % w;
        sy += Math.floor(i / w);
      }
    }

    return {
      dirs,
      teñidas,
      max: Math.max(...dirs),
      min: Math.min(...dirs),
      // Diagnóstico: si el centroide no cae sobre la celda del puntero, el derrame está
      // en otro sitio del que la sonda lo busca (típicamente por un eje Y invertido).
      cx,
      cy,
      centro: teñidas ? [Math.round(sx / teñidas), Math.round(sy / teñidas)] : [-1, -1],
      valorMax: mx,
      enPuntero: at(cx, cy),
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
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
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
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
      const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
      const r = c?.getBoundingClientRect();
      return { x: r?.x ?? 0, y: r?.y ?? 0, w: r?.width ?? 0, h: r?.height ?? 0 };
    });
    const clip = {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.w),
      height: Math.round(box.h),
    };

    // ---------------------------------------------------------------- sangría por hover
    // Un punto sobre el cuerpo del jaguar, donde hay pelaje y estructura que seguir.
    const px = box.x + box.w * 0.62;
    const py = box.y + box.h * 0.62;
    // El puntero tiene que estar DE VERDAD sobre el canvas antes de medir. Sin esta
    // comprobación la sonda daba ceros de forma intermitente: Lenis sigue interpolando el
    // scroll un rato, el canvas se mueve bajo un cursor quieto y dispara `pointerleave`, así
    // que `hasPointer` quedaba en false y no había sangría que medir. Un usuario real genera
    // `pointermove` continuo y no lo nota; una sonda que mueve el ratón una vez, sí.
    // Va por el helper y no por un bucle propio: además de confirmar que el motor recibió el
    // puntero, es lo único que ENCIENDE el hover, que bajo automatización nace apagado (el
    // candado del 2026-09-09). Duplicar aquí la lógica dejaría esta sonda midiendo cero.
    await confirmarPuntero(page, px, py, 'gl');

    await sleep(2200); // que la difusión llegue a su alcance

    const r = await reach(page);
    const shotBleed = join(OUT, 'bleed-hover.png');
    await page.screenshot({ path: shotBleed, clip });

    say('== CHECKPOINT 2.3 — sangría orgánica en el shader ==');
    say('');
    say(`   alcance por dirección (celdas): ${r.dirs.join(', ')}`);
    say(`   mínimo ${r.min} · máximo ${r.max} · factor ${r.min > 0 ? (r.max / r.min).toFixed(1) : '∞'}`);
    say(`   celdas teñidas: ${r.teñidas} · valor máximo ${r.valorMax.toFixed(2)}`);
    say(
      `   puntero en celda (${r.cx}, ${r.cy}) con valor ${r.enPuntero.toFixed(2)} · centroide del derrame (${r.centro.join(', ')})`,
    );
    say('');
    say('   Referencia del Canvas 2D (CLAUDE.md 2026-09-04): 7 a 21 celdas, factor 3.');
    say('   Un factor cercano a 1 significaría un disco, no un derrame que sigue al sujeto.');

    // ---------------------------------------------------------------- onda de color
    // La onda dura 0.9 s en producción; para la foto se alarga a 8 s. Hacen falta tantos
    // porque la curva es `power1.out`: cubre el 56 % del radio en el primer 34 % del tiempo,
    // así que a 3 s la captura seguía saliendo con el retrato ya casi entero teñido.
    await page.evaluate(() => {
      (
        window as unknown as { __asciiGL: { setWaveDuration: (s: number) => void } }
      ).__asciiGL.setWaveDuration(8);
    });
    await page.mouse.click(px, py);
    await sleep(700); // frente a la vista
    const modoTrasClic = await page.evaluate(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glMode ?? '?',
    );
    if (modoTrasClic !== 'color') {
      throw new Error(`El clic no cambió a color (modo "${modoTrasClic}"): la captura no valdría.`);
    }
    const shotWave = join(OUT, 'wave-mid.png');
    await page.screenshot({ path: shotWave, clip });
    const wave = await page.evaluate(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glColorWave ?? '?',
    );

    await sleep(8500);
    const shotColor = join(OUT, 'wave-done.png');
    await page.screenshot({ path: shotColor, clip });
    const modo = await page.evaluate(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glMode ?? '?',
    );

    say('');
    say(`   onda de color: capturada al ${wave} de progreso · modo final "${modo}"`);

    // ---------------------------------------------------------------- coste con todo activo
    const perf = await page.evaluate(async () => {
      const ms: number[] = [];
      const t0 = performance.now();
      await new Promise<void>((done) => {
        const tick = (): void => {
          const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
          if (c?.dataset.glMs) ms.push(Number(c.dataset.glMs));
          if (performance.now() - t0 > 2000) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      ms.sort((a, b) => a - b);
      return {
        p50: ms[Math.floor(ms.length * 0.5)] ?? 0,
        p95: ms[Math.floor(ms.length * 0.95)] ?? 0,
        max: ms[ms.length - 1] ?? 0,
        n: ms.length,
      };
    });
    say('');
    say(
      `   coste por frame con sangría + onda + vídeo: p50 ${perf.p50.toFixed(2)} · p95 ${perf.p95.toFixed(2)} · max ${perf.max.toFixed(2)} ms  (presupuesto §8: 4 ms)`,
    );

    const sheet = await browser.newPage({ viewport: { width: 2100, height: 780 }, deviceScaleFactor: 1 });
    await compose(
      sheet,
      [
        {
          title: 'sangría por hover',
          sub: `alcance ${r.min}-${r.max} celdas · factor ${(r.max / Math.max(1, r.min)).toFixed(1)}`,
          img: dataUrl(shotBleed),
        },
        {
          title: 'onda de color a media expansión',
          sub: `progreso ${wave} desde el punto del clic (onda alargada a 8 s para la foto; en producción 0.9 s)`,
          img: dataUrl(shotWave),
        },
        {
          title: 'modo color completo',
          sub: 'paleta bands · la onda ya cubrió el retrato',
          img: dataUrl(shotColor),
        },
      ],
      join(OUT, 'BLEED-Y-ONDA.png'),
    );

    await browser.close();
    writeFileSync(join(OUT, 'bleed.txt'), report.join('\n'), 'utf8');
    console.log(`\n${join(OUT, 'BLEED-Y-ONDA.png')}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
