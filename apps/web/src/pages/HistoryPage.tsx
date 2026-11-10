import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionHistoryRow } from '@fgn/shared';
import { supabase } from '../lib/supabase';

/** Past session winners, newest first. Anyone can read this table (no login needed). */
export function HistoryPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SessionHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('session_results')
      .select('id, winner_name, is_guest, winner_wins, total_rounds, tiebreaker_rounds, finished_at')
      .order('finished_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => (error ? setError(error.message) : setRows(data)));
  }, []);

  return (
    <main className="page history-page">
      <h1>Winners</h1>
      {error && <p className="error">Couldn't load history: {error}</p>}
      {!error && rows === null && <p className="muted">Loading…</p>}
      {rows?.length === 0 && <p className="muted">No finished games yet. Go win one!</p>}
      <ul className="players">
        {rows?.map((r) => (
          <li key={r.id}>
            <span className="crown">👑</span>
            <span className="player-name">
              {r.winner_name}
              {r.is_guest && <span className="muted"> (guest)</span>}
              <small className="muted block">
                {new Date(r.finished_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                {' · '}{r.total_rounds} rounds{r.tiebreaker_rounds > 0 && ' + tie-breaker'}
              </small>
            </span>
            <span className="badge wins">🏆 {r.winner_wins}</span>
          </li>
        ))}
      </ul>
      <button className="link" onClick={() => navigate(-1)}>Back</button>
    </main>
  );
}
