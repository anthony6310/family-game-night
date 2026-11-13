/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string; // optional: only when the server is NOT on the same host as the web page
  readonly VITE_SERVER_PORT?: string; // optional: the server's port (default 3001)
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}
