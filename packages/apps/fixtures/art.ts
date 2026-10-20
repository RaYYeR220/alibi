/**
 * Stand-in art for fixtures and the contact sheet: small inline SVGs in the
 * case art direction (ink over a gouache wash), so the design can be reviewed
 * offline before the real portraits and evidence images exist.
 */

const svg = (body: string, w: number, h: number) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`,
  )}`;

const wash = (id: string, a: string, b: string) =>
  `<defs><radialGradient id="${id}" cx="38%" cy="30%" r="85%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>` +
  `<filter id="${id}-r"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="7"/><feDisplacementMap in="SourceGraphic" scale="9"/></filter></defs>`;

const INK = '#211c16';

export type Headwear = 'cap' | 'bun' | 'none';

export function portraitArt(tone: string, deep: string, head: Headwear): string {
  const extra =
    head === 'cap'
      ? `<path d="M64 98c6-34 30-50 58-50s50 14 56 44c-30-8-80-8-114 6z" fill="${INK}"/><path d="M60 100c40-14 90-14 128-2l-4 10c-40-10-84-10-122 2z" fill="${INK}"/>`
      : head === 'bun'
        ? `<circle cx="120" cy="60" r="22" fill="${INK}"/><path d="M70 120c0-40 22-64 50-64s50 24 50 64c-10-22-28-34-50-34s-40 12-50 34z" fill="${INK}"/>`
        : `<path d="M100 214l20 16 20-16-20 6z" fill="${tone}" stroke="${INK}" stroke-width="3"/>`;
  return svg(
    `${wash('w', tone, deep)}<rect width="240" height="288" fill="url(#w)"/>` +
      `<g filter="url(#w-r)" opacity=".92"><ellipse cx="120" cy="124" rx="46" ry="56" fill="${INK}"/>` +
      `<path d="M98 168h44v30H98z" fill="${INK}"/><path d="M30 288c4-62 40-92 90-92s86 30 90 92z" fill="${INK}"/>${extra}</g>` +
      `<path d="M0 0h240v288H0z" fill="none" stroke="${deep}" stroke-width="10" opacity=".35"/>`,
    240,
    288,
  );
}

export function evidenceArt(kind: 'handkerchief' | 'prints' | 'key' | 'ticket', tone = '#d9c9a3', deep = '#9c8a62'): string {
  const body = {
    handkerchief:
      `<path d="M60 70q20-12 40 0t40 0 40 0q14 20 0 40t0 40 0 40q-20 14-40 0t-40 0-40 0q-14-20 0-40t0-40 0-40z" fill="#f4efe2" stroke="${INK}" stroke-width="3"/>` +
      `<path d="M78 92h104v96H78z" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="4 5"/><circle cx="130" cy="140" r="16" fill="none" stroke="${INK}" stroke-width="2"/>`,
    prints:
      `<g fill="#5a4329" opacity=".9"><path d="M70 170c-6-30 4-62 22-62s24 30 18 60c-4 18-36 22-40 2z"/><ellipse cx="88" cy="196" rx="16" ry="12"/>` +
      `<path d="M150 120c-6-30 4-62 22-62s24 30 18 60c-4 18-36 22-40 2z"/><ellipse cx="168" cy="146" rx="16" ry="12"/></g>`,
    key:
      `<circle cx="86" cy="140" r="34" fill="none" stroke="#a57a22" stroke-width="14"/><path d="M118 134h96v14h-12v20h-14v-20h-12v14h-14v-14h-44z" fill="#a57a22" stroke="${INK}" stroke-width="2"/>` +
      `<circle cx="86" cy="140" r="34" fill="none" stroke="${INK}" stroke-width="2"/>`,
    ticket:
      `<path d="M58 84h144v112H58z" fill="#efe4c4" stroke="${INK}" stroke-width="3"/><circle cx="58" cy="140" r="12" fill="${deep}"/><circle cx="202" cy="140" r="12" fill="${deep}"/>` +
      `<path d="M80 108h80M80 126h100M80 144h60" stroke="${INK}" stroke-width="5"/><text x="80" y="182" font-family="Courier New" font-size="22" fill="${INK}">No 4471</text>`,
  }[kind];
  return svg(`${wash('e', tone, deep)}<rect width="260" height="260" fill="url(#e)"/><g filter="url(#e-r)">${body}</g>`, 260, 260);
}

export function coverArt(sky: string, ground: string, lit = '#f0c25a'): string {
  return svg(
    `${wash('c', sky, ground)}<rect width="400" height="300" fill="url(#c)"/><circle cx="312" cy="70" r="28" fill="#efe6cf" opacity=".9"/>` +
      `<g filter="url(#c-r)" fill="${INK}"><path d="M60 300V170l70-56 70 56v-30h24v50l40 32V300z"/><path d="M0 300c60-30 120-34 200-26s140 0 200-20v46z"/></g>` +
      `<rect x="112" y="186" width="20" height="26" fill="${lit}"/><rect x="152" y="186" width="20" height="26" fill="${lit}" opacity=".5"/>`,
    400,
    300,
  );
}
