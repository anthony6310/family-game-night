import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `host: true` exposes the dev server on your LAN so phones can open it (http://<your-ip>:5173).
export default defineConfig({ plugins: [react()], server: { host: true, port: 5173 } });
