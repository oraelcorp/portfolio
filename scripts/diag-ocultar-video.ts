// scripts/diag-ocultar-video.ts — el <video> tiene que estar EN el DOM para que WebKit dé
// frames (medido en diag-fuente.ts), pero no puede verse. ¿Cuál de las formas de ocultarlo
// conserva los frames y el tamaño intrínseco?
//
// No se elige a ojo: se miden seis estrategias con el mismo mp4, y de cada una se lee
// `videoWidth` (si sale mal, el recorte `cover` del retrato saldría mal) y la tinta que llega
// a una textura WebGL2.
//
// Uso:  node scripts/diag-ocultar-video.ts [webkit|chrome]

import { chromium, webkit, devices } from 'playwright';
import type { Browser } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MOTOR = (process.argv[2] === 'chrome' ? 'chrome' : 'webkit') as 'chrome' | 'webkit';
const PORT = MOTOR === 'webkit' ? 4216 : 4215;
const OUT = resolve('screenshots', 'movil', `ocultar-${MOTOR}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const ESTRATEGIAS: [string, string][] = [
  ['(hoy) fuera del DOM', 'FUERA'],
  [
    '1px opacity .01 fixed',
    'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none',
  ],
  ['1px opacity 0 fixed', 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none'],
  [
    'fuera de pantalla, tamaño real',
    'position:fixed;left:-9999px;top:0;width:320px;height:180px;pointer-events:none',
  ],
  [
    'clip-path inset(50%)',
    'position:fixed;left:0;top:0;width:320px;height:180px;clip-path:inset(50%);pointer-events:none',
  ],
  ['visibility:hidden', 'position:fixed;left:0;top:0;width:320px;height:180px;visibility:hidden'],
  ['display:none (control)', 'display:none'],
];

async function lanzar(): Promise<Browser> {
  if (MOTOR === 'webkit') return webkit.launch({ headless: true });
  return chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--autoplay-policy=user-gesture-required'],
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  const linea: string[] = [];
  const say = (s = ''): void => {
    console.log(s);
    linea.push(s);
    writeFileSync(join(OUT, 'ocultar.txt'), linea.join('\n'), 'utf8');
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

    const browser = await lanzar();
    const ctx = await browser.newContext(devices['iPhone 13']);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

    say(`== CÓMO OCULTAR EL <video> SIN PERDER LOS FRAMES · motor=${MOTOR} ==`);
    say('   tinta sobre 4096 px de una textura WebGL2 · videoWidth esperado: 580');
    say('');
    say('   estrategia                          tamaño   tintaGL   readyState  paused');

    for (const [nombre, css] of ESTRATEGIAS) {
      const r = await page.evaluate(
        async ([estilo]) => {
          const v = document.createElement('video');
          v.src = '/img/portrait/jaguar-loop.mp4';
          v.muted = true;
          v.loop = true;
          v.playsInline = true;
          v.preload = 'auto';
          v.setAttribute('muted', '');
          if (estilo !== 'FUERA') {
            v.style.cssText = estilo as string;
            document.body.appendChild(v);
          }
          await new Promise<void>((res) => {
            if (v.readyState >= 2) return res();
            v.addEventListener('loadeddata', () => res(), { once: true });
            setTimeout(() => res(), 8000);
          });
          await v.play().catch(() => {});
          await new Promise((r2) => setTimeout(r2, 1200));

          const cg = document.createElement('canvas');
          cg.width = 64;
          cg.height = 64;
          const gl = cg.getContext('webgl2');
          let tintaGL = -1;
          if (gl) {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
            const vs = gl.createShader(gl.VERTEX_SHADER)!;
            gl.shaderSource(
              vs,
              '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}',
            );
            gl.compileShader(vs);
            const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
            gl.shaderSource(
              fs,
              '#version 300 es\nprecision highp float;uniform sampler2D t;out vec4 o;void main(){o=vec4(texture(t,gl_FragCoord.xy/64.0).rgb,1.0);}',
            );
            gl.compileShader(fs);
            const p = gl.createProgram()!;
            gl.attachShader(p, vs);
            gl.attachShader(p, fs);
            gl.linkProgram(p);
            gl.useProgram(p);
            gl.bindVertexArray(gl.createVertexArray());
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            const px = new Uint8Array(64 * 64 * 4);
            gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
            tintaGL = 0;
            for (let i = 0; i < px.length; i += 4)
              if ((px[i] ?? 0) + (px[i + 1] ?? 0) + (px[i + 2] ?? 0) > 24) tintaGL++;
          }
          const out = {
            videoW: v.videoWidth,
            videoH: v.videoHeight,
            tintaGL,
            readyState: v.readyState,
            paused: v.paused,
          };
          v.pause();
          v.remove();
          return out;
        },
        [css],
      );
      say(
        `   ${nombre.padEnd(33)} ${(r.videoW + 'x' + r.videoH).padStart(9)}   ${String(r.tintaGL).padStart(7)}   ${String(r.readyState).padStart(9)}   ${r.paused}`,
      );
    }

    await ctx.close();
    await browser.close();
    say('');
    say(`Evidencia en ${OUT}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
