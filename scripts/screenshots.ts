// scripts/screenshots.ts — captura el sitio propio en 3 viewports, sección por sección (§9 Fase 1).
// Es la forma en que Claude Code "ve" lo que construyó y lo compara con recon/reference/.
// Uso: npm run build && npm run shots

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const OUT = resolve('screenshots');
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 768 },
  { name: '390', width: 390, height: 844 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 40_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch {
      /* aún no levanta */
    }
    await sleep(400);
  }
  throw new Error(`El preview no respondió en ${URL}`);
}

async function shootSections(page: Page, viewport: string): Promise<void> {
  // El nav es position:fixed y Playwright lo compone a media captura al recortar
  // secciones más altas que el viewport. Se oculta solo para estas tomas.
  const hideNav = await page.addStyleTag({ content: '[data-nav]{visibility:hidden}' });

  const sections = await page.$$('[data-section]');
  for (const section of sections) {
    const name = (await section.getAttribute('data-section')) ?? 'section';
    await section.scrollIntoViewIfNeeded();
    await sleep(500);
    await section.screenshot({ path: join(OUT, `${viewport}-${name}.png`) });
    console.log(`  ${viewport}-${name}.png`);
  }

  await hideNav.evaluate((el) => {
    (el as Element).remove();
  });
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  const consoleErrors: string[] = [];

  try {
    await waitForServer();

    let browser;
    try {
      browser = await chromium.launch({ channel: 'chrome' });
    } catch {
      browser = await chromium.launch();
    }

    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      page.on('pageerror', (e) => consoleErrors.push(`[${vp.name}] pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[${vp.name}] console: ${m.text()}`);
      });

      await page.goto(URL, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      // Cada contexto trae sessionStorage limpio, así que el preloader aparece: esperarlo (§6.1)
      await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, {
        timeout: 15_000,
      });
      await sleep(900);

      await page.screenshot({ path: join(OUT, `${vp.name}-fullpage.png`), fullPage: true });
      console.log(`  ${vp.name}-fullpage.png`);
      await shootSections(page, vp.name);

      await context.close();
    }

    await browser.close();
  } finally {
    server.kill();
  }

  // §10.8: un error de consola significa que la tarea NO está terminada.
  if (consoleErrors.length > 0) {
    console.error(`\n${consoleErrors.length} error(es) de consola:`);
    for (const e of consoleErrors) console.error(`  ${e}`);
    process.exitCode = 1;
  } else {
    console.log('\nSin errores de consola.');
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
