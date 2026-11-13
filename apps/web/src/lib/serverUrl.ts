/**
 * Where the game server lives.
 *
 * By default this is the SAME computer that served the web page, on the server's port. So if you open the site on
 * your phone at http://192.168.1.23:5173, it talks to http://192.168.1.23:3001, and on your own computer
 * (http://localhost:5173) it talks to http://localhost:3001. Nothing to configure for phones on your Wi-Fi.
 *
 * For a real deployment where the server is on a different host, set VITE_SERVER_URL at build time.
 * DEPLOY: if you forget it, a deployed site will look for the server on its OWN host at port 3001 and fail. Use an
 * https:// server URL when the site is https (browsers block plain http/ws calls from an https page).
 */
const port = import.meta.env.VITE_SERVER_PORT || '3001';

export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:${port}`;
