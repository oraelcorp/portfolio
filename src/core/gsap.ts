// src/core/gsap.ts — registro centralizado de plugins y eases con nombre (§4.4). Fase 1.
// Fase 2 añadió Flip (swap del CTA) y ScrambleText (MENU ↔ CLOSE); Fase 4 añade SplitText.

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CustomEase } from 'gsap/CustomEase';
import { Flip } from 'gsap/Flip';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, CustomEase, Flip, ScrambleTextPlugin, SplitText);

// Mismos valores que las custom properties --ease-out / --ease-inout de tokens.css
CustomEase.create('main', '0.16, 1, 0.3, 1');
CustomEase.create('wipe', '0.83, 0, 0.17, 1');
// Entrada muy suave para el titular del hero: arranca antes que "main" y frena más largo,
// de modo que las letras se posan en vez de aterrizar.
CustomEase.create('silk', '0.19, 1, 0.22, 1');

gsap.defaults({ ease: 'main', duration: 0.8 });

export { gsap, ScrollTrigger, CustomEase, Flip, SplitText };
