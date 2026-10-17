// Messages are relayed live through Supabase Realtime "broadcast": they pass
// through and are never stored anywhere. Works through VPNs and firewalls.
const SB_URL = 'https://phutnwiwaoncduwvlfhb.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBodXRud2l3YW9uY2R1d3ZsZmhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5NjAwOTgsImV4cCI6MjEwNzUzNjA5OH0.CJjyXfc_UH95MslVjW8Pa8n9vPVMbj0mbZsIQZkSGNs';
const log = document.getElementById('log');
const form = document.getElementById('form');
const input = document.getElementById('input');
const prompt = document.getElementById('prompt');
const typed = document.getElementById('typed');
const lineEl = document.getElementById('line');

// Typing goes straight to the prompt line: no clicking needed.
const sync = () => { typed.textContent = input.value; document.body.scrollTop = document.body.scrollHeight; };
input.addEventListener('input', sync);
const grab = () => { if (document.activeElement !== input) input.focus({ preventScroll: true }); };
document.addEventListener('click', grab);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (state === 'chat' || state === 'waiting')) return goHome(e);
  if (document.activeElement === input || e.ctrlKey || e.metaKey || e.altKey) return;
  grab();
  if (e.key.length === 1) { input.value += e.key; sync(); e.preventDefault(); }
  else if (e.key === 'Backspace') { input.value = input.value.slice(0, -1); sync(); e.preventDefault(); }
  else if (e.key === 'Enter') { form.requestSubmit(); e.preventDefault(); }
});
window.addEventListener('focus', grab);
setLocked(false);
grab();

function setLocked(on) {
  input.disabled = on;
  lineEl.classList.toggle('locked', on);
  if (!on) setTimeout(grab, 0);
}
window.onerror = (m) => line('error: ' + m, 'bad');
let state = 'ip'; // ip -> waiting -> chat -> done
let me = null, target = null, chan = null, peerId = null;
// The chat survives a refresh (sessionStorage), but is gone when the tab closes.
const SKEY = 'ipchat:' + (new URLSearchParams(location.search).get('as') || '');
let sess = {};
try { sess = JSON.parse(sessionStorage.getItem(SKEY) || '{}') || {}; } catch {}
const save = () => { try { sessionStorage.setItem(SKEY, JSON.stringify(sess)); } catch {} };
const forget = () => { try { sessionStorage.removeItem(SKEY); } catch {} sess = {}; };
const myId = sess.id || (sess.id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)));
save();
function chatLine(text) { line(text); (sess.msgs = sess.msgs || []).push(text); if (sess.msgs.length > 300) sess.msgs.shift(); save(); }

function line(text, sys) {
  const div = document.createElement('div');
  if (sys) div.className = sys === 'bad' ? 'bad' : 'sys';
  div.textContent = text;
  log.appendChild(div);
  document.body.scrollTop = document.body.scrollHeight;
}

