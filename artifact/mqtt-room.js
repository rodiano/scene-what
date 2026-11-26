// ====================================================================
// Multiplayer via en offentlig MQTT-broker over WebSocket (wss://).
// Går gennem de fleste firewalls og kræver ingen direkte forbindelse mellem
// spillerne. Hver spiller udgiver sin tilstand som en "retained" besked på sit
// eget emne og abonnerer på alle andres i samme spil. Lukker man fanen, rydder
// brokeren ens emne via MQTT's "last will".
//
// Egen broker (valgfrit): ?mqtt=wss://min.broker.dk:8884/mqtt   (?mqtt=off slår den fra)
// ====================================================================
const MQTT_ROOM = (() => {
  if (typeof mqtt === 'undefined') return null;
  const qp = new URLSearchParams(location.search);
  const URL_ = qp.get('mqtt') || 'wss://broker.hivemq.com:8884/mqtt';
  if (URL_ === 'off') return null;
  const BASE = 'scenewhat/v1/';
  const STALE_MS = 25_000;      // en spiller uden opdateringer så længe regnes som væk
  const HEARTBEAT_MS = 5_000;

  function join(name) {
    return new Promise((resolve) => {
      const cid = 'sw-' + Math.random().toString(36).slice(2, 12);
      const topicBase = BASE + name + '/p/';
      const myTopic = topicBase + cid;
      let mine = {};
      const others = new Map();        // cid -> { p: presence, seen: ms }
      const handlers = new Set();
      let left = false, resolved = false, lastError = '', everConnected = false;

      const snap = () => [
        { isMe: true, presence: mine },
        ...[...others].map(([id, o]) => ({ isMe: false, peer: id, presence: o.p })),
      ];
      let fq = false;
      const fire = () => {
        if (fq) return; fq = true;
        setTimeout(() => { fq = false; const peers = snap(); for (const h of handlers) { try { h({ peers, joined: [], left: [], updated: [] }); } catch (e) { console.error(e); } } }, 16);
      };

      const client = mqtt.connect(URL_, {
        clientId: cid, clean: true, keepalive: 20, reconnectPeriod: 3000, connectTimeout: 8000,
        will: { topic: myTopic, payload: '', retain: true, qos: 0 },
      });
      const done = () => { if (!resolved) { resolved = true; resolve(api); } };
      setTimeout(done, 7000);

      let pubT = null, lastPub = 0;
      const publish = () => {
        if (pubT || left) return;
        const wait = Math.max(0, 150 - (Date.now() - lastPub));
        pubT = setTimeout(() => {
          pubT = null; lastPub = Date.now();
          if (!client.connected) return;
          try { client.publish(myTopic, JSON.stringify({ ...mine, _ts: Date.now() }), { retain: true, qos: 0 }); } catch {}
        }, wait);
      };

      client.on('connect', () => {
        everConnected = true; lastError = '';
        client.subscribe(topicBase + '+', { qos: 0 }, (err) => { if (err) lastError = 'subscribe'; });
        publish(); fire(); done();
      });
      client.on('message', (topic, buf) => {
        const id = topic.slice(topicBase.length);
        if (id === cid) return;
        const txt = buf.toString();
        if (!txt) { if (others.delete(id)) fire(); return; }
        try {
          const p = JSON.parse(txt);
          if (!p || typeof p !== 'object') return;
          if (typeof p._ts === 'number' && Date.now() - p._ts > 120_000) return; // gammel "retained" rest
          others.set(id, { p, seen: Date.now() });
          fire();
        } catch {}
      });
      client.on('error', (e) => { lastError = (e && (e.code || e.message)) || 'fejl'; });
      client.on('offline', () => { if (!lastError) lastError = 'offline'; fire(); });

      const iv = setInterval(() => {
        if (left) return;
        publish(); // hjerteslag
        const now = Date.now();
        let changed = false;
        for (const [id, o] of others) if (now - o.seen > STALE_MS) { others.delete(id); changed = true; }
        if (changed) fire();
      }, HEARTBEAT_MS);

      const api = {
        name,
        async presence(patch) {
          const next = { ...mine };
          for (const [k, v] of Object.entries(patch || {})) { if (v === null) delete next[k]; else next[k] = v; }
          mine = next; publish(); fire();
        },
        peers: snap,
        onPeers(h) { handlers.add(h); fire(); return () => handlers.delete(h); },
        connected: () => client.connected,
        status: () => ({ state: client.connected ? 'connected' : 'connecting', error: client.connected ? '' : lastError || (everConnected ? 'afbrudt' : '') }),
        async leave() {
          left = true; clearInterval(iv); handlers.clear();
          try { client.publish(myTopic, '', { retain: true, qos: 0 }); } catch {}
          try { client.end(false); } catch {}
        },
      };
      // ryd mit emne, når fanen lukkes
      addEventListener('pagehide', () => { try { client.publish(myTopic, '', { retain: true, qos: 0 }); } catch {} });
    });
  }
  return { join };
})();

