// Returns the caller's IP. Nothing is logged or stored.
module.exports = (req, res) => {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  let ip = fwd || req.socket.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ip });
};
