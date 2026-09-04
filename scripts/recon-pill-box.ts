// scripts/recon-pill-box.ts — mide la CAJA del cartel "VIEW PROJECT" de la referencia:
// ancho, alto, relleno, tipografía y a qué distancia del cursor cuelga. Sonda corta y
// repetible, separada de recon-work.ts (que tarda un par de minutos en completar su recorrido).

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon');
/** Posición dentro del showcase verificada a mano en la que la media grande está a la vista. */
const SCROLL = 5677;

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForTimeout(6000);
  await page.evaluate((y) => window.scrollTo(0, y), SCROLL);
  await page.waitForTimeout(1500);

  // El cartel solo existe con el puntero sobre la media.
  await page.mouse.move(950, 400);
  await page.waitForTimeout(900);

  const box = await page.evaluate(() => {
    const label = [...document.querySelectorAll<HTMLElement>('div')].find(
      (el) => (el.textContent ?? '').trim().toUpperCase() === 'VIEW PROJECT' && el.children.length === 0,
    );
    if (!label) return null;

    const cs = getComputedStyle(label);
    const r = label.getBoundingClientRect();
    const wrap = label.parentElement;
    const wr = wrap?.getBoundingClientRect();
    // El seguidor: el ancestro `fixed` que está traducido hasta el cursor.
    let fol: HTMLElement | null = label;
    while (fol && getComputedStyle(fol).position !== 'fixed') fol = fol.parentElement;
    const fr = fol?.getBoundingClientRect();

    return {
      w: Math.round(r.width * 100) / 100,
      h: Math.round(r.height * 100) / 100,
      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      font: `${cs.fontSize} / ${cs.lineHeight} · peso ${cs.fontWeight} · ls ${cs.letterSpacing}`,
      family: cs.fontFamily.split(',')[0],
      transform: cs.textTransform,
      bg: cs.backgroundColor,
      color: cs.color,
      radius: cs.borderRadius,
      wrapW: wr ? Math.round(wr.width * 100) / 100 : -1,
      wrapH: wr ? Math.round(wr.height * 100) / 100 : -1,
      // Cuánto cuelga por encima del cursor y cuánto se desplaza en horizontal.
      offsetY: fr && wr ? Math.round((wr.bottom - fr.top) * 10) / 10 : -1,
      offsetX: fr && wr ? Math.round((wr.left + wr.width / 2 - fr.left) * 10) / 10 : -1,
    };
  });

  if (!box) {
    console.log('no se encontró el cartel');
    await browser.close();
    return;
  }

  writeFileSync(join(OUT, 'pill-box.json'), JSON.stringify(box, null, 1), 'utf8');
  console.log('=== cartel "VIEW PROJECT" de la referencia ===');
  console.log(`  caja:      ${box.w} × ${box.h} px`);
  console.log(`  relleno:   ${box.padding}`);
  console.log(`  tipo:      ${box.font}`);
  console.log(`  familia:   ${box.family}`);
  console.log(`  uppercase: ${box.transform}`);
  console.log(`  fondo:     ${box.bg} · texto ${box.color} · radio ${box.radius}`);
  console.log(`  envoltura: ${box.wrapW} × ${box.wrapH} px`);
  console.log(`  cuelga:    ${box.offsetY} px por encima del cursor · centro a ${box.offsetX} px en X`);

  await page.screenshot({
    path: join(OUT, 'pill-box.png'),
    clip: { x: 820, y: 320, width: 280, height: 130 },
  });
  console.log('  captura:   recon/pill-box.png');

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
