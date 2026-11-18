// scripts/measure-titulares.ts — ¿en cuántas líneas se parte cada titular, y cuánto dura por eso
// su entrada?
//
// El barrido de dos barras dura 0.966 s por línea y las líneas van con desfase, así que el total
// crece con el número de líneas: `0.966 + (n - 1) * stagger`. En el hero son dos líneas y Javier
// lo aprobó. La pregunta antes de replicarlo al resto es si alguna sección se parte en más —y
// sobre todo en móvil, donde todo envuelve más— hasta el punto de que el efecto se haga largo.
//
// Se cuentan las líneas REALES que produce SplitText en la página, no las que uno supondría
// mirando el texto: dependen de la fuente cargada y del ancho de la columna.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4274;
const OUT = resolve('screenshots', 'titular');
/** Duración medida del barrido de UNA línea, en segundos (recon/texto-entrada.txt). */
const UNA_LINEA = 0.966;
const STAGGER = 0.08;
const VIEWPORTS = [
  { nombre: '1440', width: 1440, height: 900 },
  { nombre: '1024', width: 1024, height: 768 },
  { nombre: '390', width: 390, height: 844 },
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TOPE_MS = 8 * 60 * 1000;
const guardian = setTimeout(() => {
  console.error(`FATAL: la sonda pasó de ${TOPE_MS / 1000}s. Se corta para no dejar huérfanos.`);
  process.exit(1);
}, TOPE_MS);
guardian.unref?.();

const preview = startPreview(PORT);
const L: string[] = [];
const say = (s = ''): void => {
  console.log(s);
  L.push(s);
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
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: false });

  say('== LÍNEAS POR TITULAR Y DURACIÓN DEL BARRIDO ==');
  say(`   una línea dura ${UNA_LINEA.toFixed(3)} s · cada línea extra suma ${STAGGER} s de desfase`);

  for (const v of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.bringToFront();
    // Se recorre la página entera para que todos los ScrollTrigger monten sus SplitText.
    await page.evaluate(`(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    })()`);
    await sleep(1200);

    const filas = (await page.evaluate(`(() => {
      const fuera = [];
      const mide = (el, etiqueta) => {
        if (!el) return;
        // SplitText deja las líneas como hijos directos; si aún no se partió, es una línea.
        const lineas = el.querySelectorAll(':scope > div, :scope > .barwipe__l');
        fuera.push({
          etiqueta,
          texto: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
          n: Math.max(1, lineas.length),
        });
      };
      mide(document.querySelector('[data-hero-title]'), 'hero (h1)');
      for (const s of document.querySelectorAll('[data-section]')) {
        const h = s.querySelector('h2');
        if (h) mide(h, s.getAttribute('data-section') || '?');
      }
      return fuera;
    })()`)) as Array<{ etiqueta: string; texto: string; n: number }>;

    say('');
    say(`   --- ${v.nombre} px ---`);
    say('   sección          líneas   duración   texto');
    for (const f of filas) {
      const dur = UNA_LINEA + (f.n - 1) * STAGGER;
      say(
        `   ${f.etiqueta.padEnd(16)} ${String(f.n).padStart(6)}   ${dur.toFixed(2).padStart(7)} s   "${f.texto}"`,
      );
    }
    await ctx.close();
  }

  await browser.close();
  writeFileSync(join(OUT, 'titulares.txt'), L.join('\n'), 'utf8');
  say('');
  say(`Guardado en ${join(OUT, 'titulares.txt')}`);
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
