// scripts/audit-contrast.ts — mide el contraste REAL de todo el texto del sitio contra el
// fondo sobre el que se pinta, teniendo en cuenta la opacidad heredada de los ancestros.
// Criterio WCAG 2.1 AA: 4.5:1 para texto normal, 3:1 para texto grande (≥24px, o ≥18.66px
// en negrita). No arregla nada: reporta qué falla, dónde y por cuánto.
//
// La opacidad importa: un párrafo al 32 % dentro de un scrollytelling se compone contra el
// fondo y su contraste efectivo no tiene nada que ver con el de su color declarado.

import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 4211;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots', 'a11y');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface Fallo {
  seccion: string;
  texto: string;
  ratio: number;
  exigido: number;
  fg: string;
  bg: string;
  opacidad: number;
  fuente: string;
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

/** Recorre la página para que disparen los ScrollTrigger y el layout se asiente. */
async function recorrer(page: Page): Promise<void> {
  const alto = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < alto; y += 500) {
    await page.evaluate((sy) => window.scrollTo(0, sy), y);
    await sleep(160);
  }
  await sleep(500);
}

export async function medirContraste(page: Page): Promise<Fallo[]> {
  return page.evaluate(() => {
    const rgb = (s: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(s);
      if (!m) return [0, 0, 0, 0];
      const v = (m[1] ?? '').split(',').map((x) => parseFloat(x));
      return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1];
    };
    const lum = (c: [number, number, number]): number => {
      const f = (x: number): number => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const ratio = (a: [number, number, number], b: [number, number, number]): number => {
      const la = lum(a);
      const lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    /** Compone `fg` sobre `bg` con alfa `a`. */
    const mezcla = (
      fg: [number, number, number],
      bg: [number, number, number],
      a: number,
    ): [number, number, number] => [
      bg[0] + (fg[0] - bg[0]) * a,
      bg[1] + (fg[1] - bg[1]) * a,
      bg[2] + (fg[2] - bg[2]) * a,
    ];

    /** El primer fondo opaco subiendo por el árbol. */
    const fondoDe = (el: HTMLElement): [number, number, number] => {
      for (let n: HTMLElement | null = el; n; n = n.parentElement) {
        const [r, g, b, a] = rgb(getComputedStyle(n).backgroundColor);
        if (a > 0.95) return [r, g, b];
      }
      return [0, 0, 0];
    };

    /** Producto de las opacidades de todos los ancestros: lo que realmente se ve. */
    const opacidadEfectiva = (el: HTMLElement): number => {
      let o = 1;
      for (let n: HTMLElement | null = el; n; n = n.parentElement) {
        o *= Number(getComputedStyle(n).opacity);
        if (o < 0.001) break;
      }
      return o;
    };

    const fallos: Array<{
      seccion: string;
      texto: string;
      ratio: number;
      exigido: number;
      fg: string;
      bg: string;
      opacidad: number;
      fuente: string;
    }> = [];
    const vistos = new Set<string>();

    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      // Solo elementos con texto PROPIO, para no contar un contenedor por cada hijo
      const propio = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? '').trim())
        .join(' ')
        .trim();
      if (propio.length < 2) continue;

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;

      // Decorativo: si está oculto a la accesibilidad no es texto que nadie tenga que leer.
      // El wordmark gigante del footer entra aquí.
      if (el.closest('[aria-hidden="true"]')) continue;

      // Texto pintado con un degradado recortado (`background-clip: text`): su `color` es
      // `transparent`, así que compararlo con el fondo da 1.00:1 y no significa nada. Es el
      // caso del label del CTA, cuyo destello ya se verificó aparte.
      const clip =
        cs.backgroundClip || (cs as unknown as { webkitBackgroundClip?: string }).webkitBackgroundClip;
      if (clip === 'text') continue;

      // Bajo un ancestro `fixed` sin fondo propio, lo de detrás NO está en el árbol: es la
      // sección por la que se pasa en ese momento. Medirlo aquí daría un fondo inventado.
      // El nav es el único caso y su legibilidad se verificó con píxeles en tune-nav-scrim.
      let sobreFondoVariable = false;
      for (let n: HTMLElement | null = el; n; n = n.parentElement) {
        const cn = getComputedStyle(n);
        if (cn.position === 'fixed') {
          sobreFondoVariable = true;
          break;
        }
        const [, , , a] = rgb(cn.backgroundColor);
        if (a > 0.95) break;
      }
      if (sobreFondoVariable) continue;

      const op = opacidadEfectiva(el);
      if (op < 0.02) continue; // invisible: no hay nada que leer

      const bg = fondoDe(el);
      const [fr, fg2, fb, fa] = rgb(cs.color);
      const efectivo = mezcla([fr, fg2, fb], bg, Math.min(1, fa * op));
      const rr = ratio(efectivo, bg);

      const px = parseFloat(cs.fontSize);
      const grande = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
      const exigido = grande ? 3 : 4.5;
      if (rr >= exigido) continue;

      const seccion = el.closest('[data-section]')?.getAttribute('data-section') ?? 'nav/menu';
      const k = `${seccion}|${propio.slice(0, 24)}|${rr.toFixed(2)}`;
      if (vistos.has(k)) continue;
      vistos.add(k);

      const hex = (c: [number, number, number]): string =>
        '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');

      fallos.push({
        seccion,
        texto: propio.slice(0, 40),
        ratio: Math.round(rr * 100) / 100,
        exigido,
        fg: hex(efectivo),
        bg: hex(bg),
        opacidad: Math.round(op * 100) / 100,
        fuente: `${px.toFixed(0)}px/${cs.fontWeight}`,
      });
    }
    return fallos.sort((a, b) => a.ratio - b.ratio);
  });
}

async function auditar(browser: Browser, w: number, h: number, nombre: string): Promise<number> {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: w <= 768,
    isMobile: w <= 768,
    deviceScaleFactor: w <= 768 ? 2 : 1,
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20_000 });
  await sleep(700);
  await recorrer(page);

  const fallos = await medirContraste(page);
  console.log(`\n=== ${nombre} · ${w}×${h} ===`);
  if (fallos.length === 0) {
    console.log('  todo el texto cumple AA');
  } else {
    for (const f of fallos) {
      console.log(
        `  ${f.ratio.toFixed(2)}:1 (exige ${f.exigido}) · ${f.fuente} · op ${f.opacidad} · ${f.fg} sobre ${f.bg}\n` +
          `      [${f.seccion}] "${f.texto}"`,
      );
    }
  }
  await ctx.close();
  return fallos.length;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  await waitForServer();
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());

  let total = 0;
  total += await auditar(browser, 480, 900, 'móvil');
  total += await auditar(browser, 1440, 900, 'escritorio');

  console.log(`\n${total} fallos de contraste en total`);
  await browser.close();
  preview.stop();
  if (total > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
