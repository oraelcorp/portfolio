// scripts/check-phase2.ts — verifica los criterios de aceptación de la Fase 2 (§9) en el sitio real:
// preloader, menú (mouse + teclado + Esc + foco), tema del nav por sección, relevo del CTA y reduced-motion.
// Uso: npm run build && node scripts/check-phase2.ts

import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4174;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots', 'phase2');
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

function watchErrors(page: Page, tag: string): void {
  page.on('pageerror', (e) => consoleErrors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${tag}] console: ${m.text()}`);
  });
}

async function testPreloader(browser: Browser): Promise<void> {
  console.log('\n== Preloader');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watchErrors(page, 'preloader');

  await page.goto(URL, { waitUntil: 'commit' });
  await sleep(350);

  const early = await page.evaluate(() => {
    const el = document.querySelector('[data-preloader]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    // El acento se resuelve AQUÍ, del token, y se normaliza a rgb() pintándolo en un elemento
    // de usar y tirar: así la comparación es color contra color y no cadena contra cadena.
    const sonda = document.createElement('span');
    sonda.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    document.body.appendChild(sonda);
    const accentRgb = getComputedStyle(sonda).color;
    sonda.remove();
    return {
      bg: cs.backgroundColor,
      accentRgb,
      visible: cs.display !== 'none',
      loading: document.documentElement.dataset.loading,
    };
  });
  check('el preloader se muestra al entrar', early?.visible === true, JSON.stringify(early));
  // El color esperado NO se escribe a mano: se lee del token, que es la fuente de verdad. Con el
  // verde literal aquí, cambiar el acento tumbaba este check sin que hubiera nada roto.
  check(
    'usa el color de acento como fondo',
    early?.bg === early?.accentRgb,
    `${early?.bg ?? 'sin dato'} (token: ${early?.accentRgb ?? 'sin dato'})`,
  );
  await page.screenshot({ path: join(OUT, 'preloader-early.png') });

  await sleep(700);
  await page.screenshot({ path: join(OUT, 'preloader-mid.png') });

  // Se va solo, sin superar el mínimo + wipe con margen
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 8000 });
  check('el preloader se retira solo', true);
  await sleep(400);
  await page.screenshot({ path: join(OUT, 'after-preloader.png') });

  // Segunda visita en la misma sesión: se salta (§6.1)
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(600);
  const second = await page.evaluate(() => document.querySelector('[data-preloader]') !== null);
  check('no reaparece en la misma sesión (sessionStorage)', second === false);

  await ctx.close();
}

async function testMenuAndNav(browser: Browser): Promise<void> {
  console.log('\n== Menú y nav');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watchErrors(page, 'menu');

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 10_000 });
  await sleep(500);

  // --- El nav es transparente (como la referencia)
  const navBg = await page.evaluate(
    () => getComputedStyle(document.querySelector('[data-nav]')!).backgroundColor,
  );
  check('el nav no tiene fondo propio', navBg === 'rgba(0, 0, 0, 0)', navBg);

  // --- Abrir con el ratón
  await page.click('[data-menu-toggle]');
  await sleep(300);
  await page.screenshot({ path: join(OUT, 'menu-opening.png') });
  await sleep(900);
  await page.screenshot({ path: join(OUT, 'menu-open.png') });

  const openState = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-menu]')!;
    return {
      expanded: document.querySelector('[data-menu-toggle]')!.getAttribute('aria-expanded'),
      open: panel.dataset.open,
      inert: panel.hasAttribute('inert'),
      clip: getComputedStyle(panel).clipPath,
      label: document.querySelector<HTMLElement>('[data-menu-label]')!.textContent?.trim(),
      logo: document.querySelector<HTMLElement>('[data-logo]')!.textContent?.trim(),
      focusInPanel: panel.contains(document.activeElement),
    };
  });
  check('aria-expanded pasa a true', openState.expanded === 'true');
  check('el panel queda visible y no inert', openState.open === 'true' && !openState.inert);
  check('el foco entra al panel', openState.focusInPanel === true);
  check('el label cambia a CLOSE', openState.label === 'CLOSE', openState.label);
  check('el wordmark cambia a TRAPERO', openState.logo === 'TRAPERO', openState.logo);

  // --- Lenis se detiene mientras está abierto
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 900);
  await sleep(700);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  check(
    'el scroll queda bloqueado con el menú abierto',
    Math.abs(scrollAfter - scrollBefore) < 12,
    `${scrollBefore} → ${scrollAfter}`,
  );

  // --- Cerrar con Escape y comprobar que el foco vuelve
  await page.keyboard.press('Escape');
  await sleep(900);
  const closed = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-menu]')!;
    return {
      expanded: document.querySelector('[data-menu-toggle]')!.getAttribute('aria-expanded'),
      open: panel.dataset.open,
      inert: panel.hasAttribute('inert'),
      label: document.querySelector<HTMLElement>('[data-menu-label]')!.textContent?.trim(),
      logo: document.querySelector<HTMLElement>('[data-logo]')!.textContent?.trim(),
      focusOnToggle: document.activeElement === document.querySelector('[data-menu-toggle]'),
    };
  });
  check('Esc cierra el menú', closed.open === 'false' && closed.expanded === 'false');
  check('el panel vuelve a ser inert', closed.inert === true);
  check('el foco vuelve al botón MENU', closed.focusOnToggle === true);
  check('el label vuelve a MENU', closed.label === 'MENU', closed.label);
  check('el wordmark vuelve a JAVIER', closed.logo === 'JAVIER', closed.logo);

  // --- Abrir con teclado (Enter sobre el botón)
  await page.focus('[data-menu-toggle]');
  await page.keyboard.press('Enter');
  await sleep(900);
  const byKeyboard = await page.evaluate(
    () => document.querySelector<HTMLElement>('[data-menu]')!.dataset.open,
  );
  check('se abre con teclado', byKeyboard === 'true');
  await page.keyboard.press('Escape');
  await sleep(800);

  // --- Hover del CTA: relevo entre los DOS "+" (medido en la referencia, item 3).
  // Ningún "+" viaja: el de la derecha encoge a 0 y el de la izquierda crece de 0 a 1.
  const ctaScales = () =>
    page.evaluate(() => {
      const g = document.querySelector<HTMLElement>('.nav__cta')!;
      const norm = (sel: string): number => {
        const m = new DOMMatrixReadOnly(getComputedStyle(g.querySelector<HTMLElement>(sel)!).transform);
        return Math.round(Math.hypot(m.a, m.b) * 100) / 100;
      };
      const lab = new DOMMatrixReadOnly(
        getComputedStyle(g.querySelector<HTMLElement>('.btn--label')!).transform,
      );
      return { inS: norm('.btn--icon-in'), outS: norm('.btn--icon-out'), labX: Math.round(lab.m41) };
    });

  const ctaBefore = await ctaScales();
  await page.hover('.nav__cta .btn--label');
  await sleep(900);
  const ctaAfter = await ctaScales();
  await page.screenshot({
    path: join(OUT, 'cta-hover.png'),
    clip: { x: 1000, y: 0, width: 440, height: 110 },
  });
  check(
    'en reposo solo se ve el "+" de la derecha',
    ctaBefore.inS < 0.05 && ctaBefore.outS > 0.95,
    `izq ${ctaBefore.inS} · der ${ctaBefore.outS}`,
  );
  check(
    'en hover se hace el relevo: crece el izquierdo y encoge el derecho',
    ctaAfter.inS > 0.95 && ctaAfter.outS < 0.05,
    `izq ${ctaAfter.inS} · der ${ctaAfter.outS}`,
  );
  check(
    'y el label se desliza al hueco que queda',
    ctaBefore.labX < -20 && Math.abs(ctaAfter.labX) < 2,
    `label de ${ctaBefore.labX}px a ${ctaAfter.labX}px`,
  );

  await page.mouse.move(700, 600);
  await sleep(600);

  // --- Tema del nav según la sección de debajo
  const themes: Record<string, string> = {};
  for (const id of ['stats', 'work', 'principles', 'faq']) {
    await page.evaluate((section) => {
      const el = document.querySelector(`[data-section="${section}"]`);
      el?.scrollIntoView({ block: 'start' });
    }, id);
    await sleep(900);
    themes[id] = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('[data-nav]')!;
      return `${nav.dataset.theme}|${getComputedStyle(nav).color}`;
    });
  }
  check('el nav se aclara sobre secciones claras', themes.stats?.startsWith('light') === true, themes.stats);
  check('el nav se oscurece sobre secciones oscuras', themes.work?.startsWith('dark') === true, themes.work);
  check(
    'cambia también en principles (claro)',
    themes.principles?.startsWith('light') === true,
    themes.principles,
  );
  check('y en faq (oscuro)', themes.faq?.startsWith('dark') === true, themes.faq);

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(700);
  await page.screenshot({ path: join(OUT, 'nav-dark.png'), clip: { x: 0, y: 0, width: 1440, height: 110 } });
  await page.evaluate(() =>
    document.querySelector('[data-section="stats"]')?.scrollIntoView({ block: 'start' }),
  );
  await sleep(900);
  await page.screenshot({ path: join(OUT, 'nav-light.png'), clip: { x: 0, y: 0, width: 1440, height: 110 } });

  await ctx.close();
}

/**
 * El magnetismo se REVIRTIÓ el 2026-09-04 por decisión de Javier (ver CLAUDE.md › Decisiones):
 * la medición original decía que la referencia no lo tiene, y él lo confirmó viéndolo en vídeo.
 * Aquí se comprueba justo lo contrario que antes: que el CTA NO persigue al puntero.
 * El encogimiento y el auto-hide del nav sí siguen siendo diferenciadores suyos.
 */
async function testNoMagnetismAndScrollNav(browser: Browser): Promise<void> {
  console.log('\n== El CTA ya no persigue al puntero · comportamiento de scroll del nav');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watchErrors(page, 'cta');

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 10_000 });
  await sleep(600);

  const groupTranslate = () =>
    page.evaluate(() => {
      const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.nav__cta')!).transform);
      return { x: Math.round(m.m41 * 10) / 10, y: Math.round(m.m42 * 10) / 10 };
    });

  const box = await page.evaluate(() => {
    const r = document.querySelector('.nav__cta')!.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  });

  // Puntero cerca del botón, donde antes tiraba de él
  await page.mouse.move(box.cx - box.w * 0.6, box.cy, { steps: 20 });
  await sleep(700);
  const near = await groupTranslate();
  check(
    'el CTA no se desplaza hacia el puntero al acercarse',
    Math.abs(near.x) < 1.5 && Math.abs(near.y) < 1.5,
    JSON.stringify(near),
  );

  // Y encima tampoco
  await page.mouse.move(box.cx, box.cy, { steps: 12 });
  await sleep(700);
  const over = await groupTranslate();
  check('ni con el puntero encima', Math.abs(over.x) < 1.5 && Math.abs(over.y) < 1.5, JSON.stringify(over));
  await page.screenshot({
    path: join(OUT, 'cta-no-magnet.png'),
    clip: { x: 1000, y: 0, width: 440, height: 120 },
  });

  await page.mouse.move(300, 700, { steps: 20 });
  await sleep(900);

  // --- Encogimiento a los 80 px
  const padTop = () =>
    page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('[data-nav]')!;
      return { scrolled: nav.dataset.scrolled, padding: getComputedStyle(nav).paddingTop };
    });

  const atTop = await padTop();
  await page.evaluate(() => window.scrollTo(0, 150));
  await sleep(900);
  const scrolled = await padTop();
  check(
    'el nav encoge pasados 80 px',
    scrolled.scrolled === 'true' && scrolled.padding !== atTop.padding,
    `${atTop.padding} → ${scrolled.padding}`,
  );

  // --- Auto-hide al bajar / reaparición al subir
  const navY = () =>
    page.evaluate(() => {
      const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-nav]')!).transform);
      return Math.round(m.m42);
    });

  await page.mouse.move(700, 500);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 400);
    await sleep(90);
  }
  await sleep(800);
  const hiddenY = await navY();
  check('el nav se oculta al bajar', hiddenY < -20, `translateY ${hiddenY}px`);
  await page.screenshot({
    path: join(OUT, 'nav-hidden.png'),
    clip: { x: 0, y: 0, width: 1440, height: 120 },
  });

  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -400);
    await sleep(90);
  }
  await sleep(900);
  const shownY = await navY();
  check('y reaparece al subir', shownY > -5, `translateY ${shownY}px`);

  // --- Con el menú abierto el nav no puede esconderse (dejaría CLOSE inalcanzable)
  await page.click('[data-menu-toggle]');
  await sleep(900);
  await page.mouse.wheel(0, 1200);
  await sleep(800);
  const withMenu = await navY();
  check('no se oculta con el menú abierto', withMenu > -5, `translateY ${withMenu}px`);
  await page.keyboard.press('Escape');
  await sleep(700);

  await ctx.close();
}

async function testReducedMotion(browser: Browser): Promise<void> {
  console.log('\n== prefers-reduced-motion');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  watchErrors(page, 'reduced');

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 10_000 });
  check('el preloader también termina con reduced-motion', true);

  await page.click('[data-menu-toggle]');
  await sleep(400);
  const open = await page.evaluate(() => ({
    open: document.querySelector<HTMLElement>('[data-menu]')!.dataset.open,
    label: document.querySelector<HTMLElement>('[data-menu-label]')!.textContent?.trim(),
  }));
  check('el menú abre sin animación', open.open === 'true', JSON.stringify(open));

  await page.keyboard.press('Escape');
  await sleep(300);
  const closed = await page.evaluate(() => document.querySelector<HTMLElement>('[data-menu]')!.dataset.open);
  check('y cierra con Esc', closed === 'false');

  await page.screenshot({ path: join(OUT, 'reduced-motion.png') });
  await ctx.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);

  try {
    await waitForServer();
    const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());

    await testPreloader(browser);
    await testMenuAndNav(browser);
    await testNoMagnetismAndScrollNav(browser);
    await testReducedMotion(browser);

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
