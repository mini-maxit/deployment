const API = '/api/v1';

// Minimal fetch-based API client with a refresh-cookie jar.
// Mirrors the backend's {ok, data} response envelope (httputils.ReturnSuccess).
export function createClient(baseUrl) {
  const jar = new Map(); // cookie name -> value

  function captureCookies(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const expired = attrs.some(
        (a) => /^max-age=0$/i.test(a) || /^expires=.*1970/i.test(a) || value === '',
      );
      if (expired) jar.delete(name);
      else jar.set(name, value);
    }
  }

  function cookieHeader() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async function request(method, path, { token, body, cookie, headers = {} } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (token) h['Authorization'] = `Bearer ${token}`;
    const cookies = cookie ?? cookieHeader();
    if (cookies) h['Cookie'] = cookies;

    const res = await fetch(baseUrl + path, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    captureCookies(res);
    return res;
  }

  return {
    // --- auth ---
    register: (user) => request('POST', `${API}/auth/register`, { body: user }),
    login: (email, password) =>
      request('POST', `${API}/auth/login`, { body: { email, password } }),
    refresh: () => request('POST', `${API}/auth/refresh`),
    refreshWithCookie: (cookie) => request('POST', `${API}/auth/refresh`, { cookie }),
    logout: (token) => request('POST', `${API}/auth/logout`, { token }),

    // --- users ---
    me: (token) => request('GET', `${API}/users/me`, { token }),
    changePassword: (userId, token, oldPassword, newPassword, newPasswordConfirm) =>
      request('PATCH', `${API}/users/${userId}/password`, {
        token,
        body: { oldPassword, newPassword, newPasswordConfirm },
      }),
    editUser: (userId, token, edit) =>
      request('PATCH', `${API}/users/${userId}`, { token, body: edit }),

    // --- generic verbs for journeys ---
    get: (path, token) => request('GET', path, { token }),
    post: (path, token, body) => request('POST', path, { token, body }),
    put: (path, token, body) => request('PUT', path, { token, body }),
    patch: (path, token, body) => request('PATCH', path, { token, body }),
    del: (path, token) => request('DELETE', path, { token }),
    postForm: (path, token, formData) =>
      fetch(baseUrl + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        redirect: 'manual',
      }),
    patchForm: (path, token, formData) =>
      fetch(baseUrl + path, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        redirect: 'manual',
      }),

    getRefreshCookie: () => jar.get('refresh_token'),
  };
}
