// scripts/recon-nav-overlap.ts — ¿qué hace la referencia cuando pasa contenido por detrás de
// su nav transparente? ¿Lo deja colisionar, le pone un degradado, un backdrop-filter, una
// máscara? Se inspecciona el nav y se muestrean píxeles justo detrás de su texto en varias
// posiciones de scroll, para ver si el fondo cambia cuando hay contenido debajo.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon');

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForTimeout(6000);

  // 1) ¿Qué declara el nav y todo lo que hay dentro o justo detrás?
  const declared = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('header, [class*="fixed"][class*="top-0"]');
    if (!nav) return null;
    const cs = getComputedStyle(nav);
    const kids = [...nav.querySelectorAll<HTMLElement>('*')].slice(0, 12).map((el) => {
      const k = getComputedStyle(el);
      return {
        cls: String(el.className).slice(0, 46),
        bg: k.backgroundColor,
        img: k.backgroundImage.slice(0, 70),
        filter: k.backdropFilter,
        mask: k.maskImage.slice(0, 40),
      };
    });
    return {
      tag: nav.tagName.toLowerCase(),
      cls: String(nav.className).slice(0, 70),
      bg: cs.backgroundColor,
      img: cs.backgroundImage.slice(0, 90),
      backdrop: cs.backdropFilter,
      mask: cs.maskImage.slice(0, 60),
      mixBlend: cs.mixBlendMode,
      isolation: cs.isolation,
      rect: (() => {
        const r = nav.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
      })(),
      kids: kids.filter((k) => k.bg !== 'rgba(0, 0, 0, 0)' || k.img !== 'none' || k.filter !== 'none'),
    };
  });
  console.log('=== lo que declara el nav ===');
  console.log(JSON.stringify(declared, null, 1));

  // 2) ¿Hay algún elemento hermano que haga de velo detrás del nav?
  const veils = await page.evaluate(() => {
    return [...document.querySelectorAll<HTMLElement>('body *')]
      .map((el) => ({ el, r: el.getBoundingClientRect(), cs: getComputedStyle(el) }))
      .filter(
        ({ r, cs }) =>
          (cs.position === 'fixed' || cs.position === 'sticky') &&
          r.top <= 2 &&
          r.height > 40 &&
          r.height < 220 &&
          r.width > 1200 &&
          (cs.backgroundImage !== 'none' ||
            cs.backdropFilter !== 'none' ||
            cs.backgroundColor !== 'rgba(0, 0, 0, 0)'),
      )
      .map(({ el, r, cs }) => ({
        cls: `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 46)}`,
        alto: Math.round(r.height),
        bg: cs.backgroundColor,
        img: cs.backgroundImage.slice(0, 80),
        backdrop: cs.backdropFilter,
      }));
  });
  console.log(`\n=== velos fijos a la altura del nav: ${veils.length} ===`);
  veils.forEach((v) => console.log('  ' + JSON.stringify(v)));

  // 3) Prueba empírica: capturar la franja del nav en varias posiciones de scroll y ver si
  //    el contenido de detrás se lee a través o queda velado.
  const strips: string[] = [];
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let i = 0; i < 8; i++) {
    const y = Math.round((H - 900) * (i / 8));
    await page.evaluate((sy) => window.scrollTo(0, sy), y);
    await page.waitForTimeout(700);
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 110 } });
    strips.push(
      `<figure><img src="data:image/png;base64,${buf.toString('base64')}"><figcaption>scroll ${y}</figcaption></figure>`,
    );
  }

  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#111;font:11px ui-monospace,monospace;color:#bbb;padding:10px}
    figure{margin:0 0 8px} img{display:block;width:100%;outline:1px solid #333}
    figcaption{padding-top:2px}
  </style>${strips.join('')}`;
  const out = await ctx.newPage();
  await out.setContent(html);
  await out.waitForLoadState('networkidle');
  await (await out.$('body'))?.screenshot({ path: join(OUT, 'nav-overlap.png') });

  writeFileSync(join(OUT, 'nav-overlap.json'), JSON.stringify({ declared, veils }, null, 1), 'utf8');
  console.log('\n→ recon/nav-overlap.png y nav-overlap.json');
  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
