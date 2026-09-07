// scripts/audit-a11y.ts — Fase 5, bloque 2: teclado, foco, landmarks, reduced-motion y la
// alternativa textual del canvas. No arregla nada: recorre el sitio con el teclado de verdad
// y reporta qué se puede alcanzar, qué se ve al enfocarlo y qué queda mudo para un lector.
//
// Lo que NO hace: sustituir a un lector de pantalla real. Mide el árbol de accesibilidad que
// expone el navegador, que es una condición necesaria pero no suficiente.

import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4212;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots', 'a11y');
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

interface Parada {
  etiqueta: string;
  nombre: string;
  visible: boolean;
  enPantalla: boolean;
  anillo: string;
  contraste: number;
}

/** Describe el elemento con el foco: qué es, cómo se llama y qué se ve al enfocarlo. */
async function focoActual(page: Page): Promise<Parada> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body)
      return { etiqueta: '(body)', nombre: '', visible: false, enPantalla: false, anillo: '', contraste: 0 };

    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();

    // Nombre accesible aproximado: aria-label, luego el texto, luego el título/alt
    const etiquetado = el.getAttribute('aria-labelledby');
    const nombre =
      (
        el.getAttribute('aria-label') ??
        (etiquetado ? (document.getElementById(etiquetado)?.textContent ?? '') : '')
      ).trim() ||
      (() => {
        const visible = (n: Node): string => {
          if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? '';
          if (!(n instanceof HTMLElement) || n.getAttribute('aria-hidden') === 'true') return '';
          return [...n.childNodes].map(visible).join('');
        };
        return visible(el).replace(/\s+/g, ' ').trim().slice(0, 40);
      })() ||
      el.getAttribute('title') ||
      '';

    const rgb = (s: string): [number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(s);
      if (!m) return [0, 0, 0];
      const v = (m[1] ?? '').split(',').map((x) => parseFloat(x));
      return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
    };
    const lum = (c: [number, number, number]): number => {
      const f = (x: number): number => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };

    // El anillo se compara con el fondo sobre el que se dibuja, no con el del propio control:
    // `outline-offset` positivo lo saca fuera de la caja, así que cae sobre el fondo de detrás.
    let fondo: [number, number, number] = [0, 0, 0];
    for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const m = /rgba?\(([^)]+)\)/.exec(c);
      const a = m ? parseFloat((m[1] ?? '').split(',')[3] ?? '1') : 0;
      if (a > 0.95) {
        fondo = rgb(c);
        break;
      }
    }
    const anillo = rgb(cs.outlineColor);
    const la = lum(anillo);
    const lb = lum(fondo);
    const contraste = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);

    const ancho = parseFloat(cs.outlineWidth) || 0;
    const hayAnillo = cs.outlineStyle !== 'none' && ancho > 0;
    // Un `box-shadow` también vale como indicador de foco
    const haySombra = cs.boxShadow !== 'none' && cs.boxShadow.length > 0;

    return {
      etiqueta: `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}`,
      nombre,
      visible: hayAnillo || haySombra,
      enPantalla: r.top >= -2 && r.bottom <= window.innerHeight + 2 && r.width > 0 && r.height > 0,
      anillo: hayAnillo
        ? `${cs.outlineStyle} ${ancho}px ${cs.outlineColor}`
        : haySombra
          ? 'box-shadow'
          : 'ninguno',
      contraste: Math.round(contraste * 100) / 100,
    };
  });
}

/** Recorre el sitio con Tab y devuelve cada parada. */
async function recorrerConTab(page: Page, max = 60): Promise<Parada[]> {
  const paradas: Parada[] = [];
  const vistos = new Set<string>();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    await page.evaluate(
      () =>
        new Promise<void>((r) => {
          const el = document.activeElement;
          const ms = el ? parseFloat(getComputedStyle(el).transitionDuration) * 1000 : 0;
          setTimeout(r, Math.max(80, ms + 60));
        }),
    );
    const p = await focoActual(page);
    if (p.etiqueta === '(body)') break;
    const clave = `${p.etiqueta}|${p.nombre}`;
    if (vistos.has(clave) && paradas.length > 3) break; // dio la vuelta
    vistos.add(clave);
    paradas.push(p);
  }
  return paradas;
}

