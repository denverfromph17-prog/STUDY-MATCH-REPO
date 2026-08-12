import crypto from 'node:crypto';

export const SESSION_COOKIE = 'study_match_session';
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function createSession(db, userId, sessionDays) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + sessionDays * 86400000);
  db.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), userId, hashToken(token), expires.toISOString(), now.toISOString());
  return { token, expires };
}

export function setSessionCookie(res, session, secure) {
  res.cookie(SESSION_COOKIE, session.token, {
    httpOnly: true, secure, sameSite: 'strict', path: '/', expires: session.expires,
  });
}

export function clearSessionCookie(res, secure) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure, sameSite: 'strict', path: '/' });
}

export function authMiddleware(db) {
  return (req, res, next) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return res.status(401).json({ error: 'Authentication required.' });
    const row = db.prepare(`
      SELECT s.id AS session_id, u.id, u.full_name, u.email, u.date_of_birth,
             u.account_status, u.created_at, u.updated_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.account_status = 'active'
    `).get(hashToken(token), new Date().toISOString());
    if (!row) return res.status(401).json({ error: 'Authentication required.' });
    req.user = row;
    next();
  };
}

export function deleteCurrentSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}
