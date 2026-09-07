// scripts/check-seo.ts — comprueba lo que el §8 pide de SEO/meta sobre el HTML YA CONSTRUIDO
// (dist/), no sobre el fuente: lo que importa es lo que llega al navegador y al rastreador.
// Fase 5, bloque 3.
//
// Incluye la lógica que hoy está dormida: mientras `meta.url` sea [TODO] no debe haber
// canonical, og:url ni sitemap. Una canonical inventada es peor que ninguna — le dice a
// Google que la página buena es otra.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { siteOrigin, OG_IMAGE } from '../src/render/head.ts';
import { site } from '../src/content/site.ts';

const DIST = resolve('dist');
const results: string[] = [];
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  const line = `${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`;
  results.push(line);
  if (!ok) failures.push(line);
  console.log(line);
}

/** Ancho y alto de un JPEG leyendo sus marcadores SOF, sin dependencias. */
function jpegSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.readUInt16BE(0) !== 0xffd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1] ?? 0;
    // SOF0..SOF15 llevan las dimensiones; SOF4 (DHT) y SOF12 (DAC) no son SOF de verdad
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function main(): void {
  const htmlPath = resolve(DIST, 'index.html');
  if (!existsSync(htmlPath)) {
    console.error('No hay dist/index.html — corre `npm run build` antes.');
    process.exit(1);
  }
  const html = readFileSync(htmlPath, 'utf-8');

  const meta = (attr: 'property' | 'name', key: string): string | null => {
    const re = new RegExp(`<meta[^>]*${attr}="${key}"[^>]*content="([^"]*)"`, 'i');
    return re.exec(html)?.[1] ?? null;
  };

  // --- Lo básico que pide §8
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  check('el HTML servido trae <title>', title.length > 10, `"${title}"`);
  check(
    'y description',
    (meta('name', 'description') ?? '').length > 30,
    meta('name', 'description') ?? 'falta',
  );
  check('el documento declara lang="en"', /<html[^>]*lang="en"/.test(html));
  check('y theme-color', meta('name', 'theme-color') !== null, meta('name', 'theme-color') ?? 'falta');

  // --- Open Graph y Twitter
  for (const k of ['og:type', 'og:title', 'og:description', 'og:image', 'og:site_name', 'og:locale']) {
    check(`está ${k}`, (meta('property', k) ?? '').length > 0, meta('property', k) ?? 'falta');
  }
  check(
    'la tarjeta de X es de imagen grande',
    meta('name', 'twitter:card') === 'summary_large_image',
    meta('name', 'twitter:card') ?? 'falta',
  );
  for (const k of ['twitter:title', 'twitter:description', 'twitter:image']) {
    check(`está ${k}`, (meta('name', k) ?? '').length > 0, meta('name', k) ?? 'falta');
  }
  check(
    'la imagen para compartir tiene alternativa textual',
    (meta('property', 'og:image:alt') ?? '').length > 10,
    meta('property', 'og:image:alt') ?? 'falta',
  );

  // --- El texto sale de site.ts, no escrito a mano (§5)
  check(
    'el título del HTML coincide con site.ts',
    title === `${site.meta.name} — ${site.meta.role}`.replace(/&/g, '&amp;'),
    `"${title}"`,
  );

  // --- La imagen existe de verdad y mide lo que las meta declaran
  const imgPath = resolve(DIST, OG_IMAGE.replace(/^\//, ''));
  const hayImg = existsSync(imgPath);
  check('la imagen para compartir existe en dist/', hayImg, hayImg ? OG_IMAGE : `falta ${imgPath}`);
  if (hayImg) {
    const size = jpegSize(readFileSync(imgPath));
    const w = Number(meta('property', 'og:image:width'));
    const h = Number(meta('property', 'og:image:height'));
    check(
      'y mide exactamente lo que declaran og:image:width/height',
      size !== null && size.w === w && size.h === h,
      size ? `${size.w}×${size.h} vs ${w}×${h} declarado` : 'no pude leer el JPEG',
    );
  }

  // --- Datos estructurados válidos
  const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)?.[1] ?? '';
  const persona = ((): Record<string, unknown> | null => {
    try {
      return JSON.parse(ld) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  check('los datos estructurados son JSON válido', persona !== null, ld.slice(0, 60));
  check(
    'y describen a una Person con nombre y puesto',
    persona?.['@type'] === 'Person' && typeof persona['name'] === 'string' && !!persona['jobTitle'],
    persona ? `${String(persona['name'])} · ${String(persona['jobTitle'])}` : '-',
  );
  check(
    'sin marcadores [TODO] dentro',
    !ld.includes('[TODO]'),
    ld.includes('[TODO]') ? 'hay un [TODO] en el JSON-LD' : 'limpio',
  );

  check('robots.txt se publica', existsSync(resolve(DIST, 'robots.txt')));

  // --- Lo que depende del dominio: presente o ausente, pero nunca inventado
  const origin = siteOrigin();
  const canonical = /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/.exec(html)?.[1] ?? null;
  const sitemap = existsSync(resolve(DIST, 'sitemap.xml'));
  if (origin) {
    check('con dominio conocido hay canonical', canonical === `${origin}/`, canonical ?? 'falta');
    check('y og:url', meta('property', 'og:url') === `${origin}/`, meta('property', 'og:url') ?? 'falta');
    check('y sitemap.xml', sitemap);
  } else {
    check(
      'sin dominio NO se inventa una canonical',
      canonical === null && meta('property', 'og:url') === null && !sitemap,
      `canonical=${canonical} og:url=${meta('property', 'og:url')} sitemap=${sitemap}`,
    );
    check(
      'y queda constancia del TODO en el propio HTML',
      html.includes('TODO_JAVIER: falta meta.url'),
      'comentario presente en el <head>',
    );
    console.log('      (canonical, og:url y sitemap se activan solos al rellenar meta.url en site.ts)');
  }

  console.log(`\n${results.length - failures.length}/${results.length} comprobaciones OK`);
  if (failures.length > 0) process.exitCode = 1;
}

main();
