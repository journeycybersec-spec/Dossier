/* Login / first-run setup gate. Shows before the case-management screen. */
const Auth = {
  mode: 'login',   // 'login' | 'setup'

  init() {
    this.el = document.getElementById('auth');
    document.getElementById('auth-btn').onclick = () => this._submit();
    ['auth-pass', 'auth-pass2', 'auth-user'].forEach(id =>
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') this._submit();
      }));
    document.addEventListener('tm-unauth', () => this.show(true));
  },

  show(configured) {
    this.mode = configured ? 'login' : 'setup';
    document.getElementById('launcher').classList.add('hidden');
    document.getElementById('workspace').classList.add('hidden');
    this.el.classList.remove('hidden');
    const sub = document.getElementById('auth-sub');
    const pass2 = document.getElementById('auth-pass2');
    const user = document.getElementById('auth-user');
    const btn = document.getElementById('auth-btn');
    this._err('');
    document.getElementById('auth-pass').value = '';
    pass2.value = '';
    user.classList.remove('hidden');   // name required in both modes
    user.placeholder = 'Name';
    if (this.mode === 'setup') {
      sub.textContent = 'Create your account to protect this vault';
      pass2.classList.remove('hidden');
      btn.textContent = 'Create account';
    } else {
      sub.textContent = 'Sign in to your case vault';
      pass2.classList.add('hidden');
      btn.textContent = 'Unlock';
    }
    setTimeout(() => document.getElementById('auth-user').focus(), 30);
  },

  async _submit() {
    const name = document.getElementById('auth-user').value.trim();
    const pass = document.getElementById('auth-pass').value;
    this._err('');
    if (!name) return this._err('Name is required.');
    try {
      if (this.mode === 'setup') {
        if (pass.length < 4) return this._err('Password must be at least 4 characters.');
        if (pass !== document.getElementById('auth-pass2').value) return this._err('Passwords do not match.');
        await API.authSetup(name, pass);
      } else {
        await API.authLogin(name, pass);
      }
      this.el.classList.add('hidden');
      App.enterApp();
    } catch (e) {
      this._err(e.message || 'Authentication failed');
      document.getElementById('auth-pass').select();
    }
  },

  _err(msg) { document.getElementById('auth-err').textContent = msg; },
};
