import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';
import { getConfig } from '../src/config.js';

let db, app, uploadDir, currentNow;
const adult = { fullName:'Security Tester', email:'security@example.test', password:'LongPassword123!', dateOfBirth:'2000-01-01' };

beforeEach(() => {
  uploadDir = mkdtempSync(path.join(os.tmpdir(), 'study-match-security-'));
  currentNow = new Date('2026-08-12T12:00:00.000Z');
  db = createDatabase(':memory:');
  app = createApp({ db, config:{ isProduction:false, sessionDays:7, uploadDir }, now:() => currentNow });
});
afterEach(() => { db.close(); rmSync(uploadDir, { recursive:true, force:true }); });

test('malformed JSON is rejected safely as a client error', async () => {
  const response = await request(app).post('/api/auth/register').set('Content-Type','application/json').send('{"broken":');
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error:'Invalid JSON request body.' });
  assert.doesNotMatch(JSON.stringify(response.body), /stack|sqlite|node_modules|[A-Z]:\\/i);
});

test('future dates and alternate client age fields cannot bypass registration', async () => {
  const future = await request(app).post('/api/auth/register').send({ ...adult, dateOfBirth:'2030-01-01' });
  const alternate = await request(app).post('/api/auth/register').send({ ...adult, birthDate:'2000-01-01', age:30, dateOfBirth:'2010-01-01' });
  assert.equal(future.status, 400);
  assert.equal(alternate.status, 400);
  assert.equal(db.prepare('SELECT count(*) count FROM users').get().count, 0);
});

test('expired sessions no longer authenticate', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send(adult);
  db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await agent.get('/api/auth/me')).status, 401);
});

test('security headers protect browser responses', async () => {
  const response = await request(app).get('/');
  assert.match(response.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(response.headers['referrer-policy'], /no-referrer/);
  assert.equal(response.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
});

test('production session cookie is secure and token stays out of the response', async () => {
  const production = createApp({ db, config:{ isProduction:true, sessionDays:7, uploadDir }, now:() => currentNow });
  const response = await request(production).post('/api/auth/register').send(adult);
  assert.equal(response.status, 201);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.match(response.headers['set-cookie'][0], /Secure/);
  assert.match(response.headers['set-cookie'][0], /SameSite=Strict/);
  assert.equal('token' in response.body, false);
  assert.equal(JSON.stringify(response.body).includes('password'), false);
});

test('report creation does not expose moderation status', async () => {
  const reporter = request.agent(app), other = request.agent(app);
  await reporter.post('/api/auth/register').send(adult);
  await other.post('/api/auth/register').send({ ...adult, fullName:'Other User', email:'other@example.test' });
  const otherId = db.prepare('SELECT id FROM users WHERE email=?').get('other@example.test').id;
  const response = await reporter.post('/api/reports').send({ reportedUserId:otherId, reason:'spam', description:null, conversationId:null });
  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(response.body.report), ['id']);
});

test('invalid production configuration fails closed', () => {
  const prior = process.env.CHAT_MAX_MESSAGE_LENGTH;
  try {
    process.env.CHAT_MAX_MESSAGE_LENGTH = '50000';
    assert.throws(() => getConfig(), /CHAT_MAX_MESSAGE_LENGTH/);
  } finally {
    if (prior === undefined) delete process.env.CHAT_MAX_MESSAGE_LENGTH;
    else process.env.CHAT_MAX_MESSAGE_LENGTH = prior;
  }
});

test('three-user lifecycle preserves private chat session and notification boundaries', async () => {
  const a = request.agent(app), b = request.agent(app), c = request.agent(app);
  await a.post('/api/auth/register').send({ ...adult, fullName:'User A', email:'a@lifecycle.test' });
  await b.post('/api/auth/register').send({ ...adult, fullName:'User B', email:'b@lifecycle.test' });
  await c.post('/api/auth/register').send({ ...adult, fullName:'User C', email:'c@lifecycle.test' });
  const ids = Object.fromEntries(db.prepare('SELECT id,email FROM users').all().map(x => [x.email[0], x.id]));
  const profile = { school:null, course:null, yearLevel:null, bio:null, preferredStudyMode:'Online', subjectIds:[1], goalIds:[], studyStyleIds:[] };
  await a.put('/api/profile').send({ ...profile, displayName:'User A' });
  await b.put('/api/profile').send({ ...profile, displayName:'User B' });
  await c.put('/api/profile').send({ ...profile, displayName:'User C' });
  assert.equal((await a.post(`/api/matches/${ids.b}/request`)).status, 201);
  assert.equal((await c.post(`/api/matches/${ids.a}/accept`)).status, 404);
  assert.equal((await b.post(`/api/matches/${ids.a}/accept`)).status, 200);
  const conversation = (await a.post(`/api/conversations/open/${ids.b}`)).body.conversation;
  assert.equal((await c.get(`/api/conversations/${conversation.id}`)).status, 404);
  assert.equal((await c.post(`/api/conversations/${conversation.id}/messages`).send({ message:'intrusion' })).status, 404);
  assert.equal((await a.post(`/api/conversations/${conversation.id}/messages`).send({ message:'Study plan' })).status, 201);
  const sessionResponse = await a.post('/api/study-sessions').send({ title:'Final review', description:null, scheduledStart:'2026-08-13T10:00:00+08:00', scheduledEnd:'2026-08-13T11:00:00+08:00', participantUserIds:[ids.b] });
  assert.equal(sessionResponse.status, 201);
  assert.equal((await c.get(`/api/study-sessions/${sessionResponse.body.session.id}`)).status, 404);
  const bNotification = db.prepare('SELECT id FROM notifications WHERE user_id=? ORDER BY created_at DESC').get(ids.b).id;
  assert.equal((await c.post(`/api/notifications/${bNotification}/read`)).status, 404);
  assert.equal((await a.post(`/api/users/${ids.b}/block`)).status, 201);
  assert.equal((await b.get(`/api/conversations/${conversation.id}`)).status, 404);
  assert.equal((await b.post(`/api/matches/${ids.a}/request`)).status, 403);
});
