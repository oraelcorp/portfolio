// scripts/recon-nav.ts — Fase 2: resuelve las dos dudas que quedaron abiertas en recon/diff.md §B3:
// ¿los botones son magnéticos? ¿el nav se oculta al scrollear hacia abajo?

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon');
const REF = join(OUT, 'reference');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Matriz de transform + caja del CTA del nav, para detectar desplazamiento magnético. */
async function ctaState(page: Page) {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll('a, button')].find((n) => {
      const r = n.getBoundingClientRect();
      return r.top < 120 && r.left > innerWidth * 0.6 && r.width > 60 && r.height > 20 && r.height < 90;
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      transform: getComputedStyle(el).transform,
      x: Math.round(r.left * 100) / 100,
      y: Math.round(r.top * 100) / 100,
      text: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 40),
    };
  });
}

async function navState(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector('header') ?? document.querySelector('[class*="nav" i]');
    if (!header) return null;
    const r = header.getBoundingClientRect();
    const cs = getComputedStyle(header);
    return {
      top: Math.round(r.top),
      height: Math.round(r.height),
      position: cs.position,
      transform: cs.transform,
      opacity: cs.opacity,
      paddingBlock: `${cs.paddingTop} / ${cs.paddingBottom}`,
      background: cs.backgroundColor,
      color: cs.color,
      scrollY: Math.round(window.scrollY),
    };
  });
}

async function main() {
  mkdirSync(REF, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: 'load', timeout: 60_000 });
  await sleep(4000);

  const report: Record<string, unknown> = {};

  // ---- 1. ¿Magnetismo? Se compara el CTA en reposo vs. con el puntero CERCA (no encima).
  await page.mouse.move(200, 600, { steps: 10 });
  await sleep(900);
  report.ctaRest = await ctaState(page);

  const box = await page.evaluate(() => {
    const el = [...document.querySelectorAll('a, button')].find((n) => {
      const r = n.getBoundingClientRect();
      return r.top < 120 && r.left > innerWidth * 0.6 && r.width > 60 && r.height > 20 && r.height < 90;
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  });

  if (box) {
    // Puntero justo fuera del botón: si hay magnetismo, el botón se mueve hacia él.
    await page.mouse.move(box.cx - box.w * 0.75, box.cy, { steps: 20 });
    await sleep(900);
    report.ctaNear = await ctaState(page);

    await page.mouse.move(box.cx, box.cy, { steps: 15 });
    await sleep(900);
    report.ctaOver = await ctaState(page);
    await page.screenshot({
      path: join(REF, 'nav-cta-hover-2.png'),
      clip: { x: 1000, y: 0, width: 440, height: 110 },
    });
  }

  await page.mouse.move(200, 600, { steps: 10 });
  await sleep(800);

  // ---- 2. ¿El nav se oculta al scrollear hacia abajo?
  report.navTop = await navState(page);

  await page.mouse.move(700, 450);
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, 400);
    await sleep(120);
  }
  await sleep(150);
  report.navWhileScrollingDown = await navState(page); // medido casi en caliente
  await sleep(1200);
  report.navAfterScrollDown = await navState(page); // ya detenido

  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -400);
    await sleep(120);
  }
  await sleep(150);
  report.navWhileScrollingUp = await navState(page);
  await sleep(1200);
  report.navAfterScrollUp = await navState(page);

  // ---- 3. Nav sobre una sección clara (¿cambia de tema?)
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, 500);
    await sleep(140);
  }
  await sleep(1500);
  report.navOverLightSection = await navState(page);

  writeFileSync(join(OUT, 'nav-behavior.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log('\nsaved recon/nav-behavior.json');

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
