# Javier Portfolio — CLAUDE.md

Sitio de portafolio que replica las técnicas de good-fella.com con contenido propio.
Spec completo: ./PORTFOLIO_SPEC.md (leer antes de cualquier tarea).
Hallazgos de la Fase 0 que **corrigen** el spec: ./recon/sections.md y ./recon/diff.md (aprobados el 2026-09-02).

## Stack (versiones reales instaladas — verificadas con `npm view`)

- vite 8.2.2 · typescript 6.0.3 · gsap 3.15.0 · lenis 1.3.26 · playwright 1.62.1
- eslint 10.9.1 · typescript-eslint 8.69.0 · prettier 3.9.6

## Comandos

- `npm run dev` · `npm run build` (tsc --noEmit && vite build) · `npm run preview`
- `npm run lint` (eslint + prettier --check) · `npm run format`
- `npm run shots` (capturas propias → screenshots/) · `npm run recon` (analiza el sitio de referencia)
- `node scripts/check-phase2.ts` — suite de interacción (preloader, menú, teclado, tema del nav, magnetismo, reduced-motion)
- `node scripts/check-phase3.ts` — suite del ASCII (reveal, shimmer, puntero, ms/frame, modo color, pausa)
- `node scripts/measure-grid.ts` — mide el tamaño de celda por periodicidad de Fourier (se autovalida contra nuestro canvas)
- `node scripts/verify-color-mapping.ts` — clasifica por celda el color de la referencia y compara peso visual
- `node scripts/tune-highlights.ts` — barre `smooth`/`highlightDelta` contra la proporción medida
- `node scripts/side-by-side.ts` — compone nuestro retrato junto al de la referencia
- `node scripts/diagnose-type.ts` — métricas del glifo: caja real, alineación a píxel, cobertura de fuentes
- `node scripts/compare-type.ts` — renderiza variantes tipográficas y las compone (necesita `?debug`)
- `node scripts/measure-weight.ts` — peso visual del build publicado frente a la referencia
- `npm run dev` + `?debug` — panel con sliders de cellW/cellH/fontSize/contraste/radio y ms/frame reales
- `node scripts/recon-nav.ts` / `recon-footer.ts` — sondas puntuales sobre la referencia
- `node scripts/recon-spinner.ts` — descubre QUÉ anima el indicador de carga de la referencia, sin asumir que gira
- `node scripts/recon-spinner2.ts [kbps] [ms]` — lo remide con la red estrangulada, para separar "progreso" de "loop"
- `node scripts/spinner-filmstrip.ts` — recorta y apila los frames de la referencia para poder mirarlos
- `node scripts/check-preloader.ts` — mide NUESTRO preloader desde dentro de la página (geometría, vuelcos, label, destello inicial)
- `node scripts/capture-preloader.ts` — tira del preloader propio, etiquetada por ángulo real y no por reloj
- `node scripts/compare-reveal.ts` — compara duraciones/curvas de la onda del retrato y mide cuánto dura la cresta en pantalla
- `node scripts/recon-work.ts` — mide la pill y el marcador de pestañas de la referencia (retardo, balanceo, entrada)
- `node scripts/check-work.ts` — suite del item 2 (9): pill desde fuera, sin pegarse al borde, marcador con rebote
- `node scripts/capture-work.ts` — tiras del viaje de la pill y de la caída del marcador

**Los scripts levantan el preview con `scripts/lib/preview.ts`, nunca con `spawn('npx', …, { shell: true })`:**
en Windows eso deja el servidor huérfano y basta con unos cuantos para falsear las mediciones de rendimiento.

**`npm run shots` y `check-phase2` requieren `npm run build` antes** (levantan `vite preview` sobre dist/).
Las capturas estáticas no bastan para juzgar interacción: para nav/menú/preloader usar `check-phase2.ts`.

## Reglas (§10 del spec, íntegro)

