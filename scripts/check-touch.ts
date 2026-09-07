// scripts/check-touch.ts — comprueba la política de efectos de puntero en táctil (§9 Fase 5):
// qué se desactiva, qué se adapta, y que nada se quede "pegado" tras un toque, que es el
// fallo clásico de emular hover con `:hover` en un dispositivo sin cursor.

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4205;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots', 'touch');
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

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  await waitForServer();

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({
    viewport: { width: 480, height: 900 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
  await sleep(900);

  // El navegador debe reportarse como sin hover, que es lo que consulta isTouch()
  const sinHover = await page.evaluate(() => window.matchMedia('(hover: none)').matches);
  check('el contexto se comporta como táctil', sinHover, `(hover: none) = ${sinHover}`);

  // --- La pill de work no debe existir siquiera
  await page.evaluate(() =>
    document.querySelector('[data-section="work"]')?.scrollIntoView({ block: 'start' }),
  );
  await sleep(1200);
  const pill = await page.evaluate(() => {
    const f = document.querySelector<HTMLElement>('[data-work-follower]');
    return {
      existe: !!f,
      listo: f?.hasAttribute('data-ready') ?? false,
      display: f ? getComputedStyle(f).display : '-',
    };
  });
  check(
    'la pill que persigue al cursor está desactivada',
    !pill.listo && pill.display === 'none',
    `data-ready=${pill.listo} display=${pill.display}`,
  );

  // --- Un toque sobre la figura no debe dejar la pill visible
  const fig = await page.locator('.work__figure').first().boundingBox();
  if (fig) {
    await page.touchscreen.tap(fig.x + fig.width / 2, fig.y + fig.height / 2);
    await sleep(900);
    // Visibilidad EFECTIVA, no la opacidad de la pill: su contenedor está en `display: none`,
    // así que mirar solo su opacidad daba un fallo que no existía.
    const tras = await page.evaluate(() => {
      const p = document.querySelector<HTMLElement>('.work__pill');
      if (!p) return { visible: false, motivo: 'no existe' };
      for (let el: HTMLElement | null = p; el; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none')
          return { visible: false, motivo: `${el.className || el.tagName} en display:none` };
        if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.02)
          return { visible: false, motivo: `${el.className || el.tagName} invisible` };
      }
      return { visible: true, motivo: 'se ve' };
    });
    check('y sigue oculta tras tocar la figura', !tras.visible, tras.motivo);
  }

  // --- El retrato: sin efecto de puntero, pero el toque para alternar color SÍ funciona
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1000);
  const antes = await page.evaluate(
    () => document.querySelector('[data-ascii]')?.getAttribute('data-mode') ?? '?',
  );
  const canvas = await page.locator('[data-ascii]').boundingBox();
  if (canvas) {
    await page.touchscreen.tap(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.6);
    await sleep(1600);
  }
  const despues = await page.evaluate(
    () => document.querySelector('[data-ascii]')?.getAttribute('data-mode') ?? '?',
  );
  check('el toque en el retrato alterna a modo color', antes !== despues, `${antes} → ${despues}`);
  await page.screenshot({ path: join(OUT, 'retrato-tocado.png') });

  // --- El CTA: el scramble se desactiva, pero el relevo del "+" responde al toque
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(900);
  // El CTA del nav se oculta por debajo de 48rem (el "+" del menú ocupa su sitio),
  // así que en móvil se prueba el del hero, que sí está a la vista.
  const cta = await page.locator('.hero__actions .btn--label').first().boundingBox();
  const textoAntes = await page.evaluate(() => document.querySelector('[data-cta-text]')?.textContent ?? '');
  if (cta) {
    await page.touchscreen.tap(cta.x + cta.width / 2, cta.y + cta.height / 2);
    await sleep(400);
  }
  const textoDurante = await page.evaluate(
    () => document.querySelector('[data-cta-text]')?.textContent ?? '',
  );
  check('el scramble del CTA no se dispara al tocar', textoAntes === textoDurante, `"${textoDurante}"`);

  // --- Nada se queda pegado: tras tocar en otro sitio, los estados de hover se deshacen
  await page.touchscreen.tap(20, 400);
  await sleep(1200);
  const pegado = await page.evaluate(() => {
    const malos: string[] = [];
    // Los grupos de CTA que estén REALMENTE a la vista deben volver a su reposo: el "+"
    // izquierdo encogido. Medir uno en `display: none` daba `transform: none` y por tanto
    // una escala de 1.00 que parecía un estado pegado y no lo era.
    for (const g of document.querySelectorAll<HTMLElement>('[data-cta]')) {
      if (g.getBoundingClientRect().width < 2) continue;
      const inI = g.querySelector<HTMLElement>('.btn--icon-in');
      if (!inI) continue;
      const m = new DOMMatrixReadOnly(getComputedStyle(inI).transform);
      const s = Math.hypot(m.a, m.b);
      if (s > 0.1) malos.push(`un "+" izquierdo quedó a escala ${s.toFixed(2)}`);
    }
    // El halo del contacto no debe haberse encendido
    const c = document.querySelector<HTMLElement>('[data-section="contact"]');
    if (c && getComputedStyle(c).getPropertyValue('--halo').trim() === '1')
      malos.push('el halo del contacto quedó encendido');
    return malos;
  });
  check(
    'ningún estado de hover se queda pegado tras tocar fuera',
    pegado.length === 0,
    pegado.join(' · ') || 'ninguno',
  );

  // --- Coste: sin los efectos de puntero, el retrato debe pintar menos.
  // La instancia solo se expone con `?debug`, que aquí no está puesto, así que se lee el
  // atributo del canvas —que publica el peor frame de cada ventana de diez—. Leer
  // `__asciiPortrait` sin `?debug` devolvía `undefined` y esta línea reportaba 0.00 siempre.
  const ms = await page.evaluate(async () => {
    const s: number[] = [];
    for (let i = 0; i < 40; i++) {
      s.push(Number(document.querySelector<HTMLElement>('[data-ascii]')?.dataset.frameMs ?? '0'));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    return Math.max(...s);
  });
  console.log(`      coste máximo de pintado del retrato en táctil: ${ms.toFixed(2)} ms`);

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
