import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// DEPLOY: dev only. `host: true` opens these servers to everyone on your network. Do not use `vite preview` to serve a real
// deployment (host the built files on a proper static host instead).
// `host: true` exposes the dev server AND the production preview on your LAN so phones can open them
// (http://<your-ip>:5173 for dev, http://<your-ip>:4173 for `npm run preview`).
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
