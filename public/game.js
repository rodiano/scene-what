import {
  TILE, MAP, W, H, POSTS, LEGEND, ROUTES, STAGE, LABELS, SOLID,
  tileAt, postAt, zoneAt, inRect, AVATARS, COLORS,
} from './world.js';

// ====================================================================
// Hjælpere
// ====================================================================
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch { /* tom */ }
  if (!res.ok) throw new Error(data.error || `Fejl (${res.status})`);
  return data;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) {
  $(id).classList.add('hidden');
  if (id === 'qModal') { G.currentPost = null; }
}
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('pointerdown', (e) => { if (e.target === m) closeModal(m.id); }));

function toast(html, ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  $('toasts').appendChild(el);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  setTimeout(() => el.remove(), ms);
  return el;
}

// Spilleridentitet gemmes pr. fane (sessionStorage): en genindlæsning fortsætter som samme
// spiller, mens en ny fane eller en anden enhed med samme kode bliver en ny spiller.
const tabStore = (() => { try { return window.sessionStorage; } catch { return null; } })();
const credsKey = (code) => `festival:${code}`;
const loadCreds = (code) => { try { return JSON.parse(tabStore.getItem(credsKey(code))); } catch { return null; } };
const saveCreds = (code, c) => { try { tabStore.setItem(credsKey(code), JSON.stringify(c)); tabStore.setItem('festival:last', code); } catch {} };

