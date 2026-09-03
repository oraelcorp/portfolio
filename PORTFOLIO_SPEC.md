# PORTFOLIO SPEC — Javier · Mechatronics Engineer & AI Developer

### Documento maestro para Claude Code — réplica técnica de good-fella.com

> **Cómo usar este documento:** es la única fuente de verdad del proyecto. Claude Code debe leerlo completo antes de escribir una sola línea, generar `CLAUDE.md` a partir de la sección 11, y ejecutar las fases en orden (sección 9). Nada que no esté aquí o en el sitio de referencia se inventa: si hay duda, se pregunta o se verifica (sección 10).

---

## 0. Contexto y objetivo

**Quién:** Javier — estudiante de ingeniería (Tec de Monterrey, Campus Guadalajara), co-founder de productos SaaS (Orael, ROAR), aprendiendo creative web development con un roadmap hacia efectos estilo Awwwards.

**Qué:** un sitio de portafolio personal, single-page con secciones (más páginas de caso opcionales), que replique **la experiencia** de https://good-fella.com — su estructura, ritmo, tipografía, motion design y efectos — pero con **contenido, identidad y assets 100 % de Javier**.

**Para qué:** servir como prueba pública ("look what I can build with Claude Code / Claude") enlazable desde el resume, LinkedIn y otros perfiles. Debe verse como un sitio de agencia premium, no como un template.

**Principio rector — réplica de técnicas, no de propiedad:**

- ✅ Se replican: layout, jerarquía, timings, easings, tipos de efecto, comportamiento del scroll, estructura de secciones.
- ❌ No se copian: textos, logo, imágenes/vídeos, fuentes con licencia, nombres de clientes ni ningún asset de Good Fella. Todo el copy es de Javier; todos los assets se generan (Higgsfield/Canva) o se crean con código.
- El sitio debe incluir en el footer una línea de créditos tipo _"Design inspired by Good Fella. Built with Claude Code."_ — esto además refuerza el objetivo del portafolio.

---

## 1. Análisis del sitio de referencia (good-fella.com)

### 1.1 Confirmado por captura de pantalla (hero, desktop 1366×768)

| Elemento          | Observación exacta                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fondo             | Negro casi puro con tinte cálido, ≈ `#0F0E0E` – `#121010`                                                                                                                                                                                                                                                                                                                                                                                                    |
| Logo (top-left)   | Wordmark "GOOD" en fuente **pixel/bitmap** blanca, ~28 px de alto                                                                                                                                                                                                                                                                                                                                                                                            |
| Nav (centro)      | Texto "MENU" en **monospace uppercase** + icono hamburguesa de 2 líneas                                                                                                                                                                                                                                                                                                                                                                                      |
| CTA (top-right)   | Botón naranja `#FF4D00`-ish, texto monospace uppercase "LET'S WORK TOGETHER", con un **botón cuadrado "+"** pegado a la derecha (mismo naranja, separado por ~4 px de gap)                                                                                                                                                                                                                                                                                   |
| Headline          | Sans-serif grotesk (tipo Inter / Neue Haas), peso regular-medium, ~96 px, blanco, line-height ≈ 0.95, dos líneas: "The digital landmark / studio."                                                                                                                                                                                                                                                                                                           |
| Sub-copy          | Misma sans, ~17 px, gris `#9A9A9A`, ancho máx. ~600 px                                                                                                                                                                                                                                                                                                                                                                                                       |
| Botones hero      | "SEE THE WORK" (mismo estilo que el CTA superior, con "+") + link de texto "Tell us more" con **subrayado** blanco                                                                                                                                                                                                                                                                                                                                           |
| Logos de clientes | Fila de 3 logos en gris `#7A7A7A` + texto mono "+ MANY MORE"                                                                                                                                                                                                                                                                                                                                                                                                 |
| Visual derecho    | **Retrato ASCII** de una persona (busto, perfil ¾) formado por caracteres monospace sobre negro. **No es monocromático**: la mayoría de los caracteres son blanco/crema, con un subconjunto (bordes de silueta, mechones, puntos de brillo) en un segundo tono de acento — confirmado al inspeccionar una captura con zoom. Densidad variable: caracteres brillantes/densos en zonas claras, dispersos en sombras. Ocupa ~45 % del ancho, ~70 % de la altura |
| Grid              | Márgenes laterales ~24 px, contenido alineado a un grid de 12 columnas                                                                                                                                                                                                                                                                                                                                                                                       |

### 1.2 Inferido con alta confianza (a verificar en Fase 0)

- **Lenis** para smooth scroll — la URL `?utm_source=lenis&utm_medium=github` confirma que el sitio aparece en el showcase oficial de Lenis.
- **GSAP + ScrollTrigger** para animaciones (estándar en este tipo de sitio; el motion de Webflow también es GSAP).
- Construido en **Webflow** (patrón habitual de estudios de este tipo).
- El retrato ASCII es un **`<canvas>`** que muestrea un vídeo o imagen y dibuja caracteres; reacciona al mouse (desplazamiento/ripple) y tiene "shimmer" (los caracteres cambian sutilmente aunque no haya interacción).
- Secciones típicas debajo del hero (a confirmar en recon): trabajos/casos en grid o lista con hover de imagen, servicios/capacidades, marquee de texto, sección "about"/manifiesto con texto que se revela al scroll, testimonios o clientes, CTA final grande y footer con wordmark gigante.
- Preloader al entrar, transiciones entre páginas (overlay o wipe), menú fullscreen al pulsar "MENU".

### 1.3 Lo que NO sabemos aún

Exactamente qué secciones existen debajo del fold, sus timings precisos y si el ASCII usa vídeo o imagen. **Por eso existe la Fase 0.**

---

## 2. Decisión de stack

| Capa            | Elección                                                                                                                              | Por qué                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundler         | **Vite 5+** (plantilla `vanilla-ts`)                                                                                                  | Cero framework overhead; el sitio de referencia es DOM puro. Javier está en Phase 1 de su roadmap (DOM/eventos) y esto es directamente transferible |
| Lenguaje        | **TypeScript** strict                                                                                                                 | Claude Code produce menos errores con tipos; el portafolio muestra rigor                                                                            |
| Animación       | **GSAP 3.13+** (`gsap`, `gsap/ScrollTrigger`, `gsap/SplitText`, `gsap/CustomEase`, `gsap/Flip`)                                       | Todos los plugins son gratuitos desde 2025 — **NO** crear `.npmrc` con token de GreenSock, no usar `npm.greensock.com`. Instalar solo `npm i gsap`  |
| Smooth scroll   | **Lenis** (`lenis`) — sincronizado con GSAP ticker                                                                                    | Es literalmente lo que usa el sitio de referencia                                                                                                   |
| ASCII / efectos | **Canvas 2D** primero; **Three.js** opcional en fase avanzada                                                                         | 2D es suficiente para el retrato y es depurable; WebGL solo si se quiere el "bonus"                                                                 |
| Estilos         | **CSS moderno** (custom properties, `clamp()`, container queries, `@layer`) en archivos `.css` por componente. Sin Tailwind, sin Sass | Control total del layout y evita clases genéricas que se ven "template"                                                                             |
| Fuentes         | Google Fonts self-hosted en `/public/fonts` (ver 4.2)                                                                                 | Licencia OFL, sin peticiones externas                                                                                                               |
| Routing         | Single-page con anchors + **Vite multi-page** para `/work/<slug>.html` (opcional Fase 7)                                              | Transiciones de página se hacen con overlay + `fetch` del HTML destino (Fase 7) o simplemente navegación con preloader                              |
| Deploy          | **Vercel** (o GitHub Pages) desde repo GitHub público                                                                                 | El repo público es parte de la "prueba"                                                                                                             |
| Testing visual  | **Playwright** (dev dep) para screenshots automáticas de cada sección                                                                 | Es la forma de que Claude Code _vea_ lo que construyó y compare                                                                                     |
| Lint            | ESLint + Prettier                                                                                                                     | Repo público limpio                                                                                                                                 |

