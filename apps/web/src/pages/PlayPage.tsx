import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROOM_CODE_LENGTH } from '@fgn/shared';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { useRoom } from '../room/RoomContext';

/** Hub: create a room or join one by invite code. */
export function PlayPage() {
  const navigate = useNavigate();
  const { session, profile, guestName, signOut } = useAuth();
  const { createRoom, joinRoom, notice, clearNotice } = useRoom();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = session ? profile?.display_name ?? '' : guestName ?? '';

  // Run a create/join request, then enter the lobby or show why it failed.
  async function enter(request: () => Promise<string | null>) {
    setError(null);
    clearNotice();
    setBusy(true);
    const err = await request();
    setBusy(false);
    if (err) setError(err);
    else navigate('/room');
  }

  function onJoin(e: FormEvent) {
    e.preventDefault();
    enter(() => joinRoom(code));
  }

  async function leave() {
    await signOut(); // clears the guest name or ends the account session
    navigate('/');
  }

  return (
    <main className="page">
      <Avatar url={session ? profile?.avatar_url : null} name={name} size={96} />
      <h1>Hi, {name}!</h1>
      <p className="muted">{session ? 'Signed in' : 'Playing as a guest'}</p>

      <button className="primary" disabled={busy} onClick={() => enter(createRoom)}>Create room</button>

      <form onSubmit={onJoin}>
        <label>
          Have a code?
          <input
            className="code-input" value={code} maxLength={ROOM_CODE_LENGTH} placeholder="ABCD"
            onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off"
          />
        </label>
        <button disabled={busy || code.length !== ROOM_CODE_LENGTH}>Join room</button>
      </form>
      {error && <p className="error">{error}</p>}
      {notice && <p className="muted" onClick={clearNotice}>{notice}</p>}

      <button className="link" onClick={() => navigate('/history')}>Winners history</button>
      {session && <button className="link" onClick={() => navigate('/profile')}>Edit profile</button>}
      <button className="link" onClick={leave}>{session ? 'Log out' : 'Leave'}</button>
    </main>
  );
}
