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

Nothing is stored. Messages and files are relayed live through Supabase Realtime broadcast (a free project), which passes them along without saving them. That works through VPNs and strict networks. Close the tab and it's gone.

## Deploy

Built for Vercel: `public/index.html` is the page, `api/ip.js` returns your IP. The Supabase project URL and public (anon) key are in the page; they only allow realtime broadcast, and the project is on the free plan, so it can't be billed. Import the repo into Vercel, no settings needed.
