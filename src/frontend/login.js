// login.js — no-dependency login page

window.handleLogin = async function(e) {
  e.preventDefault();
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  const err = document.getElementById('loginError');
  if (!u || !p) { err.textContent = 'username and password required'; err.style.display = ''; return false; }
  try {
    const r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u,password:p}) });
    const d = await r.json();
    if (!r.ok || d.error) { err.textContent = d.message || 'auth failed'; err.style.display = ''; return false; }
    if (d.token) {
      localStorage.setItem('auth_token', d.token);
      window.location.href = d.mustChangePassword ? '/admin.html#password' : '/admin.html';
    }
  } catch(e) { err.textContent = 'network error'; err.style.display = ''; }
  return false;
};

document.addEventListener('DOMContentLoaded', function() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('u')) document.getElementById('username').value = p.get('u');
  if (p.get('p')) document.getElementById('password').value = p.get('p');
  const t = localStorage.getItem('auth_token');
  if (t) {
    fetch('/api/auth/status', { headers:{'Authorization':'Bearer '+t} })
      .then(r=>r.json()).then(d=>{ if(d.authenticated) window.location.href='/admin.html'; }).catch(()=>{});
  }
});
