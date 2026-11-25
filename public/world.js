// Delt verdensdefinition – bruges af både server og browser.
// Kortet kan redigeres direkte. Tegnforklaring:
//  .  græs          ,  sti            =  vej/asfalt     :  pladsen foran hovedscenen
//  #  hegn          T  træ            ~  vand           S  scene / højttalertårn
//  B  bod/telt      K  bil            R  cykelstativ    X  telt (camping)
//  1-9 bomme (spørgsmål for at komme videre)
//  f m b t i w  festivalposter (spørgsmål giver stempler)
// Bemærk: Rigtige svar, festivalnavn og bands ligger KUN på serveren (config/).

export const TILE = 32;

export const MAP = [
    "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    "T............#:SS:SSSSSSSSSSSSSS:SS:#............T",
    "T............#:SS:SSSSSSSSSSSSSS:SS:#============T",
    "T============#:SS:SSSSSSSSSSSSSS:SS:#.....,,.....T",
    "T.....,,.....#::::::::::::::::::::::#.....,,.....T",
    "T..BBB,,.....#::::::::::::::::::::::#.....,,.....T",
    "T.....,,..T..#::::::::::::::::::::::#.RRRR,,RRRR.T",
    "T.....,,.....#::::::::::::::::::::::#.....,,.....T",
    "T.T...,,.....#::::::::::::::::::::::#.....,,.....T",
    "T.....,,.T...#::::::::::::::::::::::#.RRRR,,RRRR.T",
    "T.....,,...T.###########99###########.....,,.....T",
    "T..T..,,.....#T.........,,.........T#.....,,.....T",
    "T.....,,.....#.BBB..BBB.,,.BBB..BBB.#.....,,.....T",
    "T#####11######.BBB..BBB.,,.BBB..BBB.######55#####T",
    "T.....,,..T..#..f....m..,,..b....i..#..T..,,.....T",
    "T.T...,,,,,,,2,,,,,,,,,,,,,,,,,,,,,,6,,,,,,,..T..T",
    "T..T..,,,,,,,2,,,,,,,,,,,,,,,,,,,,,,6,,,,,,,...T.T",
    "T............#.BBBBB....,,....BBBBB.#............T",
    "T#############.BBBBB....,,....BBBBB.#############T",
    "T............#TBBBBB.T..,,..T.BBBBBT#..T.........T",
    "T.~~......T..#..,t,.....,,......w...#........~~~.T",
    "T.~~.........#..........,,..........#........~~~.T",
    "T.....,,,,,,,4,,,,,,,,,,,,,,,,,,,,,,8,,,,,,,.....T",
    "T.....,,,,,,,4,,,,,,,,,,,,,,,,,,,,,,8,,,,,,,.....T",
    "T...T.,,.....#..........,,..........#.....,,.T...T",
    "T.....,,...T.#T.........,,.........T#.T...,,.....T",
    "T#####33##################################77#####T",
    "T.....,,......TTTTTTTTTTTTTTTTTTTTTT......,,.....T",
    "T=====,,=====.TTTTTTTTTTTTTTTTTTTTTT..X...,,..X..T",
    "T.....,,......TTT~~~~~~~~~~~~~~~~TTT......,,.....T",
    "T.K.K.,,.K.K..TTT~~~~~~~~~~~~~~~~TTT....X.,,.....T",
    "T.....,,......TTT~~~~~~~~~~~~~~~~TTT......,,.X.X.T",
    "T.....,,......TTT~~~~~~~~~~~~~~~~TTT......,,.....T",
    "T.K.K.,,.K.K..TTT~~~~~~~~~~~~~~~~TTT..X...,,.....T",
    "T.....,,......TTT~~~~~~~~~~~~~~~~TTT......,,.X...T",
    "T.....,,......TTTTTTTTTTTTTTTTTTTTTT...X..,,...X.T",
    "T.....,,......TTTTTTTTTTTTTTTTTTTTTT......,,.....T",
    "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
];

