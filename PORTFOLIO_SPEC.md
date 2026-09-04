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
| Animación       | **GSAP 3.13+** (`gsap`, `gsap/ScrollTrigger`, `gsap/SplitText`, `gsap/CustomEase`, `gsap/ScrambleTextPlugin`)                                       | Todos los plugins son gratuitos desde 2025 — **NO** crear `.npmrc` con token de GreenSock, no usar `npm.greensock.com`. Instalar solo `npm i gsap`  |
| Smooth scroll   | **Lenis** (`lenis`) — sincronizado con GSAP ticker                                                                                    | Es literalmente lo que usa el sitio de referencia                                                                                                   |
| ASCII / efectos | **Canvas 2D** primero; **Three.js** en la Fase 8 opcional                                                                             | La Fase 0 midió que el ASCII de la referencia **es WebGL** (shader con atlas de glifos), no un "opcional": igualarlo 1:1 exige WebGL. Canvas 2D llega muy cerca y es depurable, así que se construye en 2D y la paridad exacta queda como Fase 8 |
| Estilos         | **CSS moderno** (custom properties, `clamp()`, container queries, `@layer`) en archivos `.css` por componente. Sin Tailwind, sin Sass | Control total del layout y evita clases genéricas que se ven "template"                                                                             |
| Fuentes         | Google Fonts self-hosted en `/public/fonts` (ver 4.2)                                                                                 | Licencia OFL, sin peticiones externas                                                                                                               |
| Routing         | Single-page con anchors + **Vite multi-page** para `/work/<slug>.html` (opcional Fase 7)                                              | Transiciones de página se hacen con overlay + `fetch` del HTML destino (Fase 7) o simplemente navegación con preloader                              |
| Deploy          | **Vercel** (o GitHub Pages) desde repo GitHub público                                                                                 | El repo público es parte de la "prueba"                                                                                                             |
| Testing visual  | **Playwright** (dev dep) para screenshots automáticas de cada sección                                                                 | Es la forma de que Claude Code _vea_ lo que construyó y compare                                                                                     |
| Lint            | ESLint + Prettier                                                                                                                     | Repo público limpio                                                                                                                                 |

Versiones: **Claude Code debe correr `npm view <pkg> version` para cada dependencia antes de escribir el `package.json`** y anotar las versiones reales en `CLAUDE.md`. No asumir versiones.

