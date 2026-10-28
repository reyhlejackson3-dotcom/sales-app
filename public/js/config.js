// Public config. The Supabase anon (publishable) key is meant to be in the browser; row-level security protects the data.
// Secrets (Anthropic, Azure, ElevenLabs) live in Vercel environment variables, never here.
export const CONFIG = {
  APP_NAME: 'Sales Coach',
  SUPABASE_URL: 'https://obuudbrlurybwcvuungr.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_uyqV26xV1aLF_HjhIdCYcA_fUgo0KkY',
  // The fake test account ("claudio"). No login yet: every visitor is this profile.
  TEST_PROFILE_ID: 'c1a0d10c-0000-4000-8000-000000000001',
  MAX_CLIP_SECONDS: 120,
  MAX_FILE_MB: 200,
};