Versiones: **Claude Code debe correr `npm view <pkg> version` para cada dependencia antes de escribir el `package.json`** y anotar las versiones reales en `CLAUDE.md`. No asumir versiones.

---

## 3. Estructura de carpetas y archivos

```
javier-portfolio/
├── CLAUDE.md                      # reglas de trabajo (generado desde §11)
├── PORTFOLIO_SPEC.md              # este documento
├── README.md                      # explicación pública del proyecto + créditos
├── package.json
├── tsconfig.json
├── vite.config.ts                 # multi-page config si aplica
├── .eslintrc.cjs / .prettierrc
├── .gitignore
├── index.html                     # única entrada (secciones en orden)
├── work/                          # (Fase 7, opcional)
│   ├── orael.html
│   └── roar.html
├── public/
│   ├── fonts/                     # woff2 self-hosted
│   ├── img/
│   │   ├── portrait/              # portrait.mp4 / portrait.png para el ASCII
│   │   ├── work/                  # thumbnails de proyectos (webp)
│   │   └── og.jpg                 # Open Graph 1200×630
│   ├── favicon.svg
│   └── robots.txt
├── src/
│   ├── main.ts                    # bootstrap: preloader → lenis → módulos
│   ├── content/
│   │   └── site.ts                # TODO el copy y datos del sitio (§5) — única fuente de texto
│   ├── styles/
│   │   ├── index.css              # @layer reset, tokens, base, components, utilities
│   │   ├── tokens.css             # custom properties (§4)
│   │   ├── reset.css
│   │   ├── typography.css
│   │   ├── layout.css             # grid de 12 cols, container, spacing
│   │   └── components/
│   │       ├── button.css
│   │       ├── nav.css
│   │       ├── menu-overlay.css
│   │       ├── preloader.css
│   │       ├── cursor.css
│   │       ├── hero.css
│   │       ├── clients.css
│   │       ├── work.css
│   │       ├── services.css
│   │       ├── marquee.css
│   │       ├── about.css
│   │       ├── stack.css
│   │       ├── cta.css
│   │       └── footer.css
│   ├── core/
│   │   ├── lenis.ts               # instancia Lenis + integración con gsap.ticker
│   │   ├── gsap.ts                # registerPlugin centralizado + eases custom
│   │   ├── preloader.ts
│   │   ├── cursor.ts
│   │   ├── transitions.ts         # (Fase 7) overlay entre páginas
│   │   └── utils.ts               # lerp, clamp, debounce, prefersReducedMotion()
│   ├── components/
│   │   ├── Nav.ts
│   │   ├── MenuOverlay.ts
│   │   ├── MagneticButton.ts
│   │   ├── SplitReveal.ts         # revelado de texto (SplitText)
│   │   ├── Marquee.ts
│   │   ├── WorkCard.ts
│   │   ├── ParallaxImage.ts
│   │   └── Counter.ts
│   ├── effects/
│   │   ├── ascii/
│   │   │   ├── AsciiPortrait.ts   # clase principal (§6.3)
│   │   │   ├── charRamp.ts        # rampas de caracteres
│   │   │   └── ascii.worker.ts    # (opcional) muestreo en Web Worker
│   │   └── noise.ts               # simplex 2D para shimmer/ripple
│   └── sections/
│       ├── hero.ts
│       ├── clients.ts
│       ├── work.ts
│       ├── services.ts
│       ├── about.ts
│       ├── stack.ts
│       ├── cta.ts
│       └── footer.ts
├── scripts/
│   ├── recon.ts                   # Fase 0: analiza el sitio de referencia
│   └── screenshots.ts             # Playwright: captura cada sección en 3 viewports
├── recon/                         # salida de Fase 0 (gitignored)
│   ├── reference/                 # screenshots del sitio real
│   ├── scripts.json               # lista de <script> y libs detectadas
│   ├── fonts.json
│   └── sections.md                # inventario de secciones escrito por Claude Code
└── screenshots/                   # salida de scripts/screenshots.ts (gitignored)
```

**Convenciones de código:**

- Un módulo = una clase o una función `init<Nombre>(root: HTMLElement)` que devuelve `{ destroy() }`. Todo debe ser destruible (para transiciones de página y HMR).
- Selectores por `data-*` (`data-hero`, `data-split`, `data-magnetic`), **nunca** por clases de estilo.
- Sin `any`. Sin `!important`. Sin librerías extra sin justificación escrita en `CLAUDE.md`.
- Cada archivo empieza con un comentario de 1–3 líneas: qué hace y en qué fase se creó.

---

## 4. Design tokens (`src/styles/tokens.css`)

### 4.1 Color

```css
:root {
  --bg: #0f0e0e; /* negro cálido, base */
  --bg-elev: #171515; /* cards, overlay menú */
  --fg: #f2f0ec; /* blanco cálido, no #FFF puro */
  --fg-muted: #9a9a9a; /* sub-copy */
  --fg-dim: #6e6e6e; /* logos, labels */
  --accent: #39ff6a; /* verde terminal — único color de marca (deliberadamente distinto del naranja de la referencia) */
  --accent-hover: #5cff85;
  --accent-ink: #0f0e0e; /* texto sobre el acento */
  --line: rgba(242, 240, 236, 0.12);
}
```

Regla: **un solo acento**. Cualquier otro color es un error.

Nota de diseño: `--accent` reemplaza al naranja `#FF4D00` de good-fella.com en **todos** los usos de §6 (botones, CTA, retrato ASCII §6.3, subrayados, marquee "✦", radial del CTA §6.12) — donde el spec diga "naranja" o `#FF4D00`, léase `--accent` (verde terminal). Verificar contraste AA de `--accent-ink` sobre `--accent` en Fase 5 (§8).