1. **Verificar antes de afirmar.** Versiones (`npm view`), APIs de GSAP/Lenis (consultar `node_modules/<pkg>/README.md` o los tipos `.d.ts` instalados — no memoria). Si `SplitText` no tiene una opción, no inventarla: leer `node_modules/gsap/types/split-text.d.ts`.
2. **Mirar el resultado.** Tras cada cambio visual, correr `npm run shots` y **abrir/leer las imágenes** antes de declarar la tarea hecha. Comparar con `recon/reference/`.
3. **No cambiar el spec silenciosamente.** Si algo del §6 es inviable o mejorable, escribir el cambio propuesto en `CLAUDE.md › Decisiones` con motivo, y preguntar si afecta el resultado visual.
4. **Una fase a la vez.** No adelantar trabajo de fases posteriores.
5. **Nada de contenido inventado.** Todo copy sale de `site.ts`; los `TODO_JAVIER` quedan como placeholders visibles (`[TODO]`) hasta que Javier los llene — nunca rellenarlos con datos ficticios (emails, empresas, logros).
6. **Nada de assets de terceros.** No descargar imágenes, fuentes ni vídeos de good-fella.com ni de otros sitios. Placeholders generados por código.
7. **Cero dependencias sorpresa.** Añadir un paquete requiere anotar en `CLAUDE.md` qué problema resuelve que no se podía resolver con lo existente.
8. **Errores de consola = tarea no terminada.** Incluye warnings de GSAP ("target not found") y de Vite.
9. **Reportar con honestidad.** Al final de cada fase: qué funciona, qué está aproximado, qué no se pudo verificar y por qué.

## Convenciones

- Un módulo = clase o `init<Nombre>()` que devuelve `{ destroy() }`. Todo destruible (HMR y transiciones).
- Selectores por `data-*` (`data-hero`, `data-split`, `data-ascii`), **nunca** por clases de estilo.
- Sin `any`. Sin `!important`. Sin librerías extra sin justificación aquí.
- Cada archivo abre con 1–3 líneas de comentario: qué hace y en qué fase se creó.
- CSS en capas: `@layer reset, tokens, base, components, utilities`.
- Las secciones declaran `data-theme="dark|light"`; el CSS solo usa las variables semánticas
  (`--surface`, `--on-surface`, `--rule`, `--btn-bg`…), nunca los colores crudos.

### Tokens clave (medidos en la referencia, §4 + diff.md §B4)

`--bg #141314` · `--fg #EEEEEE` · `--fg-muted #818081` · `--fg-dim #696869`
`--bg-light #EDEDED` · `--card-light #F6F6F5` · `--fg-on-light #141314`
`--accent #39FF6A` (verde terminal, único acento) · `--accent-on-light #0B5F27` · `--accent-ink #0F0E0E`
Display lh 1.1 / ls −0.035em · H2 peso 500 ls −0.05em · **mono con tracking NEGATIVO (−0.02em)** · `--radius: 0`

## Decisiones

