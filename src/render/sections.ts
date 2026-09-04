// src/render/sections.ts — genera el HTML de cada sección a partir de site.ts. Fase 1.
// Se ejecuta en build (plugin de vite.config.ts), así el HTML servido ya viene completo:
// una sola fuente de texto (§5) + HTML estático real para SEO (§8).

import { site, TODO } from '../content/site.ts';
import { esc } from '../core/utils.ts';

/** Un campo pendiente se muestra visible como [TODO] (§10.5), nunca se rellena inventado. */
function field(value: string): string {
  return value === TODO ? `<span class="todo">${TODO}</span>` : esc(value);
}

function isTodo(value: string): boolean {
  return value === TODO;
}

/** href seguro: los TODO no navegan a ninguna parte. */
function href(value: string): string {
  return isTodo(value) ? '#' : esc(value);
}

function placeholder(label: string, cls = ''): string {
  return `<div class="ph ${cls}"><span class="ph__label">${esc(label)}</span></div>`;
}

/** Label con dos copias apiladas: el hover desliza la de arriba y entra la de abajo (§6.4). */
function slideLabel(label: string): string {
  const text = esc(label);
  return `<span class="btn__slide"><span class="btn__label">${text}</span><span class="btn__label btn__label--ghost" aria-hidden="true">${text}</span></span>`;
}

function button(label: string, url: string, extra = ''): string {
  return `
    <span class="btn-group" data-swap data-magnetic>
      <a class="btn" href="${href(url)}"${extra}><span data-magnetic-inner>${slideLabel(label)}</span></a>
      <a class="btn btn--icon" href="${href(url)}" aria-hidden="true" tabindex="-1">+</a>
    </span>`;
}

function nav(): string {
  // Cada línea va en un contenedor con overflow:hidden para el reveal con stagger (§6.2)
  const links = site.nav.links
    .map(
      (l) =>
        `<li class="menu__line"><a class="menu__link t-h2" href="${esc(l.href)}" data-menu-link><i class="bullet"></i>${esc(l.label)}</a></li>`,
    )
    .join('');

  const socials = site.nav.socials
    .map((s) => `<li><a class="t-body" href="${href(s.href)}">${esc(s.label)}: ${field(s.href)}</a></li>`)
    .join('');

  const status = site.nav.status
    .map(
      (s) =>
        `<li class="footer__hotkey"><i class="bullet"></i><span class="t-mono-sm">${esc(s.label)}</span></li>`,
    )
    .join('');

  return `
  <header class="nav" data-nav data-theme="dark">
    <a class="nav__logo t-pixel" href="#top" data-logo aria-label="${esc(site.meta.name)} — home">${esc(site.nav.logo)}</a>

    <button class="nav__menu t-mono" type="button" data-menu-toggle aria-expanded="false" aria-controls="menu">
      <span data-menu-label>${esc(site.nav.menuLabel)}</span>
      <span class="nav__burger" aria-hidden="true"><span></span><span></span></span>
    </button>

    <div class="nav__cta btn-group" data-swap data-magnetic>
      <a class="btn" href="${esc(site.nav.cta.href)}"><span data-magnetic-inner>${slideLabel(site.nav.cta.label)}</span></a>
      <a class="btn btn--icon" href="${esc(site.nav.cta.href)}" aria-hidden="true" tabindex="-1">+</a>
    </div>
  </header>

  <div class="menu__backdrop" data-menu-backdrop></div>

  <div class="menu" id="menu" data-menu data-open="false">
    <div class="menu__inner">
      <nav aria-label="Main">
        <ul class="menu__links">${links}</ul>
      </nav>

      <div class="menu__col" data-menu-col>
        <div class="menu__group">
          <p class="t-mono t-muted">Contact</p>
          <p class="t-body">${field(site.meta.email)}</p>
        </div>
        <ul class="menu__group" role="list">${socials}</ul>
        <div class="menu__group">
          <p class="t-mono t-muted">${esc(site.meta.location)}</p>
          <ul role="list" class="footer__hotkeys">${status}</ul>
        </div>
      </div>

      <div class="menu__cards" data-menu-col>
        <div class="menu__card">
          <figure>
            ${placeholder('about photo')}
            <figcaption class="t-mono-sm t-muted">About me</figcaption>
          </figure>
        </div>
        <div class="menu__card">
          <figure>
            ${placeholder('featured project')}
            <figcaption class="t-mono-sm t-muted">Featured project</figcaption>
          </figure>
        </div>
      </div>
    </div>
  </div>`;
}

