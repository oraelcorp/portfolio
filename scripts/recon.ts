// scripts/recon.ts — Fase 0 (PORTFOLIO_SPEC §9): reconocimiento técnico de good-fella.com.
// Guarda screenshots + JSON de evidencia en recon/ (gitignored). Solo análisis local:
// no se descarga ni reutiliza ningún asset del sitio de referencia en el build.

import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon');
const REF = join(OUT, 'reference');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const errors: string[] = [];
const consoleErrors: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function save(name: string, data: unknown) {
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2), 'utf8');
  console.log(`  saved recon/${name}`);
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: join(REF, name), fullPage });
  console.log(`  shot  recon/reference/${name}`);
}

async function step(label: string, fn: () => Promise<void>) {
  console.log(`\n== ${label}`);
  try {
    await fn();
  } catch (e) {
    const msg = `${label}: ${(e as Error).message}`;
    errors.push(msg);
    console.log(`  !! ${msg}`);
  }
}

// Scroll con eventos de rueda reales (para que Lenis, si existe, lo procese como un usuario)
async function slowScrollBottom(page: Page) {
  await page.mouse.move(700, 450);
  let last = -1;
  for (let i = 0; i < 140; i++) {
    await page.mouse.wheel(0, 500);
    await sleep(300);
    const st = await page.evaluate(() => ({
      y: Math.round(window.scrollY),
      max: Math.round(document.documentElement.scrollHeight - window.innerHeight),
    }));
    if (st.y >= st.max - 6) break;
    if (st.y === last && i > 12) break;
    last = st.y;
  }
  await sleep(900);
}

async function scrollTop(page: Page) {
  for (let i = 0; i < 90; i++) {
    await page.mouse.wheel(0, -2600);
    await sleep(120);
    const y = await page.evaluate(() => window.scrollY);
    if (y < 6) break;
  }
  await sleep(900);
}

async function wheelTo(page: Page, targetY: number) {
  await page.mouse.move(700, 450);
  for (let i = 0; i < 70; i++) {
    const y = await page.evaluate(() => window.scrollY);
    const d = targetY - y;
    if (Math.abs(d) < 70) break;
    await page.mouse.wheel(0, Math.max(-1400, Math.min(1400, d)));
    await sleep(200);
  }
  await sleep(600);
}

async function gotoAndSettle(page: Page, settleMs = 3500) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
  await sleep(settleMs);
}