### 4.2 Tipografía (self-hosted, OFL)

| Rol            | Fuente                        | Fallback     | Uso                                                  |
| -------------- | ----------------------------- | ------------ | ---------------------------------------------------- |
| Display / body | **Inter** (variable, 400–600) | system-ui    | Headlines, párrafos                                  |
| Mono           | **JetBrains Mono** 400/500    | ui-monospace | Botones, labels, nav, "MENU", metadatos, ASCII       |
| Wordmark       | **Silkscreen** (pixel)        | monospace    | Logo "JAVIER" / iniciales en el nav y footer gigante |

Escala fluida (`clamp`):

```css
--fs-display: clamp(3rem, 8.5vw, 7.5rem); /* headline hero, lh .95, ls -0.02em */
--fs-h2: clamp(2.25rem, 5.5vw, 4.5rem); /* títulos de sección */
--fs-h3: clamp(1.5rem, 2.5vw, 2.25rem);
--fs-body: clamp(1rem, 1.1vw, 1.125rem); /* lh 1.5 */
--fs-label: 0.75rem; /* mono, uppercase, ls .08em */
--fs-footer: clamp(6rem, 22vw, 20rem); /* wordmark gigante del footer */
```

### 4.3 Espaciado y layout

```css
--gutter: clamp(1.25rem, 2vw, 2rem); /* margen lateral (~24 px en 1366) */
--section: clamp(6rem, 12vw, 12rem); /* padding vertical entre secciones */
--col-gap: 1.5rem;
--radius: 0; /* TODO es rectangular. Sin border-radius */
```

Grid: `display:grid; grid-template-columns: repeat(12, 1fr)` en `.container`.

