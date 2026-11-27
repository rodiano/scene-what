// Festivalspillet – server uden eksterne afhængigheder (Node 18+).
// Real-time via Server-Sent Events (server -> browser) + almindelige POST-kald (browser -> server).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { POSTS, ROUTES, STAGE, AVATARS, COLORS, inRect } from './public/world.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- Konfiguration ----------
const MAX_PLAYERS = Math.max(1, parseInt(process.env.MAX_PLAYERS || '6', 10));
const PORT = parseInt(process.env.PORT || '3000', 10);
const SESSION_TTL_MS = parseFloat(process.env.SESSION_TTL_HOURS || '12') * 3600_000;
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '500', 10);
// Festival og spørgsmål ligger i eksterne filer, som kan ændres, mens serveren kører.
// FESTIVAL_CONFIG / QUESTIONS_CONFIG kan pege på filer uden for projektet.
const FESTIVAL_FILE = path.resolve(__dirname, process.env.FESTIVAL_CONFIG || 'config/festival.json');
const QUESTIONS_FILE = path.resolve(__dirname, process.env.QUESTIONS_CONFIG || 'config/questions.json');
const MEDIA_DIR = path.resolve(__dirname, process.env.MEDIA_DIR || 'media');
let FESTIVAL, QUESTIONS, STAMPS_REQUIRED;

function loadConfig() {
  const fest = JSON.parse(fs.readFileSync(FESTIVAL_FILE, 'utf8'));
  const qraw = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
  const qs = qraw.questions || qraw;
  for (const key of ['festivalName', 'headliner']) if (!fest[key]) throw new Error(`"${key}" mangler i ${FESTIVAL_FILE}`);
  if (!Array.isArray(fest.lineup)) throw new Error(`"lineup" skal være en liste i ${FESTIVAL_FILE}`);
  for (const id of Object.keys(POSTS)) {
    if (!Array.isArray(qs[id]) || qs[id].length === 0) throw new Error(`Mangler spørgsmål til posten "${id}" i ${QUESTIONS_FILE}`);
  }
  FESTIVAL = fest;
  QUESTIONS = qs;
  STAMPS_REQUIRED = Math.min(
    Object.values(POSTS).filter((p) => p.kind === 'station').length,
    parseInt(process.env.STAMPS_REQUIRED || FESTIVAL.stampsRequired || '3', 10),
  );
}
try { loadConfig(); } catch (e) { console.error('Kunne ikke læse konfigurationen:', e.message); process.exit(1); }
// Genindlæs automatisk, når filerne ændres (en fejl i filen beholder den gamle udgave)
for (const f of [FESTIVAL_FILE, QUESTIONS_FILE]) {
  fs.watchFile(f, { interval: 1500 }, () => {
    try { loadConfig(); console.log(`🔄 Genindlæste ${path.basename(f)}`); }
    catch (e) { console.error(`⚠️  ${path.basename(f)} kunne ikke læses – beholder den gamle udgave:`, e.message); }
  });
}

// Musik og band til browseren (ikke hemmeligt)
// media/finale-video.(mp4|webm|mov|m4v) bruges automatisk, hvis den findes og finaleVideo ikke er sat
function autoFinaleVideo() {
  for (const ext of ['mp4', 'webm', 'mov', 'm4v']) {
    if (fs.existsSync(path.join(MEDIA_DIR, `finale-video.${ext}`))) return `media/finale-video.${ext}`;
  }
  return null;
}
function publicMedia() {
  const m = FESTIVAL.music || {}, b = FESTIVAL.band || {};
  return {
    music: { background: m.background || null, backgroundVolume: m.backgroundVolume ?? 0.35, finale: m.finale || null, finaleVolume: m.finaleVolume ?? 0.8, finaleVideo: m.finaleVideo || autoFinaleVideo(), noVideoProbe: true },
    band: { members: Array.isArray(b.members) ? b.members.slice(0, 6) : [], image: b.image || null },
  };
}
const WRONG_BEFORE_HELP = 2; // forkerte svar før man kan spørge holdet (alternativt: brug alle hints)
const SKIP_AFTER_WRONG = parseInt(process.env.SKIP_AFTER_WRONG || '5', 10); // nødudgang så ingen sidder fast for evigt
const ANSWER_COOLDOWN_MS = 1200;
const ONLINE_GRACE_MS = 15_000;


// ---------- Hjælpere ----------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(len = 6) {
  let s = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}
const newId = () => crypto.randomBytes(8).toString('hex');
const now = () => Date.now();