async function main() {
  mkdirSync(REF, { recursive: true });

  let browser: Browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    console.log('Navegador: Chrome del sistema');
  } catch {
    browser = await chromium.launch();
    console.log('Navegador: Chromium de Playwright');
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text().slice(0, 200)}`);
  });

  const netScripts = new Set<string>();
  const netFonts = new Set<string>();
  const netMedia = new Set<string>();
  page.on('response', (res) => {
    const u = res.url();
    if (/\.m?js(\?|$)/.test(u)) netScripts.add(u);
    if (/\.(woff2?|ttf|otf)(\?|$)/.test(u)) netFonts.add(u);
    if (/\.(mp4|webm|webp|avif|jpe?g|png|gif|svg)(\?|$)/.test(u)) netMedia.add(u);
  });

  await step('Carga inicial + frames del preloader (1440x900)', async () => {
    await page.goto(URL, { waitUntil: 'commit', timeout: 60_000 });
    await shot(page, 'preloader-01.png');
    await sleep(700);
    await shot(page, 'preloader-02.png');
    await sleep(1300);
    await shot(page, 'preloader-03.png');
    await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
    await sleep(3500);
    await shot(page, 'hero-base.png');
  });

  await step('Interacción del mouse sobre el retrato (3 estados)', async () => {
    const pos: Array<[number, number]> = [
      [1000, 300],
      [1180, 480],
      [950, 640],
    ];
    for (const [i, [x, y]] of pos.entries()) {
      await page.mouse.move(x, y, { steps: 25 });
      await sleep(850);
      await shot(page, `hero-mouse-${i + 1}.png`);
    }
  });

  await step('Hover sobre el CTA del nav', async () => {
    const box = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a, button')] as HTMLElement[];
      for (const el of links) {
        const r = el.getBoundingClientRect();
        if (r.top < 120 && r.left > innerWidth * 0.6 && r.width > 60 && r.height > 20 && r.height < 90) {
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      return null;
    });
    if (box) {
      await page.mouse.move(box.x, box.y, { steps: 15 });
      await sleep(700);
      await shot(page, 'nav-cta-hover.png');
      await page.mouse.move(700, 750, { steps: 10 });
    } else {
      console.log('  (no se encontró CTA en el nav)');
    }
  });

  await step('Extracción de datos del documento', async () => {
    const info = await page.evaluate(() => {
      // Globals que puede o no haber dejado el sitio inspeccionado: forma desconocida a propósito.
      type Probe = {
        gsap?: { version?: string; core?: { globals?: () => Record<string, unknown> } };
        Lenis?: unknown;
        lenis?: unknown;
        ScrollTrigger?: unknown;
        Webflow?: unknown;
        THREE?: unknown;
        jQuery?: { fn?: { jquery?: string } };
        barba?: unknown;
      };
      const g = window as unknown as Probe;
      let scrollTrigger = typeof g.ScrollTrigger !== 'undefined';
      try {
        scrollTrigger = scrollTrigger || !!g.gsap?.core?.globals?.().ScrollTrigger;
      } catch {
        /* noop */
      }
      const attr = (sel: string, a: string) => document.querySelector(sel)?.getAttribute(a) ?? null;
      return {
        title: document.title,
        generator: attr('meta[name="generator"]', 'content'),
        description: attr('meta[name="description"]', 'content'),
        htmlClass: document.documentElement.className || null,
        bodyClass: document.body.className || null,
        htmlAttrs: [...document.documentElement.attributes].map((a) => ({ name: a.name, value: a.value })),
        globals: {
          gsapVersion: g.gsap?.version ?? null,
          ScrollTrigger: scrollTrigger,
          LenisClass: typeof g.Lenis !== 'undefined',
          lenisInstance: g.lenis !== null && g.lenis !== undefined,
          Webflow: typeof g.Webflow !== 'undefined',
          THREE: typeof g.THREE !== 'undefined',
          jQuery: g.jQuery?.fn?.jquery ?? null,
          barba: typeof g.barba !== 'undefined',
        },
        scripts: [...document.querySelectorAll('script[src]')].map((s) => (s as HTMLScriptElement).src),
        inlineScriptCount: document.querySelectorAll('script:not([src])').length,
        links: [...document.querySelectorAll('link')]
          .map((l) => ({ rel: (l as HTMLLinkElement).rel, href: (l as HTMLLinkElement).href }))
          .filter((x) => x.href),
        videos: [...document.querySelectorAll('video')].map((v) => {
          const el = v as HTMLVideoElement;
          return {
            src: el.currentSrc || el.src || null,
            poster: el.poster || null,
            autoplay: el.autoplay,
            loop: el.loop,
            muted: el.muted,
            videoW: el.videoWidth,
            videoH: el.videoHeight,
            cls: String(el.className).slice(0, 120),
            rect: (() => {
              const r = el.getBoundingClientRect();
              return {
                x: Math.round(r.x),
                y: Math.round(r.y),
                w: Math.round(r.width),
                h: Math.round(r.height),
              };
            })(),
          };
        }),
        canvases: [...document.querySelectorAll('canvas')].map((c) => {
          const el = c as HTMLCanvasElement;
          const r = el.getBoundingClientRect();
          return {
            w: el.width,
            h: el.height,
            cls: String(el.className).slice(0, 120),
            parentCls: String(el.parentElement?.className ?? '').slice(0, 120),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          };
        }),
        imgCount: document.querySelectorAll('img').length,
      };
    });
    save('scripts.json', {
      ...info,
      network: {
        scripts: [...netScripts],
        fonts: [...netFonts],
        media: [...netMedia].slice(0, 100),
      },
    });

    const fonts = await page.evaluate(() =>
      [...(document as unknown as { fonts: Iterable<FontFace> }).fonts].map((f) => ({
        family: f.family,
        weight: f.weight,
        style: f.style,
        status: f.status,
      })),
    );
    save('fonts.json', fonts);

    const styles = await page.evaluate(() => {
      const pick = (el: Element) => {
        const cs = getComputedStyle(el as HTMLElement);
        return {
          text: String((el as HTMLElement).innerText || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 70),
          cls: String(el.className).slice(0, 90),
          color: cs.color,
          background: cs.backgroundColor,
          fontFamily: cs.fontFamily,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          lineHeight: cs.lineHeight,
          letterSpacing: cs.letterSpacing,
          textTransform: cs.textTransform,
          borderRadius: cs.borderRadius,
        };
      };
      const grab = (sel: string, n: number) => [...document.querySelectorAll(sel)].slice(0, n).map(pick);
      return {
        body: pick(document.body),
        h1: grab('h1', 3),
        h2: grab('h2', 8),
        h3: grab('h3', 8),
        p: grab('p', 8),
        navLinks: grab('nav a, header a', 10),
        buttons: grab('a[class*="button" i], button, .w-button', 12),
      };
    });
    save('computed-styles.json', styles);

    const html = await page.content();
    writeFileSync(join(OUT, 'page-1440.html'), html, 'utf8');
    console.log(`  saved recon/page-1440.html (${Math.round(html.length / 1024)} KB)`);
  });

  await step('Abrir menú y capturar', async () => {
    const candidates = [
      '.w-nav-button',
      'text=/^\\s*menu\\s*$/i',
      '[class*="menu" i][class*="button" i]',
      '[class*="burger" i]',
    ];
    let opened = false;
    for (const sel of candidates) {
      const loc = page.locator(sel).first();
      const n = await loc.count().catch(() => 0);
      if (n > 0 && (await loc.isVisible().catch(() => false))) {
        await loc.click({ timeout: 4000 });
        console.log(`  menú abierto con selector: ${sel}`);
        opened = true;
        break;
      }
    }
    if (!opened) {
      console.log('  !! no se encontró un botón de menú clicable');
      return;
    }
    await sleep(300);
    await shot(page, 'menu-opening.png');
    await sleep(1100);
    await shot(page, 'menu-open.png');
    await page.keyboard.press('Escape');
    await sleep(600);
  });

  await step('Scroll completo + inventario de secciones (1440)', async () => {
    await gotoAndSettle(page); // recarga para partir de un estado limpio
    await slowScrollBottom(page);
    await scrollTop(page);

    const sections = await page.evaluate(() => {
      const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
      let list = [...document.querySelectorAll('section')] as HTMLElement[];
      if (list.length < 3) {
        const root = document.querySelector('main') ?? document.body;
        list = ([...root.children] as HTMLElement[]).filter((el) => el.offsetHeight > 150);
      }
      return list.map((el, i) => ({
        i,
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: clean(String(el.className)),
        top: Math.round(el.getBoundingClientRect().top + window.scrollY),
        height: Math.round(el.offsetHeight),
        text: clean(el.innerText || '').slice(0, 300),
        imgs: el.querySelectorAll('img').length,
        videos: el.querySelectorAll('video').length,
        canvases: el.querySelectorAll('canvas').length,
      }));
    });
    save('sections.json', sections);

    for (const s of sections) {
      await wheelTo(page, Math.max(0, s.top - 80));
      await sleep(1500);
      const slug =
        (s.cls || s.tag)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'section';
      await shot(page, `section-${String(s.i + 1).padStart(2, '0')}-${slug}.png`);
    }
  });

  await step('Hover sobre una fila/card de work', async () => {
    const target = await page.evaluate(() => {
      const links = [...document.querySelectorAll('main a, a')] as HTMLElement[];
      for (const a of links) {
        const r = a.getBoundingClientRect();
        const absTop = r.top + window.scrollY;
        if (r.width > innerWidth * 0.5 && r.height > 70 && r.height < 420 && absTop > innerHeight * 0.6) {
          return { xr: (r.left + r.width / 2) / innerWidth, top: absTop, height: r.height };
        }
      }
      return null;
    });
    if (!target) {
      console.log('  (no se encontró una fila de proyecto candidata)');
      return;
    }
    await wheelTo(page, Math.max(0, target.top - 300));
    const pos = await page.evaluate(
      ({ top, height, xr }) => ({ x: xr * innerWidth, y: top - window.scrollY + height / 2 }),
      target,
    );
    await page.mouse.move(pos.x, Math.max(0, Math.min(880, pos.y)), { steps: 18 });
    await sleep(950);
    await shot(page, 'work-row-hover.png');
  });

  await step('Full-page 1440', async () => {
    await scrollTop(page);
    await shot(page, 'fullpage-1440.png', true);
  });

  for (const vw of [
    { w: 1024, h: 768 },
    { w: 390, h: 844 },
  ]) {
    await step(`Viewport ${vw.w}x${vw.h}`, async () => {
      await page.setViewportSize({ width: vw.w, height: vw.h });
      await gotoAndSettle(page);
      await shot(page, `hero-${vw.w}.png`);
      await slowScrollBottom(page);
      await scrollTop(page);
      await shot(page, `fullpage-${vw.w}.png`, true);
    });
  }

  await step('Captura hi-DPI del retrato (detalle de caracteres)', async () => {
    const ctx2 = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      userAgent: UA,
    });
    const p2 = await ctx2.newPage();
    await p2.goto(URL, { waitUntil: 'load', timeout: 60_000 });
    await sleep(4500);
    await p2.screenshot({ path: join(REF, 'hero-base-2x.png') });
    await p2.screenshot({
      path: join(REF, 'hero-portrait-detail-2x.png'),
      clip: { x: 620, y: 40, width: 800, height: 850 },
    });
    console.log('  shot  hero-base-2x.png / hero-portrait-detail-2x.png');
    await ctx2.close();
  });

  save('run-log.json', {
    url: URL,
    when: new Date().toISOString(),
    errors,
    consoleErrors: consoleErrors.slice(0, 40),
  });
  await browser.close();
  console.log(`\nRecon terminado. Errores de pasos: ${errors.length}`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  save('run-log.json', { url: URL, when: new Date().toISOString(), fatal: String(e), errors, consoleErrors });
  process.exitCode = 1;
});