// Link der åbner spillet direkte med koden (GitHub Pages bruger #KODE, Node-serveren ?s=KODE).
// I claude.ai-artifacten findes der ikke et delbart link (window.__NO_LINK__).
function shareLink(code) {
  if (window.__NO_LINK__) return null;
  if (window.__PAGES__) return `${location.origin}${location.pathname}#${code}`;
  return `${location.origin}/?s=${code}`;
}
// QR-kode som andre i nærheden kan scanne for at komme direkte ind i spillet
function renderQr(el, code) {
  const url = shareLink(code);
  if (!el) return;
  if (!url || typeof qrcode === 'undefined') { el.hidden = true; return; }
  try {
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) + '<small>Scan for at være med</small>';
    el.hidden = false;
  } catch { el.hidden = true; }
}
async function share(code) {
  const url = shareLink(code);
  const text = `Kom med til festivalen! 🎪 Brug koden ${code}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Festivalspillet', text, url }); return; } catch { /* annulleret */ }
  }
  try { await navigator.clipboard.writeText(url); toast('🔗 Link kopieret – send det til dit hold'); }
  catch { prompt('Kopiér linket:', url); }
}

// ====================================================================
// Global tilstand
// ====================================================================
const G = {
  code: null, pid: null, token: null,
  me: null,                 // min spiller (lokal position)
  players: new Map(),       // id -> spiller fra server (+ rx/ry til glat bevægelse)
  config: { stampsRequired: 3, maxPlayers: 6 },
  poster: null,
  helps: new Map(),         // rid -> hjælpeanmodning
  chat: [],
  unreadChat: 0,
  finale: null,
  currentPost: null,        // post der vises i spørgsmålsvinduet
  myHelpRid: {},            // post -> rid
  explored: new Uint8Array(W * H),
  es: null,
};
const mySolved = () => new Set(G.players.get(G.pid)?.solved || []);

// ====================================================================
// Lobby
// ====================================================================
const params = new URLSearchParams(location.search);
const urlCode = (params.get('s') || location.pathname.split('/s/')[1] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
if (urlCode) $('codeInput').value = urlCode;
// Kommer man fra et delt link eller en QR-kode, går man direkte til karaktervalg
if (urlCode && !loadCreds(urlCode)) {
  $('lobbyError').textContent = '⏳ Forbinder til spillet…';
  gotoCharacter(urlCode).catch((e) => { showScreen('lobby'); $('lobbyError').textContent = e.message; });
}

(function checkResume() {
  const code = urlCode || (() => { try { return tabStore.getItem('festival:last'); } catch { return null; } })();
  if (!code) return;
  const c = loadCreds(code);
  if (!c) return;
  api(`/api/s/${code}`).then(() => {
    $('resumeBox').classList.remove('hidden');
    $('resumeCode').textContent = code;
    $('resumeBtn').onclick = () => startGame(code, c);
  }).catch(() => {});
})();

$('createBtn').onclick = async () => {
  $('lobbyError').textContent = '';
  try {
    const { id } = await api('/api/sessions', {});
    history.replaceState(null, '', `/?s=${id}`);
    await gotoCharacter(id);
  } catch (e) { $('lobbyError').textContent = e.message; }
};

$('joinForm').onsubmit = async (e) => {
  e.preventDefault();
  $('lobbyError').textContent = '';
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length < 4) { $('lobbyError').textContent = 'Skriv koden fra din medspiller'; return; }
  $('lobbyError').textContent = '⏳ Forbinder til spillet…';
  try {
    const c = loadCreds(code);
    if (c) {
      await api(`/api/s/${code}`);
      history.replaceState(null, '', `/?s=${code}`);
      return startGame(code, c);
    }
    history.replaceState(null, '', `/?s=${code}`);
    await gotoCharacter(code);
  } catch (err) { $('lobbyError').textContent = err.message; }
};

// ====================================================================
// Karaktervalg
// ====================================================================
async function gotoCharacter(code) {
  const info = await api(`/api/s/${code}`);
  $('lobbyError').textContent = '';
  G.code = code;
  $('charCode').textContent = code;
  $('charShare').onclick = () => share(code);
  renderQr($('charQr'), code);
  if (info.players >= info.maxPlayers) throw new Error(`Spillet er fuldt (maks ${info.maxPlayers} spillere).`);
  $('charInfo').textContent = info.players === 0
    ? `Du er den første! Del koden, så op til ${info.maxPlayers - 1} andre kan spille med.`
    : `${info.players} af ${info.maxPlayers} spillere er allerede med: ${info.taken.map((t) => t.avatar + ' ' + t.name).join(', ')}`;

  const takenAv = new Set(info.taken.map((t) => t.avatar));
  let avatar = AVATARS.find((a) => !takenAv.has(a)) || AVATARS[0];
  let color = COLORS[info.players % COLORS.length];

  const render = () => {
    $('avatarGrid').innerHTML = AVATARS.map((a) => `<button type="button" class="${a === avatar ? 'sel' : ''} ${takenAv.has(a) ? 'taken' : ''}" data-a="${a}">${a}</button>`).join('');
    $('colorGrid').innerHTML = COLORS.map((c) => `<button type="button" class="${c === color ? 'sel' : ''}" data-c="${c}" style="background:${c}"></button>`).join('');
    $('preview').textContent = avatar;
    $('preview').style.borderColor = color;
  };
  $('avatarGrid').onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) { avatar = b.dataset.a; render(); } };
  $('colorGrid').onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) { color = b.dataset.c; render(); } };
  render();
  try { $('nameInput').value = localStorage.getItem('festival:name') || ''; } catch {}
  showScreen('character');

  $('joinBtn').onclick = async () => {
    $('charError').textContent = '';
    const name = $('nameInput').value.trim();
    if (!name) { $('charError').textContent = 'Skriv dit navn først'; $('nameInput').focus(); return; }
    try {
      localStorage.setItem('festival:name', name);
    } catch {}
    try {
      const r = await api(`/api/s/${code}/join`, { name, avatar, color });
      saveCreds(code, { pid: r.pid, token: r.token });
      startGame(code, { pid: r.pid, token: r.token });
    } catch (e) { $('charError').textContent = e.message; }
  };
}

// ====================================================================
// Start spil + forbindelse
// ====================================================================
function startGame(code, creds) {
  G.code = code; G.pid = creds.pid; G.token = creds.token;
  $('hudCode').textContent = code;
  $('teamCode').textContent = code;
  loadExplored();
  showScreen('game');
  resize();
  connect();
  requestAnimationFrame(loop);
  setTimeout(() => { $('controlsHint').style.opacity = '0'; }, 9000);
}

function connect() {
  if (G.es) G.es.close();
  const es = new EventSource(`/api/s/${G.code}/events?pid=${G.pid}&token=${G.token}`);
  G.es = es;
  es.addEventListener('init', (e) => {
    const d = JSON.parse(e.data);
    G.config = d.config;
    // har man allerede trykket på siden, må musikken starte med det samme
    setTimeout(() => { try { if (navigator.userActivation?.hasBeenActive) unlockMusic(); } catch {} }, 0); // efter finale-tjekket herunder
    setPlayers(d.players, true);
    G.poster = d.poster;
    G.chat = d.chat;
    G.helps = new Map(d.help.map((h) => [h.rid, h]));
    for (const h of d.help) if (h.pid === G.pid) G.myHelpRid[h.post] = h.rid;
    renderChat(); renderHelps(); renderPoster(); updateHud();
    if (d.finale && !G.finale) {
      // Finalen er allerede i gang (fx genindlæst side): vis showet, hvis denne fane ikke har set det
      G.finale = d.finale;
      let seen = false;
      try { seen = tabStore.getItem(`festival:povseen:${G.code}`) === '1'; } catch {}
      if (!seen) startFinale(d.finale);
    }
  });
  es.addEventListener('players', (e) => { setPlayers(JSON.parse(e.data).players, false); });
  es.addEventListener('poster', (e) => { G.poster = JSON.parse(e.data); renderPoster(); updateHud(); });
  es.addEventListener('toast', (e) => { const d = JSON.parse(e.data); toast(esc(d.text)); });
  es.addEventListener('solved', (e) => {
    const d = JSON.parse(e.data);
    if (d.pid !== G.pid) toast(`🎉 ${esc(d.avatar)} ${esc(d.name)} klarede ${esc(d.postName)}`);
    const p = G.players.get(d.pid);
    if (p && !p.solved.includes(d.post)) p.solved.push(d.post);
    updateHud();
  });
  es.addEventListener('chat', (e) => {
    const m = JSON.parse(e.data);
    G.chat.push(m);
    if ($('chatModal').classList.contains('hidden') && m.pid !== G.pid) {
      G.unreadChat++;
      toast(`💬 <b>${esc(m.avatar)} ${esc(m.from)}:</b> ${esc(m.text)}`);
    }
    renderChat(); updateHud();
  });
  es.addEventListener('help', (e) => {
    const h = JSON.parse(e.data);
    G.helps.set(h.rid, h);
    if (h.pid !== G.pid) {
      const t = toast(`🆘 <b>${esc(h.avatar)} ${esc(h.name)}</b> har brug for hjælp ved ${esc(h.postName)} <button class="btn small primary">Hjælp</button>`, 9000);
      t.querySelector('button').onclick = () => { t.remove(); openModal('helpModal'); };
      beep(660, 0.12);
    }
    renderHelps(); updateHud();
  });
  es.addEventListener('suggest', (e) => {
    const d = JSON.parse(e.data);
    const h = G.helps.get(d.rid);
    if (h) { h.suggestions.push(d); }
    if (h && h.pid === G.pid && d.pid !== G.pid) {
      toast(`💡 ${esc(d.avatar)} ${esc(d.from)} foreslår: <b>${esc(d.text)}</b>`, 6000);
      beep(880, 0.1);
    }
    renderHelps();
    if (G.currentPost && h && h.post === G.currentPost && h.pid === G.pid) renderSuggestions();
  });
  es.addEventListener('helpdone', (e) => {
    const d = JSON.parse(e.data);
    const h = G.helps.get(d.rid);
    if (h) { h.done = true; h.answer = d.answer; if (h.pid !== G.pid) toast(`✅ ${esc(h.name)} kom forbi ${esc(h.postName)} – tak for hjælpen!`); }
    renderHelps(); updateHud();
  });
  es.addEventListener('finale', (e) => {
    const d = JSON.parse(e.data);
    G.finale = d;
    G.poster = d.poster;
    renderPoster();
    startFinale(d);
  });
  es.onerror = () => {
    // EventSource genforbinder selv. Hvis serveren ikke kender os længere, gå tilbage til lobby.
    setTimeout(async () => {
      if (es.readyState === EventSource.CLOSED) {
        try { await api(`/api/s/${G.code}`); connect(); }
        catch { toast('Forbindelsen til spillet blev afbrudt'); }
      }
    }, 3000);
  };
}

function setPlayers(list, isInit) {
  const seen = new Set();
  for (const sp of list) {
    seen.add(sp.id);
    const ex = G.players.get(sp.id);
    if (sp.id === G.pid) {
      if (!G.me || isInit) {
        G.me = { x: sp.x, y: sp.y, dir: sp.dir, moving: false };
        revealAround(G.me.x, G.me.y);
      }
      G.players.set(sp.id, { ...sp, rx: G.me.x, ry: G.me.y });
    } else {
      G.players.set(sp.id, { ...sp, rx: ex ? ex.rx : sp.x, ry: ex ? ex.ry : sp.y });
    }
  }
  for (const id of [...G.players.keys()]) if (!seen.has(id)) G.players.delete(id);
  updateHud();
  if (!$('teamModal').classList.contains('hidden')) renderTeam();
}

// ====================================================================
// HUD
// ====================================================================
function stationIds() { return Object.keys(POSTS).filter((k) => POSTS[k].kind === 'station'); }

function updateHud() {
  const solved = mySolved();
  const stamps = stationIds().filter((k) => solved.has(k));
  const need = G.config.stampsRequired;
  $('stampBar').innerHTML = `🎟️ ${Math.min(stamps.length, need)}/${need} ` +
    stationIds().map((k) => `<span class="st ${solved.has(k) ? 'got' : ''}" title="${esc(POSTS[k].name)}">${POSTS[k].emoji}</span>`).join('');
  $('teamCount').textContent = G.players.size;
  if (G.poster) $('posterCount').textContent = `${G.poster.revealed}/${G.poster.total}`;
  const openHelps = [...G.helps.values()].filter((h) => !h.done && h.pid !== G.pid);
  $('helpBtn').classList.toggle('hidden', openHelps.length === 0);
  $('helpCount').textContent = openHelps.length;
  $('chatBadge').textContent = G.unreadChat;
  $('chatBadge').classList.toggle('hidden', G.unreadChat === 0);

  // Mål / objective
  const me = G.players.get(G.pid);
  let obj = '';
  if (!me) obj = '';
  else if (G.finale) obj = '🎶 Koncerten er i gang!';
  else if (solved.has('finale')) obj = '🎤 Gå helt op foran scenen!';
  else {
    const route = ROUTES.find((r) => r.id === me.route);
    const routeGates = Object.keys(POSTS).filter((k) => POSTS[k].route === me.route);
    const left = routeGates.filter((k) => !solved.has(k));
    if (left.length) obj = `🚶 Find vej ind på festivalen – ${POSTS[left[0]].emoji} ${POSTS[left[0]].name} venter`;
    else if (stamps.length < need) obj = `🎡 Saml ${need - stamps.length} ${need - stamps.length > 1 ? 'stempler' : 'stempel'} mere fra standene på festivalpladsen`;
    else obj = '🎟️ Du har stemplerne! Find Scenevagten ved det store hegn mod nord';
    if (!route) obj = '';
  }
  $('objective').textContent = obj;
  updateStageBanner();
}

function updateStageBanner() {
  const me = G.players.get(G.pid);
  const el = $('stageBanner');
  if (!me || G.finale || !G.me || !(mySolved().has('finale') && inRect(STAGE.crowd, G.me.x, G.me.y))) {
    el.classList.add('hidden');
    return;
  }
  const waiting = [...G.players.values()].filter((p) => p.online && !p.atStage && p.id !== G.pid);
  el.classList.remove('hidden');
  if (waiting.length === 0) el.innerHTML = '🎶 Alle er her… lyset dæmpes…';
  else el.innerHTML = `🎶 Du er ved scenen! Koncerten starter, når hele holdet er her.<br>Venter på: ${waiting.map((p) => `${esc(p.avatar)} ${esc(p.name)} <small>(${esc(zoneAt(p.x, p.y))})</small>`).join(', ')}<br><small>Tjek 🆘 og 💬 – måske kan du hjælpe dem!</small>`;
}

$('codeChip').onclick = () => { renderTeam(); renderQr($('teamQr'), G.code); openModal('teamModal'); };
$('teamShare').onclick = () => share(G.code);
$('posterBtn').onclick = () => { renderPoster(); openModal('posterModal'); };
$('teamBtn').onclick = () => { renderTeam(); renderQr($('teamQr'), G.code); openModal('teamModal'); };
$('helpBtn').onclick = () => { renderHelps(); openModal('helpModal'); };
$('chatBtn').onclick = () => {
  G.unreadChat = 0; updateHud(); renderChat(); openModal('chatModal');
  setTimeout(() => $('chatInput').focus(), 50);
};

// ====================================================================
// Hold, chat, plakat
// ====================================================================
function renderTeam() {
  const need = G.config.stampsRequired;
  $('teamList').innerHTML = [...G.players.values()].map((p) => {
    const stamps = p.solved.filter((k) => POSTS[k]?.kind === 'station').length;
    const status = p.atStage ? '🎤 Ved hovedscenen' : `📍 ${zoneAt(p.x, p.y)}`;
    return `<div class="member">
      <div class="av" style="border-color:${esc(p.color)}">${esc(p.avatar)}</div>
      <div class="info"><b>${esc(p.name)}${p.id === G.pid ? ' (dig)' : ''}</b>
        <small>${esc(status)} · 🎟️ ${Math.min(stamps, need)}/${need}</small></div>
      <div class="dot ${p.online ? 'on' : ''}" title="${p.online ? 'Online' : 'Offline'}"></div>
    </div>`;
  }).join('');
}

function renderChat() {
  $('chatList').innerHTML = G.chat.map((m) => `<div class="msg ${m.pid === G.pid ? 'me' : ''}">
    <div class="who" style="color:${esc(m.color || '#555')}">${esc(m.avatar)} ${esc(m.from)}</div>
    <div class="txt">${esc(m.text)}</div></div>`).join('') || '<p class="muted">Ingen beskeder endnu. Sig hej til holdet! 👋</p>';
  $('chatList').scrollTop = 1e9;
}
$('chatForm').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (!text) return;
  $('chatInput').value = '';
  try { await api(`/api/s/${G.code}/chat`, auth({ text })); } catch (err) { toast(esc(err.message)); }
};

function posterHtml(p, big = false) {
  if (!p) return '';
  // et kunstnernavn som bogstaver; null = endnu ikke afsløret
  const band = (chars) => chars.map((c) => (c === null ? '<span class="hl">_</span>' : c === ' ' ? '<span class="sp"></span>' : `<span class="sl">${esc(c)}</span>`)).join('');
  const lineup = `<div class="lineup">${p.lineup.map((ch) => `<div>${band(ch)}</div>`).join('')}</div>`;
  if (!p.final) {
    const pct = Math.round((p.progress?.ratio || 0) * 100);
    return `<div class="poster locked">
      <div class="lock-title">🔒 ? ? ?</div>
      <div class="lock-sub">Festivalens navn, dato og sted afsløres først, når hele holdet står samlet foran scenen.</div>
      <div class="headliner-box">🔒 HEMMELIGT HOVEDNAVN</div>
      <div class="lineup-label">Kunstnerne – afsløres bogstav for bogstav</div>
      ${lineup}
      ${big ? '' : `<div class="poster-progress"><div class="bar"><div style="width:${pct}%"></div></div>
      <p>Holdet har afsløret ${p.revealed} af ${p.total} bogstaver. Hver post, nogen på holdet klarer, afslører flere.</p></div>`}
    </div>`;
  }
  const size = Math.max(20, Math.min(40, Math.floor(560 / Math.max(8, (p.name || '').length))));
  return `<div class="poster">
    <div style="font-size:14px;opacity:.8">✨ VELKOMMEN TIL ✨</div>
    <div class="pname" style="font-size:${size}px">${esc(p.name)}</div>
    <div class="tagline">${esc(p.tagline || '')}</div>
    <div class="meta"><span>📅 ${esc(p.date || '')}</span><span>📍 ${esc(p.place || '')}</span></div>
    <div class="headliner-box revealed">⭐ ${esc(p.headliner || '')} ⭐</div>
    ${lineup}
  </div>`;
}
let lastRevealed = -1;
function renderPoster() {
  if (!G.poster) return;
  $('poster').innerHTML = posterHtml(G.poster);
  if (lastRevealed >= 0 && G.poster.revealed > lastRevealed && !G.finale) {
    toast(`🎤 Nye bogstaver i kunstnernes navne! <button class="btn small">Se plakaten</button>`, 4500)
      .querySelector('button').onclick = () => openModal('posterModal');
  }
  lastRevealed = G.poster.revealed;
  updateHud();
}

// ====================================================================
// Hjælp til medspillere
// ====================================================================
function renderHelps() {
  const list = [...G.helps.values()].filter((h) => h.pid !== G.pid).sort((a, b) => a.done - b.done || b.at - a.at);
  if (list.length === 0) { $('helpList').innerHTML = '<p class="muted">Ingen har brug for hjælp lige nu. 👍</p>'; return; }
  $('helpList').innerHTML = list.map((h) => `<div class="help-item ${h.done ? 'done' : ''}" data-rid="${h.rid}">
    <h4>${esc(h.avatar)} ${esc(h.name)} ved ${esc(h.postName)} ${h.done ? '✅' : ''}</h4>
    <p class="qtext">${esc(h.q)}</p>
    ${h.hints?.length ? `<ul class="hints">${h.hints.map((x) => `<li>💡 ${esc(x)}</li>`).join('')}</ul>` : ''}
    ${h.done ? `<p class="feedback good">Løst! Svaret var: ${esc(h.answer || '')}</p>` : `
      ${h.options ? `<div class="options">${h.options.map((o, i) => `<button class="btn" data-opt="${i}">Foreslå: ${esc(o)}</button>`).join('')}</div>` : ''}
      <form class="row suggest-form"><input placeholder="${h.options ? 'Eller skriv en besked…' : 'Skriv dit forslag…'}" maxlength="140" /><button class="btn primary">Send</button></form>`}
    ${h.suggestions.length ? `<div class="suggestions">${h.suggestions.map((s) => `<div class="s">${esc(s.avatar)} <b>${esc(s.from)}:</b> ${esc(s.text)}</div>`).join('')}</div>` : ''}
  </div>`).join('');
  $('helpList').querySelectorAll('.help-item').forEach((el) => {
    const rid = el.dataset.rid;
    el.querySelectorAll('[data-opt]').forEach((b) => b.onclick = () => suggest(rid, { option: Number(b.dataset.opt) }));
    const f = el.querySelector('.suggest-form');
    if (f) f.onsubmit = (e) => { e.preventDefault(); const v = f.querySelector('input').value.trim(); if (v) suggest(rid, { text: v }); };
  });
}
async function suggest(rid, payload) {
  try { await api(`/api/s/${G.code}/suggest`, auth({ rid, ...payload })); toast('📨 Forslag sendt'); }
  catch (e) { toast(esc(e.message)); }
}

// ====================================================================
// Poster / spørgsmål
// ====================================================================
const auth = (o) => ({ pid: G.pid, token: G.token, ...o });
let qState = null; // { post, question, canAskTeam, canSkip, wrongOptions:Set }

async function openPost(postId) {
  if (G.currentPost || G.finale) return;
  const post = POSTS[postId];
  G.currentPost = postId;
  try {
    const r = await api(`/api/s/${G.code}/post`, auth({ post: postId }));
    $('qEmoji').textContent = post.emoji;
    $('qTitle').textContent = post.name;
    if (r.solved) {
      G.currentPost = null;
      toast(post.kind === 'station' ? `✅ Du har allerede et stempel fra ${esc(post.name)}` : '✅ Her er du allerede kommet igennem');
      return;
    }
    if (r.locked) {
      $('qBody').innerHTML = `<p class="qtext">🛑 "Stop! Kun festivalgæster med mindst ${G.config.stampsRequired} stempler fra festivalpladsens stande må komme forbi."</p>
        <p>Du har ${r.stamps} ${r.stamps === 1 ? 'stempel' : 'stempler'} – du mangler <b>${r.need}</b>.</p>
        <div class="note">Gå rundt til standene på festivalpladsen (${stationIds().map((k) => POSTS[k].emoji).join(' ')}) og svar på deres spørgsmål.</div>`;
      openModal('qModal');
      return;
    }
    qState = { post: postId, question: r.question, canAskTeam: r.canAskTeam, canSkip: r.canSkip, wrongOptions: new Set() };
    renderQuestion();
    openModal('qModal');
  } catch (e) {
    G.currentPost = null;
    toast(esc(e.message));
  }
}

function renderQuestion(feedback = '', fbClass = '') {
  const q = qState.question;
  const post = POSTS[qState.post];
  const intro = post.kind === 'gate'
    ? (post.final ? '🎟️ "Vil du ind til den store scene? Så skal du lige svare på det her…"' : '🛑 "Hov, hov! Du skal svare rigtigt for at komme forbi."')
    : '🎪 "Svar rigtigt og få et stempel i dit festivalpas!"';
  const rid = G.myHelpRid[qState.post];
  const asked = rid && G.helps.get(rid) && !G.helps.get(rid).done;
  const others = [...G.players.values()].filter((p) => p.id !== G.pid && p.online).length;
  const hintsLeft = q.hintsTotal - q.hints.length;

  $('qBody').innerHTML = `
    <p class="muted">${intro}</p>
    <p class="qtext">${esc(q.q)}</p>
    ${q.type === 'choice'
      ? `<div class="options">${q.options.map((o, i) => `<button class="btn ${qState.wrongOptions.has(i) ? 'wrong' : ''}" data-i="${i}" ${qState.wrongOptions.has(i) ? 'disabled' : ''}>${String.fromCharCode(65 + i)}. ${esc(o)}${suggestTag(o)}</button>`).join('')}</div>`
      : `<form id="textAnswer" class="row" style="margin-bottom:12px"><input id="answerInput" placeholder="Dit svar" autocomplete="off" /><button class="btn primary">Svar</button></form>`}
    <div class="feedback ${fbClass}">${feedback}</div>
    ${q.hints.length ? `<ul class="hints">${q.hints.map((h) => `<li>💡 ${esc(h)}</li>`).join('')}</ul>` : ''}
    <div class="helpers">
      <button id="hintBtn" class="btn" ${hintsLeft <= 0 ? 'disabled' : ''}>💡 Hint ${hintsLeft > 0 ? `(${hintsLeft} tilbage)` : '(ingen flere)'}</button>
      <button id="askBtn" class="btn" ${!qState.canAskTeam || asked || others === 0 ? 'disabled' : ''}>
        ${asked ? '📨 Spurgt – venter på svar' : others === 0 ? '🆘 Ingen andre online' : qState.canAskTeam ? '🆘 Spørg holdet' : '🆘 Spørg holdet (brug hints først)'}
      </button>
    </div>
    ${qState.canSkip ? `<div class="note">Vagten kan se, du har kæmpet. <button id="skipBtn" class="btn small">Lad mig komme videre</button></div>` : ''}
    <div id="suggestBox" class="suggestions"></div>`;

  $('qBody').querySelectorAll('[data-i]').forEach((b) => b.onclick = () => answer(Number(b.dataset.i)));
  const f = $('textAnswer');
  if (f) {
    f.onsubmit = (e) => { e.preventDefault(); const v = $('answerInput').value.trim(); if (v) answer(v); };
    if (!matchMedia('(hover: none)').matches) setTimeout(() => $('answerInput')?.focus(), 50);
  }
  $('hintBtn').onclick = getHint;
  $('askBtn').onclick = askTeam;
  if ($('skipBtn')) $('skipBtn').onclick = skip;
  renderSuggestions();
}

function suggestTag(option) {
  const rid = G.myHelpRid[qState?.post];
  const h = rid && G.helps.get(rid);
  if (!h) return '';
  const n = h.suggestions.filter((s) => s.text === option).length;
  return n ? `<span class="tag">👥 ${n}</span>` : '';
}

function renderSuggestions() {
  const box = $('suggestBox');
  if (!box || !qState) return;
  const rid = G.myHelpRid[qState.post];
  const h = rid && G.helps.get(rid);
  if (!h) { box.innerHTML = ''; return; }
  box.innerHTML = h.suggestions.length
    ? '<b>Forslag fra holdet:</b>' + h.suggestions.map((s) => `<div class="s">${esc(s.avatar)} <b>${esc(s.from)}:</b> ${esc(s.text)}</div>`).join('')
    : '<div class="note">📨 Dit spørgsmål er sendt til holdet. Deres forslag dukker op her.</div>';
  if (qState.question.type === 'choice') {
    // opdater 👥-mærker på svarmulighederne
    $('qBody').querySelectorAll('[data-i]').forEach((b) => {
      const i = Number(b.dataset.i);
      b.innerHTML = `${String.fromCharCode(65 + i)}. ${esc(qState.question.options[i])}${suggestTag(qState.question.options[i])}`;
    });
  }
}

async function answer(value) {
  const post = qState.post;
  try {
    const r = await api(`/api/s/${G.code}/answer`, auth({ post, answer: value }));
    if (r.correct) {
      const me = G.players.get(G.pid);
      if (me && !me.solved.includes(post)) me.solved.push(post);
      const p = POSTS[post];
      $('qBody').innerHTML = `<div class="success"><div class="big-emoji">${p.kind === 'station' ? '🎟️' : '🎉'}</div>
        <h3>Rigtigt!</h3><p>${p.kind === 'station' ? `Du fik et stempel fra ${esc(p.name)}.` : p.final ? 'Vagten løfter båndet… Gå ind og find en plads foran scenen!' : 'Bommen går op – du kan gå videre.'}</p>
        <button class="btn primary big" id="contBtn">Videre ▶</button></div>`;
      $('contBtn').onclick = () => closeModal('qModal');
      chime();
      updateHud();
      if (p.final) burst(G.me.x, G.me.y - 1, 60);
      return;
    }
    qState.question = r.question;
    qState.canAskTeam = r.canAskTeam;
    qState.canSkip = r.canSkip;
    if (typeof value === 'number') qState.wrongOptions.add(value);
    renderQuestion('❌ Det var ikke rigtigt – prøv igen!', 'bad');
    beep(200, 0.15);
  } catch (e) {
    renderQuestion(esc(e.message), 'bad');
  }
}

async function getHint() {
  try {
    const r = await api(`/api/s/${G.code}/hint`, auth({ post: qState.post }));
    qState.question = r.question; qState.canAskTeam = r.canAskTeam; qState.canSkip = r.canSkip;
    renderQuestion();
  } catch (e) { toast(esc(e.message)); }
}

async function askTeam() {
  try {
    const r = await api(`/api/s/${G.code}/help`, auth({ post: qState.post }));
    G.myHelpRid[qState.post] = r.rid;
    renderQuestion('📨 Spørgsmålet er sendt til holdet!', 'good');
  } catch (e) { toast(esc(e.message)); }
}

async function skip() {
  try {
    const r = await api(`/api/s/${G.code}/skip`, auth({ post: qState.post }));
    if (r.correct) {
      const me = G.players.get(G.pid);
      if (me && !me.solved.includes(qState.post)) me.solved.push(qState.post);
      closeModal('qModal');
      toast('🙂 Vagten blinker og lader dig gå videre');
      updateHud();
    }
  } catch (e) { toast(esc(e.message)); }
}

// ====================================================================
// Input: tastatur, joystick, tryk
// ====================================================================
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { document.querySelectorAll('.modal:not(.hidden)').forEach((m) => closeModal(m.id)); return; }
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) { keys.add(k); e.preventDefault(); }
  if ((k === 'e' || k === ' ' || k === 'enter') && !anyModalOpen()) { interactNearest(); e.preventDefault(); }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
const anyModalOpen = () => !!document.querySelector('.modal:not(.hidden)') || !$('pov').classList.contains('hidden');

const joy = { id: null, sx: 0, sy: 0, dx: 0, dy: 0, active: false, t: 0 };
const canvas = $('canvas');
canvas.addEventListener('pointerdown', (e) => {
  if (joy.id !== null) return;
  joy.id = e.pointerId; joy.sx = e.clientX; joy.sy = e.clientY; joy.dx = joy.dy = 0; joy.active = false; joy.t = performance.now();
  canvas.setPointerCapture(e.pointerId);
  initAudio();
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== joy.id) return;
  const dx = e.clientX - joy.sx, dy = e.clientY - joy.sy;
  const d = Math.hypot(dx, dy);
  if (!joy.active && d > 12) {
    joy.active = true;
    $('joystick').classList.remove('hidden');
    $('joystick').style.left = joy.sx + 'px';
    $('joystick').style.top = joy.sy + 'px';
  }
  if (joy.active) {
    const max = 50, k = Math.min(1, max / Math.max(d, 1));
    joy.dx = (dx * k) / max; joy.dy = (dy * k) / max;
    $('knob').style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }
});
const endJoy = (e) => {
  if (e.pointerId !== joy.id) return;
  if (!joy.active && performance.now() - joy.t < 400) handleTap(e.clientX, e.clientY);
  joy.id = null; joy.active = false; joy.dx = joy.dy = 0;
  $('joystick').classList.add('hidden');
  $('knob').style.transform = '';
};
canvas.addEventListener('pointerup', endJoy);
canvas.addEventListener('pointercancel', endJoy);

function screenToWorld(cx, cy) {
  return { x: (cx - view.w / 2) / view.scale / TILE + cam.x, y: (cy - view.h / 2) / view.scale / TILE + cam.y };
}
function handleTap(cx, cy) {
  const w = screenToWorld(cx, cy);
  const tx = Math.floor(w.x), ty = Math.floor(w.y);
  const post = interactivePostAt(tx, ty);
  if (!post) return;
  const d = Math.hypot(tx + 0.5 - G.me.x, ty + 0.5 - G.me.y);
  if (d < 2.6) openPost(post);
  else toast(`${POSTS[post].emoji} Gå tættere på ${esc(POSTS[post].name)}`, 1800);
}
function interactivePostAt(tx, ty) {
  const post = postAt(tx, ty);
  if (!post) return null;
  if (POSTS[post].kind === 'gate' && mySolved().has(post)) return null;
  return post;
}
function nearestPost(maxD = 1.9) {
  if (!G.me) return null;
  let best = null, bd = maxD;
  for (let y = Math.floor(G.me.y) - 2; y <= Math.floor(G.me.y) + 2; y++)
    for (let x = Math.floor(G.me.x) - 2; x <= Math.floor(G.me.x) + 2; x++) {
      const p = interactivePostAt(x, y);
      if (!p) continue;
      const d = Math.hypot(x + 0.5 - G.me.x, y + 0.5 - G.me.y);
      if (d < bd) { bd = d; best = p; }
    }
  return best;
}
function interactNearest() { const p = nearestPost(); if (p) openPost(p); }
$('actionBtn').onclick = interactNearest;

// ====================================================================
// Bevægelse og kollision
// ====================================================================
const SPEED = 4.2; // felter pr. sekund
const R = 0.3;
function solidTile(tx, ty) {
  const c = tileAt(tx, ty);
  if (SOLID.has(c)) return true;
  const post = LEGEND[c];
  if (post) return POSTS[post].kind === 'station' || !mySolved().has(post);
  return false;
}
function hit(x, y) {
  for (const [cx, cy] of [[x - R, y - R], [x + R, y - R], [x - R, y + R], [x + R, y + R]]) {
    const tx = Math.floor(cx), ty = Math.floor(cy);
    if (solidTile(tx, ty)) return { post: postAt(tx, ty) };
  }
  return null;
}
let bump = { post: null, t: 0 };
function onBump(post) {
  if (!post) return;
  const t = performance.now();
  if (bump.post === post && t - bump.t < 600) { bump.t = t; return; }
  bump = { post, t };
  if (!anyModalOpen()) {
    if (POSTS[post].kind === 'gate' && mySolved().has(post)) return;
    openPost(post);
  }
}

function update(dt) {
  if (!G.me) return;
  let vx = 0, vy = 0;
  if (!anyModalOpen()) {
    if (keys.has('arrowleft') || keys.has('a')) vx -= 1;
    if (keys.has('arrowright') || keys.has('d')) vx += 1;
    if (keys.has('arrowup') || keys.has('w')) vy -= 1;
    if (keys.has('arrowdown') || keys.has('s')) vy += 1;
    if (joy.active) { vx += joy.dx; vy += joy.dy; }
  }
  const len = Math.hypot(vx, vy);
  if (len > 1) { vx /= len; vy /= len; }
  const moving = len > 0.15;
  const me = G.me;
  if (moving) {
    const nx = me.x + vx * SPEED * dt;
    const hx = hit(nx, me.y);
    if (!hx) me.x = nx; else if (Math.abs(vx) > 0.3) onBump(hx.post);
    const ny = me.y + vy * SPEED * dt;
    const hy = hit(me.x, ny);
    if (!hy) me.y = ny; else if (Math.abs(vy) > 0.3) onBump(hy.post);
    me.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : (vy < 0 ? 'up' : 'down');
    revealAround(me.x, me.y);
  }
  me.moving = moving;
  const mp = G.players.get(G.pid);
  if (mp) { mp.rx = me.x; mp.ry = me.y; mp.x = me.x; mp.y = me.y; }

  // glat bevægelse for medspillere
  for (const p of G.players.values()) {
    if (p.id === G.pid) continue;
    const k = Math.min(1, dt * 10);
    p.rx += (p.x - p.rx) * k; p.ry += (p.y - p.ry) * k;
  }

  // vis handlingsknap når man står ved en post
  const near = nearestPost();
  $('actionBtn').classList.toggle('hidden', !near || anyModalOpen());
  if (near) $('actionBtn').textContent = POSTS[near].emoji;

  sendMove();
  stageCheck();
  spatialAudio();
}

let lastSent = { x: 0, y: 0, moving: false, t: 0 }, sending = false;
async function sendMove() {
  const me = G.me, t = performance.now();
  if (sending || t - lastSent.t < 100) return;
  const changed = Math.abs(me.x - lastSent.x) > 0.02 || Math.abs(me.y - lastSent.y) > 0.02 || me.moving !== lastSent.moving;
  if (!changed && t - lastSent.t < 5000) return; // hjerteslag hvert 5. sek.
  sending = true;
  lastSent = { x: me.x, y: me.y, moving: me.moving, t };
  try { await api(`/api/s/${G.code}/move`, auth({ x: me.x, y: me.y, dir: me.dir, moving: me.moving })); }
  catch { /* ignorer */ }
  sending = false;
}

let wasAtStage = false;
function stageCheck() {
  const at = mySolved().has('finale') && inRect(STAGE.crowd, G.me.x, G.me.y);
  if (at !== wasAtStage) { wasAtStage = at; updateStageBanner(); }
  if (at && !G.finale && Math.random() < 0.02) updateStageBanner();
}

// ====================================================================
// Tåge (udforskede områder huskes pr. spil)
// ====================================================================
const exploredKey = () => `festival:fog:${G.code}:${G.pid}`;
function loadExplored() {
  try {
    const s = tabStore.getItem(exploredKey());
    if (s) for (let i = 0; i < s.length && i < G.explored.length; i++) G.explored[i] = s.charCodeAt(i) === 49 ? 1 : 0;
  } catch {}
}
let fogDirty = false;
function revealAround(x, y) {
  const r = 4.5;
  for (let ty = Math.floor(y - r); ty <= Math.ceil(y + r); ty++)
    for (let tx = Math.floor(x - r); tx <= Math.ceil(x + r); tx++) {
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) <= r && !G.explored[ty * W + tx]) { G.explored[ty * W + tx] = 1; fogDirty = true; }
    }
}
setInterval(() => {
  if (!fogDirty || !G.code) return;
  fogDirty = false;
  try { tabStore.setItem(exploredKey(), Array.from(G.explored, (v) => (v ? '1' : '0')).join('')); } catch {}
}, 2000);

// ====================================================================
// Tegning
// ====================================================================
const ctx = canvas.getContext('2d');
const view = { w: 0, h: 0, dpr: 1, scale: 1 };
const cam = { x: 0, y: 0 };
function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = innerWidth; view.h = innerHeight;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  // Vis ca. 11-13 felter på den korteste led
  view.scale = Math.max(0.9, Math.min(2.4, Math.min(view.w, view.h) / (TILE * 11)));
}
addEventListener('resize', resize);

const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const GRASS = ['#5da545', '#62ab4a', '#58a042'];

function drawGround(c, x, y, px, py) {
  const s = TILE;
  if (c === ',' || LEGEND[c] && POSTS[LEGEND[c]].kind === 'gate') { ctx.fillStyle = '#dcc394'; ctx.fillRect(px, py, s, s); if (hash(x, y) > 0.7) { ctx.fillStyle = '#cdb383'; ctx.fillRect(px + 8, py + 12, 4, 3); } return; }
  if (c === '=') { ctx.fillStyle = '#55575e'; ctx.fillRect(px, py, s, s); if (x % 2 === 0) { ctx.fillStyle = '#e8e2c8'; ctx.fillRect(px + 4, py + 15, 20, 2); } return; }
  if (c === ':') { ctx.fillStyle = (x + y) % 2 ? '#7a5c48' : '#836350'; ctx.fillRect(px, py, s, s); return; }
  if (c === '~') {
    ctx.fillStyle = '#3d8fd1'; ctx.fillRect(px, py, s, s);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.beginPath();
    const o = Math.sin(performance.now() / 600 + x + y) * 3;
    ctx.moveTo(px + 4, py + 12 + o); ctx.quadraticCurveTo(px + 12, py + 7 + o, px + 20, py + 12 + o); ctx.stroke();
    return;
  }
  ctx.fillStyle = GRASS[Math.floor(hash(x, y) * 3)];
  ctx.fillRect(px, py, s, s);
  if (hash(y, x) > 0.82) { ctx.fillStyle = '#4c8f38'; ctx.fillRect(px + 6 + hash(x, x) * 16, py + 8 + hash(y, y) * 14, 3, 6); }
  if (hash(x + 99, y) > 0.96) { ctx.fillStyle = ['#fff', '#ffd23f', '#ff6fa3'][Math.floor(hash(x, y + 7) * 3)]; ctx.beginPath(); ctx.arc(px + 16, py + 16, 3, 0, 7); ctx.fill(); }
}

function emoji(e, x, y, size) {
  ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000'; // farve-emojis arver ellers gennemsigtighed fra forrige fillStyle
  ctx.fillText(e, x, y);
}

function drawObject(c, x, y, px, py, t) {
  const s = TILE;
  switch (c) {
    case '#': {
      ctx.fillStyle = '#8b8f99';
      const horiz = tileAt(x - 1, y) === '#' || tileAt(x + 1, y) === '#' || /[0-9]/.test(tileAt(x - 1, y) + tileAt(x + 1, y));
      if (horiz) { ctx.fillRect(px, py + 12, s, 3); ctx.fillRect(px, py + 21, s, 3); ctx.fillStyle = '#5d616b'; ctx.fillRect(px + 2, py + 6, 4, 22); ctx.fillRect(px + 18, py + 6, 4, 22); }
      else { ctx.fillRect(px + 12, py, 3, s); ctx.fillRect(px + 19, py, 3, s); ctx.fillStyle = '#5d616b'; ctx.fillRect(px + 9, py + 2, 16, 4); ctx.fillRect(px + 9, py + 18, 16, 4); }
      break;
    }
    case 'T': {
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(px + 16, py + 27, 12, 5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(px + 13, py + 16, 6, 12);
      ctx.fillStyle = hash(x, y) > 0.5 ? '#2f7a33' : '#357f2c';
      ctx.beginPath(); ctx.arc(px + 16, py + 12, 13, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.arc(px + 12, py + 8, 5, 0, 7); ctx.fill();
      break;
    }
    case 'S': {
      ctx.fillStyle = '#26232e'; ctx.fillRect(px, py, s, s);
      ctx.strokeStyle = '#4a4656'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + s, py + s); ctx.moveTo(px + s, py); ctx.lineTo(px, py + s); ctx.stroke();
      break;
    }
    case 'B': {
      const stripe = x % 2 === 0;
      ctx.fillStyle = stripe ? '#e94f4f' : '#fff4e0'; ctx.fillRect(px, py, s, s);
      if (tileAt(x, y - 1) !== 'B') { ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(px, py, s, 5); }
      if (tileAt(x, y + 1) !== 'B') { ctx.fillStyle = '#b3373a'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(px + 4 + i * 8, py + s - 2, 4, 0, Math.PI); ctx.fill(); } }
      break;
    }
    case 'K': {
      const col = ['#d63b3b', '#3b78d6', '#f2c232', '#eee', '#333'][Math.floor(hash(x, y) * 5)];
      ctx.fillStyle = col; roundRect(px + 4, py + 2, 24, 28, 6); ctx.fill();
      ctx.fillStyle = '#9fd3ff'; ctx.fillRect(px + 8, py + 6, 16, 6); ctx.fillRect(px + 8, py + 21, 16, 5);
      break;
    }
    case 'R': emoji('🚲', px + 16, py + 17, 24); break;
    case 'X': {
      const col = ['#ff9f1c', '#2ec4b6', '#e71d36', '#7b2ff7'][Math.floor(hash(x, y) * 4)];
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(px + 2, py + 28); ctx.lineTo(px + 16, py + 4); ctx.lineTo(px + 30, py + 28); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.moveTo(px + 12, py + 28); ctx.lineTo(px + 16, py + 16); ctx.lineTo(px + 20, py + 28); ctx.fill();
      break;
    }
  }
  const postId = LEGEND[c];
  if (postId) drawPost(postId, c, x, y, px, py, t);
}

function drawPost(postId, c, x, y, px, py, t) {
  const post = POSTS[postId];
  const solved = mySolved().has(postId);
  if (post.kind === 'station') {
    ctx.fillStyle = '#8a5a35'; roundRect(px + 1, py + 4, 30, 24, 5); ctx.fill();
    ctx.fillStyle = '#a8703f'; ctx.fillRect(px + 1, py + 4, 30, 6);
    emoji(post.emoji, px + 16, py + 18, 20);
    if (solved) emoji('✅', px + 26, py + 6, 12);
    else { const b = Math.sin(t / 300) * 2; drawBubble(px + 16, py - 6 + b, '❓'); }
    return;
  }
  // bom (to felter brede – tegn detaljer kun én gang)
  const horiz = tileAt(x - 1, y) === c || tileAt(x + 1, y) === c || tileAt(x - 1, y) === '#' || tileAt(x + 1, y) === '#';
  const first = horiz ? tileAt(x - 1, y) !== c : tileAt(x, y - 1) !== c;
  if (solved) {
    if (first) { ctx.fillStyle = '#c33'; horiz ? ctx.fillRect(px - 2, py + 4, 5, 24) : ctx.fillRect(px + 4, py - 2, 24, 5); }
    return;
  }
  ctx.save();
  if (horiz) {
    for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#e23d3d'; ctx.fillRect(px + i * 8, py + 13, 8, 6); }
  } else {
    for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#e23d3d'; ctx.fillRect(px + 13, py + i * 8, 6, 8); }
  }
  ctx.restore();
  if (first) {
    const cx = horiz ? px + s2() : px + 16, cy = horiz ? py + 16 : py + s2();
    emoji(post.final ? '💂' : '🦺', cx + (horiz ? 0 : 0), cy - 2, 22);
    const b = Math.sin(t / 300) * 2;
    drawBubble(cx, cy - 26 + b, post.emoji);
  }
}
const s2 = () => TILE; // midten af en 2-felts bom

function drawBubble(x, y, e) {
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#23183f'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 4, y + 9); ctx.lineTo(x, y + 15); ctx.lineTo(x + 4, y + 9); ctx.fill();
  emoji(e, x, y + 1, 13);
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawPlayer(p, t, isMe) {
  const px = p.rx * TILE, py = p.ry * TILE;
  const bob = p.moving ? Math.abs(Math.sin(t / 110)) * 4 : 0;
  ctx.globalAlpha = p.online || isMe ? 1 : 0.45;
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(px, py + 11, 11, 5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(px, py + 2 - bob, 14, 0, 7); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = isMe ? 3 : 2; ctx.stroke();
  ctx.save();
  if (p.dir === 'left') { ctx.translate(px, 0); ctx.scale(-1, 1); ctx.translate(-px, 0); }
  emoji(p.avatar, px, py + 2 - bob, 20);
  ctx.restore();
  // navneskilt
  ctx.font = 'bold 11px system-ui, sans-serif';
  const w = ctx.measureText(p.name).width + 10;
  ctx.fillStyle = isMe ? 'rgba(255,79,139,.92)' : 'rgba(27,16,55,.8)';
  roundRect(px - w / 2, py - 30 - bob, w, 15, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.name, px, py - 22.5 - bob);
  const h = [...G.helps.values()].find((x) => x.pid === p.id && !x.done);
  if (h && !isMe) emoji('🆘', px + w / 2 + 8, py - 23 - bob, 14);
  ctx.globalAlpha = 1;
}

// Bløde lydbølger fra scenen, når musikken spiller – viser, hvor lyden kommer fra
function drawSoundWaves(t) {
  const playing = [MUSIC.bg, MUSIC.fin].some((a) => a && !a.paused && !a._stopping && (a !== MUSIC.fin || a._live));
  if (!playing || MUSIC.muted) return;
  const cx = SOUND_SOURCE.x * TILE, cy = (STAGE.y + STAGE.h) * TILE;
  ctx.save();
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const k = ((t / 2600) + i / 4) % 1;
    ctx.strokeStyle = `rgba(255, 210, 122, ${(1 - k) * 0.35})`;
    ctx.beginPath(); ctx.arc(cx, cy, TILE * (1 + k * 9), 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  }
  ctx.restore();
}

function drawStageCover(t) {
  const x = STAGE.x * TILE, y = STAGE.y * TILE, w = STAGE.w * TILE, h = STAGE.h * TILE;
  ctx.fillStyle = '#1d2b4a'; ctx.fillRect(x, y, w, h);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 14;
  for (let i = -h; i < w; i += 40) { ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); ctx.stroke(); }
  ctx.restore();
  // lyskegler der lækker op over hegnet
  for (let i = 0; i < 3; i++) {
    const a = Math.sin(t / 900 + i * 2) * 0.5;
    ctx.save(); ctx.translate(x + w * (0.25 + i * 0.25), y + h * 0.4); ctx.rotate(a);
    const g = ctx.createLinearGradient(0, 0, 0, -h);
    g.addColorStop(0, 'rgba(255,220,120,.25)'); g.addColorStop(1, 'rgba(255,220,120,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-30, -h); ctx.lineTo(30, -h); ctx.lineTo(6, 0); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = 'bold 22px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('🚧  ADGANG KUN MED STEMPLER  🚧', x + w / 2, y + h / 2 - 8);
  ctx.font = '15px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.6)';
  ctx.fillText('Hvad mon der gemmer sig bag hegnet…? 🎶', x + w / 2, y + h / 2 + 18);
  const pulse = (Math.sin(t / 250) + 1) / 2;
  ctx.globalAlpha = 0.3 + pulse * 0.4; emoji('🔊', x + 40, y + 40, 26); emoji('🔊', x + w - 40, y + 40, 26); ctx.globalAlpha = 1;
}

function drawConcert(t) {
  const sx = 18 * TILE, sw = 14 * TILE, sy = 1 * TILE;
  // lys
  const cols = ['255,79,139', '255,182,39', '123,47,247', '46,196,182'];
  for (let i = 0; i < 6; i++) {
    const a = Math.sin(t / 500 + i) * 0.6;
    ctx.save(); ctx.translate(sx + (sw / 5) * i, sy + 6); ctx.rotate(a);
    const g = ctx.createLinearGradient(0, 0, 0, 260);
    g.addColorStop(0, `rgba(${cols[i % 4]},.55)`); g.addColorStop(1, `rgba(${cols[i % 4]},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-50, 260); ctx.lineTo(50, 260); ctx.lineTo(4, 0); ctx.fill();
    ctx.restore();
  }
  const band = ['🎸', '🥁', '🎤', '🎹', '🎷'];
  band.forEach((b, i) => emoji(b, sx + 40 + i * ((sw - 80) / 4), sy + 52 + Math.abs(Math.sin(t / 180 + i)) * -8, 30));
  if (Math.random() < 0.15) notes.push({ x: sx + Math.random() * sw, y: sy + 70, vy: -20 - Math.random() * 20, life: 2, e: ['🎵', '🎶', '✨'][Math.floor(Math.random() * 3)] });
}

