const { verify } = require('../utils/token');

function requirePlatformAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const data = verify(token);
  if (!data || data.role !== 'platform-admin') {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

module.exports = { requirePlatformAuth };
