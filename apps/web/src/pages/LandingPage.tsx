import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function LandingPage() {
  const navigate = useNavigate();
  const { session, profileComplete, guestName } = useAuth();
  // Already identified (finished account or guest)? Skip straight to Play.
  const canPlay = (session && profileComplete) || guestName;

  return (
    <main className="page">
      <h1>Family Game Night</h1>
      <p>Grab your phone and play together.</p>
      <button className="primary" onClick={() => navigate(canPlay ? '/play' : '/guest')}>
        Play now
      </button>
      <button onClick={() => navigate(session ? '/play' : '/login')}>
        {session ? 'My account' : 'Log in'}
      </button>
      <button className="link" onClick={() => navigate('/history')}>Winners history</button>
    </main>
  );
}
