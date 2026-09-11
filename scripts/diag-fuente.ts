// scripts/diag-fuente.ts — aísla la variable del bug 1: ¿es el VÍDEO o es el pipeline WebGL?
//
// En WebKit el retrato da 0 píxeles de tinta con todo lo demás sano: `glReady 1`, reveal
// completo, rejilla correcta, y el vídeo cargado y REPRODUCIÉNDOSE (readyState 4, currentTime
// avanzando). O sea que la sospecha del autoplay no se sostiene: el vídeo se reproduce y aun
// así no aparece nada. Queda por saber si lo que falla es subir ESE vídeo a una textura.
//
// Tres medidas, cada una cambiando UNA cosa:
//   A. hero normal            → vídeo + WebGL   (es el que falla)
//   B. hero con `?glphoto`    → FOTO + el MISMO WebGL, mismos shaders, misma rejilla
//   C. micro-test aislado     → sube a textura un <video> FUERA del DOM y otro DENTRO,
//                               y lee los píxeles. Sin nada del sitio de por medio.
//
// Si B pinta y A no, el shader no tiene la culpa. Si en C el vídeo de fuera del DOM da negro y
// el de dentro da color, la causa es que WebKit no entrega frames de un <video> sin insertar.

import { chromium, webkit, devices } from 'playwright';
import type { Browser } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MOTOR = (process.argv[2] === 'chrome' ? 'chrome' : 'webkit') as 'chrome' | 'webkit';
const PORT = MOTOR === 'webkit' ? 4214 : 4213;
const OUT = resolve('screenshots', 'movil', `fuente-${MOTOR}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function lanzar(): Promise<Browser> {
  if (MOTOR === 'webkit') return webkit.launch({ headless: true });
  return chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--autoplay-policy=user-gesture-required'],
  });
}

/** Píxeles con luminancia apreciable en un canvas del DOM. */
const CONTAR = (sel: string): number => {
  const c = document.querySelector<HTMLCanvasElement>(sel);
  if (!c || !c.width) return -1;
  const off = document.createElement('canvas');
  off.width = c.width;
  off.height = c.height;
  const ctx = off.getContext('2d');
  if (!ctx) return -1;
  ctx.drawImage(c, 0, 0);
  const d = ctx.getImageData(0, 0, off.width, off.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0) >= 26) n++;
  }
  return n;
};

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  const linea: string[] = [];
  const say = (s = ''): void => {
    console.log(s);
    linea.push(s);
    writeFileSync(join(OUT, 'fuente.txt'), linea.join('\n'), 'utf8');
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
    say(`== ¿VÍDEO O PIPELINE? · motor=${MOTOR} ==`);
    say('');

    // ---- A y B: la misma página, cambiando solo la fuente del retrato -----------------
    for (const [nombre, url] of [
      ['A. hero con VÍDEO (producción)', `http://localhost:${PORT}/`],
      ['B. hero con FOTO  (?glphoto)', `http://localhost:${PORT}/?glphoto`],
    ] as const) {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(
        () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
        null,
        { timeout: 30_000 },
      );
      await sleep(600);
      const hero = await page.evaluate(CONTAR, '[data-ascii]');
      // El footer usa la FOTO y el MISMO motor WebGL, en la misma página.
      await page.evaluate(() => {
        document.querySelector('[data-ascii-footer]')?.scrollIntoView();
      });
      await sleep(1500);
      const footer = await page.evaluate(CONTAR, '[data-ascii-footer]');
      say(`   ${nombre}`);
      say(`     tinta hero: ${hero}   ·   tinta footer (foto, mismo WebGL): ${footer}`);
      await page.screenshot({ path: join(OUT, nombre.startsWith('A') ? 'A-video.png' : 'B-foto.png') });
      await page.close();
    }
    say('');

    // ---- C: micro-test, sin nada del sitio -------------------------------------------
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    const micro = await page.evaluate(async () => {
      const hacerVideo = (enDOM: boolean): HTMLVideoElement => {
        const v = document.createElement('video');
        v.src = '/img/portrait/jaguar-loop.mp4';
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.setAttribute('muted', '');
        if (enDOM) {
          // Insertado pero invisible para el usuario: 1 px en una esquina.
          v.style.cssText =
            'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none';
          document.body.appendChild(v);
        }
        return v;
      };

      const medir = async (enDOM: boolean): Promise<Record<string, unknown>> => {
        const v = hacerVideo(enDOM);
        await new Promise<void>((res) => {
          if (v.readyState >= 2) return res();
          v.addEventListener('loadeddata', () => res(), { once: true });
          setTimeout(() => res(), 8000);
        });
        let errorPlay = '';
        await v.play().catch((e: Error) => {
          errorPlay = e.name;
        });
        await new Promise((r) => setTimeout(r, 1200));

        // 1) ¿da frames a un canvas 2D?
        const c2 = document.createElement('canvas');
        c2.width = 64;
        c2.height = 64;
        const x2 = c2.getContext('2d');
        let tinta2d = -1;
        if (x2 && v.videoWidth) {
          x2.drawImage(v, 0, 0, 64, 64);
          const d = x2.getImageData(0, 0, 64, 64).data;
          tinta2d = 0;
          for (let i = 0; i < d.length; i += 4)
            if ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0) > 24) tinta2d++;
        }

        // 2) ¿da frames a una TEXTURA WebGL2? (que es lo que hace el retrato)
        const cg = document.createElement('canvas');
        cg.width = 64;
        cg.height = 64;
        const gl = cg.getContext('webgl2');
        let tintaGL = -1;
        let errGL = 0;
        if (gl) {
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
          errGL = gl.getError();
          // Se lee la textura pintándola en el framebuffer por defecto.
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

        return {
          enDOM,
          readyState: v.readyState,
          paused: v.paused,
          currentTime: Number(v.currentTime.toFixed(2)),
          videoW: v.videoWidth,
          errorPlay: errorPlay || 'ninguno',
          tinta2d,
          tintaGL,
          errGL,
        };
      };

      return { fuera: await medir(false), dentro: await medir(true) };
    });

    say('   C. micro-test aislado — el MISMO mp4, subido a textura WebGL2');
    say('      (tinta sobre 4096 píxeles; 0 = negro puro)');
    for (const [k, v] of Object.entries(micro)) {
      const m = v as Record<string, unknown>;
      say(
        `      <video> ${k === 'fuera' ? 'FUERA del DOM (como está hoy)' : 'DENTRO del DOM        '} → tinta WebGL: ${String(m.tintaGL).padStart(4)} · tinta canvas2D: ${String(m.tinta2d).padStart(4)} · readyState ${m.readyState} · paused ${m.paused} · t ${m.currentTime} · ${m.videoW}px · play(): ${m.errorPlay} · glError ${m.errGL}`,
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