function hero(): string {
  const title = site.hero.title.map((line) => `<span class="hero__line">${esc(line)}</span>`).join(' ');

  const clients = site.clients.items.map((c) => `<span class="t-mono">${esc(c)}</span>`).join('');

  return `
  <section class="section hero container" data-section="hero" data-theme="dark" id="top">
    <div class="hero__text">
      <h1 class="hero__title t-display" data-hero-title>${title}</h1>
      <p class="hero__sub t-body-lg" data-hero-sub>${esc(site.hero.subtitle)}</p>
      <div class="hero__actions" data-hero-actions>
        ${button(site.hero.primary.label, site.hero.primary.href)}
        <a class="btn-text t-body" href="${esc(site.hero.secondary.href)}">${esc(site.hero.secondary.label)}</a>
      </div>
    </div>

    <div class="hero__visual" data-hero-visual>
      <canvas class="hero__canvas" data-ascii aria-hidden="true"></canvas>
      <p class="visually-hidden">${esc(site.hero.canvasAlt)}</p>
      <button class="hero__hint t-mono-sm" type="button" data-ascii-toggle>${esc(site.hero.asciiHint)}</button>
    </div>

    <div class="hero__clients" data-hero-clients>
      ${clients}
      <span class="t-mono">${esc(site.clients.label)}</span>
    </div>
  </section>`;
}

function stats(): string {
  const cards = site.stats.items
    .map(
      (s) => `
      <div class="stats__card">
        <p class="stats__value" data-counter="${esc(s.value)}">${field(s.value)}</p>
        <p class="stats__label t-mono-sm"><i class="bullet"></i>${esc(s.label)}</p>
      </div>`,
    )
    .join('');

  return `
  <section class="section container" data-section="stats" data-theme="light">
    <div class="stats">
      ${placeholder('portrait photo', 'stats__photo')}
      ${cards}
    </div>
  </section>`;
}

function process(): string {
  const steps = site.process.steps
    .map(
      (s, i) => `
      <li class="process__step" data-step data-active="${i === 0}">
        <i class="bullet"></i>
        <span class="process__n t-mono-sm">${esc(s.n)}</span>
        <h3 class="process__step-title t-h3">${field(s.title)}</h3>
        <p class="process__step-desc t-body">${field(s.desc)}</p>
      </li>`,
    )
    .join('');

  return `
  <section class="section container" data-section="process" data-theme="light" id="process">
    <div class="section__head">
      <h2 class="t-h2">${esc(site.process.heading)}</h2>
      <p class="t-mono t-accent">${esc(site.process.label)}</p>
    </div>
    <div class="process__body">
      <div>
        <p class="process__intro t-body-lg">${esc(site.process.intro)}</p>
        <ol class="process__steps">${steps}</ol>
      </div>
      <div class="process__media" data-process-media>
        ${site.process.steps
          .map(
            (s, i) =>
              `<div class="process__media-item" data-process-media-item data-active="${i === 0}">${placeholder(`step ${s.n}`)}</div>`,
          )
          .join('')}
      </div>
    </div>
  </section>`;
}