- **[2026-09-02] Estructura de secciones nueva · Motivo:** la Fase 0 mostró que la referencia no tiene marquee, about-manifiesto ni cursor custom, sino Hero → Stats → Process → Work → Build → FAQ → Contact → Footer. **Impacto visual:** alto; aprobado por Javier en `recon/diff.md`. Orden final: Hero → Stats → Process → Work → **Marquee** (conservado a petición de Javier) → Principles → Stack → FAQ → Contact → Footer.
- **[2026-09-02] TypeScript 6.0.3 en vez de 7.0.2 · Motivo:** `typescript-eslint@8.69.0` declara `typescript >=4.8.4 <6.1.0`; con TS 7 el linter no funciona y §9 exige `npm run lint` limpio. **Impacto visual:** ninguno. Revisar cuando typescript-eslint soporte TS 7.
- **[2026-09-02] Copy inyectado en build, no en cliente · Motivo:** §5 exige que el texto viva solo en `site.ts`, y §8 exige SEO. `vite.config.ts` monta un plugin `transformIndexHtml` que llama a `renderSite()` (src/render/sections.ts), así el HTML servido ya viene completo sin duplicar textos ni depender de JS. **Impacto visual:** ninguno (evita el flash de contenido vacío).
- **[2026-09-02] `prefers-reduced-motion` fuera de `@layer` · Motivo:** §3 prohíbe `!important`; el CSS sin capa gana al CSS en capas, que da la misma prioridad sin usarlo. **Impacto visual:** ninguno.
- **[2026-09-02] `menu-overlay.css` renombrado a `menu.css` · Motivo:** el menú de la referencia es un panel desplegable bajo el nav, no un overlay fullscreen (recon). **Impacto visual:** el del hallazgo, ya aprobado.
- **[2026-09-02] Sin `cursor.ts` · Motivo:** la referencia no usa cursor custom; Javier aprobó eliminarlo. El feedback de hover se hace con scrambles, bullets y la pill "VIEW PROJECT".
- **[2026-09-02] El nav es transparente y cambia de color por sección · Motivo:** medido en la referencia (`scripts/recon-nav.ts` → `recon/nav-behavior.json`): `background-color: rgba(0,0,0,0)` y el `color` alterna `#EEEEEE` / `#141314` según la sección de debajo. Corrige el nav opaco que se había hecho en Fase 1. **Impacto visual:** medio, acerca el resultado a la referencia.

- **[2026-09-02] El jaguar no necesita espejarse · Motivo:** el `portrait.png` que subió Javier ya ruge hacia la izquierda, o sea hacia el centro de la página con el canvas a la derecha. No hace falta el flag `flipX` que se había previsto.
- **[2026-09-02] El ASCII nunca repinta el canvas entero en un frame · Motivo:** pintar las ~6000 celdas cuesta ~11 ms, muy por encima del presupuesto de 4 ms de §8. Cada cambio repinta solo lo suyo: el shimmer sus ~180 celdas, el reveal solo las filas nuevas, el puntero el rectángulo afectado. Medido: de 11 ms a **1.2–2.2 ms**. **Impacto visual:** ninguno; el efecto es idéntico.
- **[2026-09-02] El crossfade ascii↔color usa dos canvas, no interpolación por celda · Motivo:** recalcular el color de 6000 celdas por frame durante 0.9 s rompía el presupuesto. Se usa el **fallback que el propio §6.3 punto 11 autoriza**: se pintan dos canvas una vez y se componen por opacidad. **Contrapartida:** el shimmer queda congelado durante los 0.9 s de transición (el punto 11 pedía mantenerlo activo). Si algún día molesta, la salida es el atlas de glifos o la versión WebGL de la Fase 8.
- **[2026-09-02] El color real se reescala con la curva de contraste del ASCII · Motivo:** usar el RGB muestreado tal cual dejaba el modo color apagado y verdoso sobre el fondo negro. Se conserva el tono de la foto pero se lleva la intensidad a la misma curva que la luminancia del ASCII. **Impacto visual:** los ámbar del jaguar se leen de verdad.
- **[2026-09-02] El reveal arranca al terminar el preloader, no al decodificar la imagen · Motivo:** la imagen decodifica _durante_ el preloader, así que el barrido ocurría tapado por el overlay y no se veía nunca. `initAscii()` recibe la promesa `preloader.done` y dispara `reveal()` ahí (§6.3 punto 8).

