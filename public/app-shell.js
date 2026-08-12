document.querySelectorAll('.app-header').forEach((header) => {
  const nav = header.querySelector('.app-nav');
  if (!nav) return;
  const toggle = document.createElement('button');
  toggle.className = 'nav-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', nav.id || 'primary-navigation');
  toggle.textContent = 'Menu';
  if (!nav.id) nav.id = 'primary-navigation';
  header.insertBefore(toggle, nav);
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close menu' : 'Menu';
  });
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a') && matchMedia('(max-width: 820px)').matches) {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = 'Menu';
    }
  });
});

window.ui = {
  notice(element, message = '', tone = 'error') {
    element.textContent = message;
    if (message) element.dataset.tone = tone;
    else delete element.dataset.tone;
  },
  busy(button, busy, label = 'Working…') {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = label;
      button.classList.add('loading');
    } else if (button.dataset.label) {
      button.textContent = button.dataset.label;
      delete button.dataset.label;
      button.classList.remove('loading');
    }
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
  },
  apiError(error) {
    return error instanceof TypeError ? 'We could not reach Study Match PH. Check your connection and try again.' : error.message;
  }
};

document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
    }
  });
});