function work(): string {
  // El bullet ya no vive dentro de cada item: hay UNO solo que cae de un proyecto al
  // siguiente (§6.7). Cada item deja su hueco reservado para que no baile el layout.
  const list = site.work.items
    .map(
      (w, i) => `
      <li class="work__item" data-work-tab data-active="${i === 0}">
        <i class="work__slot" aria-hidden="true"></i>
        ${placeholder(w.title, 'work__thumb')}
        <span class="t-mono-sm">${esc(w.title)}</span>
      </li>`,
    )
    .join('');

  const previews = site.work.items
    .map(
      (w) => `
      <article class="work__preview" data-work-preview>
        <a class="work__figure" href="${href(w.href)}" aria-label="${esc(w.title)}">
          ${placeholder(`${w.title} cover`)}
        </a>
        <div class="work__meta">
          <h3 class="t-h3">${esc(w.title)}</h3>
          <p class="t-mono-sm">${w.meta.map((m) => `[${esc(m)}]`).join(' — ')}</p>
        </div>
        <p class="t-body t-muted">${esc(w.tagline)}</p>
      </article>`,
    )
    .join('');

  return `
  <section class="section container" data-section="work" data-theme="dark" id="work">
    <div class="work__body">
      <div class="work__aside">
        <h2 class="t-h2">${esc(site.work.heading)}</h2>
        <p class="work__intro t-body">${esc(site.work.intro)}</p>
        <a class="btn-text t-mono" href="${href(site.work.viewAll.href)}">${esc(site.work.viewAll.label)}</a>
        <div class="work__list-wrap">
          <i class="work__marker" data-work-marker aria-hidden="true"></i>
          <ul class="work__list" role="list">${list}</ul>
        </div>
      </div>
      <div class="work__previews">${previews}</div>
    </div>

    <!-- Un solo seguidor para toda la sección, en coordenadas de viewport: así la pill puede
         acompañar al cursor desde fuera del recuadro y entrar con él (§6.7). -->
    <div class="work__follower" data-work-follower aria-hidden="true">
      <span class="work__pill btn">View project</span>
    </div>
  </section>`;
}

function marquee(): string {
  const group = `<span class="marquee__group">${site.marquee
    .map((m) => `<span class="marquee__item">${esc(m)}</span><span class="marquee__sep">✦</span>`)
    .join('')}</span>`;

  // Dos copias: la segunda hace posible el loop infinito sin salto (§6.9)
  return `
  <section class="marquee" data-section="marquee" data-theme="dark" aria-hidden="true">
    <div class="marquee__track" data-marquee>${group}${group}</div>
  </section>`;
}

function principles(): string {
  const items = site.principles.items
    .map(
      (p) => `
      <article class="principles__item">
        <h3 class="principles__title t-mono"><i class="bullet"></i>${field(p.title)}</h3>
        <p class="principles__desc t-body">${field(p.desc)}</p>
      </article>`,
    )
    .join('');

  return `
  <section class="section container" data-section="principles" data-theme="light">
    <div class="section__head">
      <h2 class="t-h2">${esc(site.principles.heading)}</h2>
      <p class="t-mono t-accent">${esc(site.principles.label)}</p>
    </div>
    <p class="principles__overline t-mono"><i class="bullet"></i>${esc(site.principles.overline)}</p>
    <div class="principles__grid">${items}</div>
  </section>`;
}

function stack(): string {
  const groups = site.stack.groups
    .map(
      (g) => `
      <div class="stack__group">
        <h3 class="stack__name t-mono">${esc(g.name)}</h3>
        <ul class="stack__items" role="list">
          ${g.items.map((i) => `<li class="stack__item t-body">${field(i)}</li>`).join('')}
        </ul>
      </div>`,
    )
    .join('');

  return `
  <section class="section container" data-section="stack" data-theme="dark" id="stack">
    <div class="section__head">
      <h2 class="t-h2">${esc(site.stack.heading)}</h2>
      <p class="t-mono t-accent">${esc(site.stack.label)}</p>
    </div>
    <div class="stack__grid">${groups}</div>
  </section>`;
}

function faq(): string {
  const items = site.faq.items
    .map(
      (f, i) => `
      <li class="faq__item">
        <button class="faq__q t-mono" type="button" data-faq-q aria-expanded="false" aria-controls="faq-a-${i}">
          <span>${esc(f.q)}</span>
          <span class="faq__icon" aria-hidden="true">+</span>
        </button>
        <div class="faq__a t-body" id="faq-a-${i}" hidden>${field(f.a)}</div>
      </li>`,
    )
    .join('');

  return `
  <section class="section container" data-section="faq" data-theme="dark" id="faq">
    <div class="faq__body">
      <h2 class="t-h2">${esc(site.faq.heading)}</h2>
      <ul class="faq__list" role="list">${items}</ul>
    </div>
  </section>`;
}

