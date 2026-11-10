import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES, DISPLAY_NAME_MAX, type AvatarPreset } from '@fgn/shared';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { supabase } from '../lib/supabase';

/** Profile setup: display name + avatar (a preset from the DB, or the user's own upload). */
export function ProfilePage() {
  const navigate = useNavigate();
  const { session, profile, refreshProfile, signOut } = useAuth();
  const userId = session!.user.id; // RequireAccount guarantees a session
  const [name, setName] = useState(profile?.display_name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '');
  const [presets, setPresets] = useState<AvatarPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('avatar_presets').select('id, label, image_url').order('id')
      .then(({ data }) => setPresets(data ?? []));
  }, []);

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Client-side checks give friendly errors; the bucket enforces the same limits server-side.
    if (!AVATAR_MIME_TYPES.includes(file.type)) return setError('Please choose a PNG, JPG, WebP or GIF image.');
    if (file.size > AVATAR_MAX_BYTES) return setError('Image must be 2 MB or smaller.');

    setError(null);
    setBusy(true);
    // Storage policy: the first folder must be the user's own id. One fixed file per user (upsert).
    const path = `${userId}/avatar`;
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
    if (error) setError(error.message);
    else {
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      setAvatarUrl(`${data.publicUrl}?v=${Date.now()}`); // ?v= busts the browser cache after a re-upload
    }
    setBusy(false);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    // RLS only allows this write when id === the logged-in user's id.
    const { error } = await supabase.from('profiles').upsert({ id: userId, display_name: name.trim(), avatar_url: avatarUrl });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    await refreshProfile();
    navigate('/play');
  }

  return (
    <main className="page">
      <h1>Your profile</h1>
      <Avatar url={avatarUrl} name={name || '?'} size={96} />
      <form onSubmit={onSave}>
        <label>
          Display name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={DISPLAY_NAME_MAX} required />
        </label>

        <fieldset>
          <legend>Pick an avatar</legend>
          <div className="avatar-grid">
            {presets.map((p) => (
              <button
                type="button" key={p.id} title={p.label}
                className={p.image_url === avatarUrl ? 'avatar-option selected' : 'avatar-option'}
                onClick={() => setAvatarUrl(p.image_url)}
              >
                <Avatar url={p.image_url} name={p.label} size={56} />
              </button>
            ))}
          </div>
          <label className="upload">
            …or upload your own
            <input type="file" accept={AVATAR_MIME_TYPES.join(',')} onChange={onUpload} disabled={busy} />
          </label>
        </fieldset>

        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy || !name.trim() || !avatarUrl}>Save</button>
      </form>
      <button className="link" onClick={signOut}>Log out</button>
    </main>
  );
}
