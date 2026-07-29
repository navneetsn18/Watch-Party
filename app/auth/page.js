'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Tv, User, Globe, AlertCircle, Loader2 } from 'lucide-react';
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
  const [username, setUsername] = useState('');
  const [country, setCountry] = useState('IN');
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

    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanUsername) {
      setMessage({ type: 'error', text: 'Enter a name to continue' });
      setLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.signIn({ username: cleanUsername, country });
      if (error) throw error;
      router.push('/');
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Could not sign in' });
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#07070a] px-4 py-16 relative overflow-hidden">
      {/* Background blurs */}
      <div className="absolute top-1/4 left-1/3 w-[350px] h-[350px] rounded-full bg-violet-900/10 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/3 w-[350px] h-[350px] rounded-full bg-indigo-900/10 blur-[100px] pointer-events-none" />

      {/* Brand Logo box */}
      <div className="text-center mb-8 relative z-10 flex flex-col items-center">
        <div className="inline-flex p-3 rounded-2xl bg-zinc-900/50 border border-zinc-800 mb-3 shadow-xl">
          <Tv className="w-6 h-6 text-violet-400" />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-white mb-1">Watch Party</h1>
        <p className="text-xs text-zinc-400">Local movie nights — no accounts, no passwords, just names</p>
      </div>

      {/* Auth Card */}
      <div className="relative z-10 w-full max-w-md bg-zinc-900/40 border border-zinc-800/80 backdrop-blur-xl p-8 rounded-3xl shadow-2xl shadow-black/60 flex flex-col gap-6">
        <form onSubmit={handleAuth} className="flex flex-col gap-4">
          <AnimatePresence mode="wait">
            {message.text && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="p-3 rounded-xl border text-xs flex items-start gap-2 bg-red-950/20 border-red-900/30 text-red-400"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{message.text}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Name field */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-zinc-500" /> Your name
            </label>
            <input
              type="text"
              className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-600 focus:ring-1 focus:ring-violet-600 text-sm transition-all"
              placeholder="e.g. tofuthecat"
              maxLength={20}
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            />
            <span className="text-[10px] text-zinc-500 ml-1">
              Lowercase, numbers, underscores. Same name = same profile next time.
            </span>
          </div>

          {/* Country field */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-zinc-500" /> Country (for the flag next to your name)
            </label>
            <select
              className="w-full px-3 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-violet-600 text-sm transition-all cursor-pointer"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              {COUNTRIES.map(c => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 active:scale-[0.98] text-white font-semibold text-sm transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-violet-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Enter</span>}
          </button>
        </form>
      </div>
    </div>
  );
}
