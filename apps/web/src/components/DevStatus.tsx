import { useEffect, useState } from 'react';
import type { HealthResponse } from '@fgn/shared';
import { SERVER_URL } from '../lib/serverUrl';
import { checkSupabase } from '../lib/supabase';

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
      <small className={`status ${server}`}>
        Server: {server}
        {/* When it can't be reached, say where we tried: the quickest clue when testing on a phone. */}
        {server === 'offline' && <span> · tried {SERVER_URL}</span>}
      </small>
      <small className={`status ${db}`}>Supabase: {db}</small>
    </footer>
  );
}
