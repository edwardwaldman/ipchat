// Returns the caller's IP. Nothing is logged or stored.
// x-real-ip is set by Vercel itself; x-forwarded-for's first entry can be supplied by the client.
module.exports = (req, res) => {
  let ip = req.headers['x-real-ip'] || (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ip });
};