async function hash(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ipchat:' + TEST + s));
  return 'ipchat-' + [...new Uint8Array(buf)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Test mode: ?as=1.1.1.1 pretends to be that ip. Test users can only match other test users.
const fakeIp = new URLSearchParams(location.search).get('as');
const TEST = fakeIp ? 'test:' : '';

let sb = null;
try { sb = (window.SB_MOCK || supabase).createClient(SB_URL, SB_KEY, { realtime: { params: { eventsPerSecond: 40 } } }); }
catch { line('could not load the chat relay, reload the page', 'bad'); }

(fakeIp ? Promise.resolve({ ip: fakeIp.slice(0, 64) }) : fetch('/api/ip', { cache: 'no-store' }).then(r => r.json())
  .then(d => d.ip ? d : Promise.reject())
  .catch(() => fetch('https://api.ipify.org?format=json').then(r => r.json()))).then(d => {
  me = d.ip;
  if (TEST) line('[test mode]', true);
  line('your ip: ' + me, true);
  line('type the ip you want to connect to (or your own ip for a group chat with everyone on it)', true);
  if (sess.me === me && sess.target === me) startGroup(); // refreshed mid group chat
  else if (sess.me === me && sess.target) {
    // refreshed mid-chat: go straight back into the same room
    state = 'waiting'; target = sess.target; setLocked(true); start();
  } else { listen(); watchGroup(); }
}).catch(() => line('could not get your ip, reload the page', 'bad'));

const pingEl = document.getElementById('ping');
// "11ms (stable)" / "500ms (unstable)" from the last few round trips
const pings = [];
function showPing(ms) {
  pings.push(ms); if (pings.length > 5) pings.shift();
  const avg = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
  const jitter = Math.max(...pings) - Math.min(...pings);
  const stable = avg < 250 && jitter < 150;
  pingEl.textContent = ms + 'ms (' + (stable ? 'stable' : 'unstable') + ')';
  pingEl.className = stable ? 'ok' : 'slow';
}
let pingTimer = null, lastHeard = 0, graceTimer = null;

// Inbox: while you're not chatting, anyone who types your ip shows up here as a
// count. Their ip is never shown or sent.
const reqsEl = document.getElementById('reqs');
let inbox = null, outbox = null, reqCount = 0;

function showReqs() {
  reqsEl.textContent = reqCount && state !== 'chat' && state !== 'done' ? 'an ip is requesting you (' + reqCount + ')' : '';
}

async function listen() {
  if (!sb || state === 'chat' || state === 'done') return;
  inbox = sb.channel(await hash('inbox>' + me), { config: { presence: { key: myId } } });
  inbox.on('presence', { event: 'sync' }, () => {
    const st = inbox.presenceState();
    reqCount = Object.keys(st).filter(k => k !== myId && st[k].some(m => m.role === 'req')).length;
    showReqs();
  }).subscribe(st => { if (st === 'SUBSCRIBED' && inbox) inbox.track({ role: 'box' }); });
}

function stopListening() {
  if (inbox) sb.removeChannel(inbox);
  inbox = null; reqCount = 0; showReqs();
  if (lobby) sb.removeChannel(lobby);
  lobby = null; grpEl.textContent = '';
}

// While waiting, sit in the target's inbox so they see the request.
async function request() {
  outbox = sb.channel(await hash('inbox>' + target), { config: { presence: { key: myId } } });
  outbox.subscribe(st => { if (st === 'SUBSCRIBED' && outbox) outbox.track({ role: 'req' }); });
}

function stopRequesting() {
  if (outbox) sb.removeChannel(outbox);
  outbox = null;
}

// End-to-end encryption: each side makes a key pair (ECDH P-256) and shares only
// the public half. Every message, ping and file piece is sealed with AES-GCM, so
// the relay (or anyone else who joins the room) can't read or fake them.
const EC = { name: 'ECDH', namedCurve: 'P-256' };
let keyPair = null, aesKey = null, myPk = null, inQ = Promise.resolve();
async function initKeys() {
  if (keyPair) return;
  try {
    if (sess.jwk) keyPair = { privateKey: await crypto.subtle.importKey('jwk', sess.jwk.priv, EC, true, ['deriveKey']),
                              publicKey: await crypto.subtle.importKey('jwk', sess.jwk.pub, EC, true, []) };
  } catch { keyPair = null; }
  if (!keyPair) {
    keyPair = await crypto.subtle.generateKey(EC, true, ['deriveKey']);
    sess.jwk = { priv: await crypto.subtle.exportKey('jwk', keyPair.privateKey), pub: await crypto.subtle.exportKey('jwk', keyPair.publicKey) };
    save();
  }
  myPk = toB64(new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey)));
}
// One key per possible match (a person can show up twice for a moment, e.g. an old
// tab the relay hasn't dropped yet). Whoever actually sends us a message we can
// decrypt is the real one, because they can only encrypt for us if they chose us.
const peerKeys = {}; // presence key -> Promise<{ pk, key, code }>
function keyFor(id, pk) {
  const k = peerKeys[id];
  if (k && k.pk === pk) return k.p;
  const p = (async () => {
    const pub = await crypto.subtle.importKey('raw', fromB64(pk), EC, false, []);
    const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, keyPair.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([myPk, pk].sort().join('|'))));
    const code = [...h.slice(0, 6)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g).join('-');
    return { key, code };
  })();
  peerKeys[id] = { pk, p };
  return p;
}
async function send(event, payload) {
  if (group) return sendGroup(event, payload);
  if (!chan || !aesKey) return 'not ready';
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new TextEncoder().encode(JSON.stringify(Object.assign({ e: event, from: myId }, payload)));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, body));
  return chan.send({ type: 'broadcast', event: 'x', payload: { from: myId, iv: toB64(iv), ct: toB64(ct) } });
}

