// scripts/check-gl-knobs.ts — comprueba que los parámetros de URL del motor WebGL hacen lo
// que dicen, y sobre todo que el DEFAULT (`?gl` a secas) trae ya la sangría y la onda activas.
//
// Existe porque los mandos son para probar en vivo: si uno miente, la prueba en vivo concluye
// sobre algo que no es lo que se va a publicar.

import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { startPreview } from './lib/preview.ts';

const PORT = 4204;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Estado {
  bleedCeldas: number;
  modo: string;
  waveS: number;
  zoom: number;
  paleta: string;
}

async function probar(browser: Browser, query: string, conClic: boolean): Promise<Estado> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  try {
    await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'load' });
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
    const px = box.x + box.w * 0.62;
    const py = box.y + box.h * 0.62;

    // Igual que en check-gl-bleed: hay que confirmar que el puntero llegó, o la medida no vale
    let sobre = false;
    for (let i = 0; i < 12 && !sobre; i++) {
      await page.mouse.move(px + (i % 2), py, { steps: 8 });
      await sleep(250);
      sobre = await page.evaluate(
        () => (window as unknown as { __asciiGL?: { hasPointer: boolean } }).__asciiGL?.hasPointer === true,
      );
    }
    if (!sobre) throw new Error('el puntero no llegó al canvas');
    await sleep(1800);

    if (conClic) {
      await page.mouse.click(px, py);
      await sleep(1400);
    }

    return await page.evaluate(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const g = (window as any).__asciiGL;
      const gl = document.querySelector<HTMLCanvasElement>('[data-ascii]')?.getContext('webgl2');
      let celdas = 0;
      if (gl) {
        const w = g.cols as number;
        const h = g.rows as number;
        gl.bindFramebuffer(gl.FRAMEBUFFER, g.bleedFbo[g.bleedSrc]);
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        for (let i = 0; i < w * h; i++) if ((buf[i * 4] ?? 0) > 15) celdas++;
      }
      return {
        bleedCeldas: celdas,
        modo: document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glMode ?? '?',
        waveS: g.colorWaveS as number,
        zoom: g.opts.zoom as number,
        paleta: g.opts.palette as string,
      };
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const preview = startPreview(PORT);
  let fallos = 0;
  const check = (nombre: string, ok: boolean, detalle: string): void => {
    if (!ok) fallos++;
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${nombre} — ${detalle}`);
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

    console.log('Mandos de URL del motor WebGL\n');

    const base = await probar(browser, '?gl', true);
    check(
      '?gl trae la SANGRÍA activa sin encender nada',
      base.bleedCeldas > 100,
      `${base.bleedCeldas} celdas teñidas`,
    );
    check('?gl trae la ONDA DE COLOR al clic', base.modo === 'color', `modo tras un clic: "${base.modo}"`);
    check('?gl usa el zoom 1.2 aprobado', Math.abs(base.zoom - 1.2) < 0.001, `zoom ${base.zoom}`);
    check('?gl usa la paleta bands', base.paleta === 'bands', `paleta "${base.paleta}"`);
    check('?gl usa la onda de 0.9 s de producción', Math.abs(base.waveS - 0.9) < 0.001, `${base.waveS} s`);

    const sinBleed = await probar(browser, '?gl&glbleed=0', false);
    check(
      '?glbleed=0 apaga la sangría',
      sinBleed.bleedCeldas === 0,
      `${sinBleed.bleedCeldas} celdas teñidas`,
    );

    const lenta = await probar(browser, '?gl&glwave=4', false);
    check('?glwave=4 alarga la onda', Math.abs(lenta.waveS - 4) < 0.001, `${lenta.waveS} s`);

    const zoom1 = await probar(browser, '?gl&glzoom=1', false);
    check('?glzoom=1 cambia el encuadre', Math.abs(zoom1.zoom - 1) < 0.001, `zoom ${zoom1.zoom}`);

    const ramp = await probar(browser, '?gl&glpal=ramp', false);
    check('?glpal=ramp cambia la paleta', ramp.paleta === 'ramp', `paleta "${ramp.paleta}"`);

    await browser.close();
    console.log(
      `\n${fallos === 0 ? 'Todos los mandos hacen lo que dicen.' : `${fallos} mando(s) no cumplen.`}`,
    );
    if (fallos > 0) process.exitCode = 1;
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