**Nota de la Fase 0:** la referencia resultó ser **Next.js + Tailwind v4 + Sanity en Vercel**, no Webflow como suponía §1.2. No cambia nada de esta tabla: se replican técnicas, no plataforma. Los plugins de GSAP confirmados en su bundle son ScrollTrigger, SplitText, **ScrambleText**, **Flip** y **Observer** (GSAP 3.14.2).

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
│   │   └── components/          # uno por sección/componente real (ver nota abajo)
│   │       ├── button.css · nav.css · menu.css · preloader.css
│   │       ├── hero.css · stats.css · process.css · work.css · marquee.css
│   │       ├── principles.css · stack.css · faq.css · contact.css · footer.css
│   │       └── counter.css · placeholder.css · grid-overlay.css · ascii-debug.css
│   ├── render/
│   │   └── sections.ts            # renderSite(): HTML de todas las secciones desde site.ts
│   ├── core/
│   │   ├── lenis.ts               # instancia Lenis + integración con gsap.ticker
│   │   ├── gsap.ts                # registerPlugin centralizado + eases custom
│   │   ├── preloader.ts
│   │   ├── transitions.ts         # (Fase 7) overlay entre páginas
│   │   └── utils.ts               # lerp, clamp, isTouch, prefersReducedMotion()
│   ├── components/
│   │   ├── Nav.ts
│   │   ├── Menu.ts                # panel desplegable (§6.2), no overlay fullscreen
│   │   ├── CtaButton.ts           # relevo del "+" y scramble del label (§6.5)
│   │   ├── SplitReveal.ts         # revelado de texto (SplitText con autoSplit)
│   │   ├── Marquee.ts
│   │   └── Counter.ts             # odómetro por dígito (Stats, §6.10)
│   ├── effects/
│   │   └── ascii/
│   │       ├── AsciiPortrait.ts   # clase principal (§6.3)
│   │       ├── charRamp.ts        # rampas de caracteres
│   │       └── debug.ts           # panel de sliders con ?debug
│   └── sections/
│       ├── hero.ts · heroIntro.ts
│       ├── process.ts · work.ts · faq.ts · contact.ts · footer.ts
│       ├── reveals.ts             # entradas por scroll comunes a las 7 secciones
│       └── hovers.ts              # scrambles de principles y stack
├── scripts/                       # sondas y verificación (ver CLAUDE.md › Comandos)
│   ├── recon*.ts                  # Fase 0 y sondas puntuales sobre la referencia
│   ├── check-phase{2,3,4}.ts      # suites de aceptación por fase
│   ├── measure-*.ts · verify-*.ts · tune-*.ts · diagnose-*.ts   # mediciones
│   └── screenshots.ts             # Playwright: captura cada sección en 3 viewports
├── recon/                         # salida de Fase 0 (gitignored)
│   ├── reference/                 # screenshots del sitio real
│   ├── scripts.json               # lista de <script> y libs detectadas
│   ├── fonts.json
│   └── sections.md                # inventario de secciones escrito por Claude Code
└── screenshots/                   # salida de scripts/screenshots.ts (gitignored)
```

**Cambios respecto al árbol original**, todos consecuencia de hallazgos de la Fase 0 ya aprobados: se eliminan `cursor.ts` y `cursor.css` (§6.5), `about.ts`/`about.css` (§6.10), `services.*` (pasa a `principles`), `cta.*` (pasa a `contact`), `WorkCard.ts` y `ParallaxImage.ts` (el work es un showcase sticky, §6.7), `ascii.worker.ts` y `noise.ts` (no hicieron falta: el muestreo es puntual y el shimmer usa ruido barato en línea). `menu-overlay.css` pasa a `menu.css`. Se añade `src/render/sections.ts`.

**Convenciones de código:**

- Un módulo = una clase o una función `init<Nombre>(root: HTMLElement)` que devuelve `{ destroy() }`. Todo debe ser destruible (para transiciones de página y HMR).
- Selectores por `data-*` (`data-hero`, `data-split`, `data-magnetic`), **nunca** por clases de estilo.
- Sin `any`. Sin `!important`. Sin librerías extra sin justificación escrita en `CLAUDE.md`.
- Cada archivo empieza con un comentario de 1–3 líneas: qué hace y en qué fase se creó.
- **El copy se inyecta en build, no en cliente:** `vite.config.ts` monta un plugin `transformIndexHtml` que llama a `renderSite()`. El texto vive solo en `site.ts` (§5) pero el HTML servido ya va completo, que es lo que exige el SEO de §8 — y evita el flash de contenido vacío.

---

## 4. Design tokens (`src/styles/tokens.css`)

### 4.1 Color

**Corregido en Fase 0 (diff.md §B4):** los valores se remidieron sobre las capturas de la referencia. Además la home **alterna tema claro y oscuro por sección**, cosa que el spec original no contemplaba, así que hacen falta tokens de tema claro.

```css
:root {
  --bg: #141314; /* medido (el #0F0E0E del spec era más oscuro de la cuenta) */
  --bg-elev: #171515; /* cards, panel del menú */
  --fg: #eeeeee; /* medido */
  --fg-muted: #818081; /* medido — sub-copy */
  --fg-dim: #696869; /* medido — logos, labels */

  /* Tema claro: la home alterna por sección (diff.md §B4) */
  --bg-light: #ededed;
  --card-light: #f6f6f5;
  --fg-on-light: #141314;

  --accent: #39ff6a; /* verde terminal — único color de marca (deliberadamente distinto del naranja de la referencia) */
  --accent-hover: #5cff85;
  --accent-on-light: #0b5f27; /* el verde puro no contrasta sobre claro */
  --accent-ink: #0f0e0e; /* texto sobre el acento */
  --line: rgba(238, 238, 238, 0.12);
}
```

Regla: **un solo acento**. Cualquier otro color es un error.

**Cómo se usan:** cada sección declara `data-theme="dark|light"` y el CSS de componentes **solo** toca las variables semánticas (`--surface`, `--on-surface`, `--rule`, `--btn-bg`…), nunca los colores crudos de arriba. Así un mismo botón se invierte solo al entrar en una sección clara. `:root` mapea las semánticas al tema oscuro por defecto, para que nada quede sin resolver fuera de una sección (el marquee salió negro sobre negro por no tener esa red de seguridad).

Nota de diseño: `--accent` reemplaza al naranja `#FF4D00` de good-fella.com en **todos** los usos de §6 (botones, CTA, retrato ASCII §6.3, subrayados, marquee "✦", radial del CTA §6.12) — donde el spec diga "naranja" o `#FF4D00`, léase `--accent` (verde terminal). Verificar contraste AA de `--accent-ink` sobre `--accent` en Fase 5 (§8).

