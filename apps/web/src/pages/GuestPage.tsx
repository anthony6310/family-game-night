import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { DISPLAY_NAME_MAX } from '@fgn/shared';
import { useAuth } from '../auth/AuthContext';

/** Guests only pick a name. It stays in this tab (sessionStorage); nothing is saved to the database. */
export function GuestPage() {
  const navigate = useNavigate();
  const { setGuestName } = useAuth();
  const [name, setName] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setGuestName(trimmed);
    navigate('/play');
  }

  return (
    <main className="page">
      <h1>Play as guest</h1>
      <form onSubmit={onSubmit}>
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={DISPLAY_NAME_MAX} autoFocus />
        </label>
        <button className="primary" disabled={!name.trim()}>Continue</button>
      </form>
      <button className="link" onClick={() => navigate('/')}>Back</button>
    </main>
  );
}