### 4.4 Motion

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1); /* "expo.out" — entradas */
--ease-inout: cubic-bezier(0.83, 0, 0.17, 1); /* transiciones/overlays */
--dur-fast: 0.35s;
--dur-base: 0.8s;
--dur-slow: 1.4s;
```

En GSAP: registrar `CustomEase.create("main", "0.16,1,0.3,1")` y `CustomEase.create("wipe", "0.83,0,0.17,1")`, usar por nombre.

Lenis: `{ lerp: 0.08, wheelMultiplier: 1, smoothWheel: true }` (ajustar tras probar; el sitio de referencia se siente ~0.08–0.1).

---

## 5. Contenido (`src/content/site.ts`)

Todo texto vive aquí como objeto tipado. **Claude Code no escribe copy dentro de HTML** — el HTML tiene `data-content="hero.title"` o se renderiza desde TS. Los campos marcados `TODO_JAVIER` los llena Javier antes de la Fase 4; mientras tanto se usa el placeholder propuesto.

```ts
export const site = {
  meta: {
    name: 'Javier', // TODO_JAVIER: nombre y apellido completos
    role: 'Mechatronics Engineer & AI Developer',
    location: 'Guadalajara, MX',
    email: 'TODO_JAVIER',
    url: 'TODO_JAVIER',
    ogDescription: 'Mechatronics engineer building AI products. Portfolio built with Claude Code.',
  },
  nav: {
    logo: 'JAVIER', // wordmark en Silkscreen (equivalente a "GOOD")
    menuLabel: 'MENU',
    cta: { label: "LET'S WORK TOGETHER", href: '#contact' },
    links: [
      { label: 'Work', href: '#work' },
      { label: 'Services', href: '#services' },
      { label: 'About', href: '#about' },
      { label: 'Stack', href: '#stack' },
      { label: 'Contact', href: '#contact' },
    ],
    socials: [/* TODO_JAVIER: GitHub, LinkedIn, X */],
  },
  hero: {
    title: ['Engineering that', 'learns.'], // 2 líneas, equivalente a "The digital landmark / studio."
    // Alternativas: ["Hardware brain,", "software soul."] | ["Mechatronics meets", "intelligence."]
    subtitle:
      'I design systems where mechanics, electronics and machine learning meet — and ship them as products people actually use.',
    primary: { label: 'SEE THE WORK', href: '#work' },
    secondary: { label: 'Tell me more', href: '#about' },
  },
  clients: {
    label: '+ MANY MORE',
    // Equivalente a logos de clientes: aquí van tecnologías/instituciones (texto en mono, no logos de terceros con marca registrada)
    items: ['Tec de Monterrey', 'Orael', 'ROAR', 'Claude Code'],
  },
  work: {
    heading: 'Selected work',
    items: [
      {
        slug: 'orael',
        title: 'Orael',
        tagline: 'AI growth partner for LATAM infoproduct sellers',
        year: '2026',
        tags: ['SaaS', 'AI', 'Product'],
        cover: '/img/work/orael.webp', // generar en Fase 4
        href: '/work/orael.html',
      },
      {
        slug: 'roar',
        title: 'ROAR',
        tagline: 'Live football engagement, second-screen social',
        year: '2026',
        tags: ['Mobile', 'Realtime', 'Sports'],
        cover: '/img/work/roar.webp',
        href: '/work/roar.html',
      },
      {
        slug: 'this-site',
        title: 'This portfolio',
        tagline: 'Awwwards-style site built end-to-end with Claude Code',
        year: '2026',
        tags: ['Creative dev', 'GSAP', 'Canvas'],
        cover: '/img/work/portfolio.webp',
        href: 'TODO_JAVIER: repo URL',
      },
      // TODO_JAVIER: 1–2 proyectos de mecatrónica (circuitos, control, robótica) con foto real
    ],
  },
  services: {
    heading: 'What I do',
    items: [
      {
        n: '01',
        title: 'AI product development',
        desc: 'From prompt engineering and agent workflows to shipping LLM-powered SaaS.',
      },
      {
        n: '02',
        title: 'Mechatronics & embedded',
        desc: 'Circuit analysis, control systems and firmware that talk to the physical world.',
      },
      {
        n: '03',
        title: 'Creative web',
        desc: 'Motion-driven interfaces with GSAP, Lenis and Canvas — like this one.',
      },
      {
        n: '04',
        title: 'Data & modeling',
        desc: 'Statistics, regression and forecasting turned into decisions.',
      },
    ],
  },
  marquee: ['Mechatronics', 'AI Development', 'Creative Web', 'Product', 'Guadalajara'],
  about: {
    heading: 'About',
    // Párrafo largo que se revela palabra por palabra al scroll (§6.6)
    manifesto:
      "I'm an engineering student at Tec de Monterrey and co-founder of two SaaS products. I care about the seam between hardware and intelligence — and about building things that feel as good as they work. This site is a live experiment: every line was written alongside Claude Code.",
    facts: [
      { label: 'Based in', value: 'Guadalajara, MX' },
      { label: 'Studying', value: 'Mechatronics · Tec de Monterrey' },
      { label: 'Building', value: 'Orael, ROAR' },
      { label: 'Currently', value: 'TODO_JAVIER' },
    ],
  },
  stack: {
    heading: 'Tools',
    groups: [
      { name: 'AI', items: ['Claude / Claude Code', 'Python', 'LLM agents', 'Prompt engineering'] },
      { name: 'Hardware', items: ['Circuit analysis', 'Control systems', 'TODO_JAVIER'] },
      { name: 'Web', items: ['TypeScript', 'GSAP', 'Lenis', 'Canvas', 'Vite', 'Remotion'] },
      { name: 'Data', items: ['Statistics', 'Excel modeling', 'Regression / forecasting'] },
    ],
  },
  cta: {
    heading: ["Let's build", 'something.'],
    email: 'TODO_JAVIER',
    button: { label: "LET'S WORK TOGETHER", href: 'mailto:TODO_JAVIER' },
  },
  footer: {
    wordmark: 'JAVIER',
    credits: 'Design inspired by Good Fella. Built with Claude Code.',
    year: 2026,
  },
} as const;
```

---

## 6. Especificación de secciones y efectos

Orden en `index.html`: Preloader → Nav → Hero → Clients → Work → Services → Marquee → About → Stack → CTA → Footer. Cada sección es `<section data-section="hero">` con su `init` en `src/sections/`.

### 6.1 Preloader (`core/preloader.ts`)

- Overlay fullscreen `--bg` con contador `000 → 100` en mono (`Counter.ts`) y el wordmark en Silkscreen.
- Duración mínima 1.2 s aunque cargue antes; espera a `document.fonts.ready` + imagen/vídeo del ASCII listos.
- Salida: el overlay se desliza hacia arriba (`yPercent: -100`, `ease: "wipe"`, 1 s) mientras el hero ya está haciendo su entrada (overlap de 0.4 s con `timeline.add(..., "-=0.4")`).
- Solo la primera visita de la sesión (`sessionStorage`), después se salta.
- Con `prefers-reduced-motion`: fade de 0.3 s sin contador.

### 6.2 Nav (`components/Nav.ts`) y Menú (`MenuOverlay.ts`)

- Barra `position: fixed`, 3 zonas: wordmark | "MENU ≡" centrado | CTA + botón "+".
- Al scrollear >80 px: la barra reduce altura (padding 32→16 px) con transición; al scrollear hacia abajo se oculta (`y: -100%`), hacia arriba reaparece (usar `ScrollTrigger.create({ onUpdate: self => self.direction })`).
- El botón "+" y el CTA son **magnéticos** (§6.5). El "+" rota 45° en hover (se convierte en "×" visualmente) — ese mismo "+" es el que abre el menú en móvil.
- **Menú fullscreen:** overlay `--bg-elev` con wipe desde arriba (`clip-path: inset(0 0 100% 0)` → `inset(0)`, 0.8 s, `wipe`). Links en `--fs-h2` que entran con stagger 0.06 s desde `y: 100%` con `overflow:hidden` en cada línea. Columna derecha: socials + email en mono. "MENU" cambia a "CLOSE" con un swap de texto vertical. `Esc` cierra. Al abrir se llama `lenis.stop()`, al cerrar `lenis.start()`.

### 6.3 Hero — retrato ASCII (`effects/ascii/AsciiPortrait.ts`) — efecto principal

Layout: izquierda (cols 1–7) headline + sub + botones; derecha (cols 7–13) `<canvas data-ascii>` de 100 % alto del hero.

**Sujeto (decisión de Javier, sustituye al retrato humano):** en vez de un rostro, el sujeto es un **jaguar** — foto propia de Javier, retrato de perfil, boca abierta/rugido. Mismo tratamiento técnico que un retrato humano: fondo negro real recortado, sujeto bien iluminado, buen contraste de bordes (el pelaje moteado y los dientes dan mucha textura de "edge" al algoritmo, debería verse muy bien). Fuente: `public/img/portrait/jaguar.mp4` (loop corto, ligera respiración/parpadeo si es vídeo generado; o `jaguar.png` estático si se usa foto fija — decidir en Fase 4 según qué asset produzca Higgsfield con mejor calidad) con fallback `jaguar.png`. Aspect 3:4, fondo recortado a negro puro (`--bg`) por remoción de fondo antes de procesar. La carpeta `public/img/portrait/` y las variables del código mantienen el nombre genérico `portrait` para no atarlas al sujeto — solo cambia el archivo fuente.

**Corrección confirmada en Fase 0 (recon/diff.md):** el mapeo de color real del sitio de referencia es **inverso** a lo que se había inferido de la captura: el acento es la **base** (mayoría de celdas en tono medio) y el **blanco se reserva para highlights** (bordes de alto contraste, puntos de brillo), no al revés. El mouse aclara localmente hacia blanco. Esto reemplaza el punto 5 anterior:

**Algoritmo (Canvas 2D):**

1. **Grid — valor MEDIDO en la referencia, no estimado (`scripts/measure-grid.ts`):** `cellW = 7.56 px`, `cellH = 7.56 px` — **celdas cuadradas** (ratio 1.00), densidad de 1 celda por 57.2 px². Método: la tinta sumada por columna (y por fila) de una rejilla monoespaciada es una señal periódica cuyo periodo es el tamaño de celda; se localiza por magnitud de Fourier a frecuencias fraccionarias sobre los píxeles de `recon/reference/hero-base*.png`. Las capturas a DPR 1 y DPR 2 coinciden en 7.560 / 7.563. El método se valida antes contra nuestro propio canvas, donde recupera 8.000 × 12.005 exactos. Esto **sustituye** al `8 × 12` estimado previamente, que resultó ser 1.68× menos denso (6 % menos columnas, **59 % menos filas**). `cols = floor(canvasW / cellW)`, `rows = floor(canvasH / cellH)`. Canvas escalado por `devicePixelRatio` (máx. 2).
   - **Consecuencia para un renderizador de texto:** la referencia dibuja cada glifo como un quad cuadrado de un atlas WebGL, que se estira solo. `fillText` no: un glifo de JetBrains Mono avanza ~0.6 em, así que con `fontSize ≈ cellH` deja hueco horizontal. Para llenar la celda cuadrada hay que **estirar el texto en X** — medir el avance real con `ctx.measureText('0').width` y aplicar `ctx.setTransform(dpr * sx, 0, 0, dpr, 0, 0)` una vez por pasada (no por glifo), dividiendo las coordenadas x entre `sx`.
2. **Sampling con proporción correcta (fix — la fuente no debe estirarse al canvas):** calcular un recorte tipo `object-fit: cover` de la imagen fuente que coincida con la proporción **del área mostrada** — `(cols * cellW) / (rows * cellH)` — y dibujar solo esa porción con `drawImage(source, sx, sy, sw, sh, 0, 0, cols, rows)`. **Nunca** ajustar a la proporción `cols / rows`: con celdas no cuadradas eso deforma al sujeto exactamente en `cellH / cellW` (con 8 × 12 el jaguar salía estirado 1.5× a lo alto — verificado en `screenshots/grid/a-actual-8x12-f11.png`). Con celdas cuadradas ambas fórmulas coinciden, pero la correcta debe usarse igualmente porque el canvas del footer tiene otras proporciones. Cada frame (`gsap.ticker`, capado a 30 fps para el muestreo): dibujar ese recorte en un `OffscreenCanvas` de `cols × rows` px (el downscale ya promedia).
3. **Suavizado previo (fix — evita ruido de textura en superficies con patrón, como pelaje moteado):** antes de leer `getImageData`, aplicar un desenfoque leve a la imagen ya recortada (`ctx.filter = 'blur(2px)'` antes del `drawImage`, o un downscale-upscale rápido), de modo que patrones repetitivos de alto contraste local (manchas, rayas, texturas finas) se promedien entre celdas vecinas y dejen de disparar el detector de highlight del punto 6, mientras que los bordes estructurales grandes (mandíbula, oreja, hocico, colmillos) sobreviven porque tienen suficiente escala. Sin este paso, cualquier sujeto con textura repetitiva genera highlights dispersos por toda la superficie en vez de solo en los bordes que definen la forma.
4. `getImageData` (sobre el recorte ya suavizado) → por celda, luminancia `L = 0.2126R + 0.7152G + 0.0722B` normalizada 0–1. Aplicar contraste: `L = clamp((L - 0.15) * 1.4)`.
5. **Rampa de caracteres gradual (fix — reduce el efecto "bloque sólido" en zonas de textura):** en vez de 4 escalones bruscos, usar 8–10 niveles de densidad progresiva. Rampas en `charRamp.ts`:
   - `dense`: `" .'\`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"` (rampa completa, ~70 niveles — usar un subset de 8–10 índices espaciados uniformemente, no mapear carácter por carácter)
   - `code` (la que se ve en la referencia: predominan letras y dígitos, muy poca puntuación pesada): construir 8–10 buckets de `L`, cada uno con su subconjunto de glifos (`0123456789ABCDEFabcdef` para las 6–7 bandas medias), reservando `#%@` únicamente para el 10–15 % más brillante — **no** desde `L > 0.35` como antes, que generaba manchas sólidas. Umbral de vacío: L < 0.12 → espacio.
