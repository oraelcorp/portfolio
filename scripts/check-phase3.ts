// scripts/check-phase3.ts — criterios de aceptación de la Fase 3 (§9): ms/frame, reveal por scanline,
// shimmer, interacción con puntero, pausa fuera de viewport y modo color por clic (§6.3 punto 11).

import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4175;
const URL = `http://localhost:${PORT}/`;
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
async function canvasStats(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;

    let painted = 0;
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

      if (g > r + 40 && g > b + 40) greenish++;
      else if (r > 150 && g > 150 && b > 150) whiteish++;
      else if (r > g + 25 && g > b + 15) warm++;
    }

    return { width, height, painted, greenish, whiteish, warm, topPainted, bottomPainted };
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

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
    // El barrido dura 1.4 s. Leer el canvas entero cuesta ~150 ms, demasiado para muestrear una
    // animación: se sigue el progreso que el propio motor publica en data-reveal.
    const progress: number[] = [];
    for (let i = 0; i < 26; i++) {
      const v = await page.evaluate(
        () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.reveal,
      );
      if (v !== undefined) progress.push(Number(v));
      if (progress.at(-1) === 1) break;
      await sleep(60);
    }
    await page.screenshot({ path: join(OUT, 'reveal-mid.png'), clip: CLIP });

    const partials = progress.filter((p) => p > 0.02 && p < 0.98);
    const monotonic = progress.every((p, i) => i === 0 || p >= (progress[i - 1] ?? 0));
    check(
      'el reveal avanza de arriba abajo (scanline), no de golpe',
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

    // ---- Puntero: aclara la zona hacia blanco
    const beforePointer = await canvasStats(page);
    await page.mouse.move(1120, 420, { steps: 20 });
    await sleep(600);
    const withPointer = await canvasStats(page);
    await page.screenshot({ path: join(OUT, 'pointer.png'), clip: CLIP });
    check(
      'el puntero aclara la zona que toca',
      !!beforePointer && !!withPointer && withPointer.whiteish > beforePointer.whiteish,
      `blanco ${beforePointer?.whiteish} → ${withPointer?.whiteish}`,
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

    // Movimiento continuo del puntero: cada frame repinta de verdad, que es el peor caso
    const paintSamples: number[] = [];
    await page.mouse.move(1050, 300, { steps: 5 });
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(1050 + (i % 2 === 0 ? 90 : -90), 300 + i * 22, { steps: 12 });
      const ms = await page.evaluate(() =>
        Number(document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.frameMs ?? '0'),
      );
      if (ms > 0) paintSamples.push(ms);
    }

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
    server.kill();
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
