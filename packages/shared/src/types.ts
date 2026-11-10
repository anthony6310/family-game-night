/** Shape of the server's GET /health response. Both sides import this, so they can't drift. */
export interface HealthResponse {
  status: 'ok';
  time: string;
}

/** A row of `profiles`. Both fields are null until the user finishes profile setup. */
export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

/** A row of `avatar_presets`. */
export interface AvatarPreset {
  id: number;
  label: string;
  image_url: string;
}
