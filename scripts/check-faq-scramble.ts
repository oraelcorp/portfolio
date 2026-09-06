// scripts/check-faq-scramble.ts — el scramble del FAQ va atado a la APERTURA, no al hover,
// así que tiene que funcionar igual con ratón, con teclado y con toque. Es la diferencia con
// los de principios y stack, que dependen de un cursor presente y sí se apagan en táctil.

import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4208;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots', 'faq');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

/** Graba los estados del texto de la primera pregunta mientras se dispara algo. */
async function grabar(page: Page, accion: () => Promise<void>): Promise<string[]> {
  await page.evaluate(() => {
    const w = window as unknown as { __faq: string[]; __faqOn: boolean };
    w.__faq = [];
    w.__faqOn = true;
    const span = document.querySelector<HTMLElement>('[data-faq-text]');
    const tick = (): void => {
      if (!w.__faqOn) return;
      const t = (span?.textContent ?? '').trim();
      if (w.__faq[w.__faq.length - 1] !== t) w.__faq.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await accion();
  await sleep(1100);
  return page.evaluate(() => {
    const w = window as unknown as { __faq: string[]; __faqOn: boolean };
    w.__faqOn = false;
    return w.__faq;
  });
}

async function irAlFaq(page: Page): Promise<void> {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
  await sleep(700);
  await page.evaluate(() =>
    document.querySelector('[data-section="faq"]')?.scrollIntoView({ block: 'center' }),
  );
  await sleep(1200);
}

async function probar(browser: Browser, tactil: boolean): Promise<void> {
  const ctx = await browser.newContext({
    viewport: tactil ? { width: 480, height: 900 } : { width: 1440, height: 900 },
    hasTouch: tactil,
    isMobile: tactil,
    deviceScaleFactor: tactil ? 2 : 1,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`[${tactil ? 'táctil' : 'ratón'}] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${tactil ? 'táctil' : 'ratón'}] ${m.text()}`);
  });

  await irAlFaq(page);
  const etiqueta = tactil ? 'táctil' : 'escritorio';

  const caja = await page.locator('[data-faq-q]').first().boundingBox();
  if (!caja) throw new Error('no encuentro la primera pregunta');

  // --- Abrir
  const alAbrir = await grabar(page, async () => {
    if (tactil) await page.touchscreen.tap(caja.x + caja.width / 2, caja.y + caja.height / 2);
    else await page.locator('[data-faq-q]').first().click();
  });
  check(
    `${etiqueta}: el título scramblea al ABRIR`,
    alAbrir.length > 4,
    `${alAbrir.length} estados · ${alAbrir
      .slice(1, 4)
      .map((t) => `"${t.slice(0, 22)}"`)
      .join(' → ')}`,
  );
  const abierto = await page.evaluate(
    () => document.querySelector('[data-faq-q]')?.getAttribute('aria-expanded') ?? '?',
  );
  check(`${etiqueta}: y la pregunta queda abierta`, abierto === 'true', `aria-expanded=${abierto}`);
  await page.screenshot({
    path: join(OUT, `${tactil ? 480 : 1440}-abierta.png`),
    clip: { x: 0, y: Math.max(0, caja.y - 60), width: tactil ? 480 : 1440, height: 300 },
  });

  // --- Cerrar
  const alCerrar = await grabar(page, async () => {
    if (tactil) await page.touchscreen.tap(caja.x + caja.width / 2, caja.y + caja.height / 2);
    else await page.locator('[data-faq-q]').first().click();
  });
  check(`${etiqueta}: y también al CERRAR`, alCerrar.length > 4, `${alCerrar.length} estados`);

  // --- El texto acaba restituido, sin residuos del barajado
  const final = await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('[data-faq-text]');
    return { texto: (s?.textContent ?? '').trim(), original: (s?.dataset.original ?? '').trim() };
  });
  check(
    `${etiqueta}: el texto acaba restituido`,
    final.texto === final.original && final.texto.length > 0,
    `"${final.texto}"`,
  );

  // --- El hover: solo con puntero fino
  if (!tactil) {
    await irAlFaq(page);
    // La PRIMERA, que es la que graba `grabar()`: al pasar el cursor por la segunda no se
    // veía nada porque el grabador miraba el texto de la otra pregunta.
    const conHover = await grabar(page, async () => {
      await page.locator('[data-faq-q]').first().hover();
    });
    check(
      'escritorio: también scramblea al pasar por encima',
      conHover.length > 3,
      `${conHover.length} estados`,
    );
  }

  await ctx.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  await waitForServer();
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());

  await probar(browser, false);
  console.log('');
  await probar(browser, true);

  console.log(`\n${results.length - failures.length}/${results.length} comprobaciones OK`);
  console.log(
    consoleErrors.length === 0 ? 'Sin errores de consola.' : `ERRORES:\n${consoleErrors.join('\n')}`,
  );
  if (failures.length > 0 || consoleErrors.length > 0) process.exitCode = 1;

  await browser.close();
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