// partikler
const notes = [];
const confetti = [];
function burst(x, y, n) {
  for (let i = 0; i < n; i++) confetti.push({ x: x * TILE, y: y * TILE, vx: (Math.random() - 0.5) * 300, vy: -Math.random() * 300, life: 2 + Math.random(), c: `hsl(${Math.random() * 360},90%,60%)` });
}
function drawParticles(dt) {
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i]; n.y += n.vy * dt; n.life -= dt;
    ctx.globalAlpha = Math.max(0, n.life / 2); emoji(n.e, n.x, n.y, 16);
    if (n.life <= 0) notes.splice(i, 1);
  }
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i]; c.vy += 400 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.life -= dt;
    ctx.globalAlpha = Math.max(0, Math.min(1, c.life)); ctx.fillStyle = c.c; ctx.fillRect(c.x, c.y, 5, 8);
    if (c.life <= 0) confetti.splice(i, 1);
  }
  ctx.globalAlpha = 1;
}

let lastT = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  update(dt);
  render(t, dt);
  requestAnimationFrame(loop);
}

function render(t, dt) {
  const { w, h, dpr, scale } = view;
  if (G.me) {
    // blødt kamera, der følger spilleren
    // under finalen panorerer kameraet op til bandet
    const atShow = G.finale && inRect(STAGE, G.me.x, G.me.y);
    const tx = atShow ? STAGE.x + STAGE.w / 2 : G.me.x, ty = atShow ? Math.min(G.me.y, 5) : G.me.y;
    const k = cam.init ? Math.min(1, dt * (atShow ? 2 : 8)) : 1;
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.init = true;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#10131c'; ctx.fillRect(0, 0, w, h);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (w / 2 - cam.x * TILE * scale), dpr * (h / 2 - cam.y * TILE * scale));

  const x0 = Math.max(0, Math.floor(cam.x - w / 2 / scale / TILE) - 1), x1 = Math.min(W - 1, Math.ceil(cam.x + w / 2 / scale / TILE) + 1);
  const y0 = Math.max(0, Math.floor(cam.y - h / 2 / scale / TILE) - 1), y1 = Math.min(H - 1, Math.ceil(cam.y + h / 2 / scale / TILE) + 1);

  const stageOpen = mySolved().has('finale') || !!G.finale;
  const hiddenStage = (x, y) => !stageOpen && inRect(STAGE, x + 0.5, y + 0.5);
  if (stageOpen && !G.stageRevealed) { // vis hele sceneområdet, når man er kommet ind
    G.stageRevealed = true;
    for (let y = STAGE.y; y < STAGE.y + STAGE.h; y++) for (let x = STAGE.x; x < STAGE.x + STAGE.w; x++) G.explored[y * W + x] = 1;
  }

  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!hiddenStage(x, y)) drawGround(MAP[y][x], x, y, x * TILE, y * TILE);
  if (!stageOpen) drawStageCover(t); // presenningen ses altid – som et mysterium
  drawSoundWaves(t);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!hiddenStage(x, y)) drawObject(MAP[y][x], x, y, x * TILE, y * TILE, t);
  if (G.finale) drawConcert(t);

  // skilte
  for (const l of LABELS) {
    ctx.font = 'bold 13px system-ui, sans-serif';
    const tw = ctx.measureText(l.text).width + 14;
    ctx.fillStyle = 'rgba(255,250,240,.9)'; roundRect(l.x * TILE - tw / 2, l.y * TILE - 10, tw, 20, 8); ctx.fill();
    ctx.fillStyle = '#23183f'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(l.text, l.x * TILE, l.y * TILE + 1);
  }

  // spillere (sorteret efter y så de overlapper pænt)
  const ps = [...G.players.values()].sort((a, b) => a.ry - b.ry);
  for (const p of ps) drawPlayer(p, t, p.id === G.pid);
  drawParticles(dt);

  // tåge
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (hiddenStage(x, y) || (G.finale && inRect(STAGE, x + 0.5, y + 0.5))) continue;
    if (!G.explored[y * W + x]) { ctx.fillStyle = '#10131c'; ctx.fillRect(x * TILE - 0.5, y * TILE - 0.5, TILE + 1, TILE + 1); }
    else if (G.me && Math.hypot(x + 0.5 - G.me.x, y + 0.5 - G.me.y) > 6) { ctx.fillStyle = 'rgba(16,19,28,.28)'; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); }
  }
  // vis medspillere selv i tågen, så man kan finde hinanden
  for (const p of ps) {
    if (p.id === G.pid) continue;
    const tx = Math.floor(p.rx), ty = Math.floor(p.ry);
    if (tx >= 0 && ty >= 0 && tx < W && ty < H && !G.explored[ty * W + tx]) {
      ctx.globalAlpha = 0.7; emoji(p.avatar, p.rx * TILE, p.ry * TILE, 18); ctx.globalAlpha = 1;
    }
  }

  // pile mod medspillere uden for skærmen
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const p of ps) {
    if (p.id === G.pid || !p.online) continue;
    const sx = (p.rx - cam.x) * TILE * scale + w / 2, sy = (p.ry - cam.y) * TILE * scale + h / 2;
    if (sx > 0 && sx < w && sy > 0 && sy < h) continue;
    const ang = Math.atan2(sy - h / 2, sx - w / 2);
    const m = 28;
    const ex = Math.max(m, Math.min(w - m, w / 2 + Math.cos(ang) * w)), ey = Math.max(m + 70, Math.min(h - m - 40, h / 2 + Math.sin(ang) * h));
    ctx.fillStyle = p.color; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(ex, ey, 15, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    emoji(p.avatar, ex, ey, 16);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang); ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(14, -6); ctx.lineTo(14, 6); ctx.fill(); ctx.restore();
  }
}

