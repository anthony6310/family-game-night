import { networkInterfaces } from 'node:os';

/** Hosts on a home / office network: localhost, private IP ranges (10.x, 192.168.x, 172.16-31.x) and .local names. */
const LOCAL_HOST = /^(localhost|127(\.\d+){3}|\[::1\]|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|[a-z0-9-]+\.local)$/i;

/**
 * DEPLOY: the local-network allowance below applies in EVERY environment, including a deployed server. It is low
 * risk (the server has no cookies or sessions, and its only plain HTTP routes are /health and /health/supabase),
 * but before going online consider restricting it to development (e.g. skip it when NODE_ENV === 'production')
 * and list your real site in CLIENT_ORIGIN instead.
 *
 * Which web pages (browser origins) may talk to the server. Allowed:
 *  - anything on the local network, so a phone on your Wi-Fi can open http://192.168.x.x:5173 and play;
 *  - any origin listed in CLIENT_ORIGIN (comma separated), which is how a deployed site is allowed;
 *  - requests with no origin at all (non-browser clients such as the test scripts).
 */
export function isAllowedOrigin(origin: string | undefined, configured: string[]): boolean {
  if (!origin) return true;
  if (configured.includes(origin)) return true;
  try {
    return LOCAL_HOST.test(new URL(origin).hostname);
  } catch {
    return false; // not a valid origin
  }
}

/** Splits the CLIENT_ORIGIN setting ("a, b") into a clean list. */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? '').split(',').map((o) => o.trim()).filter(Boolean);
}

/** This computer's addresses on the local network (e.g. ["192.168.1.23"]), to print for phone testing. */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => Boolean(i) && i!.family === 'IPv4' && !i!.internal)
    .map((i) => i.address);
}