function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[.,!?'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Deterministisk "tilfældig" rækkefølge pr. session (så plakaten afsløres i samme orden for alle)
function seededShuffle(arr, seedStr) {
  let seed = 0;
  for (const c of seedStr) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Sessioner ----------
/** @type {Map<string, any>} */
const sessions = new Map();

function createSession() {
  let id;
  do id = newCode(); while (sessions.has(id));
  const s = {
    id,
    created: now(),
    lastActive: now(),
    players: new Map(),
    clients: new Set(), // { res, pid }
    chat: [],
    help: new Map(), // rid -> request
    finale: null,
    dirty: false,
    revealOrder: null,
  };
  s.revealOrder = lineupRevealOrder(id);
  sessions.set(id, s);
  return s;
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    color: p.color,
    route: p.route,
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100,
    dir: p.dir,
    moving: p.moving,
    online: isOnline(p),
    solved: [...p.solved],
    atStage: atStage(p),
  };
}

function isOnline(p) {
  return p.conns > 0 || now() - p.lastSeen < ONLINE_GRACE_MS;
}
function atStage(p) {
  return p.solved.has('finale') && inRect(STAGE.crowd, p.x, p.y);
}

function stampsOf(p) {
  let n = 0;
  for (const id of p.solved) if (POSTS[id]?.kind === 'station') n++;
  return n;
}

function perPlayerRequired() {
  return 2 + STAMPS_REQUIRED + 1; // to bomme på ruten + stempler + Scenevagten
}

function teamProgress(s) {
  let solved = 0;
  for (const p of s.players.values()) {
    let gates = 0;
    for (const id of p.solved) if (POSTS[id]?.kind === 'gate') gates++;
    solved += gates + Math.min(stampsOf(p), STAMPS_REQUIRED);
  }
  const required = Math.max(1, s.players.size * perPlayerRequired());
  return { solved, required, ratio: Math.min(1, solved / required) };
}

// Rækkefølgen kunstnernes bogstaver afsløres i (ens for hele holdet):
// først forbogstavet i hvert navn, derefter resten i tilfældig orden.
function lineupRevealOrder(seed) {
  const firsts = [], rest = [];
  FESTIVAL.lineup.forEach((name, b) => {
    let first = true;
    [...name].forEach((c, i) => {
      if (!/[\p{L}\p{N}]/u.test(c)) return; // mellemrum og tegn vises altid
      (first ? firsts : rest).push(`${b}:${i}`);
      first = false;
    });
  });
  return [...seededShuffle(firsts, seed), ...seededShuffle(rest, seed + 'x')];
}

// Plakaten – kun de afslørede dele sendes til browseren.
// Under spillet afsløres KUN kunstnerne, bogstav for bogstav (højst 80 %).
// Festivalnavn, dato, sted og hovednavn sendes først, når finalen er i gang.
function posterView(s) {
  const prog = teamProgress(s);
  const full = !!s.finale;
  const order = s.revealOrder;
  const shown = full ? order.length : Math.floor(prog.ratio * 0.8 * order.length);
  const set = new Set(order.slice(0, shown));
  return {
    final: full,
    lineup: FESTIVAL.lineup.map((name, b) =>
      [...name].map((c, i) => (!/[\p{L}\p{N}]/u.test(c) || full || set.has(`${b}:${i}`) ? c : null))),
    name: full ? FESTIVAL.festivalName : null,
    tagline: full ? FESTIVAL.tagline : null,
    date: full ? FESTIVAL.date : null,
    place: full ? FESTIVAL.place : null,
    headliner: full ? FESTIVAL.headliner : null,
    revealed: shown,
    total: order.length,
    progress: prog,
  };
}


function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(s, event, data, exceptPid = null) {
  for (const c of s.clients) if (c.pid !== exceptPid) send(c.res, event, data);
}
function broadcastPlayers(s) {
  broadcast(s, 'players', { players: [...s.players.values()].map(publicPlayer) });
}

function checkFinale(s) {
  if (s.finale) return;
  const online = [...s.players.values()].filter(isOnline);
  if (online.length === 0) return;
  if (online.every(atStage)) {
    s.finale = { at: now() };
    broadcast(s, 'finale', {
      poster: posterView(s),
      teaser: FESTIVAL.headlinerTeaser,
      message: FESTIVAL.finaleMessage,
      players: online.map((p) => p.name),
    });
  }
}

// ---------- Spørgsmål ----------
function publicQuestion(q, a) {
  return {
    q: q.q,
    type: q.type,
    options: q.type === 'choice' ? q.options : undefined,
    hintsTotal: q.hints?.length || 0,
    hints: (q.hints || []).slice(0, a.hintsUsed),
    wrong: a.wrong,
  };
}
function canSkip(q, a) {
  return SKIP_AFTER_WRONG > 0 && a.wrong >= SKIP_AFTER_WRONG && a.hintsUsed >= (q.hints?.length || 0);
}
function canAskTeam(q, a) {
  return a.hintsUsed >= (q.hints?.length || 0) || a.wrong >= WRONG_BEFORE_HELP;
}

function assignQuestion(s, p, postId) {
  if (p.assigned[postId] && QUESTIONS[postId][p.assigned[postId].qi]) return p.assigned[postId];
  delete p.assigned[postId];
  const pool = QUESTIONS[postId];
  // Undgå at give samme spørgsmål som holdkammerater ved samme post, så alle får noget nyt
  const taken = new Set();
  for (const o of s.players.values()) if (o.assigned[postId]) taken.add(o.assigned[postId].qi);
  const free = pool.map((_, i) => i).filter((i) => !taken.has(i));
  const choices = free.length ? free : pool.map((_, i) => i);
  const qi = choices[Math.floor(Math.random() * choices.length)];
  p.assigned[postId] = { qi, hintsUsed: 0, wrong: 0, lastAnswer: 0 };
  return p.assigned[postId];
}

function checkAnswer(q, answer) {
  if (q.type === 'choice') return Number(answer) === q.answer;
  const a = normalize(answer);
  return (q.answers || []).some((x) => normalize(x) === a);
}

function answerText(q, answer) {
  if (q.type === 'choice') return q.options[Number(answer)] ?? '';
  return String(answer ?? '').slice(0, 80);
}

function markSolved(s, p, postId, answerShown) {
  if (p.solved.has(postId)) return;
  p.solved.add(postId);
  s.dirty = true;
  const post = POSTS[postId];
  broadcast(s, 'solved', { pid: p.id, name: p.name, avatar: p.avatar, post: postId, postName: post.name });
  broadcast(s, 'poster', posterView(s));
  for (const h of s.help.values()) {
    if (h.pid === p.id && h.post === postId && !h.done) {
      h.done = true;
      broadcast(s, 'helpdone', { rid: h.rid, answer: answerShown });
    }
  }
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 20_000) {
        reject(new Error('for stor'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel.startsWith('/media/')) return serveMedia(req, res, rel.slice('/media/'.length));
  if (rel === '/' || rel.startsWith('/s/')) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Nej' });
  fs.readFile(file, (err, buf) => {
    if (err) return json(res, 404, { error: 'Ikke fundet' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

function authPlayer(s, body) {
  const p = s.players.get(String(body.pid || ''));
  if (!p || p.token !== body.token) return null;
  p.lastSeen = now();
  s.lastActive = now();
  return p;
}

// Musik og billeder fra media-mappen (med Range-understøttelse, så lyd kan spoles og loope i alle browsere)
const MEDIA_MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
function serveMedia(req, res, rel) {
  const file = path.normalize(path.join(MEDIA_DIR, rel));
  if (!file.startsWith(MEDIA_DIR + path.sep)) return json(res, 403, { error: 'Nej' });
  const type = MEDIA_MIME[path.extname(file).toLowerCase()];
  if (!type) return json(res, 415, { error: 'Filtypen understøttes ikke' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: 'Ikke fundet' });
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? Math.min(parseInt(m[2], 10), st.size - 1) : st.size - 1;
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] !== 'api') return serveStatic(req, res, url.pathname);

  try {
    // POST /api/sessions -> ny session
    if (req.method === 'POST' && parts[1] === 'sessions' && parts.length === 2) {
      if (sessions.size >= MAX_SESSIONS) return json(res, 503, { error: 'Serveren er fuld lige nu. Prøv igen senere.' });
      const s = createSession();
      return json(res, 200, { id: s.id, maxPlayers: MAX_PLAYERS });
    }

    if (parts[1] !== 's' || !parts[2]) return json(res, 404, { error: 'Ukendt' });
    const s = sessions.get(parts[2].toUpperCase());
    if (!s) return json(res, 404, { error: 'Spillet findes ikke (eller er udløbet). Tjek koden.' });
    const action = parts[3] || '';

    // GET /api/s/:id -> info
    if (req.method === 'GET' && action === '') {
      return json(res, 200, {
        id: s.id,
        players: s.players.size,
        maxPlayers: MAX_PLAYERS,
        avatars: AVATARS,
        colors: COLORS,
        taken: [...s.players.values()].map((p) => ({ name: p.name, avatar: p.avatar })),
      });
    }

    // GET /api/s/:id/events?pid&token -> SSE
    if (req.method === 'GET' && action === 'events') {
      const p = authPlayer(s, { pid: url.searchParams.get('pid'), token: url.searchParams.get('token') });
      if (!p) return json(res, 401, { error: 'Ukendt spiller' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      const client = { res, pid: p.id };
      s.clients.add(client);
      p.conns++;
      send(res, 'init', {
        me: p.id,
        config: { maxPlayers: MAX_PLAYERS, stampsRequired: STAMPS_REQUIRED, ...publicMedia() },
        players: [...s.players.values()].map(publicPlayer),
        poster: posterView(s),
        chat: s.chat.slice(-50),
        help: [...s.help.values()].filter((h) => !h.done),
        finale: s.finale
          ? { poster: posterView(s), teaser: FESTIVAL.headlinerTeaser, message: FESTIVAL.finaleMessage, players: [] }
          : null,
      });
      s.dirty = true;
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.on('close', () => {
        clearInterval(keepAlive);
        s.clients.delete(client);
        p.conns = Math.max(0, p.conns - 1);
        p.lastSeen = now();
        s.dirty = true;
      });
      return;
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'Metode ikke tilladt' });
    const body = await readBody(req);

    // POST /api/s/:id/join
    if (action === 'join') {
      const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 16);
      const avatar = AVATARS.includes(body.avatar) ? body.avatar : AVATARS[0];
      const color = COLORS.includes(body.color) ? body.color : COLORS[0];
      const existing = s.players.get(String(body.pid || ''));
      if (existing && existing.token === body.token) {
        if (name) existing.name = name;
        existing.avatar = avatar;
        existing.color = color;
        existing.lastSeen = now();
        s.dirty = true;
        return json(res, 200, { pid: existing.id, token: existing.token, rejoined: true });
      }
      if (!name) return json(res, 400, { error: 'Skriv dit navn' });
      if (s.players.size >= MAX_PLAYERS)
        return json(res, 403, { error: `Spillet er fuldt (maks ${MAX_PLAYERS} spillere).` });
      // Fordel spillerne på startstederne, så man starter forskellige steder
      const counts = ROUTES.map((r) => [...s.players.values()].filter((p) => p.route === r.id).length);
      const min = Math.min(...counts);
      const ri = counts.indexOf(min);
      const route = ROUTES[ri];
      const off = min * 0.8;
      const p = {
        id: newId(),
        token: newId() + newId(),
        name,
        avatar,
        color,
        route: route.id,
        x: route.spawn[0] + (min % 2 ? off : -off) * 0.5,
        y: route.spawn[1],
        dir: 'down',
        moving: false,
        solved: new Set(),
        assigned: {},
        conns: 0,
        lastSeen: now(),
      };
      s.players.set(p.id, p);
      s.lastActive = now();
      s.dirty = true;
      broadcast(s, 'toast', { text: `${avatar} ${name} er ankommet til ${route.name}` });
      broadcast(s, 'poster', posterView(s));
      return json(res, 200, { pid: p.id, token: p.token });
    }

    const p = authPlayer(s, body);
    if (!p) return json(res, 401, { error: 'Ukendt spiller – deltag igen.' });

    switch (action) {
      case 'move': {
        const x = Number(body.x), y = Number(body.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          p.x = Math.max(0, Math.min(60, x));
          p.y = Math.max(0, Math.min(60, y));
          p.dir = ['up', 'down', 'left', 'right'].includes(body.dir) ? body.dir : p.dir;
          p.moving = !!body.moving;
          s.dirty = true;
          checkFinale(s);
        }
        return json(res, 200, { ok: true });
      }

      case 'post': {
        const postId = String(body.post);
        const post = POSTS[postId];
        if (!post) return json(res, 400, { error: 'Ukendt post' });
        if (p.solved.has(postId)) return json(res, 200, { solved: true, post: postId });
        if (post.final && stampsOf(p) < STAMPS_REQUIRED) {
          return json(res, 200, { locked: true, post: postId, need: STAMPS_REQUIRED - stampsOf(p), stamps: stampsOf(p) });
        }
        const a = assignQuestion(s, p, postId);
        const q = QUESTIONS[postId][a.qi] || QUESTIONS[postId][(a.qi = 0)];
        return json(res, 200, { post: postId, question: publicQuestion(q, a), canAskTeam: canAskTeam(q, a), canSkip: canSkip(q, a) });
      }

      case 'hint': {
        const postId = String(body.post);
        const a = p.assigned[postId];
        if (!a) return json(res, 400, { error: 'Intet spørgsmål' });
        const q = QUESTIONS[postId][a.qi] || QUESTIONS[postId][(a.qi = 0)];
        a.hintsUsed = Math.min((q.hints || []).length, a.hintsUsed + 1);
        return json(res, 200, { question: publicQuestion(q, a), canAskTeam: canAskTeam(q, a), canSkip: canSkip(q, a) });
      }

      case 'answer': {
        const postId = String(body.post);
        const a = p.assigned[postId];
        if (!a) return json(res, 400, { error: 'Intet spørgsmål' });
        if (p.solved.has(postId)) return json(res, 200, { correct: true });
        if (now() - a.lastAnswer < ANSWER_COOLDOWN_MS) return json(res, 429, { error: 'Vent lige et øjeblik…' });
        a.lastAnswer = now();
        const q = QUESTIONS[postId][a.qi] || QUESTIONS[postId][(a.qi = 0)];
        if (checkAnswer(q, body.answer)) {
          markSolved(s, p, postId, answerText(q, body.answer));
          return json(res, 200, { correct: true, stamps: stampsOf(p) });
        }
        a.wrong++;
        return json(res, 200, { correct: false, question: publicQuestion(q, a), canAskTeam: canAskTeam(q, a), canSkip: canSkip(q, a) });
      }

      case 'skip': {
        const postId = String(body.post);
        const a = p.assigned[postId];
        if (!a) return json(res, 400, { error: 'Intet spørgsmål' });
        const q = QUESTIONS[postId][a.qi] || QUESTIONS[postId][(a.qi = 0)];
        if (!canSkip(q, a)) return json(res, 400, { error: 'Prøv lidt mere først 🙂' });
        markSolved(s, p, postId, answerText(q, q.type === 'choice' ? q.answer : q.answers[0]));
        return json(res, 200, { correct: true, skipped: true });
      }

      case 'help': {
        const postId = String(body.post);
        const a = p.assigned[postId];
        if (!a) return json(res, 400, { error: 'Intet spørgsmål' });
        const q = QUESTIONS[postId][a.qi] || QUESTIONS[postId][(a.qi = 0)];
        if (!canAskTeam(q, a)) return json(res, 400, { error: 'Brug dine hints først' });
        const open = [...s.help.values()].find((h) => h.pid === p.id && h.post === postId && !h.done);
        if (open) return json(res, 200, { rid: open.rid });
        const h = {
          rid: newId(),
          pid: p.id,
          name: p.name,
          avatar: p.avatar,
          post: postId,
          postName: POSTS[postId].name,
          q: q.q,
          type: q.type,
          options: q.type === 'choice' ? q.options : undefined,
          hints: q.hints || [],
          suggestions: [],
          done: false,
          at: now(),
        };
        s.help.set(h.rid, h);
        broadcast(s, 'help', h);
        return json(res, 200, { rid: h.rid });
      }

      case 'suggest': {
        const h = s.help.get(String(body.rid));
        if (!h || h.done) return json(res, 400, { error: 'Spørgsmålet er allerede løst' });
        let text = String(body.text || '').trim().slice(0, 140);
        if (body.option !== undefined && h.options) text = h.options[Number(body.option)] ?? text;
        if (!text) return json(res, 400, { error: 'Tom besked' });
        const sug = { from: p.name, avatar: p.avatar, pid: p.id, text, at: now() };
        h.suggestions.push(sug);
        broadcast(s, 'suggest', { rid: h.rid, ...sug });
        return json(res, 200, { ok: true });
      }

      case 'chat': {
        const text = String(body.text || '').trim().slice(0, 200);
        if (!text) return json(res, 400, { error: 'Tom besked' });
        const msg = { from: p.name, avatar: p.avatar, color: p.color, pid: p.id, text, at: now() };
        s.chat.push(msg);
        if (s.chat.length > 200) s.chat.shift();
        broadcast(s, 'chat', msg);
        return json(res, 200, { ok: true });
      }

      default:
        return json(res, 404, { error: 'Ukendt handling' });
    }
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'Serverfejl' });
  }
});

// Udsend positioner ~10 gange i sekundet, når noget har ændret sig
setInterval(() => {
  for (const s of sessions.values()) {
    if (s.dirty) {
      s.dirty = false;
      broadcastPlayers(s);
      checkFinale(s);
    }
  }
}, 100);

// Online-status og oprydning
setInterval(() => {
  const t = now();
  for (const s of sessions.values()) {
    s.dirty = true; // opdater online-status
    if (s.clients.size === 0 && t - s.lastActive > SESSION_TTL_MS) sessions.delete(s.id);
  }
}, 5_000);

server.listen(PORT, () => {
  console.log(`🎪 Festivalspillet kører på http://localhost:${PORT}  (maks ${MAX_PLAYERS} spillere pr. session, ${STAMPS_REQUIRED} stempler kræves)`);
});
