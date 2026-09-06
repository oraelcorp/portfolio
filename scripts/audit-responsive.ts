// scripts/audit-responsive.ts — audita el sitio en los cuatro anchos del §9 y REPORTA
// problemas concretos, no impresiones: desbordamiento horizontal, texto por debajo del mínimo
// legible, zonas táctiles pequeñas, elementos que se salen del viewport y solapes.
// No arregla nada: solo dice qué hay que arreglar y dónde.

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4203;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots', 'responsive');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Los cuatro anchos del §9. La altura es la típica de cada clase de dispositivo. */
const ANCHOS = [
  { w: 480, h: 900, nombre: 'móvil', touch: true },
  { w: 768, h: 1024, nombre: 'tablet', touch: true },
  { w: 1024, h: 768, nombre: 'portátil', touch: false },
  { w: 1440, h: 900, nombre: 'escritorio', touch: false },
] as const;

interface Hallazgo {
  tipo: string;
  detalle: string;
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

/** Recorre la página entera para que disparen los ScrollTrigger y se asiente el layout. */
async function recorrer(page: Page): Promise<void> {
  const alto = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < alto; y += 600) {
    await page.evaluate((sy) => window.scrollTo(0, sy), y);
    await sleep(180);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(600);
}

async function auditar(page: Page, ancho: number): Promise<Hallazgo[]> {
  return page.evaluate((w) => {
    const out: Array<{ tipo: string; detalle: string }> = [];
    const nombre = (el: Element): string => {
      const cls = String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.');
      const sec = el.closest('[data-section]')?.getAttribute('data-section') ?? '?';
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} [${sec}]`;
    };

    // 1) Desbordamiento horizontal del documento
    const doc = document.documentElement;
    if (doc.scrollWidth > w + 1) {
      out.push({
        tipo: 'scroll horizontal',
        detalle: `el documento mide ${doc.scrollWidth}px en un viewport de ${w}px`,
      });
    }

    // 2) Elementos que se salen por la derecha o por la izquierda
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (el.closest('[data-preloader]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // El canvas del hero sangra a propósito hasta el borde
      if (el.hasAttribute('data-ascii')) continue;
      // Lo que vive dentro de un contenedor que recorta no "se sale": el marquee es un
      // carrusel infinito cuya pista mide de propósito más que el viewport y va clipada.
      let clipado = false;
      for (let a: HTMLElement | null = el.parentElement; a; a = a.parentElement) {
        const ca = getComputedStyle(a);
        if (ca.overflowX !== 'visible' || ca.overflowY !== 'visible') {
          clipado = true;
          break;
        }
      }
      if (clipado) continue;
      if (r.right > w + 2 || r.left < -2) {
        out.push({
          tipo: 'se sale del viewport',
          detalle: `${nombre(el)} ocupa de ${Math.round(r.left)} a ${Math.round(r.right)}`,
        });
      }
    }

    // 3) Solapes entre secciones: un elemento cuyo rect cae dentro de OTRA sección delata
    //    un contenedor que perdió su posición y dejó escapar a sus hijos absolutos. Es
    //    justo el bug que se coló en el proceso a menos de 1024 px y que mirar solo el
    //    desbordamiento horizontal no detectaba.
    const secciones = [...document.querySelectorAll<HTMLElement>('[data-section]')].map((s2) => {
      const r = s2.getBoundingClientRect();
      return { id: s2.dataset.section ?? '?', top: r.top + scrollY, bottom: r.bottom + scrollY, el: s2 };
    });
    const yaVisto = new Set<string>();
    for (const el of document.querySelectorAll<HTMLElement>('main *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      const propia = secciones.find((s2) => s2.el.contains(el));
      if (!propia) continue;
      const top = r.top + scrollY;
      const bottom = r.bottom + scrollY;
      // ¿Cae mayoritariamente fuera de su propia sección?
      const dentro = Math.max(0, Math.min(bottom, propia.bottom) - Math.max(top, propia.top));
      if (dentro / (bottom - top) > 0.6) continue;
      const invade = secciones.find((s2) => s2.id !== propia.id && top < s2.bottom && bottom > s2.top);
      const k = `${nombre(el)}->${invade?.id}`;
      if (yaVisto.has(k)) continue;
      yaVisto.add(k);
      out.push({
        tipo: 'se escapa de su sección',
        detalle: `${nombre(el)} de ${Math.round(r.width)}×${Math.round(r.height)} invade "${invade?.id ?? 'fuera'}"`,
      });
    }

    // 3b) Desplazamientos que pisan al vecino. Un elemento `relative` o `sticky` con un
    //     offset se mueve SIN mover su hueco de layout, así que puede solaparse con lo que
    //     viene después sin que nada se salga del viewport ni escape de su sección. Es el
    //     caso del `top` del sticky del proceso, que sobrevivió al pasar a móvil y se comía
    //     97 px del párrafo de intro.
    const conTexto = [...document.querySelectorAll<HTMLElement>('main p, main h1, main h2, main h3, main li')]
      .map((t) => ({ t, r: t.getBoundingClientRect() }))
      .filter(({ r, t }) => r.height > 8 && (t.textContent ?? '').trim().length > 0);

    const yaDicho = new Set<string>();
    for (const el of document.querySelectorAll<HTMLElement>('main *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'relative' && cs.position !== 'sticky') continue;
      const dy = parseFloat(cs.top) || 0;
      const dx = parseFloat(cs.left) || 0;
      if (Math.abs(dy) < 2 && Math.abs(dx) < 2) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;

      for (const { t, r: tr } of conTexto) {
        if (el.contains(t) || t.contains(el)) continue;
        const solape = Math.min(r.bottom, tr.bottom) - Math.max(r.top, tr.top);
        const cruce = Math.min(r.right, tr.right) - Math.max(r.left, tr.left);
        if (solape <= 2 || cruce <= 2) continue;
        const k = `${nombre(el)}->${nombre(t)}`;
        if (yaDicho.has(k)) continue;
        yaDicho.add(k);
        out.push({
          tipo: 'desplazado sobre el vecino',
          detalle: `${nombre(el)} (top ${cs.top}) pisa ${Math.round(solape)}px de "${(t.textContent ?? '').trim().slice(0, 32)}"`,
        });
      }
    }

    // 4) Texto por debajo del mínimo legible en móvil
    const MIN = w <= 480 ? 12 : 11;
    const vistos = new Set<string>();
    for (const el of document.querySelectorAll<HTMLElement>('p,span,a,li,h1,h2,h3,h4,button')) {
      if (!el.textContent?.trim()) continue;
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      if (fs >= MIN || cs.display === 'none') continue;
      const k = `${nombre(el)}@${fs}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      out.push({ tipo: 'texto pequeño', detalle: `${nombre(el)} a ${fs.toFixed(1)}px (mínimo ${MIN})` });
    }

    // 5) Zonas táctiles. Criterio: WCAG 2.2 AA (SC 2.5.8) pide 24×24 CSS px y EXIME a los
    //    enlaces en línea dentro de un texto. Los 44×44 son AAA (2.5.5) y guía de plataforma,
    //    y se exigen aquí a los controles de verdad. Un umbral único de 44 para todo daba 17
    //    hallazgos mezclando botones con enlaces de párrafo, que no es accionable.
    if (w <= 768) {
      const chicas = new Set<string>();
      for (const el of document.querySelectorAll<HTMLElement>('a,button,[role="button"],summary')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;

        const esControl =
          el.tagName === 'BUTTON' ||
          el.getAttribute('role') === 'button' ||
          el.classList.contains('btn') ||
          el.classList.contains('nav__logo') ||
          el.hasAttribute('data-ascii-toggle');
        const min = esControl ? 44 : 24;

        // Un enlace en línea dentro de un párrafo está exento del mínimo.
        const enTexto =
          !esControl &&
          cs.display.startsWith('inline') &&
          el.parentElement?.textContent?.trim() !== el.textContent?.trim();

        // El área de impacto real incluye el relleno, que en un inline no altera el layout.
        const alto = r.height;
        if (alto >= min || (enTexto && alto >= 24)) continue;

        const k = `${nombre(el)}@${Math.round(r.width)}x${Math.round(alto)}`;
        if (chicas.has(k)) continue;
        chicas.add(k);
        out.push({
          tipo: esControl ? 'control con zona táctil pequeña' : 'enlace con zona táctil pequeña',
          detalle: `${nombre(el)} mide ${Math.round(r.width)}×${Math.round(alto)} (mínimo ${min})`,
        });
      }
    }

    return out;
  }, ancho);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  await waitForServer();

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  let total = 0;

