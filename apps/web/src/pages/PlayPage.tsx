import { Icon } from '../components/Icon';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_ROOM_NAME, ROOM_NAME_MAX, ROOM_PASSWORD_MAX, type RoomListing } from '@fgn/shared';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { useRoom } from '../room/RoomContext';

const REFRESH_MS = 3000; // how often the list of rooms refreshes while you look at it

/** Hub: pick a room from the list and join it (a locked one asks for its password), or make your own. */
export function PlayPage() {
  const navigate = useNavigate();
  const { session, profile, guestName, signOut } = useAuth();
  const { createRoom, joinRoom, listRooms, notice, clearNotice } = useRoom();
  const [rooms, setRooms] = useState<RoomListing[] | null>(null); // null = not loaded yet
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<string | null>(null); // the id of the locked room whose password is being typed
  const [typed, setTyped] = useState('');
  const [name, setName] = useState(DEFAULT_ROOM_NAME); // the new room's name (it starts as "Game Room")
  const [password, setPassword] = useState(''); // the new room's password (optional)
  const me = session ? profile?.display_name ?? '' : guestName ?? '';

  // Keep the list fresh while this page is open.
  const refresh = useCallback(async () => {
    const result = await listRooms();
    if ('error' in result) setError(result.error);
    else setRooms(result.rooms);
  }, [listRooms]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Run a create/join request, then enter the lobby or show why it failed.
  async function enter(request: () => Promise<string | null>) {
    setError(null);
    clearNotice();
    setBusy(true);
    const err = await request();
    setBusy(false);
    if (err) { setError(err); void refresh(); }
    else navigate('/room');
  }

  function onJoin(room: RoomListing) {
    if (room.hasPassword) { setAsking(room.code); setTyped(''); setError(null); return; } // a locked room: ask for the password first
    void enter(() => joinRoom(room.code));
  }
  function onSubmitPassword(e: FormEvent, room: RoomListing) {
    e.preventDefault();
    void enter(() => joinRoom(room.code, typed));
  }
  function onCreate(e: FormEvent) {
    e.preventDefault();
    void enter(() => createRoom({ name: name.trim() || DEFAULT_ROOM_NAME, password: password || undefined }));
  }

  async function leave() {
    await signOut(); // clears the guest name or ends the account session
    navigate('/');
  }

  /** What a room is doing, in a few words. */
  const status = (room: RoomListing) => room.phase === 'lobby' || room.phase === 'countdown' || room.phase === 'starting' ? 'Waiting to play' : room.phase === 'session-over' ? 'Session over' : 'Playing now';

  return (
    <main className="page">
      <Avatar url={session ? profile?.avatar_url : null} name={me} size={72} />
      <h1>Hi, {me}!</h1>
      <p className="muted">{session ? 'Signed in' : 'Playing as a guest'}</p>

      <section className="rooms-section">
        <h2>Join a room</h2>
        {rooms === null && <p className="muted">Looking for rooms…</p>}
        {rooms !== null && rooms.length === 0 && <p className="muted">No rooms yet. Make the first one below!</p>}
        <ul className="room-list">
          {rooms?.map((room) => (
            <li key={room.code} className="room-item">
              <div className="room-info">
                <strong className="room-name">{room.hasPassword && <span title="Needs a password"><Icon name="lock" /> </span>}{room.name}</strong>
                <span className="muted">
                  Host: {room.hostName} · {room.members}/{room.capacity} · {room.gameName ?? 'No game picked'} · {status(room)}
                </span>
              </div>
              <button className="primary" disabled={busy || room.full} onClick={() => onJoin(room)}>{room.full ? 'Full' : 'Join'}</button>
              {asking === room.code && (
                <form className="room-password" onSubmit={(e) => onSubmitPassword(e, room)}>
                  <input type="password" autoFocus value={typed} maxLength={ROOM_PASSWORD_MAX} placeholder="Password"
                    autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
                  <button disabled={busy || typed.length === 0}>Join</button>
                  <button type="button" className="link" onClick={() => setAsking(null)}>Cancel</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {error && <p className="error">{error}</p>}
        <button className="link" onClick={() => void refresh()}>Refresh</button>
      </section>

      <section className="rooms-section">
        <h2>Make your own room</h2>
        <form className="room-form" onSubmit={onCreate}>
          <label>
            Room name
            <input value={name} maxLength={ROOM_NAME_MAX} placeholder={DEFAULT_ROOM_NAME} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Password (optional)
            <input type="password" value={password} maxLength={ROOM_PASSWORD_MAX} placeholder="Leave empty for an open room"
              autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="primary" disabled={busy}>Create room</button>
        </form>
      </section>

      {notice && <p className="muted" onClick={clearNotice}>{notice}</p>}

      <button className="link" onClick={() => navigate('/history')}>Winners history</button>
      {session && <button className="link" onClick={() => navigate('/profile')}>Edit profile</button>}
      <button className="link" onClick={leave}>{session ? 'Log out' : 'Leave'}</button>
    </main>
  );
}
