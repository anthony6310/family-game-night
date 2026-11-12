import { createGameServer } from './server';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

/** Optional dev-only timing overrides (ms), e.g. COUNTDOWN_MS=1000 ROUND_MS=3000 SNOWBALL_MS=10000 FINISH_MS=1000 RESULTS_MS=1500 npm run dev */
const ms = (value: string | undefined) => (value ? Number(value) : undefined);

createGameServer(CLIENT_ORIGIN, {
  countdownMs: ms(process.env.COUNTDOWN_MS),
  roundMs: ms(process.env.ROUND_MS),
  snowballMs: ms(process.env.SNOWBALL_MS),
  finishMs: ms(process.env.FINISH_MS),
  resultsMs: ms(process.env.RESULTS_MS),
}).listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
