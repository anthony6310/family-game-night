import { useEffect, useState } from 'react';
import type { HealthResponse } from '@fgn/shared';
import { checkSupabase } from '../lib/supabase';

export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

type Status = 'checking' | 'online' | 'offline';

/** Small diagnostics footer from MVP 0: shows whether the Node server and Supabase are reachable. */
export function DevStatus() {
  const [server, setServer] = useState<Status>('checking');
  const [db, setDb] = useState<Status>('checking');

  useEffect(() => {
    fetch(`${SERVER_URL}/health`)
      .then((res) => res.json() as Promise<HealthResponse>)
      .then((data) => setServer(data.status === 'ok' ? 'online' : 'offline'))
      .catch(() => setServer('offline'));
    checkSupabase().then((ok) => setDb(ok ? 'online' : 'offline'));
  }, []);

  return (
    <footer className="dev-status">
      <small className={`status ${server}`}>Server: {server}</small>
      <small className={`status ${db}`}>Supabase: {db}</small>
    </footer>
  );
}
