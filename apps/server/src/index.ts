import { lanAddresses } from './origins';
import { createGameServer } from './server';

const PORT = Number(process.env.PORT ?? 3001);
// Optional: extra website origins allowed to use this server (comma separated), e.g. your deployed site.
// Pages on the local network (localhost, 192.168.x.x, 10.x.x.x ...) are always allowed.
// DEPLOY: set this to your real site (e.g. https://games.example.com) and see the deploy checklist in server.ts.
// Also note: the server listens on ALL network interfaces, so on a public host it is reachable by anyone.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? '';

/** Optional dev-only timing overrides (ms), e.g. COUNTDOWN_MS=1000 ROUND_MS=3000 SNOWBALL_MS=10000 FINISH_MS=1000 RESULTS_MS=1500 npm run dev */
const ms = (value: string | undefined) => (value ? Number(value) : undefined);

createGameServer(CLIENT_ORIGIN, {
  countdownMs: ms(process.env.COUNTDOWN_MS),
  roundMs: ms(process.env.ROUND_MS),
  snowballMs: ms(process.env.SNOWBALL_MS),
  finishMs: ms(process.env.FINISH_MS),
  resultsMs: ms(process.env.RESULTS_MS),
}).listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  // Handy when testing on a phone: the address to type into its browser (the web app finds this server by itself).
  for (const ip of lanAddresses()) console.log(`On your Wi-Fi: open http://${ip}:5173 on a phone (this server is at http://${ip}:${PORT})`);
});
