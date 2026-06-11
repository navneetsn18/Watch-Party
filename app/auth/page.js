'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

const COUNTRIES = [
  { code: 'IN', name: 'India' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'JP', name: 'Japan' },
  { code: 'BR', name: 'Brazil' },
  { code: 'SG', name: 'Singapore' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'RU', name: 'Russia' },
  { code: 'CN', name: 'China' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'MX', name: 'Mexico' },
];

export default function AuthPage() {
  const router = useRouter();
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [country, setCountry] = useState('IN');
  const [dob, setDob] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Redirect if already logged in
  useEffect(() => {
    async function checkUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        router.push('/');
      }
    }
    checkUser();
  }, [router]);

  async function handleAuth(e) {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    const cleanEmail = email.trim();
    const cleanPassword = password.trim();
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

    if (!cleanEmail || !cleanPassword) {
      setMessage({ type: 'error', text: 'Email and password are required' });
      setLoading(false);
      return;
    }

    try {
      if (isRegistering) {
        if (!cleanUsername) {
          setMessage({ type: 'error', text: 'Username is required' });
          setLoading(false);
          return;
        }

        if (!dob) {
          setMessage({ type: 'error', text: 'Date of birth is required' });
          setLoading(false);
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password: cleanPassword,
          options: {
            data: {
              username: cleanUsername,
              country,
              dob,
            },
          },
        });

        if (error) throw error;

        setMessage({
          type: 'success',
          text: 'Registration successful! You can now log in.',
        });
        setIsRegistering(false);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword,
        });

        if (error) throw error;

        setMessage({ type: 'success', text: 'Logged in successfully! Redirecting...' });
        setTimeout(() => {
          router.push('/');
        }, 1000);
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'An error occurred during authentication' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-logo">
        <div className="logo-icon">🎬</div>
        <h1>Watch Party</h1>
        <p>Your social space to watch, share, and connect</p>
      </div>

      <div className="auth-card">
        <div className="auth-tabs">
          <button
            className={`auth-tab ${!isRegistering ? 'active' : ''}`}
            onClick={() => {
              setIsRegistering(false);
              setMessage({ type: '', text: '' });
            }}
            type="button"
          >
            Sign In
          </button>
          <button
            className={`auth-tab ${isRegistering ? 'active' : ''}`}
            onClick={() => {
              setIsRegistering(true);
              setMessage({ type: '', text: '' });
            }}
            type="button"
          >
            Register
          </button>
        </div>

        <form onSubmit={handleAuth} className="auth-form">
          {message.text && (
            <div className={`auth-message ${message.type}`}>
              {message.type === 'error' ? '⚠️' : '✅'} {message.text}
            </div>
          )}

          {isRegistering && (
            <>
              <div className="input-group">
                <label className="input-label">Username</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Choose a username (e.g. tofuthecat)"
                  maxLength={20}
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                />
                <span className="input-hint">Lowercase, numbers, and underscores only</span>
              </div>

              <div className="input-row" style={{ display: 'flex', gap: '16px' }}>
                <div className="input-group" style={{ flex: 1 }}>
                  <label className="input-label">Country</label>
                  <select
                    className="input-field"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    style={{ height: '42px', backgroundColor: '#0d0d14', border: '1px solid #262636', borderRadius: '8px', color: '#fff', outline: 'none' }}
                  >
                    {COUNTRIES.map(c => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="input-group" style={{ flex: 1 }}>
                  <label className="input-label">Date of Birth</label>
                  <input
                    type="date"
                    className="input-field"
                    required
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div className="input-group">
            <label className="input-label">Email</label>
            <input
              type="email"
              className="input-field"
              placeholder="Enter your email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Password</label>
            <input
              type="password"
              className="input-field"
              placeholder="Enter your password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="btn btn-primary auth-submit" type="submit" disabled={loading}>
            {loading ? <div className="spinner-small" /> : isRegistering ? '🚀 Create Account' : '🔑 Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