async function auditar(browser: Browser): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
  await sleep(800);

  // --- 1. El primer Tab debe dar el enlace para saltar al contenido
  await page.keyboard.press('Tab');
  await sleep(150);
  const primero = await focoActual(page);
  check(
    'el primer Tab enfoca el enlace de salto al contenido',
    /skip/i.test(primero.etiqueta) || /skip|content|contenido/i.test(primero.nombre),
    `${primero.etiqueta} "${primero.nombre}"`,
  );
  check('y el enlace de salto se hace visible al enfocarlo', primero.enPantalla, primero.anillo);
  await page.screenshot({
    path: join(OUT, 'foco-skip-link.png'),
    clip: { x: 0, y: 0, width: 700, height: 160 },
  });

  // --- 2. Recorrido completo con Tab
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
  await sleep(800);
  const paradas = await recorrerConTab(page);
  console.log(`\n  ${paradas.length} paradas de tabulación:`);
  for (const p of paradas) {
    console.log(
      `    ${p.visible ? '·' : '✗'} ${p.etiqueta.padEnd(28)} "${p.nombre.slice(0, 28).padEnd(28)}" ${p.anillo}`,
    );
  }

  const sinAnillo = paradas.filter((p) => !p.visible);
  check(
    'todo lo tabulable muestra indicador de foco (WCAG 2.4.7)',
    sinAnillo.length === 0,
    sinAnillo.length === 0 ? `${paradas.length} paradas` : sinAnillo.map((p) => p.etiqueta).join(', '),
  );

  const sinNombre = paradas.filter((p) => p.nombre.length < 1);
  check(
    'y todo lo tabulable tiene nombre accesible (WCAG 4.1.2)',
    sinNombre.length === 0,
    sinNombre.map((p) => p.etiqueta).join(', ') || 'ninguno mudo',
  );

  const bajoContraste = paradas.filter((p) => p.contraste > 0 && p.contraste < 3);
  check(
    'el anillo de foco contrasta ≥ 3:1 con su fondo (WCAG 1.4.11)',
    bajoContraste.length === 0,
    bajoContraste.map((p) => `${p.etiqueta} ${p.contraste}:1`).join(', ') || 'todos por encima',
  );

  const fueraDePantalla = paradas.filter((p) => !p.enPantalla);
  check(
    'el foco nunca queda fuera de la vista',
    fueraDePantalla.length === 0,
    fueraDePantalla.map((p) => p.etiqueta).join(', ') || 'siempre visible',
  );

  // --- 3. El menú: trampa de foco intencionada, y Esc devuelve el foco
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
  await sleep(800);
  await page.locator('[data-menu-toggle]').click();
  await sleep(700);
  const dentro: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    await sleep(60);
    dentro.push(
      await page.evaluate(() =>
        document.activeElement?.closest('.menu, [data-menu-toggle]') ? 'dentro' : 'FUERA',
      ),
    );
  }
  check(
    'con el menú abierto el foco no se escapa',
    !dentro.includes('FUERA'),
    `${dentro.filter((d) => d === 'dentro').length}/12 dentro`,
  );

  await page.keyboard.press('Escape');
  await sleep(700);
  const trasEsc = await page.evaluate(() => ({
    abierto: document.querySelector('.menu')?.getAttribute('data-open') ?? 'null',
    foco: document.activeElement?.getAttribute('data-menu-toggle') !== null,
  }));
  check(
    'Esc cierra el menú y devuelve el foco al botón',
    trasEsc.abierto !== 'true' && trasEsc.foco,
    `data-open=${trasEsc.abierto} foco en el toggle=${trasEsc.foco}`,
  );

  // --- 4. La alternativa textual del canvas
  const canvas = await page.evaluate(() => {
    const c = document.querySelector<HTMLElement>('[data-ascii]');
    const alt = document.querySelector<HTMLElement>('.hero__visual .visually-hidden');
    const toggle = document.querySelector<HTMLElement>('[data-ascii-toggle]');
    const cs = alt ? getComputedStyle(alt) : null;
    return {
      oculto: c?.getAttribute('aria-hidden') === 'true',
      texto: (alt?.textContent ?? '').trim(),
      // `display: none` o `visibility: hidden` lo esconderían TAMBIÉN del lector de pantalla:
      // la técnica correcta es sacarlo de la vista conservándolo en el árbol.
      enElArbol: cs ? cs.display !== 'none' && cs.visibility !== 'hidden' : false,
      toggleNombre: (toggle?.textContent ?? '').trim(),
      togglePressed: toggle?.getAttribute('aria-pressed') ?? null,
      footerOculto: document.querySelector('[data-ascii-footer]')?.getAttribute('aria-hidden') === 'true',
    };
  });
  check(
    'el canvas del retrato tiene alternativa textual',
    canvas.texto.length > 10 && canvas.enElArbol,
    `"${canvas.texto}"`,
  );
  check(
    'y el canvas en sí queda fuera del árbol (no se lee dos veces)',
    canvas.oculto,
    `aria-hidden=${canvas.oculto}`,
  );
  check(
    'el canvas decorativo del footer está oculto a lectores',
    canvas.footerOculto,
    `aria-hidden=${canvas.footerOculto}`,
  );
  check(
    'el botón que alterna el retrato anuncia su estado',
    canvas.togglePressed !== null,
    canvas.togglePressed === null ? 'sin aria-pressed' : `aria-pressed=${canvas.togglePressed}`,
  );

  // --- 4b. REGRESIÓN: el nombre accesible NO puede barajarse.
  // El scramble se dispara justo al recibir el foco, que es el instante en que un lector de
  // pantalla anuncia el control: si el texto que baraja ES el nombre, lo que se oye es el
  // galimatías. Se comprueba con el árbol de accesibilidad del propio navegador, no con
  // `textContent`, para no volver a medirlo con una aproximación mía.
  for (const [que, sel] of [
    ['el CTA', '.hero__actions a.btn'],
    ['una pregunta del FAQ', '[data-faq-q]'],
    ['el botón del menú', '[data-menu-toggle]'],
  ] as const) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    await loc.scrollIntoViewIfNeeded();
    await sleep(200);
    const nombres: string[] = [];
    await loc.focus();
    for (let i = 0; i < 14; i++) {
      // `ariaSnapshot` devuelve el árbol que computa el navegador, p. ej. `- link "SEE THE WORK"`
      const yaml = await loc.ariaSnapshot();
      nombres.push(/"([^"]*)"/.exec(yaml)?.[1] ?? '(sin nombre)');
      await sleep(70);
    }
    const unicos = [...new Set(nombres)];
    check(
      `${que}: su nombre accesible no cambia mientras baraja`,
      unicos.length === 1 && unicos[0] !== '(sin nombre)',
      unicos.length === 1
        ? `"${unicos[0]}"`
        : `${unicos.length} nombres: ${unicos
            .slice(0, 3)
            .map((n) => `"${n.slice(0, 24)}"`)
            .join(' → ')}`,
    );
  }

  // --- 5. Estructura: un solo h1, sin saltos de nivel, landmarks presentes
  const estructura = await page.evaluate(() => {
    const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({
      n: Number(h.tagName[1]),
      t: (h.textContent ?? '').trim().slice(0, 30),
    }));
    const saltos: string[] = [];
    for (let i = 1; i < hs.length; i++) {
      const prev = hs[i - 1];
      const cur = hs[i];
      if (prev && cur && cur.n > prev.n + 1) saltos.push(`h${prev.n} → h${cur.n} en "${cur.t}"`);
    }
    return {
      h1: hs.filter((h) => h.n === 1).length,
      saltos,
      main: !!document.querySelector('main'),
      nav: !!document.querySelector('nav'),
      footer: !!document.querySelector('footer'),
      lang: document.documentElement.lang || '(sin lang)',
    };
  });
  check('hay exactamente un h1', estructura.h1 === 1, `${estructura.h1}`);
  check(
    'los niveles de encabezado no saltan',
    estructura.saltos.length === 0,
    estructura.saltos.join(' · ') || 'sin saltos',
  );
  check(
    'existen los landmarks main/nav/footer',
    estructura.main && estructura.nav && estructura.footer,
    `main=${estructura.main} nav=${estructura.nav} footer=${estructura.footer}`,
  );
  check('el documento declara idioma', estructura.lang !== '(sin lang)', estructura.lang);

  await ctx.close();
}