### 4.2 Tipografía (self-hosted, OFL)

| Rol            | Fuente                        | Fallback     | Uso                                                  |
| -------------- | ----------------------------- | ------------ | ---------------------------------------------------- |
| Display / body | **Inter** (variable, 400–600) | system-ui    | Headlines, párrafos                                  |
| Mono           | **JetBrains Mono** 400/500    | ui-monospace | Botones, labels, nav, "MENU", metadatos, ASCII       |
| Wordmark       | **Silkscreen** (pixel)        | monospace    | **Solo** el logo pequeño del nav (el footer gigante va en sans, §6.13) |

Escala fluida (`clamp`):

```css
--fs-display: clamp(3rem, 8.5vw, 7.5rem); /* headline hero, lh 1.10, ls -0.035em (medido) */
--fs-h2: clamp(2.25rem, 5.5vw, 4.5rem); /* títulos de sección, peso 500, ls -0.05em (medido) */
--fs-h3: clamp(1.5rem, 2.5vw, 2.25rem);
--fs-body: clamp(1rem, 1.1vw, 1.125rem); /* lh 1.5 */
--fs-label: 0.75rem; /* mono, uppercase, ls -0.02em (medido) */
--fs-footer: clamp(6rem, 22vw, 20rem); /* wordmark gigante del footer, en SANS */
```

**Corregido en Fase 0 (diff.md §B4):** tres medidas del spec original estaban mal y son las que más cambian el aire del sitio — el display tiene `line-height` **1.10**, no 0.95; el `letter-spacing` del display es **−0.035em**, no −0.02em; y sobre todo, **los labels mono llevan tracking NEGATIVO (−0.02em)**, no el +0.08em positivo que decía el spec. Este último invierte por completo la textura de todos los labels, botones y metadatos del sitio.

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

**Corregido en Fase 0 (diff.md §C):** la estructura de `site.ts` sigue el orden de secciones aprobado, así que el objeto de ejemplo que traía este apartado quedó obsoleto. La forma real, con las claves tal como existen hoy:

```ts
export const site = {
  meta,        // name · role · location · email · url · ogDescription
  nav,         // links · socials · status · cta · logoAlt (swap JAVIER→TRAPERO, §6.2)
  hero,        // title (2 líneas) · sub · cta · link "Tell me more"
  clients,     // instituciones y tecnologías, + "MANY MORE" (§6.6)
  stats,       // foto + 3 métricas con odómetro (§6.10)
  process,     // 4 pasos del scrollytelling — absorbe el papel del About (§6.10)
  work,        // proyectos con meta `[SAAS] — [AI]`, año y URL (§6.7)
  principles,  // 6 items del grid 3×2 (§6.8)
  stack,       // 4 grupos de herramientas (§6.11)
  faq,         // preguntas y respuestas del acordeón (§6.15)
  contact,     // titular, email y botón (§6.12)
  footer,      // links · socials · credits · legal (§6.13)
} as const;
```

Se eliminaron del objeto original: `services` (pasa a `principles`), `about.manifesto` (su contenido vive ahora en el copy de `process`) y `cta` (renombrado a `contact`). Se añadieron `stats`, `faq` y `nav.logoAlt`. `marquee` se conserva por decisión de Javier.

**El copy concreto vive en el archivo, no aquí.** Este documento fija la forma; duplicar los textos en el spec es justo lo que los hizo divergir. Para saber qué falta, buscar `[TODO]` en el sitio renderizado o `TODO_JAVIER` en `site.ts` — la lista viva está en `CLAUDE.md › TODO_JAVIER`.

---

## 6. Especificación de secciones y efectos

> **Sincronizado con `recon/diff.md` el 2026-09-03.** La Fase 0 midió el sitio de referencia y
> corrigió buena parte de esta sección; los cambios se aprobaron en `diff.md` pero durante cinco
> fases no se trasladaron aquí, así que el spec describía un sitio que ya no era el que se estaba
> construyendo. Este back-port lo arregla. `diff.md` queda como documento histórico de la Fase 0:
> **manda este archivo**. Las decisiones posteriores viven en `CLAUDE.md › Decisiones`.

Orden en `index.html`: Preloader → Nav → **Hero → Stats → Process → Work → Marquee → Principles → Stack → FAQ → Contact → Footer**. Cada sección es `<section data-section="hero">` con su `init` en `src/sections/`, y declara `data-theme="dark|light"`: la home alterna temas como la referencia (hero D · stats L · process L · work D · marquee D · principles L · stack D · faq D · contact L · footer D).

