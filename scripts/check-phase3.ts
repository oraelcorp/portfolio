// scripts/check-phase3.ts — criterios de aceptación de la Fase 3 (§9): ms/frame, reveal por scanline,
// shimmer, interacción con puntero, pausa fuera de viewport y modo color por clic (§6.3 punto 11).

import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { confirmarPuntero } from './lib/pointer.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LEER_ACENTO, ES_ACENTO_FN } from './lib/acento.ts';

const PORT = 4175;
const URL = `http://localhost:${PORT}/?2d&debug`;
const OUT = resolve('screenshots', 'phase3');
const CLIP = { x: 790, y: 0, width: 650, height: 900 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const results: string[] = [];
const failures: string[] = [];
const consoleErrors: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  const line = `${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`;
  results.push(line);
  if (!ok) failures.push(line);
  console.log(line);
}

async function waitForServer(timeoutMs = 40_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      /* aún no levanta */
    }
    await sleep(400);
  }
  throw new Error(`El preview no respondió en ${URL}`);
}

/** Cuenta píxeles no negros del canvas y su reparto por color, para juzgar el render sin ojo humano. */
/**
 * Luminancia media de una caja del canvas, en coordenadas de VIEWPORT, compuesta sobre negro.
 * Compuesta y no cruda: `getImageData` devuelve RGBA sin premultiplicar, así que sin componer
 * mediría como si todo fuera opaco (el mismo error que ya costó una medición del peso).
 */
async function regionLuma(page: Page, vx: number, vy: number, r: number): Promise<number> {
  return page.evaluate(
    ({ vx, vy, r }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]');
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return 0;
      const caja = canvas.getBoundingClientRect();
      const escala = canvas.width / caja.width;
      const cx = (vx - caja.left) * escala;
      const cy = (vy - caja.top) * escala;
      const rad = r * escala;
      const x0 = Math.max(0, Math.round(cx - rad));
      const y0 = Math.max(0, Math.round(cy - rad));
      const w = Math.min(canvas.width - x0, Math.round(rad * 2));
      const h = Math.min(canvas.height - y0, Math.round(rad * 2));
      if (w <= 0 || h <= 0) return 0;
      const d = ctx.getImageData(x0, y0, w, h).data;
      let suma = 0;
      for (let i = 0; i < d.length; i += 4) {
        const al = (d[i + 3] ?? 0) / 255;
        suma += (0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0)) * al;
      }
      return suma / (w * h);
    },
    { vx, vy, r },
  );
}

