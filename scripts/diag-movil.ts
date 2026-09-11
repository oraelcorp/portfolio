// scripts/diag-movil.ts — diagnóstico de los dos bugs de móvil, en SERIE TEMPORAL.
//
// Por qué no vale `repro-movil.ts`: mide UNA vez, y lo hizo con `glReveal: 0.005`, o sea 16 ms
// después de arrancar una onda de entrada de 3.2 s. Con la onda al 0.5 % el shader descarta casi
// todas las celdas, así que "0 píxeles con tinta" es lo que se espera ahí, no una prueba de nada.
// Aquí se muestrea cada 500 ms durante 14 s: si el retrato aparece, se ve en qué instante; si no
// aparece nunca, eso ya es evidencia.
//
// Y se corre en DOS motores, porque el bug es de teléfono y Chrome de escritorio con el viewport
// achicado no lo es:
//   chrome  — Chrome del sistema, contexto móvil + `--autoplay-policy=user-gesture-required`.
//   webkit  — el WebKit de Playwright, que es el motor de Safari iOS. Es lo más cerca del
//             iPhone a lo que se llega sin el iPhone.
//
// Uso:  node scripts/diag-movil.ts [chrome|webkit] [--gesto]
//       --gesto simula un toque en la página antes de medir (para separar "lo bloquea el
//       autoplay" de "no dibuja pase lo que pase").

import { chromium, webkit, devices } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MOTOR = (process.argv[2] === 'webkit' ? 'webkit' : 'chrome') as 'chrome' | 'webkit';
const CON_GESTO = process.argv.includes('--gesto');
const REDUCIDO = process.argv.includes('--reducido');
const PORT = MOTOR === 'webkit' ? 4212 : 4211;
const OUT = resolve(
  'screenshots',
  'movil',
  MOTOR + (CON_GESTO ? '-gesto' : '') + (REDUCIDO ? '-reducido' : ''),
);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const IPHONE = {
  ...devices['iPhone 13'],
  // §8 exige que con reduced-motion el retrato salga COMPLETO pero quieto. Es justo el camino
  // que toca el arreglo (el vídeo se inserta pero no se reproduce), así que hay que medirlo.
  ...(REDUCIDO ? { reducedMotion: 'reduce' as const } : {}),
  // El vídeo del contexto es la evidencia que se le enseña a Javier.
  recordVideo: { dir: OUT, size: { width: 390, height: 844 } },
};

interface Muestra {
  t: number;
  glReady: string;
  glReveal: string;
  glSeq: string;
  glGrid: string;
  tinta: number;
  canvas: string;
  rect: string;
  readyState: number;
  paused: boolean | null;
  currentTime: number;
  videoW: number;
  ctxPerdido: boolean;
  motor2d: boolean;
}

/** Cuenta píxeles con luminancia apreciable dentro del canvas del retrato. */
async function muestrear(page: Page, t: number): Promise<Muestra> {
  return page.evaluate((tt) => {
    const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const w = window as any;
    const g = w.__asciiGL;
    const v = g?.source as HTMLVideoElement | undefined;
    let tinta = 0;
    if (c && c.width > 0) {
      const off = document.createElement('canvas');
      off.width = c.width;
      off.height = c.height;
      const ctx = off.getContext('2d');
      if (ctx) {
        ctx.drawImage(c, 0, 0);
        const d = ctx.getImageData(0, 0, off.width, off.height).data;
        for (let i = 0; i < d.length; i += 4) {
          if (0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0) >= 26) tinta++;
        }
      }
    }
    const r = c?.getBoundingClientRect();
    return {
      t: tt,
      glReady: c?.dataset.glReady ?? '-',
      glReveal: c?.dataset.glReveal ?? '-',
      glSeq: c?.dataset.glSeq ?? '-',
      glGrid: c?.dataset.glGrid ?? '-',
      tinta,
      canvas: c ? `${c.width}x${c.height}` : 'sin canvas',
      rect: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : '-',
      readyState: v?.readyState ?? -1,
      paused: v?.paused ?? null,
      currentTime: Number((v?.currentTime ?? -1).toFixed(2)),
      videoW: v?.videoWidth ?? -1,
      ctxPerdido: Boolean(w.__ctxPerdido),
      // Si la rama WebGL2 falló, hero.ts cae al Canvas 2D: ese no pone `data-gl-*`.
      motor2d: Boolean(c && !c.dataset.glReady && c.dataset.reveal !== undefined),
    };
  }, t);
}

async function lanzar(): Promise<Browser> {
  if (MOTOR === 'webkit') return webkit.launch({ headless: true });
  return chromium.launch({
    channel: 'chrome',
    headless: false,
    // LA política que el resto de sondas del proyecto desactivaba.
    args: ['--autoplay-policy=user-gesture-required'],
  });
}

