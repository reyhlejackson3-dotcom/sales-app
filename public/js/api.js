import { banner } from './ui.js';

function noteDemo(j) { if (j && j.demo) banner('demo', 'Demo mode: some AI keys are not set yet, so parts of this run on sample data.'); }

async function parse(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
    noteDemo(j);
    return j;
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res;
}

export async function post(path, body, { signal } = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  return parse(res);
}

export async function postBinary(path, blob, { signal } = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: blob, signal });
  return parse(res);
}