async function canvasStats(page: Page) {
  return page.evaluate(`(() => {
    const ACC = ${LEER_ACENTO};
    ${ES_ACENTO_FN}
    const canvas = document.querySelector('[data-ascii]');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;

    let painted = 0;
    // Ojo: sin acentos graves aqui dentro, que esto vive en una plantilla de cadena.
    // greenish conserva el nombre por compatibilidad con el resto de la sonda, pero ya no mira
    // el verde: reconoce el ACENTO vigente (ver lib/acento.ts). Con el acento en guinda, "gana
    // el canal verde" dejaba de encontrar nada.
    let greenish = 0;
    let whiteish = 0;
    let warm = 0; // ámbar/naranja: solo aparece en modo color
    let topPainted = 0;
    let bottomPainted = 0;

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] ?? 0;
      if (a < 8) continue;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      painted++;

      const y = Math.floor(i / 4 / width);
      if (y < height / 2) topPainted++;
      else bottomPainted++;

      if (esAcento(r, g, b)) greenish++;
      else if (r > 150 && g > 150 && b > 150) whiteish++;
      else if (r > g + 25 && g > b + 15) warm++;
    }

    return { width, height, painted, greenish, whiteish, warm, topPainted, bottomPainted };
  })()`) as Promise<{
    width: number;
    height: number;
    painted: number;
    greenish: number;
    whiteish: number;
    warm: number;
    topPainted: number;
    bottomPainted: number;
  } | null>;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);

  let browser: Browser | undefined;

  try {
    await waitForServer();
    browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
    });

    // ---- Reveal por scanline: arranca al salir el preloader, así que se mide justo después
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 12_000 });
    // Desde la migración a WebGL (2026-09-08) el Canvas 2D es el FALLBACK y se carga con
    // `import()` dinámico, así que ya no basta con que se vaya el preloader: hay que esperar a
    // que la INSTANCIA exista. Solo eso: esperar aquí a que la onda TERMINE dejaría sin
    // muestras al check que mide su progresión, que es justo el siguiente.
    await page.waitForFunction(
      () => Boolean((window as unknown as { __asciiPortrait?: unknown }).__asciiPortrait),
      null,
      { timeout: 25_000 },
    );
    // El barrido dura 1.4 s. Muestrearlo desde Node es poco fiable: cada consulta cuesta ~50 ms
    // de ida y vuelta y se pierden muestras. La serie se graba DENTRO de la página con rAF y se
    // lee una sola vez al final.
    const progress = await page.evaluate(async () => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]');
      if (!canvas) return [];

      const series: number[] = [];
      await new Promise<void>((done) => {
        const started = performance.now();
        const tick = (): void => {
          series.push(Number(canvas.dataset.reveal ?? '0'));
          if (series.at(-1) === 1 || performance.now() - started > 4000) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return series;
    });
    await page.screenshot({ path: join(OUT, 'reveal-mid.png'), clip: CLIP });

    const partials = progress.filter((p) => p > 0.02 && p < 0.98);
    const monotonic = progress.every((p, i) => i === 0 || p >= (progress[i - 1] ?? 0));
    check(
      'la onda de entrada se expande progresivamente, no de golpe',
      partials.length >= 3 && monotonic && (progress.at(-1) ?? 0) > 0.98,
      `${partials.length} muestras intermedias · ${progress
        .slice(0, 6)
        .map((p) => p.toFixed(2))
        .join(' → ')} … ${(progress.at(-1) ?? 0).toFixed(2)}`,
    );

    await sleep(900);
    const settled = await canvasStats(page);

    const full = settled;
    await page.screenshot({ path: join(OUT, 'ascii-base.png'), clip: CLIP });
    check(
      'el retrato se dibuja',
      !!full && full.painted > 20_000,
      full ? `${full.painted} px` : 'sin canvas',
    );
    check(
      'la base es el acento y los brillos son blancos (§6.3 punto 5)',
      !!full && full.greenish > full.whiteish && full.whiteish > 200,
      full ? `verde ${full.greenish} · blanco ${full.whiteish}` : '',
    );

    // ---- Shimmer: dos capturas separadas deben diferir
    const a = await canvasStats(page);
    await sleep(700);
    const b = await canvasStats(page);
    check(
      'el shimmer cambia caracteres con el tiempo',
      !!a && !!b && a.painted !== b.painted,
      `${a?.painted} → ${b?.painted}`,
    );

    // ---- Puntero: aclara la zona que toca.
    // Se mide la LUMINANCIA MEDIA de una caja alrededor del cursor, no los píxeles casi
    // blancos de todo el canvas. Aquel criterio venía de cuando el puntero pintaba un disco
    // de `--fg` plano; ese disco se retiró el 2026-09-04 al entrar la sangría de color, que
    // tiñe hacia los tonos reales de la foto en vez de hacia el blanco, y el empuje de
    // luminancia bajó de 0.35 a 0.18. Contar blancos sobre el canvas entero daba diferencias
    // del 0.4 % —ruido del shimmer— y el check pasaba o fallaba según la corrida.
    const PX = 1120;
    const PY = 420;
    // Control en la misma corrida: una caja lejos del cursor, que NO debe aclararse. Sin él,
    // un shimmer más activo o un repintado global harían pasar el check sin que el puntero
    // hiciera nada. Es la contraparte de la lección del jank: correr siempre un control.
    // El punto está ELEGIDO con tinta medida (luma 24.2, comparable a la del cursor) y a
    // 291 px, muy por fuera del alcance máximo de la sangría (21 celdas ≈ 168 px). El primer
    // control que puse caía en zona sin tinta y leía 0.0 → 0.0: no demostraba nada.
    const LX = 1380;
    const LY = 550;
    // El puntero se mide con el retrato YA dibujado del todo: con la onda a medias la
    // luminancia de la zona sube por el barrido, no por el cursor (daba +4.8 % en vez de +20 %).
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.reveal === '1.000',
      null,
      { timeout: 25_000 },
    );
    const antesLuma = await regionLuma(page, PX, PY, 40);
    const antesLejos = await regionLuma(page, LX, LY, 40);
    await confirmarPuntero(page, PX, PY, '2d');
    await sleep(600);
    const conLuma = await regionLuma(page, PX, PY, 40);
    const conLejos = await regionLuma(page, LX, LY, 40);
    await page.screenshot({ path: join(OUT, 'pointer.png'), clip: CLIP });
    const subida = antesLuma > 0 ? (conLuma / antesLuma - 1) * 100 : 0;
    check(
      'el puntero aclara la zona que toca',
      subida > 5,
      `luminancia media ${antesLuma.toFixed(1)} → ${conLuma.toFixed(1)} (${subida >= 0 ? '+' : ''}${subida.toFixed(1)} %)`,
    );
    const deriva = antesLejos > 0 ? Math.abs(conLejos / antesLejos - 1) * 100 : 0;
    check(
      'y solo esa zona: lejos del cursor la luminancia no se mueve',
      deriva < subida / 2,
      `control a 291 px: ${antesLejos.toFixed(1)} → ${conLejos.toFixed(1)} (${deriva.toFixed(1)} % de deriva)`,
    );
    await page.mouse.move(300, 700, { steps: 15 });
    await sleep(500);

    // ---- Rendimiento durante la interacción (el peor caso real).
    // En reposo el motor no repinta a propósito, así que medir rAF sin mover el puntero
    // solo diría a qué ritmo throttlea el navegador, no cómo de caro es el efecto.
    interface Probe {
      __samples: number[];
      __raf: number;
    }

    await page.evaluate(() => {
      const w = window as unknown as Probe;
      w.__samples = [];
      let last = performance.now();
      const tick = (): void => {
        const now = performance.now();
        w.__samples.push(now - last);
        last = now;
        w.__raf = requestAnimationFrame(tick);
      };
      w.__raf = requestAnimationFrame(tick);
    });

    // Movimiento continuo del puntero: cada frame repinta de verdad, que es el peor caso.
    // El muestreo va DENTRO de la página, un dato POR FRAME, leyendo `lastFrameMs` de la
    // instancia (por eso `?debug`). Antes leía `dataset.frameMs`, que se publica 1 de cada 10
    // frames: cada valor se contaba diez veces y el p90 salía de ~20 datos distintos, no de
    // los 200 que parecía. Así reportaba 5.6–7.7 ms donde el coste real es de ~1–2 ms.
    await page.evaluate(() => {
      const w = window as unknown as {
        __paint: number[];
        __paintOn: boolean;
        __asciiPortrait?: { lastFrameMs: number };
      };
      w.__paint = [];
      w.__paintOn = true;
      const tick = (): void => {
        if (!w.__paintOn) return;
        const ms = w.__asciiPortrait?.lastFrameMs ?? 0;
        if (ms > 0) w.__paint.push(ms);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.move(1050, 300, { steps: 5 });
    for (let i = 0; i < 14; i++) {
      await page.mouse.move(1050 + (i % 2 === 0 ? 90 : -90), 300 + i * 22, { steps: 12 });
    }
    await sleep(300);
    const paintSamples = await page.evaluate(() => {
      const w = window as unknown as { __paint: number[]; __paintOn: boolean };
      w.__paintOn = false;
      return w.__paint;
    });

    const frameStats = await page.evaluate(() => {
      const w = window as unknown as Probe;
      cancelAnimationFrame(w.__raf);
      const s = [...w.__samples].sort((a, b) => a - b);
      return { median: s[Math.floor(s.length / 2)] ?? 0, count: s.length };
    });

    paintSamples.sort((x, y) => x - y);
    const worstPaint = paintSamples[Math.floor(paintSamples.length * 0.9)] ?? 0;

    check(
      'el pintado se mantiene ≤ 4 ms por frame (§8)',
      worstPaint <= 4,
      `p90 ${worstPaint.toFixed(2)} ms sobre ${paintSamples.length} muestras`,
    );
    // Nota: el intervalo de rAF en Playwright headless refleja el throttling del navegador, no
    // el coste del efecto. Se registra como dato, sin condicionar el resultado.
    console.log(
      `      (rAF mediana ${frameStats.median.toFixed(1)} ms sobre ${frameStats.count} frames — informativo)`,
    );

    await page.mouse.move(300, 700, { steps: 10 });
    await sleep(500);

    // ---- Modo color por clic (§6.3 punto 11)
    await page.click('[data-ascii]', { position: { x: 300, y: 400 } });
    await sleep(400);
    await page.screenshot({ path: join(OUT, 'color-crossfade.png'), clip: CLIP });
    await sleep(900);
    const colored = await canvasStats(page);
    await page.screenshot({ path: join(OUT, 'color-mode.png'), clip: CLIP });
    check(
      'el clic pasa a color real (aparecen tonos cálidos del jaguar)',
      !!colored && !!full && colored.warm > full.warm * 3 && colored.warm > 2000,
      `cálidos ${full?.warm} → ${colored?.warm}`,
    );

    const modeAttr = await page.evaluate(
      () => document.querySelector<HTMLElement>('[data-ascii]')?.dataset.mode,
    );
    check('el canvas expone su modo', modeAttr === 'color', String(modeAttr));

    // ---- Segundo clic: vuelve a ascii
    await page.click('[data-ascii]', { position: { x: 300, y: 400 } });
    await sleep(1300);
    const backToAscii = await canvasStats(page);
    check(
      'el segundo clic vuelve a ASCII',
      !!backToAscii && backToAscii.greenish > backToAscii.warm,
      `verde ${backToAscii?.greenish} · cálidos ${backToAscii?.warm}`,
    );

    // ---- Pausa fuera del viewport (§6.3 punto 10)
    await page.evaluate(() => document.querySelector('[data-section="faq"]')?.scrollIntoView());
    await sleep(900);
    const paused = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]')!;
      const before = canvas.toDataURL().length;
      return new Promise<boolean>((done) => {
        setTimeout(() => done(canvas.toDataURL().length === before), 700);
      });
    });
    check('el loop se pausa con el hero fuera del viewport', paused === true);

    // ---- Botón accesible por teclado para el modo color
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(900);
    const keyboard = await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-ascii-toggle]');
      if (!btn) return null;
      btn.focus();
      const focused = document.activeElement === btn;
      btn.click();
      return { focused, text: btn.textContent?.trim() };
    });
    await sleep(1200);
    check('el modo color es alcanzable por teclado', keyboard?.focused === true, JSON.stringify(keyboard));

    // ---- El footer tiene su propia instancia
    const footer = await page.evaluate(() => {
      const el = document.querySelector<HTMLCanvasElement>('[data-ascii-footer]');
      return el ? { w: el.width, h: el.height } : null;
    });
    check('el jaguar del footer se instancia', !!footer && footer.w > 0, JSON.stringify(footer));

    await page.evaluate(() => document.querySelector('[data-section="footer"]')?.scrollIntoView());
    await sleep(1500);
    await page.screenshot({ path: join(OUT, 'footer-ascii.png') });

    await ctx.close();

    // ---- reduced motion: sin shimmer, retrato estático completo
    const rCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    });
    const rPage = await rCtx.newPage();
    rPage.on('pageerror', (e) => consoleErrors.push(`[reduced] pageerror: ${e.message}`));
    await rPage.goto(URL, { waitUntil: 'load' });
    await rPage.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 12_000 });
    await sleep(900);
    await rPage.screenshot({ path: join(OUT, 'reduced-motion.png'), clip: CLIP });

    const still1 = await rPage.evaluate(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')!.toDataURL().length,
    );
    await sleep(800);
    const still2 = await rPage.evaluate(
      () => document.querySelector<HTMLCanvasElement>('[data-ascii]')!.toDataURL().length,
    );
    check('con reduced-motion el retrato queda estático', still1 === still2, `${still1} vs ${still2}`);

    await rCtx.close();
    await browser.close();
  } finally {
    preview.stop();
  }

  console.log(`\n${results.length - failures.length}/${results.length} comprobaciones OK`);
  if (consoleErrors.length > 0) {
    console.error(`\n${consoleErrors.length} error(es) de consola (§10.8):`);
    for (const e of consoleErrors) console.error(`  ${e}`);
  } else {
    console.log('Sin errores de consola.');
  }
  if (failures.length > 0 || consoleErrors.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
