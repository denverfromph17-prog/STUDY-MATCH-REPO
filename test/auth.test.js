import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

const fixedNow = new Date('2026-08-12T12:00:00.000Z');
let db, app;
beforeEach(() => { db = createDatabase(':memory:'); app = createApp({ db, config: { isProduction:false, sessionDays:7 }, now: () => fixedNow }); });
afterEach(() => db.close());
const valid = { fullName:'Maria Santos', email:'maria@example.com', password:'securePass123', dateOfBirth:'2000-01-01' };
const register = (body = valid) => request(app).post('/api/auth/register').send(body);

test('valid registration creates user and profile without exposing hash', async () => {
  const res = await register(); assert.equal(res.status, 201); assert.equal(res.body.user.email, valid.email); assert.equal('password_hash' in res.body.user, false);
  assert.equal(db.prepare('SELECT count(*) count FROM profiles').get().count, 1);
  assert.notEqual(db.prepare('SELECT password_hash FROM users').get().password_hash, valid.password);
});
test('duplicate email is rejected case-insensitively', async () => { await register(); const res = await register({ ...valid, email:'MARIA@example.com' }); assert.equal(res.status,409); });
test('missing required fields are rejected', async () => { const res = await register({ email:valid.email }); assert.equal(res.status,400); });
test('invalid email is rejected', async () => { const res = await register({ ...valid,email:'bad' }); assert.equal(res.status,400); });
test('invalid date of birth is rejected', async () => { const res = await register({ ...valid,dateOfBirth:'2000-02-30' }); assert.equal(res.status,400); });
test('under 18 is rejected and no account is created', async () => { const res = await register({ ...valid,dateOfBirth:'2008-08-13' }); assert.equal(res.status,400); assert.match(res.body.error,/18 years old/); assert.equal(db.prepare('SELECT count(*) count FROM users').get().count,0); });
test('exactly 18 is accepted', async () => { const res = await register({ ...valid,dateOfBirth:'2008-08-12' }); assert.equal(res.status,201); });
test('over 18 is accepted', async () => { const res = await register({ ...valid,dateOfBirth:'2008-08-11' }); assert.equal(res.status,201); });
test('client-supplied age cannot bypass server validation', async () => { const res = await register({ ...valid,dateOfBirth:'2010-01-01',age:25 }); assert.equal(res.status,400); assert.equal(db.prepare('SELECT count(*) count FROM users').get().count,0); });
test('successful login returns a session and user', async () => { await register(); const res = await request(app).post('/api/auth/login').send({email:valid.email,password:valid.password}); assert.equal(res.status,200); assert.match(res.headers['set-cookie'][0],/HttpOnly/); });
test('invalid password is rejected', async () => { await register(); const res = await request(app).post('/api/auth/login').send({email:valid.email,password:'wrong'}); assert.equal(res.status,401); });
test('invalid email is rejected', async () => { const res = await request(app).post('/api/auth/login').send({email:'invalid',password:'wrong'}); assert.equal(res.status,400); });
test('logout invalidates the current session', async () => { const agent=request.agent(app); await agent.post('/api/auth/register').send(valid); assert.equal((await agent.get('/api/auth/me')).status,200); assert.equal((await agent.post('/api/auth/logout')).status,204); assert.equal((await agent.get('/api/auth/me')).status,401); });
test('protected endpoint rejects unauthorized access', async () => { assert.equal((await request(app).get('/api/auth/me')).status,401); });
test('cross-origin state-changing request is rejected', async () => { const res=await request(app).post('/api/auth/register').set('Origin','https://evil.example').set('Host','study.example').send(valid); assert.equal(res.status,403); });
test('malformed origin is safely rejected', async () => { const res=await request(app).post('/api/auth/register').set('Origin','not a url').send(valid); assert.equal(res.status,403); });