### 6.1 Preloader (`core/preloader.ts`)

**Corregido en Fase 0 (diff.md §B2):** la referencia NO usa contador `000 → 100` ni wordmark, y su overlay es del **color de acento**, no del fondo. El contador se elimina de aquí; `Counter.ts` se reutiliza para los odómetros de Stats (§6.6).

**Indicador MEDIDO frame a frame en la referencia** (`scripts/recon-spinner.ts` → `recon/spinner.json`, `scripts/recon-spinner2.ts` → `recon/spinner-slow.json`, tira visual en `screenshots/spinner-strip.png`). Los bloques **no se rellenan en secuencia**: son cuatro cuadrados que **entran volcando** desde fuera del borde izquierdo, uno tras otro, hasta llenar la pista.

- **Pista:** 70 × 16 px, `position: relative`, `overflow-x: clip; overflow-y: visible` (el clip esconde los bloques que aún no han entrado; el `visible` en Y deja que la esquina sobresalga durante el giro).
- **Cuatro bloques** de 16 × 16 px en `--accent-ink`, `position: absolute; top: 0; left: 0`, con **`transform-origin: bottom right`** y `translateX(-16px)` de partida.
- **Cada bloque vuelca 90° sobre su esquina inferior derecha** — que es justo lo que lo desplaza 16 px a la derecha — mientras su `translateX` va de `-16px` a `18·i - 16` (`i` = índice). Los cuatro aterrizan en `[0,16] [18,34] [36,52] [54,70]`: 4 × 16 px + 3 huecos de 2 px = los 70 px exactos de la pista.
- **Giro medido:** rotación pura (las matrices cumplen `cos² + sin² = 1.0000`, sin escala ni sesgo), **~490 ms por vuelco**, con arranque lento, medio rápido y cola larga — el mejor ajuste sobre la muestra más densa (23 puntos) es `power3.inOut` con RMS 0.041. Los vuelcos se encadenan cada **450–620 ms**, o sea prácticamente seguidos.
- **Son exactamente 4 vuelcos, no un loop.** Verificado a dos velocidades de red muy distintas: con la carga normal el overlay dura 2.9 s y con la red estrangulada a 1.6 Mbps dura 6.85 s, y en ambos casos cada bloque gira **una sola vez**. La secuencia dura ~2 s y luego el overlay simplemente espera a que la página esté lista. (A 180 kbps ni siquiera llega el JS y no se mueve nada: la animación la mueve JS, no CSS — `animationName` es `none` en todo el subárbol.)
- **Label "LOADING"** debajo, separado 16 px, en una caja tan ancha como la pista (67 px medidos frente a 70). Se resuelve con **scramble de izquierda a derecha** en ~700 ms, terminando antes que los bloques; los caracteres sin resolver se pintan más tenues que los ya fijados. Secuencia real capturada: `"       "` → `"\"` → `"ul"` → `"L(!"` → `"LO1q^"` → `"LOADIC@"` → `"LOADIN8"` → `"LOADING"`.
- **Accesibilidad** (copiado de la referencia): la palabra real va en un `<span class="sr-only">LOADING</span>` y el texto que baila es `aria-hidden`, para que un lector de pantalla no lea la sopa de letras.
- Duración mínima 1.2 s aunque cargue antes; espera a `document.fonts.ready` + la imagen del ASCII lista.
- Salida: **wipe horizontal** — el overlay se va hacia la derecha (`xPercent: 100`) con un leve `skewX` que inclina el borde, 1 s, `ease: "wipe"`.
- El hero arranca su entrada cuando el wipe EMPIEZA, no cuando termina: el preloader expone `exiting` (arranque de la salida) y `done` (overlay retirado). El titular usa la primera y la onda del retrato (§6.3) la segunda.
- Solo la primera visita de la sesión (`sessionStorage`), después se salta.
- Con `prefers-reduced-motion`: fade de 0.3 s sin animación del indicador.

### 6.2 Nav (`components/Nav.ts`) y Menú (`components/Menu.ts`)

**Corregido en Fase 0/2 (diff.md §B3 + `recon/nav-behavior.json`):** el menú de la referencia no es un overlay fullscreen sino un panel desplegable, el swap de "MENU" es un scramble, y el nav **no tiene fondo propio**.