// ====================================================================
// Finale
// ====================================================================
// Man ser scenen fra publikum (POV). Lyset dæmpes, der tælles ned, scenetæppet
// falder, og først DÉR afsløres festivalens navn, dato, sted og hovednavn.
let finaleShown = false;
const POV = { run: 0, active: false, mode: 'house', conf: [], lasers: false, t0: 0 };
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

function buildCrowd() {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hands = ['🙌', '✋', '🤘', '👐', '✌️'];
  const head = (left, bottom, size, opacity, extra = '', inner = '') =>
    `<div class="crowd-head ${extra.cls || ''}" style="left:${left}%;bottom:${bottom}vh;width:${size * 0.95}vh;height:${size}vh;font-size:${size * 0.32}vh;opacity:${opacity};${extra.style || ''}">
      <div class="body"></div><div class="hand" style="animation-delay:${(rnd() * 0.7).toFixed(2)}s">${hands[Math.floor(rnd() * hands.length)]}</div>${inner}</div>`;
  const parts = [];
  // baggrundsrækker – mindre og længere væk
  for (let i = 0; i < 18; i++) parts.push(head(i * 6 + rnd() * 4 - 2, 11 + rnd() * 3, 7 + rnd() * 2, 0.75));
  for (let i = 0; i < 13; i++) parts.push(head(i * 8.5 + rnd() * 4 - 1, 5 + rnd() * 2, 10 + rnd() * 3, 0.9));
  // holdet står forrest i midten, set bagfra
  const team = [...G.players.values()].filter((p) => p.online || p.id === G.pid);
  // størrelse og afstand efter skærmbredden, så figurer og navneskilte ikke overlapper
  const vh = innerHeight / 100;
  const slot = Math.min(innerWidth * 0.86 / Math.max(1, team.length), 15 * vh * 1.25);
  const portrait = innerHeight > innerWidth * 4 / 3;
  const size = Math.min(portrait ? 11 : 15, (slot / 1.2) / vh);
  const span = (slot * team.length) / innerWidth * 100;
  const stagger = slot < 110; // smalle skærme: skiftevis højt og lavt navneskilt
  team.forEach((p, i) => {
    const left = 50 - span / 2 + (span * (i + 0.5)) / team.length;
    parts.push(head(left, portrait ? 7 : -2, size, 1, { cls: 'team', style: `--c:${esc(p.color)};--lift:${stagger && i % 2 ? 1.9 : 0}em;z-index:2` },
      `<div class="tag">${esc(p.avatar)} ${esc(p.name)}${p.id === G.pid ? ' (dig)' : ''}</div>`));
  });
  // lidt publikum ude i siderne af forreste række
  for (const left of [4, 12, 88, 96]) parts.push(head(left + rnd() * 3, -3, 16 + rnd() * 3, 1));
  $('povCrowd').innerHTML = parts.join('');
}