- **[2026-09-02] El grid de la referencia está MEDIDO, no estimado: 7.56 × 7.56 px (cuadrado) · Motivo:** `scripts/measure-grid.ts` localiza el periodo de la rejilla por magnitud de Fourier sobre los píxeles de las capturas de Fase 0; DPR 1 y DPR 2 coinciden (7.560 / 7.563) y el método se valida antes contra nuestro canvas, donde recupera 8.000 × 12.005 exactos. El `8 × 12` del spec era una estimación 1.68× menos densa. **Impacto visual:** alto — el spec §6.3 punto 1 queda actualizado; el código todavía NO (ver Pendiente).
- **[2026-09-02] Corregido: el jaguar salía estirado 1.5× a lo alto · Motivo:** `sample()` ajustaba el recorte `cover` a la proporción `cols/rows` en vez de a la del área mostrada `(cols·cellW)/(rows·cellH)`, lo que deforma al sujeto exactamente en `cellH/cellW`. Verificado comparando `screenshots/grid/a-actual-8x12-f11.png` (estirado) con la versión de celda cuadrada. Ya aplicado el §6.3 punto 2.
- **[2026-09-02] El mapeo acento-base / blanco-highlight queda VERIFICADO con píxeles · Motivo:** `scripts/verify-color-mapping.ts` binea la captura de referencia con el grid medido y clasifica cada celda por el color medio de su tinta. Resultado: 1131 celdas de acento (51.8 %) vs 357 blancas (16.4 %), las blancas con **2.65× más contraste local** (1450 vs 547). Las tres predicciones se cumplen. La duda del §6.3 punto 6 queda cerrada.
- **[2026-09-02] `smooth` y `highlightDelta` calibrados contra la referencia, no a ojo · Motivo:** el 0.35 que proponía el spec, junto al suavizado nuevo, eliminaba el **100 %** de los highlights (el suavizado baja el contraste local, así que el umbral debe bajar con él). `scripts/tune-highlights.ts` barre combinaciones clasificando nuestro render con el mismo criterio por celda que la referencia: `smooth 1.0` + `highlightDelta 0.12` da 20.3 % de highlights frente al 24 % medido en good-fella. **Impacto visual:** los highlights pasan de inexistentes a marcar mandíbula, oreja y fauces.
- **[2026-09-02] Estirado horizontal del glifo · Motivo:** con celda cuadrada, `fillText` deja hueco (un glifo mono avanza ~0.6 em). Se estira en X con una sola transformación por pasada y las coordenadas x pasan a medirse en avances de glifo (`stepX`). Es lo que su atlas WebGL hace gratis.
- **[2026-09-03] Tipografía del retrato: glifo ajustado, rejilla al píxel y SIN estirar · Motivo:** el retrato se veía grueso y sucio. Medido en `scripts/diagnose-type.ts`: (a) JetBrains Mono a 7.56 px tiene una caja de fuente de 10 px, así que cada glifo invadía la fila siguiente; (b) 5 de cada 6 columnas caían en píxel fraccionario, que el rasterizador difumina; (c) el estirado horizontal ×1.67 engordaba los trazos verticales sin tocar los horizontales. Se corrigen las tres: `fontSize` se deduce del alto real de la tinta, `pixelSnap` lleva la celda al píxel de dispositivo entero, y `stretch: false`. Comparadas 4 variantes en `screenshots/type/` (Javier eligió la 3). Silkscreen se descartó: tiene los 36 glifos pero **no es monoespaciada** (avances con 3.78 px de diferencia). **Impacto visual:** alto, es el cambio que hace legible el retrato.
- **[2026-09-03] Curva de alpha de la base bajada a `0.22 + 0.5·L` · Motivo:** decisión de Javier tras ver el peso medido. Los highlights se mantienen a tope (`0.9 + 0.1·L`) para que los bordes destaquen sobre una base más tenue. Peso del retrato: **29.9 → 26.4**, frente a los 23.1 de la referencia (×1.14). **Impacto visual:** el retrato gana aire sin perder presencia.
- **[2026-09-03] ⚠️ ERROR DE MEDICIÓN PROPIO, ya corregido · Qué pasó:** `measure-weight` leía nuestro canvas con `getImageData`, que devuelve **RGBA sin premultiplicar** — el alpha se queda en su canal y los RGB a valor pleno, así que medía como si todo fuera opaco. La referencia, en cambio, se medía sobre un PNG ya compuesto sobre negro. Las dos cifras nunca fueron comparables y por eso los ratios que se reportaron (×4.22, ×2.86) estaban muy inflados: el retrato **nunca estuvo tan lejos** de la referencia. Corregido componiendo sobre negro antes de medir. **Lección para futuras mediciones sobre canvas: comparar siempre imágenes ya compuestas, o premultiplicar el alpha a mano.**

