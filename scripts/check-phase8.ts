// scripts/check-phase8.ts — criterios de aceptación del retrato en WebGL2, que desde el
// 2026-09-08 es el CAMINO POR DEFECTO.
//
// `check-phase3` sigue existiendo y ahora verifica el fallback de Canvas 2D (`?2d&debug`).
// Esta suite cubre lo mismo sobre el motor nuevo, más lo que el motor nuevo trae: vídeo en
// movimiento, sangría en GPU y onda de color radial.
//
// Se escribió al migrar porque el camino por defecto se quedaba sin suite: la de Fase 3 pasaba
// a validar un camino que ya casi nadie recorre.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { asentarScroll, cajaRetrato, colocarPuntero } from './lib/pointer.ts';
import { LEER_ACENTO, ES_ACENTO_FN } from './lib/acento.ts';

const PORT = 4209;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = ''): void {
  if (!ok) fallos++;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${nombre}${detalle ? ` — ${detalle}` : ''}`);
}

async function esperarRetrato(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 25_000 });
  await page.waitForFunction(
    () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReady === '1',
    null,
    { timeout: 25_000 },
  );
  await page.waitForFunction(
    () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
    null,
    { timeout: 30_000 },
  );
  await asentarScroll(page);
}

/**
 * Cuenta píxeles con tinta y los clasifica en ACENTO y blanco.
 *
 * El acento se reconoce por su proporción entre canales contra el token vigente, no por "gana el
 * verde" como hasta el 2026-09-10: eso ataba la sonda a `#39FF6A`, y al mover la marca a guinda
 * el acento pasó a ser rojo-dominante — indistinguible de la paleta cálida con el criterio
 * viejo. Ver `lib/acento.ts`.
 */
async function tinta(page: Page): Promise<{ total: number; verde: number; blanco: number; calidos: number }> {
  return page.evaluate(`(() => {
    const ACC = ${LEER_ACENTO};
    ${ES_ACENTO_FN}
    const canvas = document.querySelector('[data-ascii]');
    if (!canvas) throw new Error('sin canvas');
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d');
    if (!ctx) throw new Error('sin contexto');
    ctx.drawImage(canvas, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    let total = 0;
    let verde = 0;
    let blanco = 0;
    let calidos = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] || 0;
      const g = d[i + 1] || 0;
      const b = d[i + 2] || 0;
      if (0.2126 * r + 0.7152 * g + 0.0722 * b < 26) continue;
      total++;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      if (sat < 0.18) blanco++;
      else if (esAcento(r, g, b)) verde++;
      else if (r > g && g > b && sat > 0.3) calidos++;
    }
    return { total, verde, blanco, calidos };
  })()`) as Promise<{ total: number; verde: number; blanco: number; calidos: number }>;
}

/**
 * Deja el motor en un estado CONOCIDO antes de medir, en vez de dar por hecho que arranca ahí.
 *
 * MEDIDO el 2026-09-09: en 3 de 11 corridas el retrato ya estaba en color al medir la base, y
 * la suite reportaba `verde 0`, que parece un fallo del retrato y es contaminación. El registro
 * de clics de más abajo enseñó el origen: clics REALES (`isTrusted: true`) sobre el canvas
 * durante el reveal. Estas sondas abren Chrome con `headless: false`, así que la ventana se
 * pone delante de lo que esté haciendo el usuario y cualquier clic suyo cae sobre el retrato y
 * dispara la onda de color. No es un fallo del producto, y no debe leerse como tal.
 */
async function normalizarModo(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const g = window.__asciiGL;
    const c = document.querySelector('[data-ascii]');
    if (!g || !c) return;
    g.modo = 'ascii';
    g.colorBase = 0;
    g.colorTarget = 0;
    g.colorR = 0;
    c.dataset.glMode = 'ascii';
    g.clearBleed?.();
  })()`);
  await sleep(300);
}

/**
 * Clic sobre el retrato que NO se da por bueno hasta que el motor lo acusa. Dos cosas que la
 * versión anterior daba por hechas y no lo están:
 *
 *   - la CAJA se recalculaba una vez y se reutilizaba para los dos clics. Si algo mueve el
 *     layout entre medias, el segundo clic aterriza fuera del canvas y no pasa nada.
 *   - se esperaba un `sleep` fijo de 1500 ms. La onda dura 0.9 s **por requestAnimationFrame**,
 *     y rAF se estrangula en cuanto la ventana pierde el foco: medido, la comprobación salía
 *     `cálidos 0 → 92`, o sea la onda ni había empezado. Ahora se espera al estado que el
 *     propio motor publica (`glMode` + `glColorWave === '1.000'`), que es la señal de verdad.
 *
 * Reintenta hasta 3 veces porque un clic sintético perdido es una condición REAL observada, no
 * una hipótesis; si aun así no llega, devuelve false y la comprobación lo dice.
 */
async function clicarRetrato(page: Page, esperado: 'ascii' | 'color'): Promise<boolean> {
  for (let intento = 0; intento < 3; intento++) {
    const caja = await cajaRetrato(page);
    await page.mouse.click(caja.x + caja.w * 0.6, caja.y + caja.h * 0.6);
    try {
      await page.waitForFunction(
        (m) => {
          const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
          return c?.dataset.glMode === m && c?.dataset.glColorWave === '1.000';
        },
        esperado,
        { timeout: 4000 },
      );
      return true;
    } catch {
      /* el clic no llegó o la onda no avanzó: se reintenta */
    }
  }
  return false;
}

/**
 * Variación de la imagen en ~0.9 s. Se usa para comparar el retrato en movimiento con el
 * retrato bajo `prefers-reduced-motion`: comparar contra CERO no vale, porque releer un canvas
 * WebGL vía `drawImage` no garantiza el mismo byte (el Canvas 2D sí, por eso check-phase3
 * puede exigir igualdad exacta). Lo que sí es concluyente es que la variación en reposo sea
 * varios órdenes de magnitud menor que la del retrato vivo.
 */
async function variacion(page: Page): Promise<{ delta: number; base: number; video: number }> {
  return page.evaluate(async () => {
    const g = (window as unknown as { __asciiGL: { source: HTMLVideoElement } }).__asciiGL;
    const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
    if (!c) throw new Error('sin canvas');
    const off = document.createElement('canvas');
    off.width = c.width;
    off.height = c.height;
    const ctx = off.getContext('2d');
    if (!ctx) throw new Error('sin contexto');
    const huella = (): number => {
      ctx.clearRect(0, 0, off.width, off.height);
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(0, 0, off.width, off.height).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 16) s += d[i] ?? 0;
      return s;
    };
    const t0 = g.source.currentTime;
    const a = huella();
    await new Promise((r) => setTimeout(r, 900));
    const b = huella();
    return { delta: Math.abs(a - b), base: a, video: Math.abs(g.source.currentTime - t0) };
  });
}

async function main(): Promise<void> {
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

    const browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: ['--autoplay-policy=no-user-gesture-required'],
    });

    // ---------------------------------------------------------------- camino por defecto
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(e.message));
    // Registrador de clics, en fase de captura y ANTES de los scripts de la página: si algo
    // dispara la onda de color durante la carga, aquí queda con su origen y si el evento era
    // de confianza (input real del navegador) o sintetizado por script.
    await page.addInitScript(() => {
      const w = window as unknown as { __clics: unknown[] };
      w.__clics = [];
      document.addEventListener(
        'click',
        (e) => {
          const t = e.target as HTMLElement | null;
          w.__clics.push({
            t: Math.round(performance.now()),
            trusted: e.isTrusted,
            x: e.clientX,
            y: e.clientY,
            tag: t?.tagName,
            data: t ? JSON.stringify(t.dataset) : null,
          });
        },
        true,
      );
    });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    // Sin foco, requestAnimationFrame se estrangula y las ondas no avanzan: la suite medía
    // transiciones que no habían empezado. Traer la ventana al frente es parte de la medición.
    await page.bringToFront();
    await esperarRetrato(page);

    // DIAGNOSTICO (2026-09-09): la base sale en COLOR en ~1 de cada 3 corridas y la
    // comprobación reporta `verde 0`, que parece un fallo del retrato y es un fallo de sonda.
    // Se vuelca el estado del motor para saber QUE se estaba midiendo.
    const estadoBase = await page.evaluate(`(() => {
      const c = document.querySelector('[data-ascii]');
      const g = window.__asciiGL;
      return { modo: c.dataset.glMode, reveal: c.dataset.glReveal, onda: c.dataset.glColorWave,
               base: g.colorBase, target: g.colorTarget, R: Math.round(g.colorR),
               vis: document.visibilityState, foco: document.hasFocus() };
    })()`);
    const ajenos = (await page.evaluate(`(window.__clics || []).length`)) as number;
    if (ajenos > 0) {
      // No se calla ni se da por bueno: se dice que hubo interferencia y se vuelve al estado
      // conocido, para que lo que se mida después siga significando algo.
      console.log(
        `      · AVISO: ${ajenos} clic(s) externos sobre el retrato durante la carga (ventana con foco robado). Estado en la base: ${JSON.stringify(estadoBase)}`,
      );
      await normalizarModo(page);
    }

    const base = await tinta(page);
    check('el retrato se dibuja sin pedir nada por URL', base.total > 20_000, `${base.total} px`);
    check(
      'la base es el acento y los brillos son blancos (§6.3 punto 6)',
      base.verde > base.blanco && base.blanco > 1000,
      `verde ${base.verde} · blanco ${base.blanco}`,
    );

    const video = await page.evaluate(async () => {
      const g = (window as unknown as { __asciiGL: { source: HTMLVideoElement } }).__asciiGL;
      const t0 = g.source.currentTime;
      await new Promise((r) => setTimeout(r, 600));
      return {
        t0,
        t1: g.source.currentTime,
        dur: g.source.duration,
        paused: g.source.paused,
        w: g.source.videoWidth,
        h: g.source.videoHeight,
      };
    });
    // El avance se calcula CONTANDO LA VUELTA del loop. Antes esto era `t1 > t0` a secas y
    // fallaba cada vez que la ventana de 600 ms caía sobre el punto de empalme —un 8 % de las
    // corridas, y una de ellas tumbó la suite entera el 2026-09-09 sin que hubiera nada roto.
    const avance = video.t1 >= video.t0 ? video.t1 - video.t0 : video.dur - video.t0 + video.t1;
    check(
      'el vídeo se reproduce como loop ambiental continuo',
      !video.paused && avance > 0.1,
      `t ${video.t0.toFixed(2)} -> ${video.t1.toFixed(2)} (avance ${avance.toFixed(2)}s${video.t1 < video.t0 ? ', con vuelta al loop' : ''}) · paused ${video.paused} · ${video.w}x${video.h}`,
    );

    // ---------------------------------------------------------------- sangría por hover
    // `colocarPuntero` ABORTA si el motor no recibe el puntero, en vez de dejar que la
    // comprobación reporte un cero que parece un fallo del efecto y es de la sonda.
    // La caja que devuelve ya no se guarda: `clicarRetrato` la recalcula en cada intento.
    await colocarPuntero(page, 0.6, 0.6, 'gl');
    await sleep(1800);
    const teñidas = await page.evaluate(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const g = (window as any).__asciiGL;
      const gl = document.querySelector<HTMLCanvasElement>('[data-ascii]')?.getContext('webgl2');
      if (!gl) return 0;
      const w = g.cols as number;
      const h = g.rows as number;
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.bleedFbo[g.bleedSrc]);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      let n = 0;
      for (let i = 0; i < w * h; i++) if ((buf[i * 4] ?? 0) > 15) n++;
      return n;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });
    check('el puntero derrama color (§6.3 punto 13)', teñidas > 100, `${teñidas} celdas teñidas`);

    // ---------------------------------------------------------------- onda de color al clic
    const llego1 = await clicarRetrato(page, 'color');
    const enColor = await tinta(page);
    const modo1 = await page.evaluate(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glMode ?? '?',
    );
    check(
      'el clic pasa a color real',
      enColor.calidos > base.calidos + 5000,
      `cálidos ${base.calidos} → ${enColor.calidos}${llego1 ? '' : ' · el clic NO llegó al motor en 3 intentos'}`,
    );
    check('el canvas expone su modo', modo1 === 'color', modo1);

    const llego2 = await clicarRetrato(page, 'ascii');
    const modo2 = await page.evaluate(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glMode ?? '?',
    );
    check(
      'el segundo clic vuelve a ASCII',
      modo2 === 'ascii',
      `${modo2}${llego2 ? '' : ' · el clic NO llegó al motor en 3 intentos'}`,
    );

    // ---------------------------------------------------------------- teclado (§8)
    const teclado = await page.evaluate(async () => {
      const b = document.querySelector<HTMLButtonElement>('[data-ascii-toggle]');
      if (!b) return { ok: false, motivo: 'no hay botón' };
      b.focus();
      const enfocado = document.activeElement === b;
      b.click();
      await new Promise((r) => setTimeout(r, 1400));
      return {
        ok: enfocado,
        modo: document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glMode,
        pressed: b.getAttribute('aria-pressed'),
        texto: b.textContent,
      };
    });
    check(
      'el modo color es alcanzable por teclado y anuncia su estado (§8)',
      teclado.ok === true && teclado.modo === 'color' && teclado.pressed === 'true',
      JSON.stringify(teclado),
    );

    // ---------------------------------------------------------------- presupuesto de pintado
    const paint = await page.evaluate(async () => {
      const ms: number[] = [];
      const t0 = performance.now();
      await new Promise<void>((done) => {
        const tick = (): void => {
          const v = Number(document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glMs ?? 0);
          if (v > 0) ms.push(v);
          if (performance.now() - t0 > 2500) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      ms.sort((a, b) => a - b);
      return { p90: ms[Math.floor(ms.length * 0.9)] ?? 0, n: ms.length };
    });
    check(
      'el pintado se mantiene ≤ 4 ms por frame (§8)',
      paint.p90 <= 4,
      `p90 ${paint.p90.toFixed(2)} ms sobre ${paint.n} muestras`,
    );

    const footer = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('[data-ascii-footer]');
      return { w: c?.width ?? 0, h: c?.height ?? 0, listo: c?.dataset.glReady === '1' };
    });
    check('el jaguar del footer se instancia', footer.w > 0 && footer.listo, JSON.stringify(footer));
    check('sin errores de consola', errores.length === 0, errores.join(' | '));
    const vivo = await variacion(page);
    await page.close();

    // ---------------------------------------------------------------- reduced-motion
    const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await rm.emulateMedia({ reducedMotion: 'reduce' });
    await rm.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await esperarRetrato(rm);
    const quieto = await variacion(rm);
    // Concluyente: la variación en reposo tiene que ser al menos 100x menor que la del
    // retrato vivo, y el vídeo no puede haber avanzado nada.
    const ratio = quieto.delta > 0 ? vivo.delta / quieto.delta : Infinity;
    check(
      'con reduced-motion el retrato queda estático y el vídeo no avanza',
      quieto.video === 0 && (quieto.delta === 0 || ratio > 100),
      `variación en reposo ${quieto.delta} vs ${vivo.delta} en movimiento (x${ratio === Infinity ? '∞' : ratio.toFixed(0)}) · vídeo avanzó ${quieto.video.toFixed(2)} s`,
    );
    await rm.close();

    // ---------------------------------------------------------------- fallback explícito
    const dos = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await dos.goto(`http://localhost:${PORT}/?2d`, { waitUntil: 'load' });
    await dos.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 25_000 });
    await dos.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.reveal !== undefined,
      null,
      { timeout: 25_000 },
    );
    const esFallback = await dos.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
      return { tiene2D: c?.dataset.reveal !== undefined, tieneGL: c?.dataset.glReady === '1' };
    });
    check(
      'con ?2d se carga el fallback de Canvas 2D (chunk aparte)',
      esFallback.tiene2D && !esFallback.tieneGL,
      JSON.stringify(esFallback),
    );
    await dos.close();

    await browser.close();
    console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} comprobación(es) fallaron`}`);
    if (fallos > 0) process.exitCode = 1;
  } finally {
    preview.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
