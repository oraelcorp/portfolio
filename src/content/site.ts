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
    email: 'traperouu21@gmail.com',
    url: TODO, // TODO_JAVIER: dominio final, para el canonical y las OG
    ogDescription: 'Mechatronics engineer building AI products. Portfolio built with Claude Code.',
    // Texto alternativo de la imagen para compartir (og:image / twitter:image)
    ogImageAlt: "ASCII portrait of a roaring jaguar beside the headline 'Engineering that learns.'",
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
      { label: 'GitHub', href: 'https://github.com/oraelcorp' },
      { label: 'Instagram', href: 'https://www.instagram.com/traperouu' },
    ],
    status: [
      { label: 'OPEN TO INTERNSHIPS & FREELANCE' }, // confirmado por Javier
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
      { value: '02', label: 'PRODUCTS CO-FOUNDED' },
      { value: '2+', label: 'YEARS BUILDING WEB & SAAS PRODUCTS' },
      { value: '2+', label: 'YEARS INTO MECHATRONICS ENGINEERING' },
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
        title: 'Spec first.',
        desc: 'I write the detailed spec before a single line of code, mapping every effect, edge case, and decision so nothing is left to guesswork.',
        media: { src: '/img/process/01.webp', alt: '' }, // TODO_JAVIER: media de cada paso
      },
      {
        n: '02',
        title: 'Build in phases.',
        desc: 'Each phase ships something testable and verified — build, lint, screenshots — before the next one starts.',
        media: { src: '/img/process/02.webp', alt: '' },
      },
      {
        n: '03',
        title: "Measure, don't assume.",
        desc: 'Every claim gets checked against the pixels, not the narrative: performance budgets, contrast, visual diffs.',
        media: { src: '/img/process/03.webp', alt: '' },
      },
      {
        n: '04',
        title: 'Iterate in the open.',
        desc: 'Version-controlled checkpoints at every decision, so nothing is ever a dead end, just a branch worth exploring.',
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
    overline: 'SIX DISCIPLINES, ONE SYSTEM.',
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
      {
        title: 'PRODUCT FROM ZERO.',
        desc: 'Scoping, building and shipping a product end to end, including the unglamorous parts between the idea and the first user.',
      },
      {
        title: 'SYSTEMS THINKING.',
        desc: 'Treating hardware, models and interface as one system rather than three layers that meet at the end.',
      },
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
      {
        q: 'WHERE DO YOU STUDY?',
        a: 'Mechatronics engineering at Tecnológico de Monterrey, Campus Guadalajara.',
      },
      {
        q: 'DO YOU TAKE FREELANCE WORK?',
        a: 'Yes — open to freelance and collaborations, especially around AI-powered products and creative web development.',
      },
      {
        q: 'WHAT KIND OF PROJECTS DO YOU ENJOY MOST?',
        a: "The ones where hardware logic meets AI — building SaaS products and intelligent systems for companies, where a system doesn't just run, it learns and gets better the more it's used.",
      },
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
    email: 'traperouu21@gmail.com',
    note: 'Working with teams remotely.',
    link: { label: 'Get in touch', href: '#contact' },
    button: { label: "LET'S WORK TOGETHER", href: 'mailto:traperouu21@gmail.com' },
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
