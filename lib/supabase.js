'use client';

// Mock Supabase Client using local JWT token
const isClient = typeof window !== 'undefined';

const listeners = new Set();

function notifyListeners(event, session) {
  listeners.forEach(cb => cb(event, session));
}

export const supabase = {
  auth: {
    async getUser(tokenOverride) {
      if (!isClient) return { data: { user: null }, error: null };
      const token = tokenOverride || localStorage.getItem('watch_party_token');
      if (!token) return { data: { user: null }, error: null };
      try {
        const res = await fetch('/api/profile', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch profile');
        const user = await res.json();
        // Standard Supabase user format compatibility
        return { data: { user }, error: null };
      } catch (err) {
        return { data: { user: null }, error: err };
      }
    },
    async getSession() {
      if (!isClient) return { data: { session: null }, error: null };
      const token = localStorage.getItem('watch_party_token');
      const userStr = localStorage.getItem('watch_party_user');
      if (!token || !userStr) return { data: { session: null }, error: null };
      try {
        const user = JSON.parse(userStr);
        return { data: { session: { access_token: token, user } }, error: null };
      } catch (err) {
        return { data: { session: null }, error: null };
      }
    },
    async signInWithPassword({ email, password }) {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) {
          return { data: { session: null, user: null }, error: new Error(data.error || 'Login failed') };
        }
        localStorage.setItem('watch_party_token', data.token);
        localStorage.setItem('watch_party_user', JSON.stringify(data.user));
        const session = { access_token: data.token, user: data.user };
        notifyListeners('SIGNED_IN', session);
        return { data: { session, user: data.user }, error: null };
      } catch (err) {
        return { data: { session: null, user: null }, error: err };
      }
    },
    async signUp({ email, password, options }) {
      try {
        const metadata = options?.data || {};
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            username: metadata.username,
            country: metadata.country,
            dob: metadata.dob
          })
        });
        const data = await res.json();
        if (!res.ok) {
          return { data: { user: null }, error: new Error(data.error || 'Registration failed') };
        }
        return { data: { user: { email } }, error: null };
      } catch (err) {
        return { data: { user: null }, error: err };
      }
    },
    async signOut() {
      if (isClient) {
        localStorage.removeItem('watch_party_token');
        localStorage.removeItem('watch_party_user');
      }
      notifyListeners('SIGNED_OUT', null);
      return { error: null };
    },
    onAuthStateChange(callback) {
      listeners.add(callback);
      // Immediately call with current session
      this.getSession().then(({ data: { session } }) => {
        callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session);
      });
      return {
        data: {
          subscription: {
            unsubscribe() {
              listeners.delete(callback);
            }
          }
        }
      };
    }
  }
};