// ---- Bandet på scenen ----
// Tegnede silhuetter med kantlys i hvert medlems farve, eller et billede fra festival.json (band.image).
function bandFigure(role, color) {
  const body = `<g class="bf-body"><circle cx="50" cy="38" r="13"/><rect x="36" y="52" width="28" height="56" rx="12"/>
    <rect x="38" y="104" width="10" height="60" rx="5"/><rect x="52" y="104" width="10" height="60" rx="5"/></g>`;
  const R = (role || '').toLowerCase();
  let extra = '';
  if (/trom|drum/.test(R)) {
    extra = `<g class="bf-arm bf-stick-l"><rect x="22" y="58" width="8" height="34" rx="4"/><rect x="18" y="86" width="3" height="26" rx="1.5" class="bf-stick"/></g>
      <g class="bf-arm bf-stick-r"><rect x="70" y="58" width="8" height="34" rx="4"/><rect x="79" y="86" width="3" height="26" rx="1.5" class="bf-stick"/></g>
      <ellipse cx="50" cy="132" rx="30" ry="30" class="bf-drum"/><ellipse cx="50" cy="132" rx="20" ry="20" class="bf-skin"/>
      <ellipse cx="12" cy="108" rx="16" ry="3" class="bf-cym"/><ellipse cx="88" cy="104" rx="16" ry="3" class="bf-cym"/>`;
  } else if (/vok|sang|vocal|sing/.test(R)) {
    extra = `<line x1="74" y1="40" x2="74" y2="166" class="bf-stand"/><circle cx="66" cy="44" r="4" class="bf-mic"/>
      <g class="bf-arm bf-wave"><rect x="24" y="30" width="8" height="34" rx="4"/></g><rect x="62" y="56" width="8" height="28" rx="4"/>`;
  } else if (/key|klaver|piano/.test(R)) {
    extra = `<rect x="14" y="96" width="72" height="10" rx="2" class="bf-keys"/><line x1="24" y1="106" x2="24" y2="166" class="bf-stand"/><line x1="76" y1="106" x2="76" y2="166" class="bf-stand"/>
      <g class="bf-arm bf-strum"><rect x="28" y="62" width="8" height="34" rx="4"/></g><rect x="64" y="62" width="8" height="34" rx="4"/>`;
  } else { // guitar eller bas
    const bas = /bas/.test(R);
    extra = `<g class="bf-guitar"><line x1="44" y1="92" x2="${bas ? 98 : 92}" y2="${bas ? 50 : 56}" class="bf-neck"/>
      <ellipse cx="44" cy="96" rx="${bas ? 16 : 14}" ry="${bas ? 13 : 12}" class="bf-inst"/><circle cx="44" cy="96" r="4" class="bf-hole"/></g>
      <g class="bf-arm bf-strum"><rect x="30" y="62" width="8" height="34" rx="4"/></g><rect x="66" y="58" width="8" height="30" rx="4" transform="rotate(-50 70 60)"/>`;
  }
  return `<svg viewBox="0 0 100 170" style="--c:${esc(color)}">${body}${extra}</svg>`;
}
function buildBand() {
  const band = G.config?.band || {};
  const el = $('povBand');
  if (band.image) {
    el.innerHTML = `<img class="pov-band-img" alt="Bandet" src="${esc(band.image)}">`;
    return;
  }
  const members = (band.members && band.members.length ? band.members : [
    { role: 'guitar', color: '#ff4f8b' }, { role: 'vokal', color: '#ffb627' }, { role: 'trommer', color: '#2ec4b6' }, { role: 'bas', color: '#7b2ff7' },
  ]).slice(0, 6);
  // trommeslageren står bagest i midten
  const drums = members.filter((m) => /trom|drum/i.test(m.role || ''));
  const front = members.filter((m) => !/trom|drum/i.test(m.role || ''));
  el.innerHTML = (drums.length ? `<div class="pov-drumriser">${drums.map((m, i) => `<div class="bm drum" style="animation-delay:${i * 0.11}s">${bandFigure(m.role, m.color || '#fff')}${m.name ? `<span>${esc(m.name)}</span>` : ''}</div>`).join('')}</div>` : '')
    + `<div class="pov-frontline">${frontHtml(front, drums.length > 0)}</div>`;
  function frontHtml(list, gap) {
    const fig = (m, i) => `<div class="bm" style="animation-delay:${((i * 0.17) % 0.47).toFixed(2)}s">${bandFigure(m.role, m.color || '#fff')}${m.name ? `<span>${esc(m.name)}</span>` : ''}</div>`;
    if (!gap) return list.map(fig).join('');
    // sangeren står tættest på midten; trommerne får plads i en åbning bag ved
    const singer = list.filter((m) => /vok|sang|vocal|sing/i.test(m.role || ''));
    const others = list.filter((m) => !singer.includes(m));
    const half = Math.ceil(others.length / 2);
    const left = [...others.slice(0, half), ...singer.slice(0, 1)];
    const right = [...singer.slice(1), ...others.slice(half)];
    return [...left.map(fig), '<div class="bm-gap"></div>', ...right.map((m, i) => fig(m, i + left.length))].join('');
  }
}
function bandOn() {
  $('pov').classList.add('band-on');
  $('povBand').classList.add('on');
  fitPovText();
  POV.band = true;
  startFinaleTrack();
}

