import { useState } from 'react';
import { DEFAULT_ROOM_NAME, ROOM_NAME_MAX, ROOM_PASSWORD_MAX, type RoomState } from '@fgn/shared';

interface Props {
  room: RoomState;
  isHost: boolean;
  onSettings: (change: { name?: string; password?: string | null }) => Promise<unknown>;
  onEndSession: () => void;
  onClose: () => void;
  onLeave: () => void;
}

/** The ROOM menu (the ⚙): for the host the room's name and password, End session and Close room; for everyone Leave room. */
export function RoomSheet({ room, isHost, onSettings, onEndSession, onClose, onLeave }: Props) {
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState('');
  return (
    <div className="room-sheet">
      {isHost && room.phase === 'lobby' && (
        <>
          {/* The host can rename the room and add, change or remove its password (new joiners need it; people already here stay). */}
          <form onSubmit={(e) => { e.preventDefault(); void onSettings({ name: (nameDraft ?? room.name).trim() || DEFAULT_ROOM_NAME }).then(() => setNameDraft(null)); }}>
            <label>
              Room name
              <input value={nameDraft ?? room.name} maxLength={ROOM_NAME_MAX} onChange={(e) => setNameDraft(e.target.value)} />
            </label>
            <button disabled={nameDraft === null}>Save name</button>
          </form>
          <form onSubmit={(e) => { e.preventDefault(); void onSettings({ password: passwordDraft }).then(() => setPasswordDraft('')); }}>
            <label>
              {room.hasPassword ? 'New password' : 'Password'}
              <input type="password" value={passwordDraft} maxLength={ROOM_PASSWORD_MAX} autoComplete="new-password" placeholder="Type a password" onChange={(e) => setPasswordDraft(e.target.value)} />
            </label>
            <button disabled={passwordDraft.length === 0}>{room.hasPassword ? 'Change password' : 'Add password'}</button>
            {room.hasPassword && <button type="button" className="link" onClick={() => void onSettings({ password: null })}>Remove password</button>}
          </form>
          {/* The host decides when the session is over: the player with the most wins is crowned. */}
          {room.roundsPlayed > 0 && <button onClick={onEndSession}>End session</button>}
          <button className="link" onClick={onClose}>Close room</button>
        </>
      )}
      <button className="link" onClick={onLeave}>Leave room</button>
    </div>
  );
}
