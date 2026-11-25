// Tjekker at alle startsteder kan nå hovedscenen, og at alle bomme ligger på ruten.
import { MAP, W, H, ROUTES, STAGE, SOLID, LEGEND, POSTS, inRect } from '../public/world.js';
const walk = (x, y, open) => {
  const c = MAP[y]?.[x];
  if (c === undefined || SOLID.has(c)) return false;
  const p = LEGEND[c];
  if (p) return POSTS[p].kind === 'gate' && open;
  return true;
};
let ok = true;
for (const r of ROUTES) {
  const [sx, sy] = r.spawn.map(Math.floor);
  const seen = new Set([`${sx},${sy}`]); const q = [[sx, sy]]; const gates = new Set(); let reached = false;
  while (q.length) {
    const [x, y] = q.shift();
    if (inRect(STAGE.crowd, x + 0.5, y + 0.5)) reached = true;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (seen.has(k)) continue;
      const p = LEGEND[MAP[ny]?.[nx]];
      if (p && POSTS[p].kind === 'gate') gates.add(p);
      if (walk(nx, ny, true)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  console.log(`${reached ? '✅' : '❌'} ${r.name}: når scenen=${reached}, bomme på vejen: ${[...gates].join(', ')}`);
  ok &&= reached;
}
// alle stande skal kunne nås fra pladsen
for (const [ch, id] of Object.entries(LEGEND)) if (POSTS[id].kind === 'station') {
  let found = false;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (MAP[y][x] === ch) {
    found = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => walk(x+dx, y+dy, true));
  }
  console.log(`${found ? '✅' : '❌'} stand ${POSTS[id].name}`); ok &&= found;
}
process.exit(ok ? 0 : 1);