- Barra `position: fixed` y **transparente** (`background-color: transparent`), 3 zonas: wordmark | "MENU ≡" centrado | CTA + botón "+".
- **Cambia de tema según la sección de debajo**, no de fondo: el color del texto alterna `--fg` / `--fg-on-light` con un `ScrollTrigger` por sección que mira la línea media del nav.
- Hover del CTA: **el "+" y el label intercambian posición** — `[LABEL][+] ⇄ [+][LABEL]`. Es lo observado en la referencia.
- **Menú = panel desplegable** bajo el nav (no fullscreen): `clip-path: inset(0 0 100% 0)` → `inset(0)`, 0.8 s, `wipe`, con backdrop oscurecido detrás. 3 columnas: links en `--fs-h2` con bullet cuadrado del acento, entrando con stagger 0.06 s desde `y: 100%` | contacto, socials y badges de estado | 2 thumbnails etiquetados. "MENU" pasa a "CLOSE" con **scramble** (`ScrambleTextPlugin`), y el wordmark hace swap `JAVIER → TRAPERO`. `Esc` cierra, el foco queda atrapado dentro y el panel es `inert` al cerrarse. Al abrir se llama `lenis.stop()`, al cerrar `lenis.start()`.

**Diferenciadores intencionales de Javier** (medidos como inexistentes en la referencia, ver `CLAUDE.md › Decisiones`): la barra encoge de 32 a 16 px de padding pasados los 80 px, y se oculta al bajar / reaparece al subir — nunca con el menú abierto ni con `prefers-reduced-motion`.

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
9. **Entrada:** al terminar el preloader, el retrato se revela con una **onda radial** que sale de la cabeza del jaguar (`revealOrigin` 0.28 / 0.36) — no con el barrido vertical tipo scanline que decía el spec original. Solo se dibujan las celdas dentro de `revealRadius`, y la cresta (7 celdas de grosor) va a alpha 1, como una piedra al caer al agua. Corregido en Fase 0 (diff.md §B1): la referencia también usa reveal radial desde un origen configurable.

   **Duración y curva, medidas y no elegidas a ojo:** la clave no es el número nominal sino **cuánto tiempo pasa la cresta cruzando la imagen**. Con los 1.9 s y la curva `silk` originales, la cresta iba del 10 % al 90 % del recorrido en **0.45 s** — en el primer cuarto del tiempo ya estaba al 80 % y el resto era un goteo de celdas sueltas, de ahí que se leyera como un parpadeo. Con **3.2 s y `power1.out`** ese tramo pasa a **1.62 s** (3.6× más) y el barrido se sostiene de principio a fin. `scripts/compare-reveal.ts` mide las variantes y compone las viñetas por progreso del barrido, no por reloj.
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

### 6.5 Feedback de los botones (`components/CtaButton.ts`)

**Corregido en Fase 0/2 (diff.md §B7):** la referencia **no tiene cursor custom** — el puntero es el nativo y el feedback de hover se hace con scrambles, bullets cuadrados y la pill "VIEW PROJECT". `core/cursor.ts` se elimina del proyecto.

**Sin magnetismo.** Medido en la Fase 2 (`recon/nav-behavior.json`): el `transform` del CTA de la referencia es `none` en reposo, cerca y encima. Estuvo implementado entre el 2026-09-02 y el 2026-09-04 como diferenciador; Javier lo revirtió tras verlo en vídeo. **`MagneticButton.ts` ya no existe.** Ver `CLAUDE.md › Decisiones` para el historial completo, que es lo que evita que alguien lo reponga leyendo una versión antigua del documento.

**El relevo del "+", MEDIDO** (`scripts/recon-cta.ts` → `recon/cta-hover.json`). El "+" **no viaja** de un lado a otro: hay **dos**, uno por lado, y se hace el relevo. Es CSS puro, sin Flip ni JS.

| | |
| --- | --- |
| "+" que sale | `transform-origin: right center`, de `rotate(0) scale(1)` a `rotate(-45deg) scale(0)` |
| "+" que entra | `transform-origin: left center`, de `rotate(-45deg) scale(0)` a `rotate(0) scale(1)` |
| label | de `translateX(-(alto + 6px))` a `translateX(0)` |
| transición | **0.7 s · `cubic-bezier(0.83, 0, 0.17, 1)`**, solo sobre `transform` |
| geometría | "+" cuadrado del alto del botón, `gap: 6px` |
| el "+" derecho | **fuera del flujo** (`position: absolute; inset-inline-end: 0`) |

Ese último punto no es un detalle: el "+" izquierdo, aunque esté a `scale(0)`, **sigue ocupando su caja** más el gap, y el label se corre justo eso para taparla. Si el derecho estuviera también en el flujo se quedaría esa misma distancia de más a la derecha — medido: **56 px de hueco en reposo contra 6 en hover**, y 50 px de caja reservada de más. La referencia lo resuelve con `absolute right-0`, y así se replica.

