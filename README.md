# Javier — Portfolio

Portafolio personal de un ingeniero en mecatrónica que construye productos con IA.
Sitio single-page, sin framework de UI y sin framework de CSS: DOM, TypeScript, Canvas y GSAP.

**Construido de punta a punta con [Claude Code](https://claude.com/claude-code)**, partiendo de una especificación
escrita antes de la primera línea de código ([`PORTFOLIO_SPEC.md`](./PORTFOLIO_SPEC.md)) y ejecutada por fases
con criterios de aceptación verificables. El proceso es parte de lo que el portafolio demuestra.

## Stack

| Capa           | Elección                                                                    |
| -------------- | --------------------------------------------------------------------------- |
| Bundler        | Vite 8                                                                      |
| Lenguaje       | TypeScript 6 (strict, sin `any`)                                            |
| Animación      | GSAP 3.15 (ScrollTrigger, SplitText, CustomEase)                            |
| Smooth scroll  | Lenis 1.3, sincronizado con el ticker de GSAP                               |
| Efectos        | Canvas 2D (retrato ASCII)                                                   |
| Estilos        | CSS moderno: `@layer`, custom properties, `clamp()`. Sin Tailwind, sin Sass |
| Tipografía     | Inter · JetBrains Mono · Silkscreen — self-hosted (OFL)                     |
| Testing visual | Playwright: captura cada sección en 3 viewports                             |

## Cómo correrlo

```bash
npm install
npm run dev          # servidor de desarrollo
npm run build        # type-check + build de producción
npm run lint         # eslint + prettier
npm run build && npm run shots   # capturas de cada sección en 1440/1024/390
```

## Arquitectura

Todo el texto del sitio vive en un único archivo tipado, [`src/content/site.ts`](./src/content/site.ts).
Un plugin de Vite (`transformIndexHtml`) llama a `renderSite()` en tiempo de build e inyecta el HTML en
`index.html`: una sola fuente de verdad para el copy **y** HTML estático real para SEO, sin depender de JS
en el cliente para pintar contenido.

```
src/
├── content/site.ts     # todo el copy y los datos
├── render/sections.ts  # HTML de cada sección (se ejecuta en build)
├── core/               # gsap, lenis, utils — cada módulo devuelve { destroy() }
├── effects/ascii/      # retrato ASCII en Canvas 2D
└── styles/             # tokens + capas + un archivo por componente
```

Las secciones alternan tema declarando `data-theme="dark|light"`; el CSS solo consume variables
semánticas (`--surface`, `--on-surface`, `--btn-bg`), nunca colores crudos.

## Créditos

El diseño replica **técnicas** (layout, ritmo, motion, tipos de efecto) de
[good-fella.com](https://good-fella.com) — un estudio cuyo trabajo admiro. Nada de su contenido, sus assets,
su identidad ni su código se ha copiado: todo el texto, los colores y las imágenes de este sitio son propios.

Librerías: [GSAP](https://gsap.com), [Lenis](https://github.com/darkroomengineering/lenis),
[Vite](https://vite.dev), [Playwright](https://playwright.dev).
Fuentes: [Inter](https://rsms.me/inter/), [JetBrains Mono](https://www.jetbrains.com/lp/mono/),
[Silkscreen](https://fonts.google.com/specimen/Silkscreen) — todas con licencia abierta.