6. **Color base = acento, highlight = blanco (corregido tras Fase 0 — con matiz, ver nota):** todas las celdas con L > 0.12 se pintan por defecto en `--accent` (verde) con alpha = `0.35 + 0.55 * L`. Las celdas de **alto contraste local** (donde `L` supera en > 0.35 el promedio de sus 8 vecinas — subido de 0.25 a 0.35 tras el suavizado del punto 3, para que solo disparen bordes estructurales genuinos) suben a `--fg` (blanco) a alpha 0.9–1. El mouse (punto 8) también aclara hacia `--fg`. Fuente: `JetBrains Mono`. Precalcular `fillStyle` por 8 niveles de alpha × 2 colores; agrupar por nivel y color antes de dibujar (batch de `fillText` por bucket).
   - **VERIFICADO con píxeles (`scripts/verify-color-mapping.ts`), duda resuelta:** se bineó la captura de referencia con el grid medido y se clasificó cada celda por el color medio de su tinta — sin tocar el DOM ni variables CSS, que en un canvas WebGL no dirían nada. Resultado sobre `hero-base-2x.png`: **1131 celdas de acento (51.8 %) frente a 357 blancas (16.4 %)**, las blancas con más tinta (6489 vs 6216) y sobre todo con **2.65× más contraste local (1450 vs 547)**. Las tres predicciones de la hipótesis se cumplen; la tercera es la decisiva, porque sitúa el blanco exactamente en los bordes. La corrección de Fase 0 queda confirmada. *(La captura a DPR 1 no tiene resolución para separar las clases y no encuentra celdas blancas: solo es válida la de DPR 2.)*
   - **Calibración de `smooth` + umbral:** el umbral no se elige a ojo. La referencia tiene un **24 % de highlights** sobre sus celdas con color; barriendo combinaciones y clasificando nuestro render **con el mismo criterio por celda** (`scripts/tune-highlights.ts`), `smooth 1.0` + `highlightDelta 0.12` da un 20.3 %, el más cercano. Nota: el 0.35 propuesto arriba, combinado con el suavizado, eliminaba el 100 % de los highlights — el suavizado baja el contraste local, así que el umbral debe bajar con él, no subir.
7. **Shimmer:** cada 120 ms, el 3 % de las celdas con L > 0.35 cambia su carácter aleatorio (por eso el retrato "vive"); las celdas en highlight (`--fg`) tienen 2× probabilidad de shimmer que las de base, para que el blanco "titile" ligeramente más.
8. **Interacción con el mouse:** puntero → coordenada en grid. Radio 6 celdas: dentro del radio, `L` se eleva (`+0.35 * falloff`), los caracteres se reemplazan por los de mayor densidad, y las celdas pasan temporalmente a `--fg` (blanco) con alpha proporcional al falloff — el cursor "aclara" la zona que toca. Desplazamiento adicional `dx = sin(noise) * 2px` para un leve ripple. Puntero suavizado con `lerp(0.12)`. En touch: mismo efecto con el último toque.
9. **Entrada:** al terminar el preloader, el retrato se revela con un barrido vertical: solo se dibujan filas `< revealRow`, animando `revealRow` 0→rows en 1.4 s `main`, con las filas del borde en alpha 1 (efecto "scanline").
10. **Scroll:** parallax suave, el canvas se mueve `y: 15 %` respecto al hero con `scrub: true`; pasado el hero, `visibility: hidden` para no gastar frames.
11. Performance: `willReadFrequently: true` en el contexto del offscreen; nada de `getImageData` por celda; pausar el loop si `document.hidden` o si el hero no está en viewport (`IntersectionObserver`).

**12. Click-to-color (decisión de Javier — feature nueva sobre el spec original):** el retrato tiene **dos modos**, `ascii` (por defecto, según puntos 1–11) y `color`. Al hacer clic en cualquier punto del canvas, se dispara una transición de ~0.9 s que reemplaza el mapeo mono-tono (verde base + blanco highlight) por un **mapeo de color real por celda**: en vez de `L` en escala de grises, se toma el color RGB muestreado de la celda tal cual (sin pasar por la rampa acento/blanco) y se pinta el carácter con ese color exacto — el resultado es el mismo retrato ASCII pero a todo color (tonos naturales del jaguar: ámbar, negro, blanco, con algo de azul/cian si el fondo original tenía tinte frío, replicando el tipo de resultado multi-tono visto en el ejemplo de referencia). Segundo clic vuelve al modo `ascii`.

