import { resolve } from 'node:path';
import { buildPage, PKG } from './build-all.js';

/** Builds design/contact-sheet.html: every view with fixture data, openable straight from disk. */
const out = resolve(PKG, 'design/contact-sheet.html');
await buildPage(resolve(PKG, 'design/sheet'), out);
console.log(`wrote ${out}`);
