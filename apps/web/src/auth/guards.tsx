import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

/** Route guard: needs a logged-in account (profile may still be incomplete). */
export function RequireAccount({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth();
  if (loading) return <p className="center">Loading…</p>;
  return session ? <>{children}</> : <Navigate to="/login" replace />;
}

/** Route guard: needs a finished account OR a guest name. Incomplete accounts go finish setup. */
export function RequirePlayer({ children }: { children: ReactNode }) {
  const { loading, session, profileComplete, guestName } = useAuth();
  if (loading) return <p className="center">Loading…</p>;
  if (session) return profileComplete ? <>{children}</> : <Navigate to="/profile" replace />;
  return guestName ? <>{children}</> : <Navigate to="/" replace />;
}