- **Transición:** crossfade por celda, no por canvas completo — cada celda interpola su color actual → color destino con `gsap.to({t:0}, {t:1, duration:0.9, ease:"main", onUpdate})` compartido (un solo tween controla un valor de progreso global; el color de cada celda se calcula por `lerp` de RGB en cada frame usando ese progreso). Evita crear cientos de tweens individuales.
- El carácter de cada celda (su glifo) se mantiene igual durante la transición — solo cambia el color; el shimmer sigue activo en ambos modos.
- Un pequeño indicador mono (`[click to reveal]` / `[click for ASCII]`) aparece en la esquina inferior del canvas, visible solo en hover, para comunicar que es interactivo.
- `prefers-reduced-motion`: el cambio de modo es instantáneo (sin crossfade), sigue siendo clicable.
- Este es el efecto insignia del sitio, así que merece más tiempo de pulido en Fase 3 que el resto de componentes — si el crossfade por celda resulta muy costoso en CPU, alternativa de fallback: crossfade por opacidad de dos canvas superpuestos (uno ascii, uno color) en vez de interpolar color por celda.

**Bonus Fase 8 (opcional):** versión WebGL con Three.js (`ShaderMaterial` que muestrea el vídeo y un atlas de caracteres, igual que el sitio de referencia — confirmado en Fase 0 que su efecto real es WebGL, no Canvas 2D), con el toggle ascii↔color como uniform del shader en vez de crossfade por celda en CPU. Solo tras validar la versión Canvas 2D.

### 6.4 Hero — texto y botones

- Headline: `SplitReveal` con `SplitText` (`type: "lines,words"`, `mask: "lines"` disponible en 3.13 — verificar en docs; si no, envolver cada línea en `overflow:hidden` manualmente). Palabras entran `yPercent: 110 → 0`, `duration: 1.1`, `ease: main`, `stagger: 0.04`. Empieza 0.4 s antes de que el preloader termine de salir.
- Sub-copy: fade + `y: 20` 0.8 s, `delay 0.5`.
- Botones: `y: 20` + opacity, stagger 0.1, después del sub-copy.
- Botones `.btn`: `mono uppercase 0.75rem ls .08em`, `padding 14px 20px`, fondo `--accent`, texto `--accent-ink`, sin radius. El "+" es `.btn--icon` cuadrado del mismo alto (44 px). Hover: fondo `--accent-hover` + el texto hace un **slide vertical** (dos copias del label en un contenedor `overflow:hidden`, la superior sube `-100%` y la inferior entra). Link "Tell me more": subrayado 1 px que se retrae y vuelve a crecer desde la izquierda en hover (`scaleX` con `transform-origin` alternado).

### 6.5 Botones magnéticos y cursor (`MagneticButton.ts`, `core/cursor.ts`)

- Magnético: en `pointermove` dentro de un área de `1.6×` el tamaño del botón, el botón se traslada `(dx, dy) * 0.35` con `gsap.quickTo` (`duration 0.6, ease: main`); al salir vuelve a 0 con `elastic.out(1, 0.4)`. El texto interior se mueve `* 0.15` adicional (parallax interno).
- Cursor custom: punto de 8 px `--fg` con `mix-blend-mode: difference`, sigue el puntero con `quickTo` (lerp ≈ 0.15). Sobre `[data-cursor="view"]` (cards de work) crece a 80 px con texto "VIEW" en mono. Sobre links crece a 40 px. Se oculta en touch devices y con `prefers-reduced-motion` (cursor nativo).

### 6.6 Clients / tech row (`sections/clients.ts`)

- Fila con `items` en mono uppercase `--fg-dim`, separados por gap 48 px, + "+ MANY MORE". Entrada por ScrollTrigger: fade + stagger 0.08 al 80 % del viewport, `once: true`.

### 6.7 Work (`sections/work.ts`, `WorkCard.ts`)

- Título "Selected work" en `--fs-h2` con `SplitReveal` disparado por scroll (`start: "top 80%"`).
- Lista vertical de filas full-width (estilo agencia): cada fila = índice mono `01`, título en `--fs-h3`, tagline en `--fg-muted`, tags mono, año a la derecha. Línea inferior `--line`.
- **Hover:** una imagen flotante (`cover`) de 320×400 sigue al cursor con `quickTo` (lerp 0.1) y ligera rotación proporcional a la velocidad del puntero (`clamp(vx * 0.05, -8, 8)`); aparece con `scale 0.8→1` + opacity. Solo una imagen visible; al cambiar de fila hace crossfade. El cursor pasa a modo "VIEW".
- La fila en hover: título se desplaza `x: 16px` y las demás filas bajan opacity a 0.4.
- Móvil: cada fila muestra su imagen debajo, sin efecto flotante.
- Entrada: filas con `y: 40` + opacity, stagger 0.1, `once: true`.

### 6.8 Services (`sections/services.ts`)

- Grid 2 cols (móvil 1): número mono `01`, título `--fs-h3`, descripción `--fg-muted`. Borde superior `--line` que se dibuja (`scaleX 0→1`, origin left) al entrar.
- Título de sección **pinneado** a la izquierda (`pin: true` sobre la columna del título, `end: "bottom bottom"` del grid) mientras los items pasan a la derecha — solo en ≥ 1024 px (`gsap.matchMedia`).

### 6.9 Marquee (`Marquee.ts`)

- Texto en `--fs-h2`, mono, uppercase, separado por "✦" en `--accent`. Dos copias del contenido, `translateX` continuo con `gsap.to(track, { xPercent: -50, repeat: -1, ease: "none", duration: 20 })`.
- La velocidad reacciona al scroll: `timeScale` = `1 + clamp(|lenis.velocity| * 0.05, 0, 3)`, con lerp de vuelta a 1. Dirección invertida al scrollear hacia arriba.

### 6.10 About — manifiesto (`sections/about.ts`)

- Párrafo en `--fs-h3`, ancho máx. (usar cols 3–11). `SplitText` por palabras; cada palabra empieza en `--fg-dim` opacity 0.25 y pasa a `--fg` opacity 1 con `scrub: true` entre `start: "top 75%"` y `end: "bottom 45%"` (efecto "texto que se enciende al leer").
- Debajo, `facts` en 4 columnas mono (label `--fg-dim` / value `--fg`).

### 6.11 Stack (`sections/stack.ts`)

- 4 columnas (móvil 2) con `name` en mono `--accent` y lista de items. Entrada con stagger por columna. Hover en item: la línea inferior se dibuja.

### 6.12 CTA (`sections/cta.ts`)

- Título 2 líneas `--fs-display` con `SplitReveal`; email en `--fs-h3` con subrayado animado; botón "LET'S WORK TOGETHER" + "+" magnéticos, centrados.
- Fondo: sutil radial `--accent` al 6 % que sigue al puntero (variable CSS `--mx/--my` actualizadas en `pointermove`).

### 6.13 Footer (`sections/footer.ts`)

