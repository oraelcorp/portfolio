// vite.config.ts — inyecta el HTML de las secciones en tiempo de build. Fase 1.
// Así el copy vive solo en src/content/site.ts (§5) y el HTML servido ya llega completo (SEO, §8).

import { defineConfig } from 'vite';
import { renderSite } from './src/render/sections.ts';
import { renderHead, renderSitemap } from './src/render/head.ts';

export default defineConfig({
  plugins: [
    {
      name: 'javier-inject-sections',
      // El sitemap necesita URLs absolutas, así que solo existe cuando hay dominio.
      // Se emite desde aquí y no como archivo en public/ para que no quede uno obsoleto
      // con un dominio antiguo si Javier lo cambia.
      generateBundle(): void {
        const xml = renderSitemap();
        if (!xml) return;
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: xml });
      },
      transformIndexHtml: {
        order: 'pre',
        handler(html: string): string {
          // Sello del build. Existe por el bug de 2026-09-08: probando desde el móvil contra el
          // servidor del PC no había forma de saber si el teléfono estaba viendo el arreglo o un
          // `index.html` cacheado de antes. Ahora `?diag` lo enseña en pantalla.
          const sello = new Date().toISOString().replace('T', ' ').slice(0, 19);
          return html
            .replace('<!--@site-->', renderSite())
            .replace('<!--@head-->', renderHead())
            .replace('<!--@build-->', `<meta name="javier:build" content="${sello}" />`);
        },
      },
    },
  ],
  build: {
    target: 'es2022',
    cssTarget: 'chrome111', // no degradar oklch/color-mix ni @layer
  },
});