// Navn og hovednavn gøres så store som muligt uden at knække ord på skærmen
function fitPovText(scale = $('pov').classList.contains('band-on') ? 0.55 : 1) {
  for (const [id, max] of [['povName', 0.075 * scale], ['povHead', 0.095 * scale]]) {
    const el = $(id);
    el.classList.add('measuring'); // mål uden bogstavernes startanimation
    let size = Math.max(16, Math.min(innerWidth, innerHeight) * max);
    el.style.fontSize = size + 'px';
    let guard = 0;
    while (el.scrollWidth > el.clientWidth + 1 && size > 16 && guard++ < 80) { size -= 1; el.style.fontSize = size + 'px'; }
    el.classList.remove('measuring');
  }
}
addEventListener('resize', () => { if (POV.active) fitPovText(); });

// Lys, laser og konfetti tegnes på et lærred oven på scenen
function povFxLoop() {
  const cv = $('povFx');
  const c = cv.getContext('2d');
  const tick = (t) => {
    if (!POV.active) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = innerWidth, Hh = innerHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, Hh);
    c.globalCompositeOperation = 'lighter';
    const r = $('povStage').getBoundingClientRect();
    const roofY = r.top + r.height * 0.07;
    const sec = (t - POV.t0) / 1000;
    // dis foran scenen
    const haze = c.createRadialGradient(r.left + r.width / 2, r.bottom, 10, r.left + r.width / 2, r.bottom, r.width * 0.8);
    const hz = POV.mode === 'show' ? 0.22 : POV.mode === 'spots' ? 0.08 : 0.12;
    haze.addColorStop(0, `rgba(140,90,255,${hz})`); haze.addColorStop(1, 'rgba(140,90,255,0)');
    c.fillStyle = haze; c.fillRect(0, 0, W, Hh);
    const cone = (x, y, ang, len, spread, rgb, a) => {
      c.save(); c.translate(x, y); c.rotate(ang);
      const g = c.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = g; c.beginPath(); c.moveTo(-3, 0); c.lineTo(-spread, len); c.lineTo(spread, len); c.lineTo(3, 0); c.fill(); c.restore();
    };
    if (POV.mode === 'spots') {
      // to følgespots, der leder efter noget på tæppet
      for (let i = 0; i < 2; i++) {
        const tx = r.left + r.width * (0.5 + 0.28 * Math.sin(sec * 1.3 + i * 2.4)), ty = r.top + r.height * 0.5;
        const sx = i ? r.right + 40 : r.left - 40, sy = r.top - 20;
        const ang = Math.atan2(tx - sx, ty - sy);
        cone(sx, sy, -ang, Math.hypot(tx - sx, ty - sy) + 40, 70, '255,245,220', 0.35);
        c.fillStyle = 'rgba(255,245,220,0.18)'; c.beginPath(); c.ellipse(tx, ty, 80, 60, 0, 0, 7); c.fill();
      }
    }
    if (POV.mode === 'show') {
      const cols = ['255,79,139', '255,182,39', '123,47,247', '46,196,182', '80,160,255', '255,255,255'];
      for (let i = 0; i < 6; i++) {
        const x = r.left + r.width * (0.1 + i * 0.16);
        const ang = Math.sin(sec * (0.9 + i * 0.13) + i) * 0.7;
        cone(x, roofY, ang, Hh * 1.1, 90, cols[(i + Math.floor(sec / 2)) % cols.length], 0.33);
      }
      if (POV.lasers) {
        c.lineWidth = 2;
        for (let i = 0; i < 14; i++) {
          const a = -Math.PI / 2 + (i - 6.5) * 0.17 + Math.sin(sec * 1.7) * 0.35;
          const x0 = r.left + r.width / 2, y0 = r.bottom - r.height * 0.1;
          c.strokeStyle = i % 2 ? 'rgba(60,255,140,0.55)' : 'rgba(255,60,200,0.5)';
          c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + Math.cos(a) * W, y0 + Math.sin(a) * W); c.stroke();
        }
      }
    }
    c.globalCompositeOperation = 'source-over';
    for (let i = POV.conf.length - 1; i >= 0; i--) {
      const p = POV.conf[i];
      p.vy += 300 / 60; p.x += p.vx / 60; p.y += p.vy / 60; p.vx *= 0.99; p.rot += p.vr; p.life -= 1 / 60;
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = p.col; c.globalAlpha = Math.max(0, Math.min(1, p.life));
      c.fillRect(-4, -2.5, 8, 5); c.restore();
      if (p.life <= 0 || p.y > Hh + 20) POV.conf.splice(i, 1);
    }
    c.globalAlpha = 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function povConfetti(n) {
  if (reducedMotion()) n = Math.floor(n / 4);
  const r = $('povStage').getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? r.left + r.width * 0.12 : r.right - r.width * 0.12;
    POV.conf.push({ x: side, y: r.top + r.height * 0.15, vx: (side < innerWidth / 2 ? 1 : -1) * (80 + Math.random() * 380), vy: -200 - Math.random() * 380, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, life: 4 + Math.random() * 2, col: `hsl(${Math.floor(Math.random() * 360)},95%,62%)` });
  }
}
function povFlash() {
  if (reducedMotion()) return;
  const f = $('povFlash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}
function povCaption(text, cls = '') {
  const el = $('povCaption');
  el.className = 'pov-caption'; void el.offsetWidth;
  if (cls) el.classList.add(cls);
  el.textContent = text;
}

function startFinale(d) {
  if (finaleShown) return;
  finaleShown = true;
  try { tabStore.setItem(`festival:povseen:${G.code}`, '1'); } catch {}
  document.querySelectorAll('.modal:not(.hidden)').forEach((m) => closeModal(m.id));
  const P = d.poster || G.poster || {};
  const run = ++POV.run;
  const alive = () => POV.run === run;

  let li = 0;
  $('povName').innerHTML = String(P.name || '').split(' ').map((word) =>
    `<span class="w">${[...word].map((ch) => `<i style="animation-delay:${(li++ * 0.06).toFixed(2)}s">${esc(ch)}</i>`).join('')}</span>`).join(' ');
  $('povMeta').innerHTML = [P.date && `📅 <b>${esc(P.date)}</b>`, P.place && `📍 <b>${esc(P.place)}</b>`].filter(Boolean).join(' &nbsp;·&nbsp; ')
    + (P.tagline ? `<div style="font-weight:500;opacity:.85;font-size:.85em;margin-top:.3em">${esc(P.tagline)}</div>` : '');
  $('povTeaser').textContent = d.teaser || 'Aftenens hemmelige hovednavn er…';
  $('povHead').textContent = P.headliner || '';
  $('povLineup').innerHTML = (P.lineup || []).map((ch) => `<span>${esc(Array.isArray(ch) ? ch.join('') : ch)}</span>`).join('');
  buildCrowd();
  buildBand();
  $('povBand').classList.remove('on');
  $('pov').className = 'pov';
  $('povCurtain').className = 'pov-curtain';
  $('povCurtain').style.display = '';
  document.querySelectorAll('#povScreen > div, #povLineup span').forEach((e) => e.classList.remove('on'));
  $('povActions').classList.remove('on');
  $('povSkip').hidden = false;
  fitPovText();
  POV.active = true; POV.mode = 'house'; POV.lasers = false; POV.conf = []; POV.t0 = performance.now();
  povFxLoop();
  updateHud();

  const showAll = () => {
    $('pov').classList.remove('dim', 'pulse');
    $('pov').classList.add('cheer');
    stopBackgroundMusic(300);
    $('povCurtain').style.display = 'none';
    document.querySelectorAll('#povScreen > div, #povLineup span').forEach((e) => e.classList.add('on'));
    POV.mode = 'show'; POV.lasers = true;
    povCaption('');
    $('povMsg').textContent = d.message || '';
    $('povActions').classList.add('on');
    $('povSkip').hidden = true;
    murmurStop(0.5);
    bandOn();
  };
  $('povSkip').onclick = () => { POV.run++; showAll(); };
  $('povClose').onclick = () => { $('pov').classList.add('hidden'); POV.active = false; burst(25, 5, 80); };
  $('povMute').onclick = toggleMute;
  $('povPoster').onclick = () => { renderPoster(); openModal('posterModal'); };

  (async () => {
    murmurStart();
    povCaption('Hele holdet er samlet foran scenen…');
    await sleep(2800); if (!alive()) return;
    $('pov').classList.add('dim', 'pulse');
    stopBackgroundMusic(2500);
    POV.mode = 'spots';
    povCaption('Lyset dæmpes…');
    await drumroll(); if (!alive()) return;
    for (const n of ['3', '2', '1']) {
      povCaption(n, 'count'); boom(0.3);
      await sleep(850); if (!alive()) return;
    }
    // Scenetæppet falder!
    povCaption('');
    $('povCurtain').classList.add('drop');
    setTimeout(() => { if (alive()) $('povCurtain').style.display = 'none'; }, 1150);
    whoosh();
    setTimeout(() => { if (alive()) { boom(0.9); povFlash(); cheer(); } }, 380);
    murmurStop(0.4);
    await sleep(500); if (!alive()) return;
    $('pov').classList.remove('dim', 'pulse');
    POV.mode = 'show';
    povConfetti(160);
    await sleep(500); if (!alive()) return;
    $('povKicker').classList.add('on');
    await sleep(500); if (!alive()) return;
    $('povName').classList.add('on');
    await sleep(1800); if (!alive()) return;
    $('povMeta').classList.add('on');
    await sleep(2000); if (!alive()) return;
    $('povTeaser').classList.add('on');
    drumrollShort();
    await sleep(1800); if (!alive()) return;
    $('povHead').classList.add('on');
    boom(1); povFlash(); cheer(1.3);
    POV.lasers = true;
    $('pov').classList.add('cheer');
    povConfetti(220);
    burst(25, 5, 150);
    for (const [i, el] of [...document.querySelectorAll('#povLineup span')].entries()) {
      await sleep(i ? 260 : 1400); if (!alive()) return;
      el.classList.add('on');
    }
    // Bandet går på scenen, og musikken starter
    await sleep(1600); if (!alive()) return;
    bandOn();
    boom(0.8); povFlash(); povConfetti(120);
    await sleep(2200); if (!alive()) return;
    $('povMsg').textContent = d.message || '';
    $('povActions').classList.add('on');
    $('povSkip').hidden = true;
  })();
}

// ====================================================================
// Lyd (lille syntetiseret – ingen filer)
// ====================================================================
let AC = null, MASTER = null;
function masterOut() {
  if (!MASTER) { MASTER = AC.createGain(); MASTER.gain.value = MUSIC.muted ? 0 : 1; MASTER.connect(AC.destination); }
  return MASTER;
}

// ---- Musik fra filer (festival.json → music) ----
const MUSIC = { bg: null, fin: null, muted: false, unlocked: false };
try { MUSIC.muted = localStorage.getItem('festival:muted') === '1'; } catch {}
const clampVol = (v, d) => Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : d));
function musicCfg() { return G.config?.music || {}; }
function makeTrack(src, vol) {
  if (!src) return null;
  const a = new Audio(src);
  a.loop = true; a.preload = 'auto'; a._vol = vol; a.muted = MUSIC.muted;
  a.volume = 0; // niveauet styres af spatialAudio()
  a.addEventListener('error', () => console.warn('Kunne ikke afspille', src));
  routeTrack(a);
  return a;
}
// Lyd fra samme adresse sendes gennem Web Audio: lydstyrke, diskant-dæmpning og stereo-retning.
// (Lyd fra andre adresser kan browseren ikke bearbejde uden CORS – dér styres kun lydstyrken.)
function routeTrack(a) {
  initAudio();
  if (!AC || a._node) return;
  try {
    if (new URL(a.src, location.href).origin !== location.origin) return;
    const src = AC.createMediaElementSource(a);
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.5;
    const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
    const g = AC.createGain(); g.gain.value = 0;
    src.connect(lp);
    (pan ? lp.connect(pan) : lp).connect(g);
    g.connect(masterOut());
    a._node = { g, lp, pan };
    a.volume = 1;
  } catch (e) { console.warn('Lyd uden rumklang:', e.message); }
}
function fade(a, to, ms, done) {
  if (!a) return done?.();
  const from = a.volume, t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step); else done?.();
  };
  step();
}
function setTrackLevel(a, vol, pan = 0, lpHz = 20000, smooth = 0.25) {
  if (a._node && AC) {
    const t = AC.currentTime;
    a._node.g.gain.setTargetAtTime(vol, t, smooth);
    a._node.lp.frequency.setTargetAtTime(lpHz, t, smooth);
    if (a._node.pan) a._node.pan.pan.setTargetAtTime(pan, t, smooth);
  } else {
    a.volume = Math.max(0, Math.min(1, vol));
  }
}

