// login.js — 登录页面 (中文默认)

const lang = localStorage.getItem('vps-lang') || 'zh';
const I18N = {
  zh: { username:'用户名', password:'密码', login_btn:'登录', auth_failed:'用户名或密码错误', net_error:'网络错误，请稍后重试', required:'用户名和密码不能为空', back:'← 返回', title:'管理员登录' },
  en: { username:'Username', password:'Password', login_btn:'Authenticate', auth_failed:'Invalid credentials', net_error:'Network error', required:'Username and password required', back:'← back', title:'Admin Login' }
};
function t(key) { return (I18N[lang] && I18N[lang][key]) || key; }

window.handleLogin = async function(e) {
  e.preventDefault();
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  const err = document.getElementById('loginError');
  if (!u || !p) { err.textContent = t('required'); err.style.display = ''; return false; }
  try {
    const r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u,password:p}) });
    const d = await r.json();
    if (!r.ok || d.error) { err.textContent = d.message || t('auth_failed'); err.style.display = ''; return false; }
    if (d.token) {
      localStorage.setItem('auth_token', d.token);
      window.location.href = d.mustChangePassword ? '/admin.html#password' : '/admin.html';
    }
  } catch(e) { err.textContent = t('net_error'); err.style.display = ''; }
  return false;
};

document.addEventListener('DOMContentLoaded', function() {
  // Apply i18n
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (I18N[lang] && I18N[lang][k]) el.textContent = I18N[lang][k]; });
  document.title = t('title') + ' · VPS 监控';

  const p = new URLSearchParams(window.location.search);
  if (p.get('u')) document.getElementById('username').value = p.get('u');
  if (p.get('p')) document.getElementById('password').value = p.get('p');
  const tk = localStorage.getItem('auth_token');
  if (tk) {
    fetch('/api/auth/status', { headers:{'Authorization':'Bearer '+tk} })
      .then(r=>r.json()).then(d=>{ if(d.authenticated) window.location.href='/admin.html'; }).catch(()=>{});
  }
});
