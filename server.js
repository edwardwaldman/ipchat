// ipchat: type an IP, wait for that IP to type yours, then chat.
// Messages are relayed in memory only. Nothing is logged or stored.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
// Set TRUST_PROXY=1 when running behind a reverse proxy / host that sets X-Forwarded-For.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const MAX_LEN = 2000;

const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page);
  } else {
    res.writeHead(404);
    res.end();
  }
});

function clientIp(req) {
  let ip = req.socket.remoteAddress || '';
  if (TRUST_PROXY && req.headers['x-forwarded-for']) {
    ip = req.headers['x-forwarded-for'].split(',')[0].trim();
  }
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

const waiting = new Set(); // sockets waiting for their target to show up

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

wss.on('connection', (ws, req) => {
  ws.ip = clientIp(req);
  ws.target = null;
  ws.peer = null;
  send(ws, { type: 'you', ip: ws.ip });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'connect' && !ws.peer && typeof msg.target === 'string') {
      ws.target = msg.target.trim().slice(0, 64);
      waiting.delete(ws);

      for (const other of waiting) {
        if (other !== ws && other.ip === ws.target && other.target === ws.ip) {
          waiting.delete(other);
          ws.peer = other;
          other.peer = ws;
          send(ws, { type: 'start', me: ws.ip, peer: other.ip });
          send(other, { type: 'start', me: other.ip, peer: ws.ip });
          return;
        }
      }
      waiting.add(ws);
      send(ws, { type: 'waiting', target: ws.target });
    } else if (msg.type === 'msg' && ws.peer && typeof msg.text === 'string') {
      const text = msg.text.slice(0, MAX_LEN);
      if (!text.trim()) return;
      const out = { type: 'msg', from: ws.ip, text };
      send(ws, out);
      send(ws.peer, out);
    }
  });

  ws.on('close', () => {
    waiting.delete(ws);
    if (ws.peer) {
      send(ws.peer, { type: 'left', ip: ws.ip });
      ws.peer.peer = null;
      ws.peer = null;
    }
  });
});

server.listen(PORT, () => console.log(`ipchat on :${PORT}`));
