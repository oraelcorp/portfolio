// src/render/head.ts — genera las meta del <head> desde site.ts. Fase 5, bloque 3.
// Antes vivían escritas a mano en index.html, duplicando el título y la descripción que ya
// estaban en site.ts: §5 exige una sola fuente de texto, y dos copias se desincronizan.
//
// Lo que necesita un dominio ABSOLUTO (og:url, canonical, sitemap) no se emite mientras
// `meta.url` sea [TODO]: inventarse un dominio sería peor que no ponerlo — una canonical
// equivocada le dice a Google que la página buena es otra (§10.5).

import { site, TODO } from '../content/site.ts';
import { esc } from '../core/utils.ts';

/** Ruta pública de la imagen para compartir. 1200×630, el tamaño que piden las tarjetas. */
export const OG_IMAGE = '/img/og.jpg';

/** El dominio final, sin barra al final, o null mientras Javier no lo dé. */
export function siteOrigin(): string | null {
  const raw: string = site.meta.url;
  if (raw === TODO || !/^https?:\/\//.test(raw)) return null;
  return raw.replace(/\/+$/, '');
}

/** Absolutiza una ruta del sitio, o la deja relativa si todavía no hay dominio. */
function abs(path: string): string {
  const origin = siteOrigin();
  return origin ? `${origin}${path}` : path;
}

export function renderHead(): string {
  const { meta } = site;
  const title = `${meta.name} — ${meta.role}`;
  const desc = meta.ogDescription;
  const origin = siteOrigin();

  const tags: string[] = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<meta name="author" content="${esc(meta.name)}" />`,
    `<meta name="theme-color" content="#141314" />`,

    `<meta property="og:type" content="profile" />`,
    `<meta property="og:site_name" content="${esc(meta.name)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:image" content="${esc(abs(OG_IMAGE))}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(meta.ogImageAlt)}" />`,

    // `summary_large_image` es lo que hace que la tarjeta salga a lo ancho y no como
    // miniatura cuadrada. Título y descripción se repiten a propósito: X no siempre
    // cae en las og: cuando hay twitter: presentes.
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<meta name="twitter:image" content="${esc(abs(OG_IMAGE))}" />`,
    `<meta name="twitter:image:alt" content="${esc(meta.ogImageAlt)}" />`,
  ];

  if (origin) {
    tags.push(
      `<link rel="canonical" href="${esc(origin)}/" />`,
      `<meta property="og:url" content="${esc(origin)}/" />`,
    );
  } else {
    // Visible en "ver código fuente", que es donde se mira esto
    tags.push(`<!-- TODO_JAVIER: falta meta.url en site.ts → sin canonical, og:url ni sitemap -->`);
  }

  // Datos estructurados: solo los campos que existen de verdad. Un Person con
  // marcadores [TODO] dentro sería peor que no ponerlo.
  const persona: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: meta.name,
    jobTitle: meta.role,
    description: desc,
  };
  const email: string = meta.email;
  if (email !== TODO) persona['email'] = `mailto:${email}`;
  if (origin) persona['url'] = `${origin}/`;
  const redes = site.nav.socials.map((s): string => s.href).filter((h) => h !== TODO);
  if (redes.length > 0) persona['sameAs'] = redes;
  const lugar: string = meta.location;
  if (lugar !== TODO) {
    persona['address'] = { '@type': 'PostalAddress', addressLocality: lugar };
  }

  // El JSON va dentro de un <script>, así que lo que hay que neutralizar es `</script`,
  // no las entidades HTML: `esc()` aquí rompería las comillas del JSON.
  tags.push(`<script type="application/ld+json">${JSON.stringify(persona).replace(/<\//g, '<\\/')}</script>`);

  return tags.join('\n    ');
}

/** sitemap.xml. Devuelve null mientras no haya dominio: las URLs deben ser absolutas. */
export function renderSitemap(): string | null {
  const origin = siteOrigin();
  if (!origin) return null;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>
`;
}
