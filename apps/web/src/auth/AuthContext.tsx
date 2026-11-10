import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Profile } from '@fgn/shared';
import { supabase } from '../lib/supabase';

const GUEST_KEY = 'fgn.guestName';

interface AuthState {
  /** True until we know the session AND (if logged in) the profile. Guards wait on this. */
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  /** An account is "complete" once it has a display name and an avatar. */
  profileComplete: boolean;
  /** Guests live only in this tab's sessionStorage. Nothing is stored server-side. */
  guestName: string | null;
  setGuestName: (name: string | null) => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function readGuestName(): string | null {
  try {
    return sessionStorage.getItem(GUEST_KEY);
  } catch {
    return null; // storage can be blocked (private mode)
  }
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .eq('id', userId)
    .maybeSingle();
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Which user id `profile` was loaded for. Prevents a flash of "no profile" right after login.
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [guestName, setGuestNameState] = useState<string | null>(readGuestName);

  // 1) Track the Supabase session. The listener fires on login, logout and token refresh,
  //    and also when the email-confirmation link brings the user back to the site.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  // 2) Load the profile whenever the logged-in user changes.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setProfileFor(null);
      return;
    }
    let cancelled = false;
    fetchProfile(userId).then((p) => {
      if (cancelled) return;
      setProfile(p);
      setProfileFor(userId);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const refreshProfile = useCallback(async () => {
    if (userId) setProfile(await fetchProfile(userId));
  }, [userId]);

  const setGuestName = useCallback((name: string | null) => {
    setGuestNameState(name);
    try {
      if (name) sessionStorage.setItem(GUEST_KEY, name);
      else sessionStorage.removeItem(GUEST_KEY);
    } catch {
      /* ignore: the name still works in memory for this page load */
    }
  }, []);

  const signOut = useCallback(async () => {
    setGuestName(null);
    await supabase.auth.signOut();
  }, [setGuestName]);

  const value: AuthState = {
    loading: !sessionReady || (userId !== null && profileFor !== userId),
    session,
    profile,
    profileComplete: Boolean(profile?.display_name && profile?.avatar_url),
    guestName,
    setGuestName,
    refreshProfile,
    signOut,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