- Wordmark "JAVIER" en Silkscreen a `--fs-footer`, color `--fg`, que **entra desde abajo por scroll** (`yPercent: 30 → 0`, scrub) y queda parcialmente recortado por el borde inferior (`line-height: 0.8; margin-bottom: -0.1em`).
- Fila superior: 3 columnas mono — links de navegación | socials | `credits` + año + "Local time: HH:MM" (reloj de Guadalajara actualizado cada segundo).
- Efecto "revelar footer": el footer es `position: sticky; bottom: 0; z-index: 0` y la sección anterior tiene `z-index: 1` con fondo, de modo que el footer parece descubrirse bajo el CTA.

### 6.14 Transiciones globales

- **Scroll:** Lenis en `core/lenis.ts`:
  ```ts
  const lenis = new Lenis({ lerp: 0.08 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  ```
  Anchors del menú usan `lenis.scrollTo(target, { offset: -80, duration: 1.4 })`.
- **Reduced motion:** `utils.prefersReducedMotion()` → Lenis desactivado, animaciones de entrada reemplazadas por `gsap.set` a estado final, ASCII estático sin shimmer, cursor nativo.
- **Resize:** todo `SplitText` se revierte y se recalcula con debounce 200 ms; `ScrollTrigger.refresh()` tras recalcular. ASCII recalcula grid.

---

## 7. Assets a producir (con las tools conectadas)

| Asset                                                        | Tool                                                           | Spec                                                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `jaguar.mp4` / `jaguar.png`                                  | **Higgsfield** a partir de una foto propia de Javier de un jaguar (perfil, rugido) | 3:4, fondo recortado a negro puro, buen contraste de bordes (pelaje/dientes); si se genera vídeo, loop corto de 6–8 s con movimiento mínimo. Reemplaza al placeholder `portrait.*` en `public/img/portrait/` |
| Covers de work (`orael.webp`, `roar.webp`, `portfolio.webp`) | **Canva** o **Higgsfield** (image)                             | 4:5, 1280×1600, estilo oscuro con acento; para "this portfolio" usar screenshot real del hero                                   |
| `og.jpg`                                                     | Canva                                                          | 1200×630: wordmark + role sobre `--bg`                                                                                          |
| `favicon.svg`                                                | Código                                                         | "J" en Silkscreen sobre cuadrado de acento                                                                                      |
| Fuentes                                                      | Google Fonts → woff2 → `/public/fonts`                         | Inter variable, JetBrains Mono 400/500, Silkscreen 400                                                                          |

Estos assets los genera Javier con Claude (chat) antes de la Fase 4; Claude Code no debe bloquearse por ellos — usa placeholders (`portrait.png` = gradiente radial generado con canvas; covers = rectángulos con el título) y un `TODO` en `CLAUDE.md`.

---

## 8. Requisitos no funcionales

- **Performance:** Lighthouse desktop ≥ 90 en Performance, ≥ 95 en Accessibility/Best Practices/SEO. ASCII ≤ 4 ms por frame en un portátil medio (medir con `performance.now()` y loguear en dev). JS inicial < 150 kB gzip. Fuentes con `font-display: swap` y `preload`.
- **Accesibilidad:** navegación completa por teclado (menú, botones, skip-link), `aria-expanded` en MENU, foco visible de acento de 2 px, contraste AA en todo texto (el `--fg-dim` solo para decorativo), `prefers-reduced-motion` respetado, `<canvas aria-hidden="true">` con `<img alt>` alternativa oculta.
- **SEO/meta:** `<title>`, description, OG/Twitter cards, `lang="en"`, `theme-color`, sitemap simple.
- **Responsive:** breakpoints 480 / 768 / 1024 / 1440. Móvil: hero apilado (texto arriba, ASCII debajo a 60 vh), sin cursor custom, sin imagen flotante, sin pin.
- **Compatibilidad:** últimas 2 versiones de Chrome/Edge/Firefox/Safari. `OffscreenCanvas` con fallback a canvas oculto.

---

## 9. Plan de fases (cada fase = un prompt a Claude Code, con criterios de aceptación)

Cada fase termina con: `npm run build` sin errores, `npm run lint` limpio, `npm run shots` (Playwright) y un resumen en `CLAUDE.md › Progreso` de qué se hizo y qué quedó pendiente. **No avanzar de fase sin cumplir los criterios.**

### Fase 0 — Reconocimiento del sitio de referencia (sin escribir UI)

Objetivo: eliminar las suposiciones de §1.2.

1. `scripts/recon.ts` con Playwright: abre `https://good-fella.com`, guarda en `recon/`:
   - `scripts.json`: todos los `<script src>` y `<link>` de fuentes; detecta en `window` la presencia de `gsap`, `ScrollTrigger`, `Lenis`, `Webflow`, `THREE`.
   - `fonts.json`: `document.fonts` (family, weight).
   - Colores computados de `body`, botones y headline (`getComputedStyle`).
   - Screenshots full-page en 1440, 1024 y 390 px, y una captura por cada `<section>` detectada (scroll lento para que disparen las animaciones; esperar 1.5 s por sección).
   - Captura de 3 estados del hero con el mouse en posiciones distintas sobre el retrato (para ver la interacción del ASCII).
   - Abre el menú (clic en MENU) y captura.
2. Claude Code escribe `recon/sections.md`: inventario de secciones en orden, con: contenido tipo, layout, efectos observados, timing aproximado. Y `recon/diff.md`: qué de §1.2 y §6 se confirma, qué se corrige.
3. **Criterio:** `recon/` completo y `diff.md` propone cambios concretos a §6. Javier aprueba los cambios antes de la Fase 1. _(Los screenshots de referencia son solo para comparación local; van en `.gitignore`.)_

### Fase 1 — Scaffold y sistema de diseño

- `npm create vite@latest` (vanilla-ts), instalar deps con versiones verificadas, ESLint/Prettier, `tsconfig` strict, `.gitignore`, `README.md` inicial.
- `tokens.css`, `reset.css`, `typography.css`, `layout.css`, fuentes self-hosted con `@font-face`.
- `index.html` con **todas** las secciones y su contenido real desde `site.ts` (renderizado en `main.ts` o HTML estático — decidir y documentar), sin animaciones.
- `core/gsap.ts`, `core/lenis.ts`, `core/utils.ts` listos. Lenis activo.
- `scripts/screenshots.ts` funcionando (3 viewports × cada sección → `screenshots/`).
- **Criterio:** sitio estático completo, tipografía y colores idénticos a §4, responsive en 3 viewports, Lenis funcionando, 0 errores de consola.

### Fase 2 — Nav, botones, cursor, preloader

- `Nav.ts`, `MenuOverlay.ts`, `MagneticButton.ts`, `cursor.ts`, `preloader.ts` + `Counter.ts`, estilos de botones con hover slide.
- **Criterio:** preloader → hero handoff con overlap; menú abre/cierra con teclado y mouse; magnetismo suave sin jitter (verificar que no se acumule transform); cursor con blend mode; todo desactivado con reduced-motion.

