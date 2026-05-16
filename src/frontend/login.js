// login.js - 登录页面逻辑

async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorDiv = document.getElementById('loginError');

  if (!username || !password) {
    errorDiv.textContent = '用户名和密码不能为空';
    errorDiv.classList.remove('d-none');
    return false;
  }

  try {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await resp.json();

    if (!resp.ok && resp.status !== 401) {
      errorDiv.textContent = data.message || '登录失败';
      errorDiv.classList.remove('d-none');
      return false;
    }

    if (resp.status === 401 || data.error) {
      errorDiv.textContent = data.message || '用户名或密码错误';
      errorDiv.classList.remove('d-none');
      return false;
    }

    if (data.token) {
      localStorage.setItem('auth_token', data.token);
      if (data.mustChangePassword) {
        window.location.href = '/admin.html#change-password';
      } else {
        window.location.href = '/admin.html';
      }
    }
  } catch (e) {
    errorDiv.textContent = '网络错误，请稍后重试';
    errorDiv.classList.remove('d-none');
  }
  return false;
}

window.handleLogin = handleLogin;

// 加载默认凭据 (从URL参数)
document.addEventListener('DOMContentLoaded', function() {
  const params = new URLSearchParams(window.location.search);
  const u = params.get('u'), p = params.get('p');
  if (u) document.getElementById('username').value = u;
  if (p) document.getElementById('password').value = p;

  const token = localStorage.getItem('auth_token');
  if (token) {
    fetch('/api/auth/status', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(r => r.json())
      .then(d => { if (d.authenticated) window.location.href = '/admin.html'; })
      .catch(() => {});
  }
});