Esa curva resulta ser **exactamente el ease `wipe`** que ya se había medido en el preloader (§6.1) — la referencia usa la misma en los dos sitios.

**El texto scramblea, y el destello lo acompaña.** Medido: el label hace un `ScrambleText` que resuelve de izquierda a derecha (21 estados en la referencia, 17 en el nuestro) **sin cambiar de color**. El aclarado a blanco es una petición de Javier; se monta como un degradado recortado al texto (`background-clip: text`) cuya **posición** se anima — una custom property sin `@property` no interpola. Va a la misma duración y curva que el relevo, de modo que el destello viaja pegado al frente de resolución del scramble en vez de ir por su cuenta. Con `prefers-reduced-motion` no hay scramble.

- El relevo responde también a `:focus-within`, para que llegue por teclado. La referencia solo reacciona a `:hover`.
- Sin efectos de puntero en dispositivos táctiles ni con `prefers-reduced-motion`.

### 6.6 Clients / tech row (`sections/clients.ts`)

- Fila con `items` en mono uppercase `--fg-dim`, separados por gap 48 px, + "+ MANY MORE". Entrada por ScrollTrigger: fade + stagger 0.08 al 80 % del viewport, `once: true`.

### 6.7 Work (`sections/work.ts`)

**Corregido en Fase 0 (diff.md §B6):** la lista de filas con imagen flotante siguiendo al cursor **no existe** en la referencia. Es un **showcase sticky** y no hay `WorkCard.ts`.

- Título "Selected work" en `--fs-h2` con `SplitReveal` disparado por scroll (`start: "top 80%"`).
- **Showcase sticky:** columna de pestañas (una por proyecto, con índice mono `01` y bullet cuadrado del acento en la activa) junto a una media grande. Al scrollear, la pestaña activa avanza sola y la media hace crossfade. Cada proyecto lleva `meta` en mono estilo `[SAAS] — [AI]` y su año.
- **Marcador de las pestañas — diferenciador de Javier.** Medido en la referencia: hay **un solo marcador** que **salta** entre posiciones (462 → 542 → 622 px, sin animación). Aquí en cambio **cae** al proyecto siguiente: un único elemento de **10 px** posicionado sobre la lista, con duración proporcional a `√altura` como un cuerpo cayendo, `bounce.out` al bajar y `back.out` al subir. Además **tumba mientras cae** (0.12° por px, acotado entre 7° y 20°) y se endereza al posarse con un pequeño contragiro. Medido: giro máximo 12.4°, final 0.00°. Cada item reserva su hueco con `.work__slot` para que el layout no baile, y sin JS ese hueco pinta el activo.
- **Pill "VIEW PROJECT"**, MEDIDA en la referencia (`scripts/recon-work.ts` → `recon/work-behavior.json`). No es un elemento dentro de cada figura: es **un único seguidor `position: fixed`** en coordenadas de viewport, `pointer-events: none`, que **no se desmonta al salir** de la media. De él cuelga el cartel, 32 px por encima del cursor y centrado, con `transform-origin: bottom` — como un letrero colgado.
  - **Caja MEDIDA** (`scripts/recon-pill-box.ts` → `recon/pill-box.json`): **111.56 × 28.6 px**, relleno `4px 8px`, tipo **13.7388 px / 20.61** con tracking −0.02em, `border-radius: 0`. Con una mono de avance 0.6 em la cuenta cuadra exacta: 12 caracteres × (13.74 × 0.6 − 0.2748) + 16 de relleno = 111.56. Cuelga con su **borde inferior 11.4 px por encima del cursor**, centrado en horizontal.
  - **Retardo del seguimiento:** mediana 15.8 px, p95 80.9 px (medido con el cursor dentro). Se reproduce con `gsap.quickTo` a 0.32 s y `power2`; con `power3` a 0.5 s salía el doble de flojo.
  - **Balanceo:** el cartel gira **0.0995° por cada píxel de desfase horizontal** respecto al cursor (ajuste por mínimos cuadrados, RMS 1.76°), con un máximo observado de 14.1°. Se acota a 16°.
  - **Separación de responsabilidades obligatoria:** la posición vive en el seguidor y la opacidad/escala/giro en el cartel. Mezclarlas fue la causa del bug en el que la pill se quedaba pegada al borde: los tweens de opacidad con `overwrite: true` mataban los `quickTo` de posición.
  - **Diferenciador de Javier — entrada tipo "genie".** La pill acompaña al cursor desde fuera de la figura y se despliega en un margen de **80 px** alrededor (poco más de media anchura del cartel), de modo que entra ya en marcha en vez de aparecer en el borde. La referencia la monta al entrar y sin deformación.
    La transición **no es un fade con escalado parejo**: es un squash & stretch direccional, como minimizar al Dock. **El eje no es fijo.** Es el vector desde el punto en el que el cartel estaba plegado hasta donde está el cursor, así que la cinta se tiende por donde el puntero ha venido, venga de donde venga — la misma lógica que ya rige el estiramiento por velocidad, aplicada también a la aparición.
    Sobre ese eje: `along = 1 + 0.38·(1−t)` y `perp = t^0.8`. Encima se compone el estiramiento por movimiento, sobre el eje de la velocidad: `along = 1 + s`, `perp = 1 − 0.6·s` con `s = |v| · 0.006` acotado a 0.3.
  - **Cómo se implementa la escala sobre un eje arbitrario.** `scaleX`/`scaleY` solo saben escalar en los ejes del elemento; para hacerlo sobre un eje girado sin dejar el cartel torcido hace falta componer `R(θ)·S(along, perp)·R(−θ)`, que sale simétrica y por tanto no introduce rotación. Las dos fases usan **la misma función** y se multiplican sus matrices; el balanceo va por fuera, así que el conjunto ya deformado se columpia. Se escribe como `matrix()` directamente en el `style` — GSAP no toca la pill, solo el seguidor.
    Medido a distancias idénticas del borde: llegando por la izquierda a 52 px la cinta es `1.26 × 0.41`; llegando desde arriba, `0.41 × 1.26` — exactamente la misma, girada 90°. En diagonal las normas se igualan (`0.93 × 0.93`) y la anisotropía vive en los términos cruzados (`b 0.30`, `c 0.29`).
  - **El eje se fija de golpe al empezar cada despliegue**, no se suaviza desde el del anterior: plegado no hay nada en pantalla que continuar, y el despliegue dura menos de lo que el suavizado tarda en converger — un acercamiento vertical salía en diagonal por arrastrar el eje del pase previo. Una vez desplegándose sí se suaviza, y sobre el vector y no sobre el ángulo, para no saltar al cruzar ±180°.