### Fase 3 — Retrato ASCII (Canvas 2D)

- `AsciiPortrait.ts` completo según §6.3 con `portrait.png` placeholder (gradiente + círculo) hasta tener el real.
- Panel de debug en dev (`?debug`): sliders de `cellW`, contraste, radio del mouse, rampa; FPS y ms/frame.
- **Criterio:** ≤ 4 ms/frame a 1440 px, reveal por scanline, shimmer, interacción con puntero, pausa fuera de viewport. Screenshot comparado lado a lado con `recon/reference/hero-*.png`.

### Fase 4 — Animaciones de scroll y secciones

- `SplitReveal.ts`, entradas de todas las secciones, work hover con imagen flotante, services pin, marquee reactivo, about scrub, footer reveal + reloj.
- Integrar assets reales (portrait.mp4, covers) si ya existen.
- **Criterio:** cada efecto de §6.6–6.13 verificable en screenshots; `ScrollTrigger.refresh()` tras resize sin saltos; sin scroll jank (DevTools Performance: frames > 16 ms < 5 %).

### Fase 5 — Responsive, accesibilidad, performance

- Pasada móvil completa, `matchMedia` para desactivar pin/flotante, foco, skip-link, Lighthouse.
- **Criterio:** métricas de §8 cumplidas; reporte Lighthouse guardado en `screenshots/lighthouse.html`.

### Fase 6 — Deploy y README

- Repo GitHub público, Vercel, dominio, OG. README con: GIF del hero, stack, cómo se construyó con Claude Code (enlace al spec), créditos a Good Fella y a las libs.
- **Criterio:** URL pública funcionando, OG preview correcto.

### Fase 7 (opcional) — Páginas de caso + transiciones

- `/work/orael.html`, `/work/roar.html` con hero de caso, problema/solución/stack/resultado, galería con parallax.
- `core/transitions.ts`: al hacer clic en link interno, overlay `--accent` wipe (0.6 s) → `fetch` del HTML → swap de `<main>` → `destroy()` de módulos viejos, `init` de nuevos → wipe out. Historial con `pushState`/`popstate`.

### Fase 8 (opcional) — ASCII en WebGL

- Three.js `ShaderMaterial` con atlas de caracteres; toggle en el panel de debug para comparar con 2D.

---

## 10. Reglas anti-alucinación para Claude Code

1. **Verificar antes de afirmar.** Versiones (`npm view`), APIs de GSAP/Lenis (consultar `node_modules/<pkg>/README.md` o los tipos `.d.ts` instalados — no memoria). Si `SplitText` no tiene una opción, no inventarla: leer `node_modules/gsap/types/split-text.d.ts`.
2. **Mirar el resultado.** Tras cada cambio visual, correr `npm run shots` y **abrir/leer las imágenes** antes de declarar la tarea hecha. Comparar con `recon/reference/`.
3. **No cambiar el spec silenciosamente.** Si algo del §6 es inviable o mejorable, escribir el cambio propuesto en `CLAUDE.md › Decisiones` con motivo, y preguntar si afecta el resultado visual.
4. **Una fase a la vez.** No adelantar trabajo de fases posteriores.
5. **Nada de contenido inventado.** Todo copy sale de `site.ts`; los `TODO_JAVIER` quedan como placeholders visibles (`[TODO]`) hasta que Javier los llene — nunca rellenarlos con datos ficticios (emails, empresas, logros).
6. **Nada de assets de terceros.** No descargar imágenes, fuentes ni vídeos de good-fella.com ni de otros sitios. Placeholders generados por código.
7. **Cero dependencias sorpresa.** Añadir un paquete requiere anotar en `CLAUDE.md` qué problema resuelve que no se podía resolver con lo existente.
8. **Errores de consola = tarea no terminada.** Incluye warnings de GSAP ("target not found") y de Vite.
9. **Reportar con honestidad.** Al final de cada fase: qué funciona, qué está aproximado, qué no se pudo verificar y por qué.

---

## 11. Plantilla de `CLAUDE.md` (Claude Code la genera en Fase 1)

```md
# Javier Portfolio — CLAUDE.md

Sitio de portafolio que replica las técnicas de good-fella.com con contenido propio.
Spec completo: ./PORTFOLIO_SPEC.md (leer antes de cualquier tarea).

## Stack (versiones reales instaladas)

- vite x.y.z · typescript x.y.z · gsap x.y.z · lenis x.y.z · playwright x.y.z

## Comandos

- npm run dev · npm run build · npm run preview · npm run lint · npm run shots · npm run recon

## Reglas

(copiar §10 íntegro)

## Convenciones

(copiar "Convenciones de código" de §3 y tokens de §4)

## Decisiones

- [fecha] Decisión · Motivo · Impacto visual

## Progreso

- [ ] Fase 0 … - [ ] Fase 8 (con notas por fase)

## TODO_JAVIER

- lista de placeholders pendientes en site.ts y assets faltantes
```

---

## 12. Prompt inicial para Claude Code

```
Lee PORTFOLIO_SPEC.md completo. Vamos a construir mi portafolio replicando las técnicas de good-fella.com con mi contenido.

Empieza por la Fase 0 exactamente como está descrita en §9: crea el proyecto mínimo necesario para correr scripts/recon.ts con Playwright, ejecuta el reconocimiento de https://good-fella.com, y entrégame recon/sections.md y recon/diff.md. No escribas ninguna UI todavía. Sigue las reglas de §10: verifica versiones con npm, no inventes APIs, y dime con honestidad qué no pudiste observar.

Cuando termines, propón los cambios concretos a §6 y espera mi aprobación antes de la Fase 1.
```

Prompt de cada fase siguiente: `"Fase N según §9 de PORTFOLIO_SPEC.md. Criterios de aceptación obligatorios. Al terminar: build, lint, shots, y actualiza CLAUDE.md › Progreso."`

---

## 13. Flujo de trabajo Javier → Claude (chat) → Claude Code

1. **Chat (aquí):** revisar `recon/diff.md` y ajustar este spec; generar assets con Higgsfield/Canva (§7); redactar/afinar copy de `site.ts`.
2. **Claude Code:** ejecutar fases; subir screenshots.
3. **Chat:** revisar screenshots contra la referencia, decidir correcciones, escribir el siguiente prompt.

Este ciclo (spec → build → screenshots → revisión) es en sí mismo la historia que cuenta el portafolio; guardar las capturas por fase en `screenshots/progress/` para el README y para el caso "This portfolio".

---

> Nota de transcripción (Fase 0): este archivo fue regenerado desde el documento original `PORTFOLIO_SPEC_1.md` adjuntado por Javier, corrigiendo únicamente el encoding (mojibake UTF-8→cp1252). El contenido es fiel al original; en §7 la frase "acento naranja" del original se normalizó a "acento" conforme a la nota de diseño de §4.1 (el acento del proyecto es `--accent` verde terminal).