function contact(): string {
  const title = site.contact.heading.map((l) => `<span>${esc(l)}</span>`).join(' ');
  const mail = isTodo(site.contact.email) ? '#' : `mailto:${site.contact.email}`;

  return `
  <section class="section container" data-section="contact" data-theme="light" id="contact" data-contact>
    <div class="contact__body">
      <div>
        <h2 class="contact__title t-h2" data-split>${title}</h2>
        ${placeholder('contact photo', 'contact__photo')}
      </div>

      <div class="contact__details">
        <p class="contact__lead t-h3">${esc(site.contact.sub)}</p>
        <div class="contact__lines">
          <a class="contact__email t-body" href="${mail}">${field(site.contact.email)}</a>
          <p class="contact__note t-body">${esc(site.contact.note)}</p>
        </div>
        <div class="hero__actions">
          ${button(site.contact.button.label, site.contact.button.href)}
        </div>
      </div>
    </div>
  </section>`;
}

function footer(): string {
  const navLinks = site.nav.links
    .map((l) => `<li><a class="footer__link t-mono" href="${esc(l.href)}">${esc(l.label)}</a></li>`)
    .join('');

  const socials = site.nav.socials
    .map((s) => `<li><a class="footer__link t-body" href="${href(s.href)}">${esc(s.label)}</a></li>`)
    .join('');

  const legal = site.footer.legal
    .map((l) => `<a class="t-body" href="${href(l.href)}">${esc(l.label)}</a>`)
    .join('');

  const hotkeys = site.footer.hotkeys
    .map(
      (h) =>
        `<li class="footer__hotkey"><kbd class="footer__key t-mono-sm">${esc(h.key)}</kbd><span class="t-mono-sm">${esc(h.label)}</span></li>`,
    )
    .join('');

  return `
  <footer class="footer container" data-section="footer" data-theme="dark">
    <div class="footer__cols">
      <div class="footer__col">
        <p class="t-h3">${esc(site.meta.role)}</p>
        <ul class="footer__mails" role="list">${socials}</ul>
      </div>

      <div class="footer__col">
        <ul class="footer__nav" role="list">${navLinks}</ul>
      </div>

      <div class="footer__col">
        <div class="footer__mails">
          <a class="t-body" href="${isTodo(site.meta.email) ? '#' : `mailto:${site.meta.email}`}">${field(site.meta.email)}</a>
        </div>
        <div class="footer__legal t-body">${legal}</div>
        <ul class="footer__hotkeys" role="list">${hotkeys}</ul>
      </div>
    </div>

    <div class="footer__meta t-mono-sm">
      <p>© ${site.footer.year} ${esc(site.meta.name)}</p>
      <p>${esc(site.footer.credits)}</p>
      <p>Local time: <span data-clock>--:--</span></p>
    </div>

    <canvas class="footer__ascii footer__ascii--end" data-ascii-footer aria-hidden="true"></canvas>
    <p class="footer__wordmark" aria-hidden="true">${esc(site.footer.wordmark)}</p>
  </footer>`;
}

function preloader(): string {
  return `
  <div class="preloader" data-preloader>
    <div class="preloader__track" aria-hidden="true">
      ${[0, 1, 2, 3].map(() => `<span class="preloader__block" data-block></span>`).join('')}
    </div>
    <p class="preloader__label t-mono-sm">
      <span class="visually-hidden">Loading</span>
      <span class="preloader__scramble" aria-hidden="true" data-loading-label>&nbsp;</span>
    </p>
  </div>`;
}

/** HTML completo del sitio, en el orden confirmado en la Fase 0. */
export function renderSite(): string {
  return [
    preloader(),
    nav(),
    '<main id="main">',
    hero(),
    stats(),
    process(),
    work(),
    marquee(),
    principles(),
    stack(),
    faq(),
    contact(),
    '</main>',
    footer(),
  ].join('\n');
}