- Móvil: cards apiladas, sin sticky ni pill.
- Entrada: filas con `y: 40` + opacity, stagger 0.1, `once: true`.

### 6.8 Principles (`sections/principles.ts` → renderizado en `render/sections.ts`)

**Corregido en Fase 0 (diff.md §B5):** la sección "Services" del spec no existe; la referencia tiene en su lugar un grid `Build` de 3×2. Javier decidió llenarlo con **principios de trabajo**, no con el stack (que vive aparte en §6.11).

- Grid 3×2 (móvil 1): número mono `01`, título, descripción `--fg-muted`, separados por hairlines `--rule` que se dibujan (`scaleX 0→1`, origin left) al entrar.
- **Hover:** scramble del título con `ScrambleTextPlugin` + bullet cuadrado del acento. Sin efectos en táctil.

### 6.9 Marquee (`Marquee.ts`)

- Texto en `--fs-h2`, mono, uppercase, separado por "✦" en `--accent`. Dos copias del contenido, `translateX` continuo con `gsap.to(track, { xPercent: -50, repeat: -1, ease: "none", duration: 20 })`.
- La velocidad reacciona al scroll: `timeScale` = `1 + clamp(|lenis.velocity| * 0.05, 0, 3)`, con lerp de vuelta a 1. Dirección invertida al scrollear hacia arriba.

### 6.10 Stats y Process (sustituyen al About-manifiesto)

**Corregido en Fase 0 (diff.md §B5):** la referencia no tiene sección de manifiesto con texto que se enciende al leer. Su lugar en el recorrido lo ocupan dos secciones, y entre las dos absorben el papel narrativo que el spec le daba al About. **`sections/about.ts` no se crea.**

- **Stats** — 4 cards: foto de Javier + 3 métricas. Cada cifra es un **odómetro por dígito** (`Counter.ts`, columna 0–9 que rueda) disparado al entrar en viewport. Aquí es donde se reutiliza el `Counter.ts` que el spec original destinaba al contador del preloader.
- **Process** (`sections/process.ts`) — **scrollytelling** de 4 pasos: el paso activo se enciende y el resto baja al 32 % de opacidad, con la media **sticky** al lado haciendo crossfade al cambiar de paso. Bullets cuadrados marcan el avance. Con `prefers-reduced-motion` todos los pasos quedan encendidos y la media fija.

