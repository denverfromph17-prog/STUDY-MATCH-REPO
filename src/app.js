import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { UNDERAGE_MESSAGE, isAtLeast18, parseDateOfBirth } from './age.js';
import { SESSION_COOKIE, authMiddleware, clearSessionCookie, createSession, deleteCurrentSession, setSessionCookie } from './auth.js';
import { registerProfileRoutes } from './profile.js';
import { registerMatchRoutes } from './matches.js';
import { registerChatRoutes } from './chat.js';
import { registerDay5Routes } from './day5.js';

const registerSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  dateOfBirth: z.string().refine(parseDateOfBirth, 'Invalid date of birth.'),
}).strict();
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) }).strict();
const publicUser = (u) => ({ id: u.id, fullName: u.full_name, email: u.email, dateOfBirth: u.date_of_birth, accountStatus: u.account_status, createdAt: u.created_at, updatedAt: u.updated_at });

export function createApp({ db, config, now = () => new Date() }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { scriptSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'] } } }));
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const host = req.get('host');
      if (origin) {
        try {
          if (new URL(origin).host !== host) return res.status(403).json({ error: 'Invalid request origin.' });
        } catch {
          return res.status(403).json({ error: 'Invalid request origin.' });
        }
      }
    }
    next();
  });
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isProduction ? 20 : 1000, standardHeaders: true, legacyHeaders: false });

  app.post('/api/auth/register', authLimit, async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid registration details.', details: parsed.error.flatten().fieldErrors });
    const { fullName, password, dateOfBirth } = parsed.data;
    const email = parsed.data.email.toLowerCase();
    if (!isAtLeast18(dateOfBirth, now())) return res.status(400).json({ error: UNDERAGE_MESSAGE });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
    const timestamp = now().toISOString();
    const user = { id: crypto.randomUUID(), full_name: fullName, email, date_of_birth: dateOfBirth, account_status: 'active', created_at: timestamp, updated_at: timestamp };
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      db.exec('BEGIN');
      db.prepare('INSERT INTO users (id, full_name, email, password_hash, date_of_birth, account_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, user.full_name, user.email, passwordHash, user.date_of_birth, user.account_status, timestamp, timestamp);
      db.prepare('INSERT INTO profiles (user_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(user.id, fullName, timestamp, timestamp);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (String(error).includes('UNIQUE')) return res.status(409).json({ error: 'An account with this email already exists.' });
      throw error;
    }
    const session = createSession(db, user.id, config.sessionDays);
    setSessionCookie(res, session, config.isProduction);
    res.status(201).json({ user: publicUser(user) });
  });

  app.post('/api/auth/login', authLimit, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid email or password.' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(parsed.data.email.toLowerCase());
    if (!user || user.account_status !== 'active' || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password.' });
    const session = createSession(db, user.id, config.sessionDays);
    setSessionCookie(res, session, config.isProduction);
    res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    deleteCurrentSession(db, req.cookies[SESSION_COOKIE]);
    clearSessionCookie(res, config.isProduction);
    res.status(204).end();
  });
  app.get('/api/auth/me', authMiddleware(db), (req, res) => res.json({ user: publicUser(req.user) }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  registerProfileRoutes(app, { db, config, now });
  registerMatchRoutes(app, { db, config, now });
  registerChatRoutes(app, { db, config, now });
  registerDay5Routes(app, { db, config, now });
  app.use(express.static('public'));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  });
  return app;
}
