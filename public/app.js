const $ = (selector) => document.querySelector(selector);
const registerForm = $('#register-form');
const loginForm = $('#login-form');
const message = $('#message');
function showMode(mode) {
  const login = mode === 'login';
  registerForm.hidden = login; loginForm.hidden = !login; $('#account').hidden = true;
  $('#register-tab').classList.toggle('active', !login); $('#login-tab').classList.toggle('active', login);
  $('#form-title').textContent = login ? 'Welcome back' : 'Find your study people';
  $('#form-subtitle').textContent = login ? 'Log in to continue.' : 'Create your free account to get started.';
  message.textContent = '';
}
async function submit(form, endpoint) {
  message.textContent = ''; const button = form.querySelector('button[type=submit]'); button.disabled = true;
  try {
    const response = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(form))) });
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw new Error(data.error || 'Something went wrong.');
    showAccount(data.user);
  } catch (error) { message.textContent = error.message; } finally { button.disabled = false; }
}
function showAccount(user) { registerForm.hidden = true; loginForm.hidden = true; $('.tabs').hidden = true; $('#form-title').textContent = 'You’re all set'; $('#form-subtitle').textContent = 'Your Study Match PH account is ready.'; $('#account').hidden = false; $('#account-name').textContent = user.fullName; message.textContent = ''; }
$('#register-tab').onclick = () => showMode('register'); $('#login-tab').onclick = $('#nav-login').onclick = () => showMode('login');
registerForm.onsubmit = (event) => { event.preventDefault(); submit(registerForm, '/api/auth/register'); };
loginForm.onsubmit = (event) => { event.preventDefault(); submit(loginForm, '/api/auth/login'); };
$('#logout').onclick = async () => { await fetch('/api/auth/logout', { method:'POST' }); $('.tabs').hidden = false; showMode('login'); };
fetch('/api/auth/me').then((r) => r.ok ? r.json() : null).then((data) => { if (data) showAccount(data.user); });