- **[2026-09-03] `PORTFOLIO_SPEC.md` sincronizado con todo lo aprobado en `recon/diff.md` · Motivo:** auditoría pedida por Javier. Prácticamente **nada** de la Fase 0 se había back-porteado al spec: el documento maestro seguía describiendo un sitio que ya no era el que estábamos construyendo (cursor custom, menú fullscreen, About-manifiesto, Services, lista de work con imagen flotante, wordmark del footer en Silkscreen, tokens sin tema claro, tracking mono positivo, `site.ts` con claves inexistentes). Cada sección tocada lleva ahora una línea **"Corregido en Fase 0/2"** con el hallazgo que la motivó, para que se lea el porqué y no solo el qué. `recon/diff.md` queda como documento **histórico**: a partir de ahora manda el spec. **Impacto visual:** ninguno, es documentación — pero elimina la trampa de "volver al spec" y deshacer decisiones ya aprobadas.
- **[2026-09-03] El indicador del preloader NO son bloques que se rellenan, ni un giro en loop: son 4 cuadrados que vuelcan · Motivo:** lo que se había construido en Fase 2 (tres bloques subiendo de opacidad en secuencia) era una reconstrucción de memoria, y Javier detectó que no se parecía. Remedido frame a frame con `scripts/recon-spinner.ts` y `recon-spinner2.ts`: cada bloque de 16 px gira **90° sobre su esquina inferior derecha** —lo que lo empuja 16 px a la derecha— mientras su `translateX` lo lleva a su hueco, hasta llenar la pista de 70 px. **Son exactamente 4 vuelcos, nunca un loop:** verificado a dos velocidades de red (overlay de 2.9 s y de 6.85 s) y en ambas cada bloque gira una sola vez. Ease `power3.inOut`, ~490 ms por vuelco, encadenados cada 450–620 ms. El label "LOADING" se resuelve por scramble. Detalle copiado también: la palabra real va en un `sr-only` y el texto que baila es `aria-hidden`. Todo en §6.1. **Impacto visual:** alto, es el primer segundo del sitio.

- **[2026-09-03] La onda del retrato pasa de 1.9 s `silk` a 3.2 s `power1.out` · Motivo:** Javier dijo que se sentía apresurada. Medido con `scripts/compare-reveal.ts`: el problema no era la duración sino la curva. `silk` (0.19,1,0.22,1) frena tantísimo que la cresta cruzaba del 10 % al 90 % del recorrido en **0.45 s** y el resto del 1.9 s era goteo — alargar la duración con esa curva solo alarga el goteo. Con `power1.out` a 3.2 s el tramo visible pasa a **1.62 s**. Duración y curva son ahora opciones de `AsciiPortrait` (`revealDuration` / `revealEase`), no constantes enterradas, para poder comparar sin recompilar. **Impacto visual:** alto, es la primera impresión del hero.
- **[2026-09-03] El overlay del preloader se sirve visible en el HTML · Motivo:** con `hidden` no aparecía hasta que corría el módulo, y eso dejaba **~900 ms de pantalla en blanco** antes del acento (medido en `scripts/check-preloader.ts`). Ahora va visible desde el HTML y un script en línea de 5 líneas en el `<head>` lo oculta en las visitas siguientes leyendo `sessionStorage`, que es lo único que el CSS no puede hacer. Verificado: el overlay existe antes del first-contentful-paint. **Impacto visual:** desaparece el destello blanco de entrada.
- **[2026-09-03] ⚠️ SEGUNDO ERROR DE MEDICIÓN PROPIO, ya corregido · Qué pasó:** `check-phase4` daba 94 % de frames "con jank" y estuve a punto de tratarlo como una regresión de mis cambios. Dos causas, ninguna del sitio: (1) los scripts lanzaban el preview con `spawn('npx', …, { shell: true })` y en Windows `kill()` mata el shell pero **no** el servidor — se habían acumulado **22 procesos huérfanos** comiendo CPU; (2) el umbral de jank estaba fijo en 20 ms, pero el display estaba a **48 Hz** (20.8 ms por frame), así que una página en blanco sin animación alguna también daba 100 % de "jank" — lo comprobé con ese control antes de tocar nada. Corregido: `scripts/lib/preview.ts` lanza node directamente sobre el bin de vite (pid real, se puede matar) y el umbral se calcula como 1.5× la cadencia real medida del display. Resultado: **0.0 % de frames perdidos**. **Lección: antes de creer una métrica que empeora, correr un control que la métrica debería pasar.**

