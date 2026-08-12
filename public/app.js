const $ = (selector) => document.querySelector(selector);
const registerForm = $('#register-form');
const loginForm = $('#login-form');
const message = $('#message');

function showMode(mode) {
  const login = mode === 'login';
  registerForm.hidden = login;
  loginForm.hidden = !login;
  $('#account').hidden = true;
  $('#register-tab').classList.toggle('active', !login);
  $('#login-tab').classList.toggle('active', login);
  $('#register-tab').setAttribute('aria-selected', String(!login));
  $('#login-tab').setAttribute('aria-selected', String(login));
  $('#form-title').textContent = login ? 'Welcome back' : 'Find your study people';
  $('#form-subtitle').textContent = login ? 'Log in to continue.' : 'Create your free account to get started.';
  ui.notice(message);
  (login ? loginForm : registerForm).querySelector('input')?.focus();
}

async function submit(form, endpoint) {
  ui.notice(message);
  const button = form.querySelector('button[type=submit]');
  ui.busy(button, true, endpoint.endsWith('login') ? 'Logging in…' : 'Creating account…');
  try {
    const response = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(form))) });
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw new Error(data.error || 'Something went wrong.');
    showAccount(data.user);
  } catch (error) {
    ui.notice(message, ui.apiError(error));
    const policyField = /18 years old|date of birth/i.test(error.message) ? form.elements.dateOfBirth : null;
    (policyField || form.querySelector(':invalid') || form.querySelector('input'))?.focus();
  } finally { ui.busy(button, false); }
}

function showAccount(user) {
  registerForm.hidden = true; loginForm.hidden = true; $('.tabs').hidden = true;
  $('#form-title').textContent = 'You’re all set';
  $('#form-subtitle').textContent = 'Your Study Match PH account is ready.';
  $('#account').hidden = false; $('#account-name').textContent = user.fullName; ui.notice(message);
}

$('#register-tab').addEventListener('click', () => showMode('register'));
$('#login-tab').addEventListener('click', () => showMode('login'));
$('#nav-login').addEventListener('click', () => showMode('login'));
registerForm.addEventListener('submit', (event) => { event.preventDefault(); submit(registerForm, '/api/auth/register'); });
loginForm.addEventListener('submit', (event) => { event.preventDefault(); submit(loginForm, '/api/auth/login'); });
$('#logout').addEventListener('click', async () => {
  const button = $('#logout'); ui.busy(button, true, 'Logging out…');
  try { await fetch('/api/auth/logout', { method:'POST' }); $('.tabs').hidden = false; showMode('login'); }
  catch (error) { ui.notice(message, ui.apiError(error)); }
  finally { ui.busy(button, false); }
});
fetch('/api/auth/me').then((r) => r.ok ? r.json() : null).then((data) => { if (data) showAccount(data.user); }).catch(() => {});