async function abrir(ctx: BrowserContext, salida: string[]): Promise<Page> {
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    (window as any).__ctxPerdido = false;
    window.addEventListener(
      'webglcontextlost',
      () => {
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        (window as any).__ctxPerdido = true;
      },
      true,
    );
  });
  page.on('pageerror', (e) => salida.push(`   [pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') salida.push(`   [console.${m.type()}] ${m.text()}`);
  });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  return page;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  const linea: string[] = [];
  const say = (s = ''): void => {
    console.log(s);
    linea.push(s);
    writeFileSync(join(OUT, 'diag.txt'), linea.join('\n'), 'utf8');
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
    const ctx = await browser.newContext(IPHONE);

    say(`== DIAGNÓSTICO MÓVIL · motor=${MOTOR}${CON_GESTO ? ' · con gesto previo' : ''} ==`);
    say(`   ${IPHONE.viewport?.width}x${IPHONE.viewport?.height} · DPR ${IPHONE.deviceScaleFactor} · touch`);
    say('');

    // ------------------------------------------------------------------ BUG 1
    const errores: string[] = [];
    const page = await abrir(ctx, errores);
    if (CON_GESTO) {
      await page.tap('body', { position: { x: 10, y: 10 } }).catch(() => {});
    }

    say('   BUG 1 — ¿aparece el retrato? (serie temporal)');
    say('   t(ms)  ready  reveal  seq   tinta   canvas     rect     video(rs/paused/t/w)');
    const t0 = Date.now();
    let maxTinta = 0;
    for (let i = 0; i < 28; i++) {
      const m = await muestrear(page, Date.now() - t0);
      maxTinta = Math.max(maxTinta, m.tinta);
      say(
        `   ${String(m.t).padStart(5)}  ${m.glReady.padStart(5)}  ${m.glReveal.padStart(6)}  ${m.glSeq.padStart(4)}  ${String(m.tinta).padStart(6)}  ${m.canvas.padEnd(10)} ${m.rect.padEnd(8)} ${m.readyState}/${m.paused}/${m.currentTime}/${m.videoW}${m.ctxPerdido ? ' CTX-PERDIDO' : ''}${m.motor2d ? ' [motor 2D]' : ''}`,
      );
      if (i === 27 || m.t > 14_000) break;
      await sleep(500);
    }
    await page.screenshot({ path: join(OUT, 'bug1-final.png') });
    say(
      `   >>> tinta máxima observada: ${maxTinta} ${maxTinta < 1000 ? '→ EL RETRATO NO SE DIBUJA' : '→ el retrato sí se dibuja'}`,
    );
    if (errores.length) {
      say('   mensajes del navegador:');
      for (const e of errores) say(e);
    }
    say('');

    // ------------------------------------------------------------------ BUG 2
    const err2: string[] = [];
    const p2 = await abrir(ctx, err2);
    await p2.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 30_000 });
    await sleep(2000);

    const destino =
      (await p2.evaluate(() =>
        document.querySelector<HTMLAnchorElement>('[data-menu] a[href^="#"]')?.getAttribute('href'),
      )) ?? '(sin enlaces)';
    const objetivoY = await p2.evaluate((sel) => {
      const el = sel && sel.startsWith('#') ? document.querySelector<HTMLElement>(sel) : null;
      return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : -1;
    }, destino);

    const estadoScroll = (): Promise<{ y: number; stopped: boolean; abierto: string }> =>
      p2.evaluate(() => ({
        y: Math.round(window.scrollY),
        // Lenis marca el <html> mientras está parado. Es su estado, observable desde fuera.
        stopped: document.documentElement.className.includes('lenis-stopped'),
        abierto: document.querySelector<HTMLElement>('[data-menu]')?.dataset.open ?? '-',
      }));

    say('   BUG 2 — enlaces del menú');
    say(`   enlace: ${destino} · su posición real en la página: y=${objetivoY}`);
    say(`   estado inicial: ${JSON.stringify(await estadoScroll())}`);

    await p2.tap('[data-menu-toggle]');
    await sleep(1200);
    say(`   menú abierto: ${JSON.stringify(await estadoScroll())}`);

    await p2.tap('[data-menu] a[href^="#"]');
    say('   t tras el toque   scrollY  lenis-stopped  menu.open');
    for (let i = 0; i < 10; i++) {
      const s = await estadoScroll();
      say(
        `   ${String(i * 400).padStart(9)} ms  ${String(s.y).padStart(7)}  ${String(s.stopped).padStart(13)}  ${s.abierto}`,
      );
      await sleep(400);
    }
    const finalY = (await estadoScroll()).y;
    await p2.screenshot({ path: join(OUT, 'bug2-final.png') });
    say(
      `   >>> ${Math.abs(finalY - objetivoY) < 120 ? 'llegó al destino' : `NO NAVEGA: quedó en y=${finalY}, el destino estaba en y=${objetivoY}`}`,
    );
    say('');

    // CONTROL: el mismo enlace, con el menú cerrado (Lenis en marcha). Aísla la variable.
    say('   CONTROL — mismo destino con Lenis EN MARCHA (menú ya cerrado)');
    const antesC = (await estadoScroll()).y;
    await p2.evaluate((sel) => {
      const a = document.createElement('a');
      a.href = sel;
      a.id = 'sonda-control';
      a.textContent = 'control';
      a.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99999;background:#fff;color:#000';
      document.body.appendChild(a);
    }, destino);
    await p2.tap('#sonda-control');
    await sleep(2500);
    const despuesC = (await estadoScroll()).y;
    say(`   scrollY ${antesC} → ${despuesC} · destino y=${objetivoY}`);
    say(
      `   >>> ${Math.abs(despuesC - objetivoY) < 120 ? 'SÍ navega con Lenis en marcha → la diferencia es el menú' : 'tampoco navega → la causa no es el menú'}`,
    );

    await ctx.close();
    await browser.close();
    say('');
    say(`Evidencia (capturas y vídeo) en ${OUT}`);
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