### 6.11 Stack (`render/sections.ts` + hovers en `sections/hovers.ts`)

- 4 columnas (móvil 2) con `name` en mono `--accent` y lista de items. Entrada con stagger por columna. Hover en item: scramble del nombre y la línea inferior se dibuja.

### 6.12 Contact (`sections/contact.ts`)

**Renombrado:** el spec la llamaba "CTA"; en la estructura aprobada es la sección **Contact**, y es de **tema claro** con el botón invertido a oscuro (como el "BOOK A 15-MIN CALL" de la referencia).

- Título 2 líneas `--fs-display` con `SplitReveal`; email en `--fs-h3` con subrayado animado; botón "LET'S WORK TOGETHER" + "+", centrados.
- Fondo: sutil radial `--accent` al 6 % que sigue al puntero. Se actualizan solo las variables CSS `--mx/--my` en `pointermove` y el CSS pinta el radial — sin tweens por frame. Desactivado en táctil.

### 6.13 Footer (`sections/footer.ts`)

**Corregido en Fase 0 (diff.md §B5):** en la referencia el wordmark gigante va en la **sans**, no en tipografía de píxel. Javier aprobó respetarlo: **Silkscreen queda solo para el logo pequeño del nav.**

- Wordmark "JAVIER" en **sans** a `--fs-footer`, color `--fg`, que **entra desde abajo por scroll** (`yPercent: 30 → 0`, scrub) y queda parcialmente recortado por el borde inferior (`line-height: 0.8; margin-bottom: -0.1em`).
- **Segundo retrato ASCII** (§6.3) asomando desde el borde derecho sobre el wordmark, misma clase `AsciiPortrait`, segunda instancia. Replica los dos canvases laterales de la referencia con un solo retrato, según lo aprobado en diff.md §B1.
- Fila superior: 3 columnas mono — links de navegación (con scramble en hover) | socials | `credits` + año + "Local time: HH:MM" (reloj de Guadalajara actualizado cada segundo). **Sin newsletter** (la referencia la tiene; Javier no).
- **Easter eggs por teclado**, anunciados en el propio footer como hace la referencia: **`G`** superpone la rejilla de 12 columnas y **`C`** rota el color de acento. Ambos se ignoran mientras el foco está en un campo de texto.
- Efecto "revelar footer": el footer es `position: sticky; bottom: 0; z-index: 0` y la sección anterior tiene `z-index: 1` con fondo, de modo que el footer parece descubrirse bajo Contact.

### 6.14 FAQ (`sections/faq.ts`)

**Sección nueva** de la estructura aprobada (diff.md §B5); no existía en el spec original.

- Acordeón de preguntas, **una abierta a la vez**, con la altura animada y scramble del título al abrir.
- Accesible por teclado: cada cabecera es un `<button>` con `aria-expanded` y el panel se referencia con `aria-controls`.
- Hairline `--rule` entre preguntas, dibujada con `scaleX` al entrar.

### 6.15 Transiciones globales

- **Scroll:** Lenis en `core/lenis.ts`:
  ```ts
  const lenis = new Lenis({ lerp: 0.08 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  ```
  Anchors del menú usan `lenis.scrollTo(target, { offset: -80, duration: 1.4 })`.
- **Reduced motion:** `utils.prefersReducedMotion()` → Lenis desactivado, animaciones de entrada reemplazadas por `gsap.set` a estado final, ASCII estático sin shimmer. (No hay cursor custom que desactivar, §6.5.)
- **Resize:** `SplitReveal.ts` usa `SplitText` con `autoSplit: true` + `onSplit` devolviendo el tween, que **resuelve por sí solo** el re-split en resize y al cargar las fuentes. Esto sustituye al debounce manual de 200 ms que pedía este punto: la propia librería lo hace mejor y sin código nuestro. `ScrollTrigger.refresh()` tras recalcular. El ASCII recalcula su grid.
- **Sin efectos de puntero en táctil:** `utils.isTouch()` apaga pill, halo, magnetismo y parallax del retrato.

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

### Fase 2 — Nav, menú, botones, preloader

- `Nav.ts`, `Menu.ts`, `CtaButton.ts`, `preloader.ts`, estilos de botones. (Sin `cursor.ts` ni `MagneticButton.ts`, §6.5. `Counter.ts` se mueve a la Fase 4 con Stats.)
- **Criterio:** preloader → hero handoff con overlap; menú abre/cierra con teclado y mouse; el nav cambia de color por sección; magnetismo suave sin jitter (verificar que no se acumule transform); todo desactivado con reduced-motion.

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
