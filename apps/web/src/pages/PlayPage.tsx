import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';

/** Placeholder hub. Room creation and joining arrive in MVP 2. */
export function PlayPage() {
  const navigate = useNavigate();
  const { session, profile, guestName, signOut } = useAuth();
  const name = session ? profile?.display_name ?? '' : guestName ?? '';

  async function leave() {
    await signOut(); // clears the guest name or ends the account session
    navigate('/');
  }

  return (
    <main className="page">
      <Avatar url={session ? profile?.avatar_url : null} name={name} size={96} />
      <h1>Hi, {name}!</h1>
      <p className="muted">{session ? 'Signed in' : 'Playing as a guest'}</p>
      <button className="primary" disabled>Create room (MVP 2)</button>
      <button disabled>Join with code (MVP 2)</button>
      {session && <button onClick={() => navigate('/profile')}>Edit profile</button>}
      <button className="link" onClick={leave}>{session ? 'Log out' : 'Leave'}</button>
    </main>
  );
}