// Poster: bomme (kind 'gate') og stande (kind 'station').
export const POSTS = {
  billet:  { kind: 'gate',    name: 'Billetkontrollen',   emoji: '🎫', route: 'A' },
  armbaand:{ kind: 'gate',    name: 'Armbåndsteltet',     emoji: '🔖', route: 'A' },
  parkering:{kind: 'gate',    name: 'Parkeringsvagten',   emoji: '🅿️', route: 'B' },
  taske:   { kind: 'gate',    name: 'Tasketjekket',       emoji: '🎒', route: 'B' },
  cykel:   { kind: 'gate',    name: 'Cykelvagten',        emoji: '🚲', route: 'C' },
  pant:    { kind: 'gate',    name: 'Pantstationen',      emoji: '♻️', route: 'C' },
  camping: { kind: 'gate',    name: 'Campingvagten',      emoji: '⛺', route: 'D' },
  vand:    { kind: 'gate',    name: 'Vandposten',         emoji: '🚰', route: 'D' },
  finale:  { kind: 'gate',    name: 'Scenevagten',        emoji: '🎟️', final: true },
  mad:     { kind: 'station', name: 'Madboden',           emoji: '🍔' },
  merch:   { kind: 'station', name: 'Merchandise-teltet', emoji: '👕' },
  bar:     { kind: 'station', name: 'Saft- & sodavandsbaren', emoji: '🥤' },
  telt:    { kind: 'station', name: 'Teltscenen',         emoji: '🎪' },
  info:    { kind: 'station', name: 'Info & førstehjælp', emoji: '⛑️' },
  toilet:  { kind: 'station', name: 'Toiletkøen',         emoji: '🚻' },
};

// Hvilket korttegn hører til hvilken post
export const LEGEND = {
  '1': 'billet', '2': 'armbaand', '3': 'parkering', '4': 'taske',
  '5': 'cykel', '6': 'pant', '7': 'camping', '8': 'vand', '9': 'finale',
  f: 'mad', m: 'merch', b: 'bar', t: 'telt', i: 'info', w: 'toilet',
};

// Startsteder – spillerne fordeles, så de starter forskellige steder
export const ROUTES = [
  { id: 'A', name: 'Busstoppet',       spawn: [6.5, 7.5] },
  { id: 'C', name: 'Cykelparkeringen', spawn: [42.5, 4.5] },
  { id: 'B', name: 'Parkeringspladsen',spawn: [6.5, 34.5] },
  { id: 'D', name: 'Campingpladsen',   spawn: [42.5, 34.5] },
];

export const ZONES = [
  { name: 'Hovedscenen',       x: 14, y: 1,  w: 22, h: 9 },
  { name: 'Festivalpladsen',   x: 14, y: 11, w: 22, h: 15 },
  { name: 'Busstoppet',        x: 1,  y: 1,  w: 12, h: 12 },
  { name: 'Indgang vest',      x: 1,  y: 14, w: 12, h: 4 },
  { name: 'Parkeringspladsen', x: 1,  y: 27, w: 13, h: 10 },
  { name: 'Indgang sydvest',   x: 1,  y: 19, w: 12, h: 7 },
  { name: 'Cykelparkeringen',  x: 37, y: 1,  w: 12, h: 12 },
  { name: 'Indgang øst',       x: 37, y: 14, w: 12, h: 4 },
  { name: 'Campingpladsen',    x: 36, y: 27, w: 13, h: 10 },
  { name: 'Indgang sydøst',    x: 37, y: 19, w: 12, h: 7 },
];

// Området bag hegnet med hovedscenen (skjult indtil man er igennem Scenevagten)
export const STAGE = { x: 14, y: 1, w: 22, h: 9, crowd: { x: 14, y: 4, w: 22, h: 6 } };

export const LABELS = [
  { text: '🚌 Busstoppet', x: 4, y: 4.2 },
  { text: '🚗 Parkering', x: 3.5, y: 27.6 },
  { text: '🚲 Cykelparkering', x: 45, y: 3.6 },
  { text: '⛺ Camping', x: 45.5, y: 29.5 },
  { text: '🎡 Festivalpladsen', x: 25, y: 18.2 },
];

export const SOLID = new Set(['#', 'T', '~', 'S', 'B', 'K', 'R', 'X']);

export const W = MAP[0].length;
export const H = MAP.length;

export function tileAt(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return 'T';
  return MAP[y][x];
}

export function postAt(x, y) {
  return LEGEND[tileAt(x, y)] || null;
}

export function zoneAt(x, y) {
  for (const z of ZONES) if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return z.name;
  return 'Festivalområdet';
}

export function inRect(r, x, y) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export const AVATARS = ['🧑‍🎤', '🦄', '🐻', '🤠', '👽', '🐸', '🧙', '🦊', '🐼', '🤖', '🐯', '🧚'];
export const COLORS = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#457b9d', '#8338ec', '#ff006e', '#06d6a0'];
