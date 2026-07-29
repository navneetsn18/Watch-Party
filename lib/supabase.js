'use client';

// Local auth client (keeps the old "supabase" name so imports don't churn).
// Name-only login: no passwords, no email — this app runs on a couch.
const isClient = typeof window !== 'undefined';

const listeners = new Set();

function notifyListeners(event, session) {
  listeners.forEach(cb => cb(event, session));
}

export const supabase = {
  auth: {
    async getUser() {
      if (!isClient) return { data: { user: null }, error: null };
      const token = localStorage.getItem('watch_party_token');
      if (!token) return { data: { user: null }, error: null };
      try {
        const res = await fetch('/api/profile', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch profile');
        const user = await res.json();
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
      } catch {
        return { data: { session: null }, error: null };
      }
    },
    async signIn({ username, country }) {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, country })
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