- **[2026-09-03] La pill de work pasa a ser UN seguidor `fixed` en coordenadas de viewport · Motivo:** medido en la referencia (`scripts/recon-work.ts`). No es un elemento por figura sino un único seguidor que **no se desmonta al salir**, con el cartel colgando 32 px sobre el cursor y pivotando abajo. Esa arquitectura es además la que **arregla el bug** que reportó Javier: la pill vivía dentro de cada figura en coordenadas locales, y los tweens de opacidad con `overwrite: true` mataban los `quickTo` de posición, así que al salir y volver a entrar se quedaba clavada en el borde. Ahora la posición vive en el seguidor y la apariencia en el cartel: ningún tween puede matar al otro. Verificado: al re-entrar la pill queda **a 1 px del cursor**. **Impacto visual:** alto.
- **[2026-09-03] Balanceo del cartel: 0.0995° por píxel de desfase horizontal · Motivo:** ajuste por mínimos cuadrados sobre 177 muestras de la referencia (RMS 1.76°), con un máximo observado de 14.1°; se acota a 16°. El retardo del seguimiento se calibró contra su mediana de 15.8 px: `power3` a 0.5 s daba 24 px y `power2` a 0.32 s da **14.7 px**. **Contrapartida honesta:** el p95 sigue más alto que el suyo (187 vs 81 px) porque el barrido "rápido" de Playwright no es equivalente entre las dos páginas — la referencia va más lenta por frame y su `steps` se reparte en más frames. La mediana, que es la que domina la sensación, sí coincide.

### Diferenciadores intencionales (decisión de Javier, 2026-09-02)

Estos efectos **no existen en good-fella.com** — está medido y la medición fue correcta. Javier los probó
y los quiere igualmente como sello propio del portafolio. No son correcciones de un error: son
desviaciones deliberadas de la fidelidad estricta. **No revertirlos "por fidelidad" en fases posteriores.**

- **Magnetismo en el CTA y el "+" (`MagneticButton.ts`, §6.5).** Medido: el `transform` del CTA de la referencia es `none` en reposo, cerca y encima — no hay magnetismo. Se implementa igualmente.
- **Nav que encoge a los 80 px y se oculta/reaparece según la dirección del scroll (§6.2 original).** Medido: la referencia mantiene `top:0`, 96 px de alto y `transform` identidad en toda la página. Se implementa igualmente. Nunca se oculta con el menú abierto (dejaría el botón CLOSE fuera de alcance) ni con `prefers-reduced-motion`.
- **La pill acompaña al cursor desde FUERA de la figura (§6.7).** Medido: la referencia monta la pill al entrar. Aquí se hace visible progresivamente en un margen de 140 px, así entra ya en marcha en vez de aparecer en el borde. Petición explícita de Javier.
- **El marcador de las pestañas CAE con física (§6.7).** Medido: la referencia tiene un solo marcador que **salta** entre 462 → 542 → 622 px, sin animación ninguna. Aquí cae con duración proporcional a `√altura`, `bounce.out` al bajar y `back.out` al subir. Petición explícita de Javier.
- **Tope al arrastre magnético (14 px exterior / 5 px interior).** El §6.5 da `(dx,dy) * 0.35` sin límite; en un CTA de ~240 px eso son ~51 px y el label se sale de la caja del botón (verificado en `screenshots/phase2/magnetic-pulled.png`). Se acota el máximo manteniendo la misma sensación. **Impacto visual:** el efecto pasa de exagerado a sutil.