/** Con `prefers-reduced-motion` nada debe moverse solo, y todo debe quedar en su estado final. */
async function auditarReducedMotion(browser: Browser): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`[reduce] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[reduce] console: ${m.text()}`);
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
  await sleep(1200);

  // Nada debe seguir animándose: se compara el canvas y el marquee consigo mismos en el tiempo
  const quieto = await page.evaluate(async () => {
    const marquee = document.querySelector<HTMLElement>('[data-marquee] > *');
    const antes = marquee ? getComputedStyle(marquee).transform : 'none';
    await new Promise((r) => setTimeout(r, 700));
    const despues = marquee ? getComputedStyle(marquee).transform : 'none';
    return { antes, despues, igual: antes === despues };
  });
  check(
    'con reduced-motion el marquee no se desplaza solo',
    quieto.igual,
    `${quieto.antes.slice(0, 24)} → ${quieto.despues.slice(0, 24)}`,
  );

  // El contenido que entra por scroll debe estar VISIBLE, no escondido esperando una animación
  const visibles = await page.evaluate(() => {
    const items = [...document.querySelectorAll<HTMLElement>('[data-reveal], [data-split], [data-step]')];
    const invisibles = items.filter((el) => {
      const cs = getComputedStyle(el);
      return Number(cs.opacity) < 0.05 || cs.visibility === 'hidden';
    });
    return { total: items.length, invisibles: invisibles.length };
  });
  check(
    'y todo el contenido queda visible sin depender de la animación',
    visibles.invisibles === 0,
    `${visibles.invisibles} invisibles de ${visibles.total}`,
  );

  // El retrato no debe hacer shimmer
  const shimmer = await page.evaluate(async () => {
    const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
    if (!c) return { cambia: false };
    const a = c.toDataURL().length;
    await new Promise((r) => setTimeout(r, 900));
    return { cambia: c.toDataURL().length !== a };
  });
  check('el retrato no hace shimmer con reduced-motion', !shimmer.cambia, `cambia=${shimmer.cambia}`);

  await page.screenshot({ path: join(OUT, 'reduced-motion.png'), fullPage: false });
  await ctx.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  await waitForServer();
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());

  await auditar(browser);
  console.log('');
  await auditarReducedMotion(browser);

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
