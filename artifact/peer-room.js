// ====================================================================
// Multiplayer uden server (GitHub Pages): browserne forbindes direkte via
// WebRTC med PeerJS. Spil-koden bestemmer et fast "hub"-id. Den første spiller
// i spillet bliver hub og videresender alles tilstand til de andre. Forsvinder
// hubben, overtager en af de andre automatisk.
//
// Giver samme lille interface som claude.ai's room-capability, som motoren bruger:
//   join(name) -> { presence(patch), peers(), onPeers(fn), connected(), leave() }
//
// Egen PeerJS-server (valgfrit): ?peerhost=example.com&peerport=443&peerpath=/
// ====================================================================
const PEER_ROOM = (() => {
  if (typeof Peer === 'undefined') return null;
  const qp = new URLSearchParams(location.search);
  const opts = { debug: 0 };
  if (qp.get('peerhost')) {
    opts.host = qp.get('peerhost');
    opts.port = Number(qp.get('peerport') || 443);
    opts.path = qp.get('peerpath') || '/';
    opts.secure = qp.get('peersecure') !== '0';
  }
  const PREFIX = 'scenewhat-v1-';

  function join(name) {
    return new Promise((resolve) => {
      const hubId = PREFIX + name;
      let mine = {};
      let others = new Map();          // peer-id -> presence
      const handlers = new Set();
      const hubConns = new Map();      // kun hos hubben: peer-id -> forbindelse
      const lastSeen = new Map();      // kun hos hubben: peer-id -> tid for sidste besked
      let hubLastSeen = 0;             // kun hos klienter
      const HEARTBEAT_MS = 2000, TIMEOUT_MS = 7000;
      let peer = null, isHub = false, toHub = null, left = false, resolved = false;

      let fireQueued = false;
      const snap = () => [
        { isMe: true, presence: mine },
        ...[...others].map(([id, p]) => ({ isMe: false, peer: id, presence: p || {} })),
      ];
      const fire = () => {
        if (fireQueued) return;
        fireQueued = true;
        setTimeout(() => {
          fireQueued = false;
          const peers = snap();
          for (const h of handlers) { try { h({ peers, joined: [], left: [], updated: [] }); } catch (e) { console.error(e); } }
        }, 16);
      };

      // hubben sender hele listen til alle (højst ~15 gange i sekundet)
      let bcT = null;
      const hubBroadcast = () => {
        if (bcT) return;
        bcT = setTimeout(() => {
          bcT = null;
          if (!isHub || !peer) return;
          const list = [[peer.id, mine], ...others];
          for (const c of hubConns.values()) if (c.open) { try { c.send({ t: 'all', list }); } catch {} }
        }, 66);
      };
      // en klient sender sin egen tilstand til hubben
      let sendT = null;
      const sendToHub = () => {
        if (sendT) return;
        sendT = setTimeout(() => {
          sendT = null;
          if (toHub?.open) { try { toHub.send({ t: 'p', p: mine }); } catch {} }
        }, 50);
      };

      const api = {
        name,
        async presence(patch) {
          const next = { ...mine };
          for (const [k, v] of Object.entries(patch || {})) { if (v === null) delete next[k]; else next[k] = v; }
          mine = next;
          if (isHub) hubBroadcast(); else sendToHub();
          fire();
        },
        peers: snap,
        onPeers(h) { handlers.add(h); fire(); return () => handlers.delete(h); },
        connected: () => !!peer && (isHub || !!toHub?.open),
        async leave() { left = true; handlers.clear(); try { peer?.destroy(); } catch {} },
      };
      const done = () => { if (!resolved) { resolved = true; resolve(api); } };
      setTimeout(done, 7000); // spillet kører videre alene, hvis forbindelsen tager for lang tid

      const retry = () => { if (!left) setTimeout(becomeHub, 300 + Math.random() * 1500); };

      function onConn(c) {
        c.on('open', () => {
          hubConns.set(c.peer, c); lastSeen.set(c.peer, Date.now());
          try { c.send({ t: 'all', list: [[peer.id, mine], ...others] }); } catch {}
        });
        c.on('data', (d) => {
          lastSeen.set(c.peer, Date.now());
          if (d && d.t === 'p' && d.p && typeof d.p === 'object') { others.set(c.peer, d.p); hubBroadcast(); fire(); }
        });
        const gone = () => { hubConns.delete(c.peer); lastSeen.delete(c.peer); try { c.close(); } catch {} if (others.delete(c.peer)) { hubBroadcast(); fire(); } };
        c._gone = gone;
        c.on('close', gone);
        c.on('error', gone);
      }

      function becomeHub() {
        if (left) return;
        const p = new Peer(hubId, opts);
        let opened = false;
        p.on('open', () => {
          opened = true; peer = p; isHub = true; toHub = null; others = new Map();
          p.on('connection', onConn);
          fire(); done();
        });
        p.on('error', (e) => {
          if (opened) return;
          try { p.destroy(); } catch {}
          if (e.type === 'unavailable-id') becomeClient(); // en anden er allerede hub
          else retry();
        });
        p.on('disconnected', () => { if (!left && !p.destroyed) { try { p.reconnect(); } catch {} } });
      }

      function becomeClient() {
        if (left) return;
        const p = new Peer(opts);
        let failed = false;
        const fail = () => {
          if (failed || left) return;
          failed = true; toHub = null; peer = null; others = new Map(); fire();
          try { p.destroy(); } catch {}
          retry();
        };
        p.on('open', () => {
          peer = p; isHub = false;
          const c = p.connect(hubId, { reliable: true });
          const t = setTimeout(() => { if (!c.open) fail(); }, 9000);
          c.on('open', () => {
            clearTimeout(t); toHub = c; hubLastSeen = Date.now(); c._fail = fail;
            try { c.send({ t: 'p', p: mine }); } catch {}
            done();
          });
          c.on('data', (d) => {
            hubLastSeen = Date.now();
            if (d && d.t === 'all' && Array.isArray(d.list)) {
              others = new Map(d.list.filter((e) => Array.isArray(e) && e[0] !== p.id && e[1] && typeof e[1] === 'object'));
              fire();
            }
          });
          c.on('close', fail);
          c.on('error', fail);
        });
        p.on('error', fail); // fx "peer-unavailable": hubben er væk -> prøv at blive hub
        p.on('disconnected', () => { if (!left && !p.destroyed) { try { p.reconnect(); } catch {} } });
      }

      // Hjerteslag: opdag hurtigt, hvis en forbindelse er død (fx lukket fane på mobil)
      setInterval(() => {
        if (left || !peer) return;
        const now = Date.now();
        if (isHub) {
          for (const [id, c] of hubConns) if (now - (lastSeen.get(id) || now) > TIMEOUT_MS) c._gone?.();
          const list = [[peer.id, mine], ...others];
          for (const c of hubConns.values()) if (c.open) { try { c.send({ t: 'all', list }); } catch {} }
        } else if (toHub) {
          if (now - hubLastSeen > TIMEOUT_MS) { toHub._fail?.(); return; }
          try { toHub.send({ t: 'p', p: mine }); } catch {}
        }
      }, HEARTBEAT_MS);

      becomeHub();
    });
  }

  return { join };
})();