## Progreso

- [x] **Fase 0 — Recon.** `recon/sections.md` + `recon/diff.md` entregados y aprobados. Confirmado: Next.js+Tailwind (no Webflow), GSAP 3.14.2 + ScrollTrigger + SplitText + ScrambleText + Flip, Lenis, ASCII en WebGL. Screenshots en `recon/reference/`.
- [x] **Fase 1 — Scaffold y sistema de diseño.** Vite+TS strict, ESLint/Prettier, fuentes self-hosted (Inter/JetBrains Mono/Silkscreen, subset latin, 117 KB), tokens con tema dark+light, 10 secciones estáticas renderizadas desde `site.ts`, Lenis activo, `scripts/screenshots.ts` operativo. Build 53 kB gzip JS. 0 errores de consola.
  - Pendiente para fases siguientes: reloj del footer (Fase 4), animación del preloader (Fase 2), retrato ASCII (Fase 3).
- [x] **Fase 2 — Nav, menú, botones, preloader.** Preloader de acento con bloques + wipe horizontal (una vez por sesión); nav transparente que invierte color por sección, encoge a los 80 px y se oculta/reaparece por dirección de scroll; menú desplegable con scramble MENU↔CLOSE, swap JAVIER↔TRAPERO, Esc, foco atrapado y `lenis.stop()`; botones con slide vertical del label, swap del "+" con Flip y magnetismo acotado. Sin cursor custom. 32/32 comprobaciones en `check-phase2.ts`, 0 errores de consola. Bundle 70.4 kB gzip.
  - Pendiente: entrada del hero solapada con la salida del preloader (necesita SplitText → Fase 4); el preloader ya expone `done` para engancharla.
- [x] **Fase 3 — Retrato ASCII (Canvas 2D). CERRADA el 2026-09-03.**
      `AsciiPortrait.ts` + `charRamp.ts` completos: base en `--accent` con highlights en `--fg` por contraste local, shimmer del 3 % cada 120 ms (doble en highlights), puntero que aclara hacia blanco con glifos densos y ripple, reveal por scanline al salir el preloader, parallax, pausa fuera de viewport, y el **modo color por clic** (§6.3 punto 12) con acceso por teclado. Segunda instancia en el footer. Panel `?debug` con sliders y ms/frame reales.
  - **Decisiones finales de Javier:** grid **7.56 × 7.56 medido** en la referencia (se ajusta a 8 px de dispositivo por `pixelSnap`); **variante 3 — sin estirado horizontal** del glifo, con `fontSize` deducido del alto real de la tinta; **curva de alpha `0.22 + 0.5·L`** en la base, highlights intactos.
  - **Métricas frente a la referencia:** peso 26.4 vs 23.1 (×1.14) · celdas con tinta 30.1 % vs 26.3 % · highlights 20.5 % vs 20.9 % · pintado **1.0–2.2 ms** (presupuesto 4 ms).
  - 13/13 en `check-phase3.ts`, 0 errores de consola, bundle 75 kB gzip.
  - **Aparcado para más adelante (no tocar todavía):** paleta multi-tono artística para el modo color — puede ir después de la Fase 4 o vivir en la Fase 8 junto a la versión WebGL.
