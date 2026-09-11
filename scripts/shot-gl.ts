// scripts/shot-gl.ts — checkpoint 2.1: captura el hero COMPLETO en las dos versiones y mide
// el coste de muestreo en la CPU (2D, foto) contra el de la GPU (WebGL, vídeo).
//
// Qué se mide y por qué ESO: el presupuesto de 4 ms de §8 es tiempo de HILO PRINCIPAL. Lo que
// decide si el vídeo es viable no es cuánto trabajo hace la GPU —eso ocurre fuera del hilo—
// sino cuánto hilo principal consume el frame. Por eso se compara `sample()` del 2D (13.7 ms
// de JS a celda 4.00) contra subida de textura + despacho de las dos pasadas del WebGL.
//
// Se lanza Chrome CON GPU (headless clásico usa SwiftShader por software y el número no
// significaría nada). El script IMPRIME el renderer real para que quede en el reporte: si
// dice SwiftShader, los ms de GPU no son representativos y hay que decirlo.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4200;
const OUT = resolve('screenshots', 'gl');
const VIEW = { width: 1440, height: 900 };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface GLStats {
  renderer: string;
  vendor: string;
  grid: string;
  frameMs: number;
  frameMsIdle: number;
  uploadMs: number;
  sampleMs: number;
  fps: number;
  videoSize: string;
}

async function glStats(page: Page): Promise<GLStats> {
  // Media de una ventana de ~2 s, no una lectura suelta
  const samples = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]');
    const gl = canvas?.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const info = {
      renderer: dbg && gl ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'desconocido',
      vendor: dbg && gl ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : 'desconocido',
      grid: canvas?.dataset.glGrid ?? '—',
    };

    // Se separan los frames CON muestreo de los que solo repintan: mezclarlos diluye
    // justo el coste que se quiere medir. El `seq` evita contar dos veces el mismo muestreo.
    const withSample: number[] = [];
    const noSample: number[] = [];
    const up: number[] = [];
    const sa: number[] = [];
    let lastSeq = -1;
    let frames = 0;
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const tick = (): void => {
        frames++;
        const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
        const ms = Number(c?.dataset.glMs ?? 0);
        const seq = Number(c?.dataset.glSeq ?? -1);
        if (c?.dataset.glSampled === '1' && seq !== lastSeq) {
          lastSeq = seq;
          withSample.push(ms);
          up.push(Number(c.dataset.glUpload ?? 0));
          sa.push(Number(c.dataset.glSample ?? 0));
        } else if (c?.dataset.glSampled === '0') {
          noSample.push(ms);
        }
        if (performance.now() - t0 > 2000) done();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const vid = (window as unknown as { __asciiGL?: { source: HTMLVideoElement } }).__asciiGL?.source;
    const avg = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

    return {
      ...info,
      frameMs: avg(withSample),
      frameMsIdle: avg(noSample),
      uploadMs: avg(up),
      sampleMs: avg(sa),
      fps: (frames * 1000) / (performance.now() - t0),
      videoSize: vid ? `${vid.videoWidth}x${vid.videoHeight}` : '—',
    };
  });

  return samples;
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

    // Headed y con GPU: en headless clásico WebGL cae a SwiftShader (software) y medir ahí
    // el coste "de GPU" sería medir una CPU haciendo de GPU.
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle'],
    });
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });

    // ---------------------------------------------------------------- WebGL + vídeo
    await page.goto(`http://localhost:${PORT}/?gl`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReady === '1',
      null,
      { timeout: 20_000 },
    );
    // Esperar a que la onda de entrada TERMINE. Medir con el reveal a medias fue lo que hizo
    // creer que el motor WebGL renderizaba casi nada: leía un retrato aún sin dibujar.
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
      null,
      { timeout: 25_000 },
    );
    await sleep(4500); // que termine el reveal de 3.2 s

    const gl = await glStats(page);
    say('== CHECKPOINT 2.1 — WebGL2 + vídeo ==');
    say(`   GPU: ${gl.vendor} · ${gl.renderer}`);
    say(`   vídeo ${gl.videoSize} · grid ${gl.grid}`);
    say(
      `   hilo principal — frame CON muestreo: ${gl.frameMs.toFixed(2)} ms · frame solo repintado: ${gl.frameMsIdle.toFixed(2)} ms   (fps ${gl.fps.toFixed(0)})`,
    );
    say(`   de los cuales, subida de textura de vídeo: ${gl.uploadMs.toFixed(2)} ms`);
    say(`   muestreo completo (subida + pasada de luma): ${gl.sampleMs.toFixed(2)} ms`);
    await page.screenshot({ path: join(OUT, 'hero-webgl.png') });

    // ---------------------------------------------------------------- Canvas 2D + foto
    await page.goto(`http://localhost:${PORT}/?debug`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
    await sleep(4500);
    await page.addStyleTag({ content: '.ascii-debug{visibility:hidden}' });

    const cpu = await page.evaluate(() => {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const p = (window as any).__asciiPortrait;
      const runs: number[] = [];
      for (let i = 0; i < 7; i++) {
        const t = performance.now();
        p.sample();
        runs.push(performance.now() - t);
      }
      runs.sort((a, b) => a - b);
      return { sampleMs: runs[3] ?? 0, grid: `${p.cols}x${p.rows}` };
    });
    await page.screenshot({ path: join(OUT, 'hero-canvas2d.png') });

    say('');
    say('== Canvas 2D + foto fija (lo que hay hoy) ==');
    say(`   grid ${cpu.grid} · sample() en JS: ${cpu.sampleMs.toFixed(1)} ms`);
    say('');
    say('== LA COMPARACIÓN QUE IMPORTA ==');
    say('   El presupuesto de §8 es tiempo de HILO PRINCIPAL. Con vídeo hay que re-muestrear a');
    say('   30 fps, así que el coste de muestreo pasa a pagarse EN CADA FRAME de muestreo.');
    say(
      `   · Canvas 2D re-muestreando vídeo: ${cpu.sampleMs.toFixed(1)} ms/frame  -> ${cpu.sampleMs > 4 ? 'ROMPE los 4 ms' : 'OK'}`,
    );
    say(
      `   · WebGL2 re-muestreando vídeo:    ${gl.sampleMs.toFixed(2)} ms/frame  -> ${gl.sampleMs > 4 ? 'ROMPE los 4 ms' : 'OK'}`,
    );
    if (cpu.sampleMs > 0 && gl.sampleMs > 0) {
      say(`   Factor: x${(cpu.sampleMs / gl.sampleMs).toFixed(1)} más barato en GPU`);
    }
    if (/swiftshader|software|llvmpipe/i.test(gl.renderer)) {
      say('');
      say('   ⚠️ El renderer es POR SOFTWARE: estos ms de GPU NO son representativos.');
    }

    await browser.close();
    writeFileSync(join(OUT, 'report.txt'), report.join('\n'), 'utf8');
    console.log(`\nCapturas en ${OUT}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