function end(msg) {
  stopListening();
  stopRequesting();
  if (state === 'done') return;
  if (msg) line(msg, 'bad');
  clearInterval(pingTimer);
  pingEl.textContent = '';
  state = 'done';
  setLocked(true);
  if (chan) { sb.removeChannel(chan); chan = null; }
}

// Other side left: show it for a moment, then wipe everything and go back home.
function left() {
  if (state === 'done') return;
  forget();
  end(target + ' disconnected');
  setTimeout(() => location.reload(), 1500);
}

async function connected(id, pk) {
  peerId = id;
  state = 'chat';
  let code;
  try { const k = await keyFor(id, pk); aesKey = k.key; code = k.code; } catch { return end('error: could not set up encryption'); }
  stopListening();
  stopRequesting();
  log.textContent = '';
  line('connected to ' + target, true);
  line('encrypted. safety code: ' + code + ' (if it matches on both screens, no one is in the middle)', true);
  if (sess.target === target && sess.msgs) sess.msgs.forEach(m => line(m));
  else { sess.me = me; sess.target = target; sess.msgs = []; save(); }
  prompt.textContent = me + ': ';
  prompt.className = 'home';
  lineEl.classList.add('chat');
  prompt.title = 'leave chat';
  setLocked(false);
  // Ping every 4s (well inside the free message quota); 20s of silence = gone.
  lastHeard = Date.now();
  const ping = () => {
    if (Date.now() - lastHeard > 20000) return left();
    send('ping', { ts: Date.now() });
  };
  pingTimer = setInterval(ping, 4000);
  ping();
}

let candidates = new Set();
async function switchPeer(id, pk) {
  if (id === peerId) return;
  try { const k = await keyFor(id, pk); peerId = id; aesKey = k.key; line('safety code updated: ' + k.code, true); } catch {}
}

// ---------- group chat: everyone on the same ip ----------
// Typing your own ip joins a room shared by everyone on that ip. Each message gets a
// fresh AES key; that key is wrapped separately for every member with the pairwise
// ECDH key, so it's still one relay message and still end-to-end encrypted.
let group = false, lobby = null, myTag = '', groupPingTimer = null;
const members = {}; // presence key -> { pk, key, tag, gone }
const grpEl = document.getElementById('grp');
const tagOf = async pk => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pk)))].slice(0, 2).map(b => b.toString(16).padStart(2, '0')).join('');
const who = id => me + ' (' + (id === myId ? myTag : members[id] ? members[id].tag : '????') + ')';

// home screen: how many people are in your ip's group right now
async function watchGroup() {
  if (!sb) return;
  lobby = sb.channel(await hash('group|' + me), { config: { presence: { key: myId } } });
  lobby.on('presence', { event: 'sync' }, () => {
    const st = lobby.presenceState();
    const n = Object.keys(st).filter(k => k !== myId && st[k].some(m => m.group)).length;
    grpEl.textContent = n && state === 'ip' ? n + (n === 1 ? ' person is' : ' people are') + " in your ip's group chat. type your ip to join" : '';
  }).subscribe(st => { if (st === 'SUBSCRIBED' && lobby) lobby.track({ watch: true }); });
}

async function sendGroup(event, payload, only) {
  if (!chan) return 'not ready';
  const ids = (only || Object.keys(members)).filter(i => members[i] && members[i].key);
  if (!ids.length) return 'ok'; // nobody else here yet
  const ck = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', ck));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, new TextEncoder().encode(JSON.stringify(Object.assign({ e: event, from: myId }, payload)))));
  const keys = {};
  for (const id of ids) {
    const wiv = crypto.getRandomValues(new Uint8Array(12));
    keys[id] = { iv: toB64(wiv), k: toB64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wiv }, members[id].key, raw))) };
  }
  return chan.send({ type: 'broadcast', event: 'g', payload: { from: myId, iv: toB64(iv), ct: toB64(ct), keys } });
}

