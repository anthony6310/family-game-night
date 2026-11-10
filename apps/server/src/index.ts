import { createGameServer } from './server';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

createGameServer(CLIENT_ORIGIN).listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
