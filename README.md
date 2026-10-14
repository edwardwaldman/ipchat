# ipchat

Barebones IP-to-IP chat.

1. Open the site. It shows your IP.
2. Type the IP you want to talk to.
3. It waits until that IP opens the site and types **your** IP.
4. You're dropped into a plain chat:

```
1.1.1.1: hi
1.2.3.4: hi
1.1.1.1 disconnected
```

Nothing is stored. Messages and files are relayed live through Supabase Realtime broadcast (a free project), which passes them along without saving them. That works through VPNs and strict networks. Close the tab and it's gone (a refresh keeps the chat, using the tab's own session storage).

## Security

- **End-to-end encrypted.** Each side makes an ECDH P-256 key pair and shares only the public key. Messages, pings and file pieces are sealed with AES-GCM, so the relay, or anyone else who joins the room, can't read or forge them.
- **Safety code.** Both screens show a short code made from both public keys. If the codes match, no one is sitting in the middle swapping keys.
- **Limits.** 2000 characters per message, 5 messages/second out, 8/second accepted in. Files are capped at 5mb, one at a time, at most 2 arriving at once, and stalled transfers are dropped. The receiver enforces all of this too.
- **Received files always download** (`application/octet-stream`), so a file can never run as a page on this site.
- **Headers.** Strict Content-Security-Policy (no inline scripts), `nosniff`, `no-referrer`, frame protection, HSTS. See `vercel.json`.
- **Known limits.** IPs are self-reported to the relay, so anyone who knows both IPs can join the room and try to pose as one side; the safety code is what catches that. The two people see each other's IP. The relay can see who is in which (hashed) room and when.

## Deploy

Built for Vercel: `public/index.html` is the page, `api/ip.js` returns your IP. The Supabase project URL and public (anon) key are in the page; the project has no tables or data (it is only used for realtime broadcast), and it is on the free plan, so it can't be billed. Import the repo into Vercel, no settings needed.
