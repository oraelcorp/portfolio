// scripts/recon-footer.ts — Fase 0 (complemento): captura del footer de good-fella.com
// (los dos canvases ASCII inferiores no eran visibles en las capturas por sección).

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const REF = resolve('recon', 'reference');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function toBottom(page: Page) {
  await page.mouse.move(700, 450);
  let last = -1;
  for (let i = 0; i < 140; i++) {
    await page.mouse.wheel(0, 900);
    await sleep(180);
    const st = await page.evaluate(() => ({
      y: Math.round(window.scrollY),
      max: Math.round(document.documentElement.scrollHeight - window.innerHeight),
    }));
    if (st.y >= st.max - 6 || (st.y === last && i > 10)) break;
    last = st.y;
  }
  await sleep(2200);
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
  } catch {
    browser = await chromium.launch();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: 'load', timeout: 60_000 });
  await sleep(3500);

  await toBottom(page);
  await page.screenshot({ path: join(REF, 'footer-bottom.png') });
  console.log('shot footer-bottom.png');

  // hover sobre el canvas izquierdo del footer para ver la interacción
  const c = await page.evaluate(() => {
    const el = [...document.querySelectorAll('canvas')].at(-2);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, visible: r.top < innerHeight && r.bottom > 0 };
  });
  if (c && c.visible) {
    await page.mouse.move(c.x, Math.min(870, Math.max(30, c.y)), { steps: 20 });
    await sleep(900);
    await page.screenshot({ path: join(REF, 'footer-canvas-hover.png') });
    console.log('shot footer-canvas-hover.png');
  } else {
    console.log('canvas del footer no visible en viewport:', c);
  }

  await page.mouse.wheel(0, -700);
  await sleep(1600);
  await page.screenshot({ path: join(REF, 'footer-upper.png') });
  console.log('shot footer-upper.png');

  const footerInfo = await page.evaluate(() => {
    const f = document.querySelector('footer');
    const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
    return {
      footerText: f ? clean((f as HTMLElement).innerText).slice(0, 600) : null,
      pageHeight: document.documentElement.scrollHeight,
      canvases: [...document.querySelectorAll('canvas')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          w: el.width,
          h: el.height,
          top: Math.round(r.top + window.scrollY),
          left: Math.round(r.left),
        };
      }),
    };
  });
  writeFileSync(resolve('recon', 'footer.json'), JSON.stringify(footerInfo, null, 2), 'utf8');
  console.log('saved recon/footer.json');

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
