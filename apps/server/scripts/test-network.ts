/**
 * Can a phone on the local network use the server?
 *   npm run test:network -w @fgn/server
 * Checks which browser origins are allowed, and then really talks to the running server over this computer's
 * LAN address with a phone-style Origin header (so it also proves the server listens beyond localhost).
 */
import type { AddressInfo } from 'node:net';
import { io } from 'socket.io-client';
import { isAllowedOrigin, lanAddresses, parseOrigins } from '../src/origins';
import { createGameServer } from '../src/server';

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};

// ---- the rules ----
const none: string[] = [];
check('origins: your own computer (localhost / 127.0.0.1) is allowed', ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173'].every((o) => isAllowedOrigin(o, none)));
check('origins: phones on a home network (192.168.x.x, 10.x.x.x, 172.16-31.x.x) are allowed, on any port',
  ['http://192.168.1.23:5173', 'http://10.0.0.81:5173', 'http://10.0.0.81:4173', 'http://172.16.0.5:5173', 'http://172.31.255.1:5173'].every((o) => isAllowedOrigin(o, none)));
check('origins: a .local computer name (e.g. my-mac.local) is allowed', isAllowedOrigin('http://my-mac.local:5173', none));
check('origins: public websites are NOT allowed by default', ['https://evil.example.com', 'http://8.8.8.8:5173', 'http://172.15.0.1:5173', 'http://172.32.0.1:5173', 'http://192.169.1.1:5173'].every((o) => !isAllowedOrigin(o, none)));
check('origins: tricky hostnames that merely CONTAIN a private address are not allowed', ['http://192.168.1.23.evil.com', 'http://evil.com/192.168.1.23', 'http://localhost.evil.com'].every((o) => !isAllowedOrigin(o, none)));
check('origins: garbage is not allowed', !isAllowedOrigin('not a url', none) && !isAllowedOrigin('null', none));
check('origins: a site listed in CLIENT_ORIGIN is allowed (how a deployment is set up), others still are not',
  isAllowedOrigin('https://family-games.example.com', ['https://family-games.example.com']) && !isAllowedOrigin('https://other.example.com', ['https://family-games.example.com']));
check('origins: non-browser clients (no Origin header) are allowed', isAllowedOrigin(undefined, none));
check('origins: CLIENT_ORIGIN accepts a comma separated list', JSON.stringify(parseOrigins(' https://a.example.com , https://b.example.com,')) === JSON.stringify(['https://a.example.com', 'https://b.example.com']) && parseOrigins(undefined).length === 0);

// ---- the real server, reached the way a phone would reach it ----
const lan = lanAddresses()[0];
const httpServer = createGameServer(''); // no CLIENT_ORIGIN at all: local network addresses must still work
await new Promise<void>((r) => httpServer.listen(0, r));
const port = (httpServer.address() as AddressInfo).port;

if (!lan) {
  console.log('SKIP  no LAN address found on this computer; skipping the real network checks');
} else {
  const phoneOrigin = `http://${lan}:5173`;
  const health = await fetch(`http://${lan}:${port}/health`, { headers: { Origin: phoneOrigin } });
  check(`real server: reachable on this computer's LAN address (${lan}), not just localhost`, health.status === 200);
  check('real server: it answers a phone\'s origin with permission to read the reply', health.headers.get('access-control-allow-origin') === phoneOrigin);
  const evil = await fetch(`http://${lan}:${port}/health`, { headers: { Origin: 'https://evil.example.com' } });
  check('real server: a public website gets no permission', evil.headers.get('access-control-allow-origin') === null);

  // Socket.io's first request (the "polling" handshake) is where a browser would be blocked if CORS were wrong.
  const poll = await fetch(`http://${lan}:${port}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: phoneOrigin } });
  check('real server: the live-connection (Socket.io) handshake is allowed for a phone origin', poll.status === 200 && poll.headers.get('access-control-allow-origin') === phoneOrigin);
  const pollEvil = await fetch(`http://${lan}:${port}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: 'https://evil.example.com' } });
  check('real server: ...and refused permission for a public website', pollEvil.headers.get('access-control-allow-origin') === null);

  const socket = io(`http://${lan}:${port}`, { auth: { guestName: 'Phone' }, transports: ['websocket'], reconnection: false });
  const connected = await new Promise<boolean>((resolve) => { socket.on('connect', () => resolve(true)); socket.on('connect_error', () => resolve(false)); });
  check('real server: a guest connects over the LAN address and is accepted', connected);
  socket.close();
}
httpServer.close();

console.log(failures === 0 ? '\nAll network checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
