// ====================================================================
// Artifact-motor: erstatter serveren, når spillet kører som claude.ai-artifact.
// Hver spiller er "server" for sin egen tilstand og deler den via room-presence.
// Spillet kan også spilles alene, hvis room ikke er tilgængeligt.
// ====================================================================
const ENGINE = (() => {
  const FEST = FESTIVAL_DATA;
  const QS = QUESTIONS_DATA;
  const MAX_PLAYERS = 6;
  const STAMPS_REQUIRED = Math.min(6, FEST.stampsRequired || 3);
  const WRONG_BEFORE_HELP = 2, SKIP_AFTER_WRONG = 5, ANSWER_COOLDOWN_MS = 1200;
  const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rid8 = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPH[b % ALPH.length]).join('');
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[.,!?'"]/g, ' ').replace(/\s+/g, ' ').trim();
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  let roomApi = null;          // lobby-room (eller null)
  const roomP = (async () => {
    try { roomApi = await window.claude?.use?.('room'); } catch { roomApi = null; }
    return roomApi;
  })();
  let room = null, roomCode = null, unsub = null;
  let me = null;               // min fulde tilstand
  let code = null;
  const listeners = new Set(); // FakeEventSource-instanser
  let prev = null;             // forrige snapshot til diff

  function seededShuffle(arr, seedStr) {
    let seed = 0;
    for (const c of seedStr) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  async function joinRoom(c) {
    await roomP;
    if (!roomApi || roomCode === c) return room;
    try {
      if (room) { try { unsub?.(); await room.leave(); } catch {} }
      room = await roomApi.join('fest-' + c.toLowerCase());
      roomCode = c;
      unsub = room.onPeers(() => onChange());
      // giv andre et øjeblik til at svare
      await new Promise((r) => setTimeout(r, 900));
    } catch { room = null; roomCode = null; }
    return room;
  }

  // ---------- spillere ----------
  function peersPresence() {
    if (!room) return [];
    return room.peers().filter((p) => !p.isMe && p.presence && p.presence.p).map((p) => p.presence);
  }
  function toPlayer(pr, online = true) {
    const p = pr.p;
    const solved = Array.isArray(p.s) ? p.s.filter((k) => POSTS[k]) : [];
    const x = +p.x || 0, y = +p.y || 0;
    return {
      id: String(p.id), name: String(p.n || '?').slice(0, 16), avatar: String(p.a || '🙂').slice(0, 12), color: /^#[0-9a-f]{6}$/i.test(p.c) ? p.c : '#888',
      route: p.r, x, y, dir: p.d || 'down', moving: !!p.m, online, solved,
      atStage: solved.includes('finale') && inRect(STAGE.crowd, x, y),
      _pr: pr,
    };
  }
  function myPresence() {
    return {
      p: { id: me.pid, n: me.name, a: me.avatar, c: me.color, r: me.route, x: +me.x.toFixed(2), y: +me.y.toFixed(2), d: me.dir, m: me.moving, s: me.solved, q: Object.fromEntries(Object.entries(me.assigned).map(([k, v]) => [k, v.qi])) },
      h: me.helps.slice(-4).map((h) => ({ r: h.rid, post: h.post, qi: h.qi, done: h.done, ans: h.ans || '', at: h.at })),
      g: me.sugg.slice(-8),
      ch: me.chat.slice(-6),
      f: me.finale ? 1 : 0,
    };
  }
  let pushT = 0, pushQueued = false;
  function push() {
    save();
    if (!room) { onChange(); return; }
    const now = performance.now();
    if (now - pushT < 80) { if (!pushQueued) { pushQueued = true; setTimeout(() => { pushQueued = false; push(); }, 90); } return; }
    pushT = now;
    room.presence(myPresence()).catch(() => {});
    onChange();
  }
  function save() { if (me && code) ls.set('fa:' + code, me); }

  function allPlayers() {
    const list = [];
    if (me) list.push(toPlayer(myPresence()));
    const seen = new Set([me?.pid]);
    for (const pr of peersPresence()) {
      if (seen.has(String(pr.p.id))) continue; // samme spiller i to faner
      seen.add(String(pr.p.id));
      list.push(toPlayer(pr));
    }
    return list;
  }

  // ---------- plakat ----------
  function posterView(players, full) {
    const name = FEST.festivalName;
    const order = {
      pieces: seededShuffle([...FEST.lineup.map((_, i) => `band:${i}`), 'date', 'place', 'tagline'], code),
      letters: seededShuffle([...name].map((_, i) => i).filter((i) => name[i] !== ' '), code + 'x'),
    };
    let solved = 0;
    for (const p of players) {
      const gates = p.solved.filter((k) => POSTS[k].kind === 'gate').length;
      const st = p.solved.filter((k) => POSTS[k].kind === 'station').length;
      solved += gates + Math.min(st, STAMPS_REQUIRED);
    }
    const required = Math.max(1, players.length * (2 + STAMPS_REQUIRED + 1));
    const ratio = Math.min(1, solved / required);
    const pc = full ? Infinity : Math.floor(ratio * order.pieces.length);
    const lc = full ? Infinity : Math.floor(ratio * 0.85 * order.letters.length);
    const sp = new Set(order.pieces.slice(0, pc)), sl = new Set(order.letters.slice(0, lc));
    const total = order.pieces.length + order.letters.length + 1;
    return {
      name: [...name].map((c, i) => (c === ' ' ? ' ' : sl.has(i) ? c : null)),
      tagline: sp.has('tagline') ? FEST.tagline : null,
      date: sp.has('date') ? FEST.date : null,
      place: sp.has('place') ? FEST.place : null,
      lineup: FEST.lineup.map((b, i) => (sp.has(`band:${i}`) ? b : null)),
      headliner: full ? FEST.headliner : null,
      revealed: full ? total : sp.size + sl.size,
      total, progress: { solved, required, ratio },
    };
  }

  // ---------- hjælp / chat samlet fra alle ----------
  function collect(players) {
    const helps = new Map(), chat = [];
    const sugg = [];
    for (const pl of players) {
      const pr = pl._pr;
      for (const g of Array.isArray(pr.g) ? pr.g : []) sugg.push({ rid: String(g.r), text: String(g.t || '').slice(0, 140), at: +g.at || 0, from: pl.name, avatar: pl.avatar, pid: pl.id });
      for (const m of Array.isArray(pr.ch) ? pr.ch : []) chat.push({ from: pl.name, avatar: pl.avatar, color: pl.color, pid: pl.id, text: String(m.t || '').slice(0, 200), at: +m.at || 0 });
    }
    for (const pl of players) {
      for (const h of Array.isArray(pl._pr.h) ? pl._pr.h : []) {
        const q = QS[h.post]?.[h.qi];
        if (!q) continue;
        helps.set(String(h.r), {
          rid: String(h.r), pid: pl.id, name: pl.name, avatar: pl.avatar, post: h.post, postName: POSTS[h.post].name,
          q: q.q, type: q.type, options: q.type === 'choice' ? q.options : undefined, hints: q.hints || [],
          suggestions: sugg.filter((s) => s.rid === String(h.r)).sort((a, b) => a.at - b.at), done: !!h.done, answer: String(h.ans || ''), at: +h.at || 0,
        });
      }
    }
    chat.sort((a, b) => a.at - b.at);
    return { helps, chat, sugg };
  }

  // ---------- events ----------
  function dispatch(type, data) { for (const l of listeners) l._emit(type, data); }

  function snapshot() {
    const players = allPlayers();
    const { helps, chat, sugg } = collect(players);
    const finale = !!me?.finale;
    return { players, helps, chat, sugg, poster: posterView(players, finale) };
  }

  function onChange() {
    if (!me || listeners.size === 0) return;
    const s = snapshot();
    const pub = s.players.map(({ _pr, ...p }) => p);
    dispatch('players', { players: pub });
    if (prev) {
      const prevIds = new Set(prev.players.map((p) => p.id));
      for (const p of s.players) {
        if (!prevIds.has(p.id)) { dispatch('toast', { text: `${p.avatar} ${p.name} er med i spillet` }); continue; }
        const old = prev.players.find((o) => o.id === p.id);
        for (const k of p.solved) if (!old.solved.includes(k) && p.id !== me.pid) dispatch('solved', { pid: p.id, name: p.name, avatar: p.avatar, post: k, postName: POSTS[k].name });
      }
      for (const [rid, h] of s.helps) {
        const o = prev.helps.get(rid);
        if (!o && !h.done) dispatch('help', h);
        else if (o && !o.done && h.done) dispatch('helpdone', { rid, answer: h.answer });
      }
      const seenSug = new Set(prev.sugg.map((g) => g.pid + g.at));
      for (const g of s.sugg) if (!seenSug.has(g.pid + g.at)) dispatch('suggest', { rid: g.rid, from: g.from, avatar: g.avatar, pid: g.pid, text: g.text, at: g.at });
      const seenChat = new Set(prev.chat.map((m) => m.pid + m.at));
      for (const m of s.chat) if (!seenChat.has(m.pid + m.at)) dispatch('chat', m);
      if (s.poster.revealed !== prev.poster.revealed) dispatch('poster', s.poster);
    }
    prev = s;
    checkFinale(s.players);
  }

  function checkFinale(players) {
    if (me.finale) return;
    // finalen starter, når alle i rummet står ved scenen (eller en anden allerede har startet den)
    const anyFinale = peersPresence().some((pr) => pr.f === 1) && players.find((p) => p.id === me.pid)?.atStage;
    if ((players.length && players.every((p) => p.atStage)) || anyFinale) {
      me.finale = true; push();
      const s = snapshot();
      dispatch('finale', { poster: s.poster, teaser: FEST.headlinerTeaser, message: FEST.finaleMessage, players: s.players.map((p) => p.name) });
    }
  }

  // ---------- spørgsmål ----------
  const pubQ = (q, a) => ({ q: q.q, type: q.type, options: q.type === 'choice' ? q.options : undefined, hintsTotal: q.hints?.length || 0, hints: (q.hints || []).slice(0, a.hintsUsed), wrong: a.wrong });
  const canAsk = (q, a) => a.hintsUsed >= (q.hints?.length || 0) || a.wrong >= WRONG_BEFORE_HELP;
  const canSkip = (q, a) => a.wrong >= SKIP_AFTER_WRONG && a.hintsUsed >= (q.hints?.length || 0);
  const qOut = (post, q, a) => ({ post, question: pubQ(q, a), canAskTeam: canAsk(q, a), canSkip: canSkip(q, a) });
  const stamps = () => me.solved.filter((k) => POSTS[k].kind === 'station').length;
  function assign(post) {
    if (me.assigned[post]) return me.assigned[post];
    const pool = QS[post];
    const taken = new Set(peersPresence().map((pr) => pr.p.q?.[post]).filter((v) => v !== undefined));
    const free = pool.map((_, i) => i).filter((i) => !taken.has(i));
    const ch = free.length ? free : pool.map((_, i) => i);
    me.assigned[post] = { qi: ch[Math.floor(Math.random() * ch.length)], hintsUsed: 0, wrong: 0, lastAnswer: 0 };
    push();
    return me.assigned[post];
  }
  function ansText(q, v) { return q.type === 'choice' ? (q.options[Number(v)] ?? '') : String(v ?? '').slice(0, 80); }
  function markSolved(post, shown) {
    if (me.solved.includes(post)) return;
    me.solved.push(post);
    for (const h of me.helps) if (h.post === post && !h.done) { h.done = true; h.ans = shown; }
    push();
  }

  const err = (m) => { throw new Error(m); };

  // ---------- "API" ----------
  async function api(path, body) {
    const parts = path.split('/').filter(Boolean); // api, s, CODE, action
    if (parts[1] === 'sessions') { const c = newCode(); await joinRoom(c); return { id: c, maxPlayers: MAX_PLAYERS }; }
    const c = String(parts[2] || '').toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(c)) err('Ugyldig kode');
    const action = parts[3] || '';
    await joinRoom(c);
    if (code !== c) { code = c; me = null; prev = null; }

    if (body === undefined && action === '') {
      const others = peersPresence();
      const stored = ls.get('fa:' + c);
      if (!room && !stored && others.length === 0 && !creating.has(c)) {
        // uden room kan vi ikke se andre – tillad alligevel solo
      }
      return { id: c, players: others.length, maxPlayers: MAX_PLAYERS, avatars: AVATARS, colors: COLORS, taken: others.map((pr) => ({ name: String(pr.p.n), avatar: String(pr.p.a) })) };
    }

    if (action === 'join') {
      const stored = ls.get('fa:' + c);
      if (stored && stored.pid === body.pid && stored.token === body.token) { me = stored; push(); return { pid: me.pid, token: me.token, rejoined: true }; }
      const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 16);
      if (!name) err('Skriv dit navn');
      const others = peersPresence();
      if (others.length >= MAX_PLAYERS) err(`Spillet er fuldt (maks ${MAX_PLAYERS} spillere).`);
      const counts = ROUTES.map((r) => others.filter((pr) => pr.p.r === r.id).length);
      const min = Math.min(...counts), route = ROUTES[counts.indexOf(min)];
      const off = min * 0.8;
      me = {
        pid: rid8(), token: rid8(), name, avatar: AVATARS.includes(body.avatar) ? body.avatar : AVATARS[0], color: COLORS.includes(body.color) ? body.color : COLORS[0],
        route: route.id, x: route.spawn[0] + (min % 2 ? off : -off) * 0.5, y: route.spawn[1], dir: 'down', moving: false,
        solved: [], assigned: {}, helps: [], sugg: [], chat: [], finale: false,
      };
      push();
      return { pid: me.pid, token: me.token };
    }

    if (!me) { const st = ls.get('fa:' + c); if (st && st.pid === body?.pid) me = st; }
    if (!me || me.pid !== body?.pid) err('Ukendt spiller – deltag igen.');

    const post = String(body.post || '');
    switch (action) {
      case 'move':
        me.x = +body.x; me.y = +body.y; me.dir = body.dir; me.moving = !!body.moving; push();
        return { ok: true };
      case 'post': {
        if (!POSTS[post]) err('Ukendt post');
        if (me.solved.includes(post)) return { solved: true, post };
        if (POSTS[post].final && stamps() < STAMPS_REQUIRED) return { locked: true, post, need: STAMPS_REQUIRED - stamps(), stamps: stamps() };
        const a = assign(post);
        return qOut(post, QS[post][a.qi], a);
      }
      case 'hint': {
        const a = me.assigned[post]; if (!a) err('Intet spørgsmål');
        const q = QS[post][a.qi]; a.hintsUsed = Math.min((q.hints || []).length, a.hintsUsed + 1); save();
        return qOut(post, q, a);
      }
      case 'answer': {
        const a = me.assigned[post]; if (!a) err('Intet spørgsmål');
        if (Date.now() - a.lastAnswer < ANSWER_COOLDOWN_MS) err('Vent lige et øjeblik…');
        a.lastAnswer = Date.now();
        const q = QS[post][a.qi];
        const ok = q.type === 'choice' ? Number(body.answer) === q.answer : (q.answers || []).some((x) => norm(x) === norm(body.answer));
        if (ok) { markSolved(post, ansText(q, body.answer)); return { correct: true, stamps: stamps() }; }
        a.wrong++; save();
        return { correct: false, ...qOut(post, q, a) };
      }
      case 'skip': {
        const a = me.assigned[post]; if (!a) err('Intet spørgsmål');
        const q = QS[post][a.qi]; if (!canSkip(q, a)) err('Prøv lidt mere først 🙂');
        markSolved(post, ansText(q, q.type === 'choice' ? q.answer : q.answers[0]));
        return { correct: true, skipped: true };
      }
      case 'help': {
        const a = me.assigned[post]; if (!a) err('Intet spørgsmål');
        const q = QS[post][a.qi]; if (!canAsk(q, a)) err('Brug dine hints først');
        let h = me.helps.find((x) => x.post === post && !x.done);
        if (!h) { h = { rid: rid8(), post, qi: a.qi, done: false, at: Date.now() }; me.helps.push(h); push(); }
        return { rid: h.rid };
      }
      case 'suggest': {
        const h = snapshot().helps.get(String(body.rid));
        if (!h || h.done) err('Spørgsmålet er allerede løst');
        let text = String(body.text || '').trim().slice(0, 140);
        if (body.option !== undefined && h.options) text = h.options[Number(body.option)] ?? text;
        if (!text) err('Tom besked');
        me.sugg.push({ r: h.rid, t: text, at: Date.now() }); me.sugg = me.sugg.slice(-8); push();
        return { ok: true };
      }
      case 'chat': {
        const text = String(body.text || '').trim().slice(0, 200); if (!text) err('Tom besked');
        me.chat.push({ t: text, at: Date.now() }); me.chat = me.chat.slice(-6); push();
        return { ok: true };
      }
    }
    err('Ukendt handling');
  }
  const creating = new Set();

  // ---------- EventSource-erstatning ----------
  class FakeEventSource {
    constructor(url) {
      this.readyState = 1; this.handlers = {};
      const u = new URL(url, 'http://x');
      const c = u.pathname.split('/')[3];
      listeners.add(this);
      setTimeout(async () => {
        await joinRoom(c);
        code = c;
        if (!me) { const st = ls.get('fa:' + c); if (st && st.pid === u.searchParams.get('pid')) me = st; }
        if (!me) { this.onerror?.(); return; }
        push();
        const s = snapshot();
        prev = s;
        this._emit('init', {
          me: me.pid, config: { maxPlayers: MAX_PLAYERS, stampsRequired: STAMPS_REQUIRED },
          players: s.players.map(({ _pr, ...p }) => p), poster: s.poster, chat: s.chat,
          help: [...s.helps.values()].filter((h) => !h.done),
          finale: me.finale ? { poster: s.poster, teaser: FEST.headlinerTeaser, message: FEST.finaleMessage, players: [] } : null,
        });
        if (!room) this._emit('toast', { text: 'Solo-tilstand: live-samspil er ikke tilgængeligt i denne visning' });
      }, 0);
      // hold online-status frisk
      this._iv = setInterval(() => onChange(), 3000);
    }
    addEventListener(t, fn) { (this.handlers[t] ||= []).push(fn); }
    _emit(t, data) { for (const fn of this.handlers[t] || []) { try { fn({ data: JSON.stringify(data) }); } catch (e) { console.error(e); } } }
    close() { listeners.delete(this); clearInterval(this._iv); this.readyState = 2; }
  }
  FakeEventSource.CLOSED = 2;

  return { api, FakeEventSource, hasRoom: async () => !!(await roomP) };
})();
