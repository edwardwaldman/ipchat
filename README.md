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

Nothing is stored. Messages go directly browser-to-browser over WebRTC and are never sent to or saved on any server. The free PeerJS server is only used so the two browsers can find each other. Close the tab and it's gone.

## Deploy

Built for Vercel: `public/index.html` is the page, `api/ip.js` returns your IP. Import the repo into Vercel, no settings needed.
