const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'fieldproof-dev-secret-change-me';
const TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

function sign(payloadObj) {
  const payload = Buffer.from(JSON.stringify({ ...payloadObj, exp: Date.now() + TTL_MS })).toString('base64url');
  const hmac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${hmac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, hmac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (hmac !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

module.exports = { sign, verify };
