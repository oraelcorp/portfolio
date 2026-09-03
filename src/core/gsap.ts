// src/core/gsap.ts — registro centralizado de plugins y eases con nombre (§4.4). Fase 1.
// Fase 2 añade Flip (swap del CTA) y ScrambleText (MENU ↔ CLOSE). SplitText entra en la Fase 4 (§10.4).

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CustomEase } from 'gsap/CustomEase';
import { Flip } from 'gsap/Flip';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';

gsap.registerPlugin(ScrollTrigger, CustomEase, Flip, ScrambleTextPlugin);

// Mismos valores que las custom properties --ease-out / --ease-inout de tokens.css
CustomEase.create('main', '0.16, 1, 0.3, 1');
CustomEase.create('wipe', '0.83, 0, 0.17, 1');

gsap.defaults({ ease: 'main', duration: 0.8 });

export { gsap, ScrollTrigger, CustomEase, Flip };
