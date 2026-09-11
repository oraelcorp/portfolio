// scripts/measure-luma-gl.ts — el campo de luminancia QUE USA EL SHADER, no el del Canvas 2D.
//
// Corrige un error propio: el reparto por tramos de la rampa se midió sobre
// `__asciiPortrait.luma`, o sea el Canvas 2D con la FOTO y sin ganancia de exposición. Pero el
// color lo decide el shader sobre el VÍDEO y con la ganancia 1.4 aplicada, y esa curva
// (`clamp((l * 1.4 - 0.15) * 1.4, 0, 1)`) satura en 1.0 a partir de cierta luminancia. Si buena
// parte del campo está amontonada en 1.0, mover el umbral del frío no sirve de nada — que es
// exactamente lo que se observó.
//
// Aquí se lee la textura de luma directamente del framebuffer del motor.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';

const PORT = 4248;
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
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
    null,
    { timeout: 40_000 },
  );
  await sleep(1200);

  const filas = (await page.evaluate(`(() => {
    const g = window.__asciiGL;
    const gl = document.querySelector('[data-ascii]').getContext('webgl2');
    const w = g.cols, h = g.rows;
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const bins = new Array(20).fill(0);
    let conTinta = 0, saturadas = 0;
    for (let i = 0; i < w * h; i++) {
      const l = buf[i * 4 + 3] / 255;   // el canal alpha guarda la luminancia con la curva
      if (l < 0.12) continue;
      conTinta++;
      if (l >= 0.995) saturadas++;
      bins[Math.min(19, Math.floor(l * 20))]++;
    }
    return { bins, conTinta, saturadas, total: w * h, gain: document.querySelector('[data-ascii]').dataset.glGain };
  })()`)) as { bins: number[]; conTinta: number; saturadas: number; total: number; gain: string };

  console.log('== CAMPO DE LUMINANCIA REAL DEL SHADER (vídeo + ganancia) ==');
  console.log(`   ganancia aplicada: ${filas.gain} · celdas con tinta: ${filas.conTinta} de ${filas.total}`);
  console.log('');
  console.log('   tramo l        celdas    % del dibujo');
  filas.bins.forEach((n, i) => {
    if (n === 0) return;
    console.log(
      `   ${(i / 20).toFixed(2)}–${((i + 1) / 20).toFixed(2)}   ${String(n).padStart(6)}   ${((n / filas.conTinta) * 100).toFixed(1).padStart(6)} %`,
    );
  });
  console.log('');
  console.log(
    `   >>> celdas SATURADAS en l>=0.995: ${filas.saturadas} (${((filas.saturadas / filas.conTinta) * 100).toFixed(1)} % del dibujo)`,
  );
  console.log('       Si esto es alto, mover el umbral del frío por debajo de 1.0 no cambia casi nada:');
  console.log('       la curva de contraste ya ha aplastado ahí todo lo que estaba por encima.');
  await b.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
