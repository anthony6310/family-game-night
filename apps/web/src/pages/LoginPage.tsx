import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';

export function LoginPage() {
  const navigate = useNavigate();
  const { session, loading, setGuestName } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  // Already logged in? /play decides whether to show the game or profile setup.
  if (!loading && session) return <Navigate to="/play" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    if (mode === 'signin') {
      // With "Confirm email" enabled, Supabase rejects unconfirmed accounts here.
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else {
        setGuestName(null); // an account replaces any guest identity
        navigate('/play');
      }
    } else {
      // emailRedirectTo: where the confirmation link sends the user back to.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/profile` },
      });
      if (error) setError(error.message);
      else if (data.session) navigate('/profile'); // only when confirmation is turned off
      else setCheckEmail(true);
    }
    setBusy(false);
  }

  if (checkEmail) {
    return (
      <main className="page">
        <h1>Check your email</h1>
        <p>We sent a confirmation link to <strong>{email}</strong>. Open it on this device to finish signing up.</p>
        <button onClick={() => { setCheckEmail(false); setMode('signin'); }}>Back to log in</button>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>{mode === 'signin' ? 'Log in' : 'Create account'}</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            required minLength={8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{mode === 'signin' ? 'Log in' : 'Sign up'}</button>
      </form>
      <button className="link" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}>
        {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Log in'}
      </button>
      <button className="link" onClick={() => navigate('/')}>Back</button>
    </main>
  );
}