- [x] **Fase 4 — Animaciones de scroll y secciones. CERRADA el 2026-09-03.**
  - **Texto y entradas:** `SplitReveal.ts` sobre SplitText con `autoSplit`, que además resuelve el re-split en resize y al cargar fuentes que §6.15 pedía a mano · **entrada del hero solapada con la salida del preloader**, que cierra la deuda de la Fase 2: el preloader expone `exiting` (arranque del wipe) y `done` (overlay fuera), y cada uno dispara lo suyo · entradas por scroll de las 7 secciones con stagger · hairlines que se dibujan con `scaleX`.
  - **Comportamiento por sección:** scrollytelling del proceso (paso activo encendido, resto al 32 %, media sticky con crossfade) · showcase de work con pestaña que sigue al scroll y pill "VIEW PROJECT" persiguiendo al cursor con `quickTo` · odómetros de las cifras (`Counter.ts`, columna 0–9 por dígito) · marquee infinito que acelera con la velocidad de Lenis e invierte al subir · acordeón del FAQ, una abierta a la vez · halo del acento al 6 % siguiendo al puntero en contacto · scramble al hacer hover en principios y stack · footer con reloj de Guadalajara, wordmark con scrub y **easter eggs G (rejilla de 12 columnas) y C (rota el acento)**.
  - **21/21 en `check-phase4.ts`** · scroll a **16.6 ms de mediana (60 fps)** con 0.7 % de frames por encima de 20 ms, muy por debajo del 5 % que exige §9 · 0 errores de consola · bundle 81 kB gzip.
  - Todo desactivado o en estado final con `prefers-reduced-motion`, y sin efectos de puntero en táctil.
  - ⚠️ **Detectado, sin resolver:** al pasar contenido por detrás del nav transparente puede colisionar con el texto del propio nav (visto en `screenshots/phase4/faq-open.png`: "Remotion" del stack encima de "MENU"). Es consecuencia directa del nav sin fondo que se midió en la referencia. Decidir en Fase 5 si se deja o se le pone un degradado sutil detrás.
- [ ] Fase 5 — Responsive, accesibilidad, performance
- [ ] Fase 6 — Deploy y README
- [ ] Fase 7 (opcional) — Páginas de caso + transiciones
- [ ] Fase 8 (opcional) — ASCII en WebGL

## TODO_JAVIER

### Resueltos (2026-09-02)

- ✅ §6.3 actualizado por Javier: sujeto = jaguar, mapeo corregido (acento base / blanco highlight) y **punto 11 click-to-color**.
- ✅ `public/img/portrait/portrait.png` en su sitio: fondo negro puro, orientado hacia la izquierda, buen contraste de bordes.
- ⏳ Javier está rellenando los TODO de `site.ts` (email, redes, métricas, principios, FAQ, "How I work", nav.status) — llegan en paralelo, no bloquean.

### Contenido pendiente en `site.ts` (se ve como `[TODO]` en el sitio)

- `meta.name` (nombre completo), `meta.email`, `meta.url`
- `nav.socials`: URLs de GitHub / LinkedIn / X
- `stats.items`: 2 métricas (users reached, projects shipped) — la de "products co-founded" ya está en 02
- `principles.items`: los 2 últimos de los 6 (el grid es 3×2)
- `stack.groups`: 1 item de Hardware
- `faq.items`: respuestas de las 3 primeras preguntas
- `work.items`: URLs de Orael/ROAR/repo + 1–2 proyectos de mecatrónica
- `contact.button.href`, `footer.legal`

### Copy propuesto pendiente de tu visto bueno

- `process.steps`: los 4 títulos y descripciones están marcados `PROPUESTA` en `site.ts`.
- `nav.status`: "OPEN TO INTERNSHIPS & FREELANCE" — confirmar si es cierto antes de publicar.

### Assets pendientes (§7)

`public/img/`: foto de retrato (stats), media de los 4 pasos del proceso, covers de work, foto de contacto, `og.jpg`.
Mientras tanto se ven placeholders rayados generados por CSS (nunca imágenes de terceros, §10.6).