// ---- Lyden kommer fra scenen ----
// Jo tættere på hovedscenen, jo højere og klarere; langt væk er den svag og dump.
// Retningen høres i stereo (scenen til venstre = lyd mest fra venstre).
const SOUND_SOURCE = { x: STAGE.x + STAGE.w / 2, y: STAGE.crowd.y + 2 }; // midt foran scenen
const SOUND_NEAR = 5, SOUND_FAR = 38, SOUND_MIN = 0.1;
function stageSoundAt(x, y) {
  const dx = SOUND_SOURCE.x - x, dy = SOUND_SOURCE.y - y;
  const d = Math.hypot(dx, dy);
  const t = Math.max(0, Math.min(1, (d - SOUND_NEAR) / (SOUND_FAR - SOUND_NEAR)));
  const near = Math.pow(1 - t, 1.6);
  return {
    d,
    mul: SOUND_MIN + (1 - SOUND_MIN) * near,
    pan: Math.max(-0.75, Math.min(0.75, dx / 14)) * Math.min(1, d / 6), // helt tæt på: lyd fra alle sider
    lp: 700 + (20000 - 700) * near * near,
  };
}
function spatialAudio() {
  for (const a of [MUSIC.bg, MUSIC.fin]) {
    if (!a || a._stopping || (a === MUSIC.fin && !a._live)) continue;
    if (POV.active || !G.me) { setTrackLevel(a, a._vol); continue; } // i finalen: fuld lyd lige foran
    const s = stageSoundAt(G.me.x, G.me.y);
    setTrackLevel(a, a._vol * s.mul, s.pan, s.lp);
    if (window.__lydDebug) window.__lydDebug = { d: +s.d.toFixed(1), mul: +s.mul.toFixed(2), pan: +s.pan.toFixed(2), lp: Math.round(s.lp), src: a.src.split('/').pop(), graf: !!a._node };
  }
}
try { if (new URLSearchParams(location.search).get('debug') === 'lyd') window.__lydDebug = {}; } catch {}