async function startGroup() {
  if (!sb) return end('error: chat relay failed to load, reload the page');
  try { await initKeys(); } catch { return end('error: this browser does not support encryption'); }
  myTag = await tagOf(myPk);
  group = true; target = me; state = 'chat';
  stopListening();
  log.textContent = '';
  line('group chat for everyone on ' + me + '. end-to-end encrypted.', true);
  line('you are ' + who(myId), true);
  if (sess.target === me && sess.msgs) sess.msgs.forEach(m => line(m));
  else { sess.me = me; sess.target = me; sess.msgs = []; save(); }
  prompt.textContent = who(myId) + ': ';
  prompt.className = 'home';
  lineEl.classList.add('chat');
  prompt.title = 'leave chat';
  setLocked(false);

  chan = sb.channel(await hash('group|' + me), { config: { broadcast: { self: false }, presence: { key: myId } } });
  chan.on('presence', { event: 'sync' }, async () => {
    const st = chan.presenceState(), here = {};
    for (const [k, ms] of Object.entries(st)) {
      if (k === myId) continue;
      const m = ms.reduce((a, b) => ((b && b.at) > (a && a.at) ? b : a), ms[0]);
      if (m && m.group && m.ip === me && typeof m.pk === 'string' && m.pk.length < 200) here[k] = m;
    }
    for (const id of Object.keys(here).slice(0, 30)) {
      if (members[id] && members[id].pk === here[id].pk) {
        if (members[id].gone) { clearTimeout(members[id].gone); members[id].gone = null; }
        continue;
      }
      try {
        const k = await keyFor(id, here[id].pk), fresh = !members[id];
        members[id] = { pk: here[id].pk, key: k.key, tag: await tagOf(here[id].pk), gone: null };
        if (fresh) line(members[id].tag + ' joined', true);
      } catch {}
    }
    // someone missing: give them a few seconds in case they're just refreshing
    for (const id of Object.keys(members)) if (!here[id] && !members[id].gone) {
      members[id].gone = setTimeout(() => {
        const s2 = chan && chan.presenceState();
        if (!members[id]) return;
        if (s2 && s2[id]) { members[id].gone = null; return; }
        line(members[id].tag + ' left', true); delete members[id];
      }, 6000);
    }
  });
  chan.on('broadcast', { event: 'g' }, ({ payload: p }) => {
    if (!p || !members[p.from] || typeof p.iv !== 'string' || typeof p.ct !== 'string' || p.ct.length > 90000) return;
    const w = p.keys && p.keys[myId];
    if (!w || typeof w.iv !== 'string' || typeof w.k !== 'string') return;
    const mem = members[p.from];
    inQ = inQ.then(async () => {
      const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(w.iv) }, mem.key, fromB64(w.k));
      const ck = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
      const d = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(p.iv) }, ck, fromB64(p.ct))));
      if (!d || d.from !== p.from) return;
      if (d.e === 'msg' && typeof d.text === 'string') { if (allow(inRate, 8)) chatLine(who(p.from) + ': ' + d.text.slice(0, 2000)); }
      else if (d.e === 'file') gotChunk(d, who(p.from));
      else if (d.e === 'ping') sendGroup('pong', { to: d.from, ts: d.ts }, [d.from]);
      else if (d.e === 'pong' && d.to === myId) showPing(Math.max(0, Date.now() - d.ts));
    }).catch(() => {});
  });
  let warned = false;
  chan.subscribe(st => {
    if (st === 'SUBSCRIBED') chan.track({ ip: me, group: true, at: Date.now(), pk: myPk });
    else if ((st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') && !warned) { warned = true; line("can't reach the chat relay right now, retrying...", 'bad'); }
  });
  // ping one other member every 8s (one ping + one pong, so groups stay cheap)
  groupPingTimer = setInterval(() => { const ids = Object.keys(members); if (ids.length) sendGroup('ping', { ts: Date.now() }, [ids[0]]); else { pingEl.textContent = ''; } }, 8000);
}

async function start() {
  if (!sb) return end('error: chat relay failed to load, reload the page');
  try { await initKeys(); } catch { return end('error: this browser does not support encryption'); }
  // Both people land in the same room: it's named after the pair of ips.
  const room = await hash([me, target].sort().join('|'));
  line('waiting for ' + target + ' to enter your ip...', true);
  chan = sb.channel(room, { config: { broadcast: { self: false }, presence: { key: myId } } });

  chan.on('presence', { event: 'sync' }, () => {
    const st = chan.presenceState();
    // someone at the target ip who typed our ip; newest first (old tabs linger a while)
    const newest = ms => ms.reduce((a, b) => ((b && b.at) > (a && a.at) ? b : a), ms[0]);
    const others = Object.entries(st).map(([k, ms]) => [k, newest(ms)])
      .filter(([k, m]) => k !== myId && m && m.ip === target && m.want === me && typeof m.pk === 'string' && m.pk.length < 200)
      .sort((a, b) => b[1].at - a[1].at);
    candidates = new Set(others.map(o => o[0]));
    others.forEach(([k, m]) => keyFor(k, m.pk).catch(() => {}));
    if (state === 'waiting' && others.length) connected(others[0][0], others[0][1].pk);
    else if (state === 'chat') {
      if (st[peerId]) { clearTimeout(graceTimer); graceTimer = null; }
      else if (others.length) switchPeer(others[0][0], others[0][1].pk);
      else if (!graceTimer) graceTimer = setTimeout(() => { graceTimer = null; const s2 = chan && chan.presenceState(); if (state === 'chat' && s2 && !s2[peerId]) left(); }, 6000);
    }
  });

  const handle = {
    msg(d) { if (typeof d.text !== 'string' || !allow(inRate, 8)) return; chatLine(target + ': ' + d.text.slice(0, 2000)); },
    ping(d) { send('pong', { to: d.from, ts: d.ts }); },
    pong(d) { if (d.to === myId) showPing(Math.max(0, Date.now() - d.ts)); },
    bye() { left(); },
    file(d) { gotChunk(d); },
  };
  chan.on('broadcast', { event: 'x' }, ({ payload: p }) => {
    if (!p || state !== 'chat' || typeof p.iv !== 'string' || typeof p.ct !== 'string' || p.ct.length > 90000) return;
    if (p.from !== peerId && !candidates.has(p.from)) return;
    const k = peerKeys[p.from];
    if (!k) return;
    // decrypt in order; anything that fails to decrypt (wrong key, tampered) is dropped
    inQ = inQ.then(async () => {
      const { key, code } = await k.p;
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(p.iv) }, key, fromB64(p.ct));
      const d = JSON.parse(new TextDecoder().decode(pt));
      if (!d || d.from !== p.from || !Object.hasOwn(handle, d.e)) return;
      if (p.from !== peerId) { peerId = p.from; aesKey = key; line('safety code updated: ' + code, true); }
      lastHeard = Date.now();
      handle[d.e](d);
    }).catch(() => {});
  });

  let warned = false;
  chan.subscribe(st => {
    if (st === 'SUBSCRIBED') chan.track({ ip: me, want: target, at: Date.now(), pk: myPk });
    else if ((st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') && !warned) { warned = true; line("can't reach the chat relay right now, retrying...", 'bad'); }
  });
  request();
}

// Files are sent in small pieces through the relay and rebuilt on the other side.
// Nothing is uploaded or stored anywhere.
// Limits: 5mb per file, one file at a time. Pieces are 32kb so they still fit the
// relay's ~100kb message limit after encryption. The receiver enforces the same limits.
const MAX_FILE = 5 * 1024 * 1024, CHUNK = 32 * 1024, MAX_PARTS = Math.ceil(MAX_FILE / CHUNK);
const fileInput = document.getElementById('file');
const size = (n) => n < 1024 ? n + 'b' : n < 1048576 ? (n / 1024).toFixed(0) + 'kb' : (n / 1048576).toFixed(1) + 'mb';
const incoming = {};
const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b) => Uint8Array.from(atob(b), c => c.charCodeAt(0));
const inRate = [], outRate = [];
function allow(arr, perSec) { const now = Date.now(); while (arr.length && now - arr[0] > 1000) arr.shift(); if (arr.length >= perSec) return false; arr.push(now); return true; }
let sending = false;

