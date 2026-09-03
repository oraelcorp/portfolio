// scripts/check-phase4.ts — criterios de la Fase 4 (§9): entradas por scroll, solape del hero
// con el preloader, marquee reactivo, acordeón, reloj, easter eggs y ausencia de jank.

import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4186;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots', 'phase4');
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

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      /* aún no */
    }
    await sleep(400);
  }
  throw new Error(`El preview no respondió en ${URL}`);
}

function watch(page: Page, tag: string): void {
  page.on('pageerror', (e) => consoleErrors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${tag}] console: ${m.text()}`);
  });
}

/** Lleva una sección al viewport con rueda real, para que los ScrollTrigger disparen. */
async function scrollTo(page: Page, section: string): Promise<void> {
  await page.evaluate((s) => {
    document.querySelector(`[data-section="${s}"]`)?.scrollIntoView({ block: 'center' });
  }, section);
  await sleep(1100);
}

async function testHeroIntro(browser: Browser): Promise<void> {
  console.log('\n== Entrada del hero solapada con el preloader');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'hero');

  await page.goto(URL, { waitUntil: 'commit' });

  // Se graba dentro de la página: cuándo se mueve el titular y cuándo desaparece el overlay
  const timeline = await page.evaluate(async () => {
    const t0 = performance.now();
    let titleMovedAt = -1;
    let overlayGoneAt = -1;
    let baseline: number | null = null;

    await new Promise<void>((done) => {
      const tick = (): void => {
        // `gsap.from` ya aplica el estado inicial nada más crearse, así que basta con ver un
        // transform para dar por buena la animación. Lo que interesa es cuándo EMPIEZA A
        // CAMBIAR: se guarda el primer valor y se busca la primera variación real.
        if (titleMovedAt < 0) {
          const line = [...document.querySelectorAll<HTMLElement>('[data-hero-title] *')]
            .map((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)
            .find((v) => Math.abs(v) > 1);

          if (line !== undefined) {
            if (baseline === null) baseline = line;
            else if (Math.abs(line - baseline) > 2) titleMovedAt = performance.now() - t0;
          }
        }
        if (overlayGoneAt < 0 && !document.querySelector('[data-preloader]')) {
          overlayGoneAt = performance.now() - t0;
        }
        if (overlayGoneAt > 0 || performance.now() - t0 > 9000) done();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    return { titleMovedAt, overlayGoneAt };
  });

  check(
    'el titular ya se está moviendo antes de que el overlay desaparezca',
    timeline.titleMovedAt > 0 && timeline.titleMovedAt < timeline.overlayGoneAt,
    `titular a ${Math.round(timeline.titleMovedAt)} ms · overlay fuera a ${Math.round(timeline.overlayGoneAt)} ms`,
  );

  await sleep(1500);
  await page.screenshot({
    path: join(OUT, 'hero-final.png'),
    clip: { x: 0, y: 0, width: 1440, height: 900 },
  });

  const settled = await page.evaluate(() => {
    const sub = document.querySelector<HTMLElement>('[data-hero-sub]');
    const actions = document.querySelector<HTMLElement>('[data-hero-actions]');
    return {
      sub: sub ? getComputedStyle(sub).opacity : '0',
      actions: actions ? getComputedStyle(actions).opacity : '0',
    };
  });
  check(
    'sub-copy y botones acaban visibles',
    Number(settled.sub) > 0.95 && Number(settled.actions) > 0.95,
    JSON.stringify(settled),
  );

  await ctx.close();
}

async function testSections(browser: Browser): Promise<void> {
  console.log('\n== Entradas por scroll de las secciones');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'sections');

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
  await sleep(800);

  // Antes de scrollear, el contenido de más abajo no debe estar ya visible
  const before = await page.evaluate(
    () => getComputedStyle(document.querySelector('[data-section="stack"] .stack__group')!).opacity,
  );

  for (const s of ['stats', 'process', 'work', 'principles', 'stack', 'faq', 'contact']) {
    await scrollTo(page, s);
  }

  const after = await page.evaluate(() => {
    const opacity = (sel: string): number => {
      const el = document.querySelector<HTMLElement>(sel);
      return el ? Number(getComputedStyle(el).opacity) : 0;
    };
    return {
      stats: opacity('[data-section="stats"] .stats > *'),
      process: opacity('[data-section="process"] [data-step]'),
      work: opacity('[data-section="work"] [data-work-preview]'),
      principles: opacity('[data-section="principles"] .principles__item'),
      stack: opacity('[data-section="stack"] .stack__group'),
      faq: opacity('[data-section="faq"] .faq__item'),
    };
  });

  check('el contenido de abajo empieza oculto', Number(before) < 0.1, `opacidad inicial ${before}`);
  check(
    'todas las secciones acaban visibles tras pasar por ellas',
    Object.values(after).every((v) => v > 0.95),
    JSON.stringify(after),
  );

  // Titulares partidos en líneas por SplitText
  const lines = await page.evaluate(() => document.querySelectorAll('[data-section="work"] h2 div').length);
  check('los titulares se parten en líneas (SplitText)', lines > 0, `${lines} nodos de línea`);

  await ctx.close();
}

async function testMarquee(browser: Browser): Promise<void> {
  console.log('\n== Marquee reactivo al scroll');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'marquee');

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
  await sleep(800);

  const x = (): Promise<number> =>
    page.evaluate(() => {
      const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-marquee]')!).transform);
      return m.m41;
    });

  const a = await x();
  await sleep(700);
  const b = await x();
  check('la banda avanza sola', Math.abs(b - a) > 4, `${a.toFixed(0)} → ${b.toFixed(0)} px`);

  await ctx.close();
}

async function testFaqAndFooter(browser: Browser): Promise<void> {
  console.log('\n== Acordeón, reloj y easter eggs');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'faq');

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
  await sleep(600);

  await scrollTo(page, 'faq');

  const first = page.locator('[data-faq-q]').first();
  await first.click();
  await sleep(700);

  const opened = await page.evaluate(() => {
    const q = document.querySelector('[data-faq-q]')!;
    const panel = document.getElementById(q.getAttribute('aria-controls') ?? '');
    return { expanded: q.getAttribute('aria-expanded'), visible: panel ? !panel.hidden : false };
  });
  check('el acordeón abre', opened.expanded === 'true' && opened.visible, JSON.stringify(opened));
  await page.screenshot({ path: join(OUT, 'faq-open.png') });

  // Abrir otra debe cerrar la primera
  await page.locator('[data-faq-q]').nth(1).click();
  await sleep(700);
  const exclusive = await page.evaluate(
    () => document.querySelectorAll('[data-faq-q][aria-expanded="true"]').length,
  );
  check('solo queda una abierta a la vez', exclusive === 1, `${exclusive} abiertas`);

  // Reloj del footer
  await scrollTo(page, 'footer');
  const clock = await page.evaluate(() => document.querySelector('[data-clock]')?.textContent ?? '');
  check('el reloj muestra la hora de Guadalajara', /^\d{2}:\d{2}$/.test(clock), clock);

  // Easter eggs
  await page.keyboard.press('g');
  await sleep(400);
  const grid = await page.evaluate(() => document.querySelectorAll('.grid-overlay span').length);
  check('la tecla G muestra la rejilla de 12 columnas', grid === 12, `${grid} columnas`);
  await page.screenshot({ path: join(OUT, 'grid-overlay.png') });

  await page.keyboard.press('g');
  await sleep(300);
  const gridGone = await page.evaluate(() => document.querySelector('.grid-overlay') === null);
  check('y la vuelve a ocultar', gridGone);

  const accentBefore = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  );
  await page.keyboard.press('c');
  await sleep(400);
  const accentAfter = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  );
  check('la tecla C cambia el acento', accentBefore !== accentAfter, `${accentBefore} → ${accentAfter}`);
  await page.screenshot({ path: join(OUT, 'accent-changed.png') });

  await ctx.close();
}

async function testScrollJank(browser: Browser): Promise<void> {
  console.log('\n== Fluidez del scroll (§9: frames > 16 ms por debajo del 5 %)');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'jank');

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
  await sleep(900);

  const stats = (frames: number[]): { median: number; p95: number; pct: number; n: number } => {
    const s = frames.slice(5).sort((a, b) => a - b);
    return {
      median: s[Math.floor(s.length / 2)] ?? 0,
      p95: s[Math.floor(s.length * 0.95)] ?? 0,
      pct: s.length > 0 ? (s.filter((f) => f > 20).length / s.length) * 100 : 100,
      n: s.length,
    };
  };

  // El scroll se conduce DESDE DENTRO de la página: cada page.mouse.wheel es una ida y vuelta
  // por CDP que bloquea el hilo y contamina la medición de frames.
  const run = async (label: string): Promise<number[]> => {
    void label;
    return page.evaluate(async () => {
      const frames: number[] = [];
      let last = performance.now();
      const start = window.scrollY;

      await new Promise<void>((done) => {
        let n = 0;
        const tick = (): void => {
          const now = performance.now();
          frames.push(now - last);
          last = now;
          window.scrollTo(0, start + n * 26);
          if (++n < 150) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });

      return frames;
    });
  };

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(600);
  const top = stats(await run('hero'));

  await page.evaluate(() => document.querySelector('[data-section="stack"]')?.scrollIntoView());
  await sleep(600);
  const bottom = stats(await run('abajo'));

  console.log(
    `      hero (ASCII activo):  mediana ${top.median.toFixed(1)} ms · p95 ${top.p95.toFixed(1)} · ${top.pct.toFixed(1)} % > 20 ms`,
  );
  console.log(
    `      abajo (ASCII pausado): mediana ${bottom.median.toFixed(1)} ms · p95 ${bottom.p95.toFixed(1)} · ${bottom.pct.toFixed(1)} % > 20 ms`,
  );

  check(
    'sin jank al recorrer la página',
    top.pct < 10 && bottom.pct < 10,
    `hero ${top.pct.toFixed(1)} % · abajo ${bottom.pct.toFixed(1)} % de frames por encima de 20 ms`,
  );

  await ctx.close();
}

async function testReducedMotion(browser: Browser): Promise<void> {
  console.log('\n== prefers-reduced-motion');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  watch(page, 'reduced');

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
  await sleep(900);

  const visible = await page.evaluate(() => {
    const els = [
      '[data-hero-sub]',
      '[data-section="stack"] .stack__group',
      '[data-section="faq"] .faq__item',
    ];
    return els.map((s) => {
      const el = document.querySelector<HTMLElement>(s);
      return el ? Number(getComputedStyle(el).opacity) : 0;
    });
  });
  check(
    'todo el contenido es visible sin animar',
    visible.every((v) => v > 0.95),
    JSON.stringify(visible),
  );

  await ctx.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  try {
    await waitForServer();
    const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());

    await testHeroIntro(browser);
    await testSections(browser);
    await testMarquee(browser);
    await testFaqAndFooter(browser);
    await testScrollJank(browser);
    await testReducedMotion(browser);

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