// kaldes ved første tryk/tast (browsere kræver det, før lyd må spille)
function unlockMusic() {
  if (MUSIC.unlocked || !G.code || !G.config?.music || MUSIC.muted) return;
  const m = musicCfg();
  MUSIC.unlocked = true;
  initAudio();
  AC?.resume?.().catch(() => {});
  if (m.background && !G.finale) {
    MUSIC.bg = makeTrack(m.background, clampVol(m.backgroundVolume, 0.35));
    spatialAudio();
    MUSIC.bg.play().catch(() => { MUSIC.unlocked = false; MUSIC.bg = null; });
  }
  if (m.finale && !MUSIC.fin) { // "lås op" til senere (iOS) – lydløst, da niveauet er 0, indtil bandet spiller
    const f = (MUSIC.fin = makeTrack(m.finale, clampVol(m.finaleVolume, 0.8)));
    f.play().then(() => { if (!f._live) { f.pause(); f.currentTime = 0; } }).catch(() => {});
  }
}
addEventListener('pointerdown', unlockMusic);
addEventListener('keydown', unlockMusic);
// vågn lydsystemet, hvis browseren har sat det på pause
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { if (AC && AC.state === 'suspended') AC.resume().catch(() => {}); });
function stopBackgroundMusic(ms = 1500) {
  const a = MUSIC.bg; MUSIC.bg = null;
  if (!a) return;
  a._stopping = true;
  if (a._node && AC) { a._node.g.gain.setTargetAtTime(0, AC.currentTime, ms / 3000); setTimeout(() => a.pause(), ms); }
  else fade(a, 0, ms, () => a.pause());
}
function startFinaleTrack() {
  const m = musicCfg();
  if (m.finale) {
    if (!MUSIC.fin) MUSIC.fin = makeTrack(m.finale, clampVol(m.finaleVolume, 0.8));
    MUSIC.fin._live = true;
    MUSIC.fin.currentTime = 0;
    spatialAudio();
    MUSIC.fin.play().catch(() => startMusic());
  } else startMusic(); // ingen fil: brug den indbyggede syntetiske musik
}
function toggleMute() {
  MUSIC.muted = !MUSIC.muted;
  try { localStorage.setItem('festival:muted', MUSIC.muted ? '1' : '0'); } catch {}
  for (const a of [MUSIC.bg, MUSIC.fin]) if (a) a.muted = MUSIC.muted;
  if (AC && MASTER) MASTER.gain.value = MUSIC.muted ? 0 : 1;
  updateMuteButtons();
  if (!MUSIC.muted) unlockMusic();
}
function updateMuteButtons() {
  for (const id of ['muteBtn', 'povMute']) { const b = $(id); if (b) { b.textContent = MUSIC.muted ? '🔇' : '🔊'; b.title = MUSIC.muted ? 'Slå lyd til' : 'Slå lyd fra'; } }
}
$('muteBtn').onclick = toggleMute;
updateMuteButtons();

function initAudio() {
  if (AC) return;
  try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { AC = null; }
}
document.addEventListener('pointerdown', initAudio, { once: true });
document.addEventListener('keydown', initAudio, { once: true });
function tone(freq, dur, type = 'sine', vol = 0.15, when = 0) {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = freq;
  const t0 = AC.currentTime + when;
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(masterOut()); o.start(t0); o.stop(t0 + dur + 0.02);
}
function beep(f, d) { tone(f, d, 'square', 0.05); }
function chime() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, i * 0.09)); }
async function drumroll() {
  if (!AC) { await sleep(2200); return; }
  for (let i = 0; i < 22; i++) { noiseHit(0.05, 0.04 + i * 0.004); await sleep(100); }
  tone(80, 0.6, 'sine', 0.5); noiseHit(0.5, 0.25);
}
function noiseHit(dur, vol) {
  if (!AC) return;
  const b = AC.createBuffer(1, AC.sampleRate * dur, AC.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = AC.createBufferSource(), g = AC.createGain(); g.gain.value = vol;
  s.buffer = b; s.connect(g).connect(masterOut()); s.start();
}
// ---- lyde til finalen ----
function noiseBuffer(dur) {
  const b = AC.createBuffer(1, Math.floor(AC.sampleRate * dur), AC.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
let murmurNode = null;
function murmurStart() { // publikum der summer
  if (!AC || murmurNode) return;
  const s = AC.createBufferSource(); s.buffer = noiseBuffer(2); s.loop = true;
  const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 480; f.Q.value = 0.7;
  const g = AC.createGain(); g.gain.setValueAtTime(0, AC.currentTime); g.gain.linearRampToValueAtTime(0.06, AC.currentTime + 1.5);
  s.connect(f).connect(g).connect(masterOut()); s.start();
  murmurNode = { s, g };
}
function murmurStop(fade = 1) {
  if (!AC || !murmurNode) return;
  const { s, g } = murmurNode; murmurNode = null;
  g.gain.cancelScheduledValues(AC.currentTime); g.gain.setValueAtTime(g.gain.value, AC.currentTime);
  g.gain.linearRampToValueAtTime(0, AC.currentTime + fade); s.stop(AC.currentTime + fade + 0.05);
}
function whoosh() { // tæppet suser ned
  if (!AC) return;
  const s = AC.createBufferSource(); s.buffer = noiseBuffer(1);
  const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(300, AC.currentTime); f.frequency.exponentialRampToValueAtTime(3500, AC.currentTime + 0.7);
  const g = AC.createGain(); g.gain.setValueAtTime(0.001, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.3, AC.currentTime + 0.45); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.95);
  s.connect(f).connect(g).connect(masterOut()); s.start();
}
function boom(vol = 1) { // dyb bas
  tone(48, 1.1, 'sine', 0.55 * vol); tone(96, 0.35, 'triangle', 0.15 * vol); noiseHit(0.25, 0.12 * vol);
}
function cheer(len = 1) { // publikum jubler
  if (!AC) return;
  const dur = 4.5 * len;
  const s = AC.createBufferSource(); s.buffer = noiseBuffer(dur);
  const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 0.6;
  const g = AC.createGain(); g.gain.setValueAtTime(0.001, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.16, AC.currentTime + 0.5); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
  s.connect(f).connect(g).connect(masterOut()); s.start();
  for (let i = 0; i < 6; i++) { // enkelte "wuhuu"-råb
    const o = AC.createOscillator(), og = AC.createGain(), t0 = AC.currentTime + 0.2 + Math.random() * 1.5;
    o.type = 'sine'; o.frequency.setValueAtTime(500 + Math.random() * 300, t0); o.frequency.exponentialRampToValueAtTime(1000 + Math.random() * 400, t0 + 0.4);
    og.gain.setValueAtTime(0.001, t0); og.gain.exponentialRampToValueAtTime(0.025, t0 + 0.1); og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
    o.connect(og).connect(masterOut()); o.start(t0); o.stop(t0 + 0.65);
  }
}
async function drumrollShort() {
  if (!AC) return;
  for (let i = 0; i < 14; i++) { noiseHit(0.04, 0.03 + i * 0.004); await sleep(85); }
}

let musicOn = false;
function startMusic() {
  if (!AC || musicOn) return;
  musicOn = true;
  const bass = [110, 110, 146.8, 130.8], mel = [440, 523, 587, 659, 587, 523, 440, 392];
  let step = 0;
  const tick = () => {
    if (step > 32 * 8) return; // ca. 32 takter
    const b = step % 8;
    if (b % 2 === 0) tone(60, 0.18, 'sine', 0.35);               // stortromme
    if (b === 2 || b === 6) noiseHit(0.12, 0.12);                  // lilletromme
    noiseHit(0.03, 0.03);                                           // hihat
    tone(bass[Math.floor(step / 8) % 4], 0.22, 'sawtooth', 0.05);
    if (step % 2 === 0) tone(mel[(step / 2) % 8], 0.2, 'triangle', 0.06);
    step++;
    setTimeout(tick, 220);
  };
  tick();
}