function gotChunk(d, label) {
  if (typeof d.id !== 'string' || typeof d.b !== 'string' || !(d.n > 0) || d.n > MAX_PARTS || !(d.i >= 0 && d.i < d.n)) return;
  if (d.b.length > CHUNK * 1.4) return;
  if (!incoming[d.id] && Object.keys(incoming).length >= 2) return; // at most 2 files arriving at once
  const f = incoming[d.id] || (incoming[d.id] = { parts: [], got: 0, bytes: 0, at: Date.now(), el: null });
  if (f.parts[d.i]) return;
  f.parts[d.i] = fromB64(d.b); f.got++; f.bytes += f.parts[d.i].length;
  if (f.bytes > MAX_FILE) { delete incoming[d.id]; if (f.el) f.el.remove(); return line('blocked a file over 5mb', 'bad'); }
  if (!f.el) { f.el = document.createElement('div'); f.el.className = 'sys'; log.appendChild(f.el); }
  f.el.textContent = 'receiving ' + String(d.name || 'file').slice(0, 100) + '... ' + Math.round(f.got / d.n * 100) + '%';
  if (f.got === d.n) { delete incoming[d.id]; f.el.remove(); fileLine(label || target, d.name, d.type, new Blob(f.parts)); }
}
// drop half-received files that stalled
setInterval(() => { for (const k in incoming) if (Date.now() - incoming[k].at > 120000) { if (incoming[k].el) incoming[k].el.remove(); delete incoming[k]; } }, 10000);