// ====================================================================
// Kombinerer flere forbindelsesveje (MQTT + PeerJS). Spillerne kan se hinanden,
// så længe mindst én vej virker. Samme spiller set via begge veje vises én gang
// (den nyeste tilstand vinder).
// ====================================================================
const MULTI_ROOM = (() => {
  const transports = [
    ['MQTT', typeof MQTT_ROOM !== 'undefined' ? MQTT_ROOM : null],
    ['P2P', typeof PEER_ROOM !== 'undefined' ? PEER_ROOM : null],
  ].filter(([, t]) => t);
  if (!transports.length) return null;

  async function join(name) {
    const rooms = [];
    // start alle samtidig; vent kun på den første, der lykkes (eller alle, hvis ingen gør)
    const joins = transports.map(([label, t]) => t.join(name).then((r) => { rooms.push([label, r]); return r; }).catch(() => null));
    await Promise.race([
      Promise.all(joins),
      new Promise((res) => { const iv = setInterval(() => { if (rooms.some(([, r]) => r.connected())) { clearInterval(iv); res(); } }, 100); }),
    ]);
    const handlers = new Set();
    let mine = {};
    const merged = () => {
      const best = new Map(); // spiller-id -> presence med nyeste _t
      for (const [, r] of rooms) for (const pe of r.peers()) {
        if (pe.isMe || !pe.presence?.p) continue;
        const id = String(pe.presence.p.id);
        const cur = best.get(id);
        if (!cur || (pe.presence._t || 0) > (cur._t || 0)) best.set(id, pe.presence);
      }
      return [{ isMe: true, presence: mine }, ...[...best.values()].map((p) => ({ isMe: false, presence: p }))];
    };
    let fq = false;
    const fire = () => {
      if (fq) return; fq = true;
      setTimeout(() => { fq = false; const peers = merged(); for (const h of handlers) { try { h({ peers, joined: [], left: [], updated: [] }); } catch (e) { console.error(e); } } }, 16);
    };
    const hook = ([, r]) => r.onPeers(fire);
    rooms.forEach(hook);
    // en vej, der først lykkes senere, kobles også på
    joins.forEach((j, i) => j.then((r) => { if (r && !hookedLater.has(i)) { hookedLater.add(i); r.onPeers(fire); r.presence(mine).catch(() => {}); } }));
    const hookedLater = new Set(rooms.map(([l]) => transports.findIndex(([tl]) => tl === l)));
    return {
      name,
      async presence(patch) {
        mine = { ...mine, ...patch, _t: Date.now() };
        for (const [k, v] of Object.entries(patch || {})) if (v === null) delete mine[k];
        for (const [, r] of rooms) r.presence({ ...patch, _t: mine._t }).catch(() => {});
        fire();
      },
      peers: merged,
      onPeers(h) { handlers.add(h); fire(); return () => handlers.delete(h); },
      connected: () => rooms.some(([, r]) => r.connected()),
      status() {
        const parts = transports.map(([label]) => {
          const r = rooms.find(([l]) => l === label)?.[1];
          const st = r?.status?.() || { state: 'connecting' };
          return `${label} ${st.state === 'connected' ? '✓' : '✗'}${st.state !== 'connected' && st.error ? ' (' + st.error + ')' : ''}`;
        });
        return { state: rooms.some(([, r]) => r.connected()) ? 'connected' : 'connecting', role: parts.join(', '), error: '' };
      },
      async leave() { handlers.clear(); for (const [, r] of rooms) { try { await r.leave(); } catch {} } },
    };
  }
  return { join };
})();