  for (const v of ANCHOS) {
    const ctx = await browser.newContext({
      viewport: { width: v.w, height: v.h },
      hasTouch: v.touch,
      isMobile: v.touch,
      deviceScaleFactor: v.touch ? 2 : 1,
    });
    const page = await ctx.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errores.push(m.text());
    });

    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
    await sleep(700);
    await recorrer(page);

    const hallazgos = await auditar(page, v.w);
    total += hallazgos.length;

    console.log(`\n=== ${v.nombre} · ${v.w}×${v.h}${v.touch ? ' · táctil' : ''} ===`);
    if (hallazgos.length === 0) {
      console.log('  sin hallazgos');
    } else {
      const porTipo = new Map<string, string[]>();
      for (const h of hallazgos) {
        const l = porTipo.get(h.tipo) ?? [];
        l.push(h.detalle);
        porTipo.set(h.tipo, l);
      }
      for (const [tipo, lista] of porTipo) {
        console.log(`  ${tipo} (${lista.length}):`);
        for (const d of lista) console.log(`    · ${d}`);
      }
    }
    if (errores.length > 0) console.log(`  ERRORES DE CONSOLA: ${errores.join(' | ')}`);

    await page.screenshot({ path: join(OUT, `${v.w}-inicio.png`) });
    await page.evaluate(() =>
      document.querySelector('[data-section="work"]')?.scrollIntoView({ block: 'start' }),
    );
    await sleep(1000);
    await page.screenshot({ path: join(OUT, `${v.w}-work.png`) });
    await page.evaluate(() =>
      document.querySelector('[data-section="stack"]')?.scrollIntoView({ block: 'start' }),
    );
    await sleep(1000);
    await page.screenshot({ path: join(OUT, `${v.w}-stack.png`) });

    await ctx.close();
  }

  console.log(`\n${total} hallazgos en total · capturas en screenshots/responsive/`);
  await browser.close();
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
