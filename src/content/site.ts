// src/content/site.ts — única fuente de texto y datos del sitio (§5). Fase 1.
// Estructura reorganizada según recon/diff.md §C (aprobado por Javier el 2026-09-02).
// Convenciones:
//   TODO_JAVIER  → dato que solo Javier puede dar. Se renderiza como "[TODO]" visible (§10.5).
//   PROPUESTA    → copy redactado como propuesta, pendiente de que Javier lo apruebe o reescriba.

export const TODO = '[TODO]' as const;

export const site = {
  meta: {
    name: 'Javier', // TODO_JAVIER: nombre y apellido completos
    role: 'Mechatronics Engineer & AI Developer',
    location: 'Guadalajara, MX',
    timezone: 'America/Mexico_City',
    email: TODO, // TODO_JAVIER
    url: TODO, // TODO_JAVIER
    ogDescription: 'Mechatronics engineer building AI products. Portfolio built with Claude Code.',
  },

  nav: {
    logo: 'JAVIER',
    logoAlt: 'TRAPERO', // swap al abrir el menú (equivale a "GOOD" → "fella")
    menuLabel: 'MENU',
    closeLabel: 'CLOSE',
    cta: { label: "LET'S WORK TOGETHER", href: '#contact' },
    links: [
      { label: 'Work', href: '#work' },
      { label: 'Process', href: '#process' },
      { label: 'Stack', href: '#stack' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Contact', href: '#contact' },
    ],
    socials: [
      // TODO_JAVIER: URLs reales de GitHub / LinkedIn / X
      { label: 'GitHub', href: TODO },
      { label: 'LinkedIn', href: TODO },
      { label: 'X', href: TODO },
    ],
    status: [
      { label: 'OPEN TO INTERNSHIPS & FREELANCE' }, // PROPUESTA
      { label: 'BASED IN GUADALAJARA, MX' },
    ],
  },

  hero: {
    title: ['Engineering that', 'learns.'],
    subtitle:
      'I design systems where mechanics, electronics and machine learning meet — and ship them as products people actually use.',
    primary: { label: 'SEE THE WORK', href: '#work' },
    secondary: { label: 'Tell me more', href: '#process' },
    // Texto alternativo del <canvas> para accesibilidad (§8)
    canvasAlt: 'ASCII portrait of a roaring jaguar rendered from a photograph',
    asciiHint: '[click to reveal]',
    asciiHintBack: '[click for ASCII]',
  },

  clients: {
    label: '+ MANY MORE',
    items: ['Tec de Monterrey', 'Orael', 'ROAR', 'Claude Code'],
  },

  // Sección 2 — equivalente a los odómetros de la referencia
  stats: {
    photo: { src: '/img/about/javier.webp', alt: 'Javier' }, // TODO_JAVIER: foto real
    items: [
      { value: '02', label: 'PRODUCTS CO-FOUNDED' }, // dato ya presente en el manifiesto de Javier
      { value: TODO, label: 'USERS REACHED' }, // TODO_JAVIER
      { value: TODO, label: 'PROJECTS SHIPPED' }, // TODO_JAVIER
    ],
  },

  // Sección 3 — scrollytelling; absorbe el rol del "about/manifiesto" (diff.md §B5)
  process: {
    heading: 'How I work.',
    label: '// PROCESS',
    intro:
      "I'm an engineering student at Tec de Monterrey and co-founder of two SaaS products. I care about the seam between hardware and intelligence — and about building things that feel as good as they work.",
    steps: [
      {
        n: '01',
        title: 'Understand the system.', // PROPUESTA
        desc: 'Before writing anything I map the whole loop: inputs, constraints, failure modes and who actually uses it.',
        media: { src: '/img/process/01.webp', alt: '' }, // TODO_JAVIER
      },
      {
        n: '02',
        title: 'Prototype in days, not weeks.', // PROPUESTA
        desc: 'A rough version that runs beats a perfect version on paper. I build the thinnest thing that proves the idea.',
        media: { src: '/img/process/02.webp', alt: '' },
      },
      {
        n: '03',
        title: 'Build it properly.', // PROPUESTA
        desc: 'Typed, tested and readable — with the motion, hardware and models treated as one system rather than layers.',
        media: { src: '/img/process/03.webp', alt: '' },
      },
      {
        n: '04',
        title: 'Ship and measure.', // PROPUESTA
        desc: 'It only counts once it is in someone else’s hands and the numbers say whether it worked.',
        media: { src: '/img/process/04.webp', alt: '' },
      },
    ],
  },

  // Sección 4 — showcase sticky
  work: {
    heading: 'Selected work.',
    label: '// WORK',
    intro: 'Products I co-founded and things I built to learn in public.',
    viewAll: { label: 'VIEW ALL', href: TODO }, // TODO_JAVIER: repo o página /work
    items: [
      {
        slug: 'orael',
        title: 'Orael',
        tagline: 'AI growth partner for LATAM infoproduct sellers',
        meta: ['SAAS', 'AI', 'PRODUCT'],
        year: '2026',
        cover: '/img/work/orael.webp',
        href: TODO, // TODO_JAVIER
      },
      {
        slug: 'roar',
        title: 'ROAR',
        tagline: 'Live football engagement, second-screen social',
        meta: ['MOBILE', 'REALTIME', 'SPORTS'],
        year: '2026',
        cover: '/img/work/roar.webp',
        href: TODO,
      },
      {
        slug: 'this-site',
        title: 'This portfolio',
        tagline: 'Awwwards-style site built end-to-end with Claude Code',
        meta: ['CREATIVE DEV', 'GSAP', 'CANVAS'],
        year: '2026',
        cover: '/img/work/portfolio.webp',
        href: TODO,
      },
      // TODO_JAVIER: 1–2 proyectos de mecatrónica (circuitos, control, robótica) con foto real
    ],
  },

  marquee: ['Mechatronics', 'AI Development', 'Creative Web', 'Product', 'Guadalajara'],

  // Sección 6 — grid 3×2 (formato "THE BUILD" de la referencia). Principios de trabajo.
  principles: {
    heading: 'What I bring.',
    label: '// THE BUILD',
    overline: 'FOUR DISCIPLINES, ONE SYSTEM.',
    items: [
      {
        title: 'AI PRODUCT DEVELOPMENT.',
        desc: 'From prompt engineering and agent workflows to shipping LLM-powered SaaS.',
      },
      {
        title: 'MECHATRONICS & EMBEDDED.',
        desc: 'Circuit analysis, control systems and firmware that talk to the physical world.',
      },
      {
        title: 'CREATIVE WEB.',
        desc: 'Motion-driven interfaces with GSAP, Lenis and Canvas — like this one.',
      },
      {
        title: 'DATA & MODELING.',
        desc: 'Statistics, regression and forecasting turned into decisions.',
      },
      { title: TODO, desc: TODO }, // TODO_JAVIER: 5º principio
      { title: TODO, desc: TODO }, // TODO_JAVIER: 6º principio
    ],
  },

  stack: {
    heading: 'Tools.',
    label: '// STACK',
    groups: [
      { name: 'AI', items: ['Claude / Claude Code', 'Python', 'LLM agents', 'Prompt engineering'] },
      { name: 'Hardware', items: ['Circuit analysis', 'Control systems', TODO] },
      { name: 'Web', items: ['TypeScript', 'GSAP', 'Lenis', 'Canvas', 'Vite', 'Remotion'] },
      { name: 'Data', items: ['Statistics', 'Excel modeling', 'Regression / forecasting'] },
    ],
  },

  faq: {
    heading: 'Common questions',
    items: [
      { q: 'HOW DO YOU ACTUALLY WORK WITH AI?', a: TODO }, // TODO_JAVIER
      { q: 'WHAT ARE YOU STUDYING RIGHT NOW?', a: TODO },
      { q: 'ARE YOU AVAILABLE FOR WORK?', a: TODO },
      {
        q: 'HOW WAS THIS SITE BUILT?',
        // Hecho verificable del propio proyecto, no inventado.
        a: 'End to end with Claude Code, from a written spec: Vite, TypeScript, GSAP, Lenis and a Canvas 2D ASCII renderer. No page builder, no UI framework, no CSS framework.',
      },
    ],
  },

  contact: {
    heading: ["Let's build", 'something.'],
    sub: 'Send a message or book a call. I read everything.',
    email: TODO, // TODO_JAVIER
    note: 'Working with teams remotely.',
    link: { label: 'Get in touch', href: '#contact' },
    button: { label: "LET'S WORK TOGETHER", href: TODO },
  },

  footer: {
    wordmark: 'JAVIER',
    credits: 'Design inspired by Good Fella. Built with Claude Code.',
    legal: [
      { label: 'Privacy', href: TODO },
      { label: 'Colophon', href: TODO },
    ],
    hotkeys: [
      { key: 'G', label: 'grid' },
      { key: 'C', label: 'change color' },
    ],
    year: 2026,
  },
} as const;

export type Site = typeof site;
