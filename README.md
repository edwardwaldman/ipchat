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

Nothing is stored. Messages are passed straight between the two sockets in memory and never logged or written anywhere. Close the tab and it's gone.

## Run

```
npm install
npm start          # http://localhost:3000
```

`PORT` sets the port. If you host it behind a proxy (Render, Railway, nginx, Cloudflare, etc.), set `TRUST_PROXY=1` so the real visitor IP is read from `X-Forwarded-For`.