function fileLine(from, name, type, data) {
  // always a plain download: a file claiming to be a web page must never run on this site
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const div = document.createElement('div');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = String(name || 'file').slice(0, 200);
  a.textContent = a.download;
  div.append(from + ': [file] ', a, ' (' + size(blob.size) + ')');
  log.appendChild(div);
  document.body.scrollTop = document.body.scrollHeight;
  (sess.msgs = sess.msgs || []).push(from + ': [file] ' + String(name || 'file').slice(0, 200) + ' (' + size(blob.size) + ', not kept after refresh)'); save();
}

document.getElementById('plus').addEventListener('click', (e) => {
  e.stopPropagation();
  if (state === 'chat') fileInput.click();
});
fileInput.addEventListener('change', async () => {
  const f = fileInput.files[0];
  fileInput.value = '';
  if (!f || state !== 'chat') return;
  if (sending) return line('wait for the current file to finish', 'bad');
  if (f.size > MAX_FILE) return line('file too big (max 5mb)', 'bad');
  sending = true;
  const u8 = new Uint8Array(await f.arrayBuffer());
  const n = Math.max(1, Math.ceil(u8.length / CHUNK)), id = myId + ':' + Date.now();
  const status = document.createElement('div'); status.className = 'sys'; log.appendChild(status);
  try {
    for (let i = 0; i < n; i++) {
      if (state !== 'chat') return;
      status.textContent = 'sending ' + f.name + '... ' + Math.round(i / n * 100) + '%';
      const piece = { id, i, n, name: f.name.slice(0, 200), type: f.type.slice(0, 100), b: toB64(u8.subarray(i * CHUNK, (i + 1) * CHUNK)) };
      let r = await send('file', piece);
      for (let k = 0; k < 4 && r !== 'ok'; k++) { await new Promise(res => setTimeout(res, 300)); r = await send('file', piece); }
      if (r !== 'ok') { status.remove(); return line('file failed to send, try again', 'bad'); }
      await new Promise(res => setTimeout(res, 40));
    }
    status.remove();
    fileLine(me, f.name, f.type, u8);
  } finally { sending = false; grab(); }
});

function sayBye() { if (state === 'chat') try { send('bye', {}); } catch {} }

// Clicking "ipchat" or your ip leaves the chat and goes back to the start.
function goHome(e) {
  e.preventDefault();
  e.stopPropagation();
  sayBye();
  forget();
  setTimeout(() => location.reload(), 150);
}
document.getElementById('home').addEventListener('click', goHome);

// donation address: click to copy
const donateEl = document.getElementById('donate');
donateEl.addEventListener('click', (e) => {
  e.stopPropagation();
  const addr = document.getElementById('sol').textContent;
  (navigator.clipboard ? navigator.clipboard.writeText(addr) : Promise.reject()).then(() => {
    const b = document.getElementById('sol'); b.textContent = 'copied'; setTimeout(() => { b.textContent = addr; grab(); }, 1200);
  }).catch(() => {});
});
prompt.addEventListener('click', (e) => { if (state === 'chat') goHome(e); });

function validIp(v) {
  if (/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(v)) return true;
  if (v.includes(':') && /^[0-9a-fA-F:.]{2,45}$/.test(v)) { try { new URL('http://[' + v + ']'); return true; } catch {} }
  return false;
}

form.onsubmit = (e) => {
  e.preventDefault();
  const v = input.value;
  if (!v.trim() || (state === 'ip' && !me)) return;
  input.value = '';
  sync();
  if (state === 'ip' && me) {
    if (!validIp(v.trim())) return line('not a valid ip address', 'bad');
    if (v.trim() === me) { setLocked(true); return startGroup(); }
    state = 'waiting';
    target = v.trim().slice(0, 64);
    setLocked(true);
    start();
  } else if (state === 'chat') {
    const text = v.slice(0, 2000);
    if (!allow(outRate, 5)) { input.value = v; sync(); return line('slow down', 'bad'); }
    send('msg', { text });
    chatLine(me + ': ' + text);
  }
};
