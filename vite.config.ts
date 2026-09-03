// vite.config.ts — inyecta el HTML de las secciones en tiempo de build. Fase 1.
// Así el copy vive solo en src/content/site.ts (§5) y el HTML servido ya llega completo (SEO, §8).

import { defineConfig } from 'vite';
import { renderSite } from './src/render/sections.ts';

export default defineConfig({
  plugins: [
    {
      name: 'javier-inject-sections',
      transformIndexHtml: {
        order: 'pre',
        handler(html: string): string {
          return html.replace('<!--@site-->', renderSite());
        },
      },
    },
  ],
  build: {
    target: 'es2022',
    cssTarget: 'chrome111', // no degradar oklch/color-mix ni @layer
  },
});
