// Optional: hands out short-lived Cloudflare TURN relay credentials so chats
// work across strict networks. Set CF_TURN_KEY_ID and CF_TURN_API_TOKEN in Vercel.
// Without them it returns an empty list and the page uses free fallback servers.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) return res.json({ iceServers: [] });
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
    });
    const d = await r.json();
    const ice = Array.isArray(d.iceServers) ? d.iceServers : d.iceServers ? [d.iceServers] : [];
    res.json({ iceServers: ice });
  } catch {
    res.json({ iceServers: [] });
  }
};
