// Supabase over plain REST (no library). If Supabase can't be reached (e.g. the SQL hasn't been run yet),
// everything quietly falls back to this browser's localStorage so the app stays testable.
import { CONFIG } from './config.js';
import { banner } from './ui.js';

const ID = CONFIG.TEST_PROFILE_ID;
const base = `${CONFIG.SUPABASE_URL}/rest/v1`;
const headers = { apikey: CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
let useLocal = false;

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(base + path, { method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

function fallback(err) {
  if (!useLocal) console.warn('Supabase unavailable, using local storage:', err);
  useLocal = true;
  banner('db', 'Database not reachable, so data is saved only in this browser. Run the SQL in Supabase to fix this.');
}

const L = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('sc_' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sc_' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const defaultProfile = () => ({ id: ID, handle: 'claudio', display_name: 'Claudio', company: 'Claudio Test Co', sells: 'Test widgets', category: 'Software / SaaS', bio: '', avatar: null });

export async function getProfile() {
  if (!useLocal) {
    try {
      const rows = await rest(`/profiles?id=eq.${ID}&select=*`);
      if (rows?.length) return rows[0];
      throw new Error('profile row missing');
    } catch (e) { fallback(e); }
  }
  return L.get('profile', defaultProfile());
}

export async function updateProfile(patch) {
  if (!useLocal) {
    try { const rows = await rest(`/profiles?id=eq.${ID}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }); if (rows?.length) return rows[0]; throw new Error('no row updated'); }
    catch (e) { fallback(e); }
  }
  const next = { ...L.get('profile', defaultProfile()), ...patch };
  L.set('profile', next);
  return next;
}

export async function listSessions() {
  if (!useLocal) {
    try { return await rest(`/sessions?profile_id=eq.${ID}&select=*&order=created_at.asc`); } catch (e) { fallback(e); }
  }
  return L.get('sessions', []);
}

export async function addSession(row) {
  const body = { ...row, profile_id: ID };
  if (!useLocal) {
    try { const rows = await rest('/sessions', { method: 'POST', body, prefer: 'return=representation' }); return rows[0]; } catch (e) { fallback(e); }
  }
  const saved = { ...body, id: crypto.randomUUID(), created_at: new Date().toISOString() };
  L.set('sessions', [...L.get('sessions', []), saved]);
  return saved;
}

export async function deleteSession(id) {
  if (!useLocal) {
    try { await rest(`/sessions?id=eq.${encodeURIComponent(id)}&profile_id=eq.${ID}`, { method: 'DELETE' }); return; } catch (e) { fallback(e); }
  }
  L.set('sessions', L.get('sessions', []).filter((s) => s.id !== id));
}

export async function deleteAllSessions() {
  if (!useLocal) {
    try { await rest(`/sessions?profile_id=eq.${ID}`, { method: 'DELETE' }); return; } catch (e) { fallback(e); }
  }
  L.set('sessions', []);
}
