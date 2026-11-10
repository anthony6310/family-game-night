import { Route, Routes } from 'react-router-dom';
import { RequireAccount, RequirePlayer } from './auth/guards';
import { DevStatus } from './components/DevStatus';
import { GuestPage } from './pages/GuestPage';
import { HistoryPage } from './pages/HistoryPage';
import { LandingPage } from './pages/LandingPage';
import { LobbyPage } from './pages/LobbyPage';
import { LoginPage } from './pages/LoginPage';
import { PlayPage } from './pages/PlayPage';
import { ProfilePage } from './pages/ProfilePage';

export function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/guest" element={<GuestPage />} />
        <Route path="/profile" element={<RequireAccount><ProfilePage /></RequireAccount>} />
        <Route path="/play" element={<RequirePlayer><PlayPage /></RequirePlayer>} />
        <Route path="/room" element={<RequirePlayer><LobbyPage /></RequirePlayer>} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
      <DevStatus />
    </>
  );
}
