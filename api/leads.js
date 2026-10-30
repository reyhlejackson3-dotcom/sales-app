// Lead finder (TEST BUILD). Uses Google Places Text Search (New) when GOOGLE_PLACES_API_KEY is set, otherwise returns sample leads.
//
// IMPORTANT: Google's Maps Platform terms limit storing, bulk-extracting and reselling Places data, and may not allow
// building prospecting or telemarketing lists from it. Use this for your own testing only. Before selling it, get written
// confirmation from Google or swap the source (see fromSource() below) for a licensed data provider.
//
// Data handling: this endpoint stores nothing. The app saves only a place id plus the user's own notes, and re-fetches
// phone and website on demand ("details").
import { handle, readJson, send, str, HttpError } from './_lib.js';

const KEY = () => process.env.GOOGLE_PLACES_API_KEY;
const SEARCH_MASK = 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours.openNow,places.businessStatus,nextPageToken';
const DETAIL_MASK = 'id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,regularOpeningHours.openNow';

const DEMO_NAMES = [
  ['Summit Roofing Co', 'https://example.com/summit', true], ['Front Range Plumbing', null, true], ['Aurora Heating & Air', 'https://example.com/aurora', false],
  ['Mile High Roof Repair', null, true], ['Peak Electric', 'https://example.com/peak', true], ['Bluebird Landscaping', null, false],
  ['Cherry Creek Dental', 'https://example.com/cherry', true], ['Parker Auto Care', 'https://example.com/parker', true], ['Rockies Pest Control', null, true],
  ['Elk Ridge Cleaning', 'https://example.com/elk', false], ['Union Tire & Brake', null, true], ['Sunrise Flooring', 'https://example.com/sunrise', true],
];

function demoLeads(query, location) {
  return DEMO_NAMES.map(([name, site, open], i) => ({
    id: `demo-${i}-${query.toLowerCase().replace(/\W+/g, '').slice(0, 8)}`,
    name: `${name}${query ? '' : ''}`, address: `${100 + i * 17} Sample St, ${location || 'Denver, CO'}`,
    phone: `(303) 555-01${String(i).padStart(2, '0')}`, website: site, openNow: open, demo: true,
  }));
}

function shape(p) {
  return {
    id: p.id, name: p.displayName?.text || 'Unnamed business', address: p.formattedAddress || '',
    phone: p.nationalPhoneNumber || null, website: p.websiteUri || null,
    openNow: typeof p.regularOpeningHours?.openNow === 'boolean' ? p.regularOpeningHours.openNow : null,
  };
}

async function googleError(r) {
  let msg = '';
  try { msg = (await r.json())?.error?.message || ''; } catch { /* ignore */ }
  console.error('Places error', r.status, msg.slice(0, 300));
  if (r.status === 403 || r.status === 400) throw new HttpError(502, 'Google rejected the request. Check that GOOGLE_PLACES_API_KEY is valid, billing is on, and "Places API (New)" is enabled.');
  if (r.status === 429) throw new HttpError(429, 'Google says too many lead searches right now. Wait a minute.');
  throw new HttpError(502, 'Google Places did not answer. Try again.');
}

/** The single place that talks to the lead source. Swap this to change providers. */
async function fromSource({ query, location, openNow, pageToken }) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': SEARCH_MASK },
    body: JSON.stringify({ textQuery: `${query} in ${location}`, pageSize: 20, ...(openNow ? { openNow: true } : {}), ...(pageToken ? { pageToken } : {}) }),
  });
  if (!r.ok) await googleError(r);
  const j = await r.json();
  return { leads: (j.places || []).filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY').map(shape), next: j.nextPageToken || null };
}

export default handle(async (req, res) => {
  const b = await readJson(req);

  if (b.action === 'details') {
    const id = str(b.placeId, 200);
    if (!/^[\w-]{8,200}$/.test(id)) throw new HttpError(400, 'Bad lead id.');
    if (!KEY() || id.startsWith('demo-')) {
      const i = Number(id.split('-')[1]) || 0;
      send(res, 200, { lead: demoLeads('', '')[i % DEMO_NAMES.length], demo: true });
      return;
    }
    const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, { headers: { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': DETAIL_MASK } });
    if (!r.ok) await googleError(r);
    send(res, 200, { lead: shape(await r.json()), demo: false });
    return;
  }

  const query = str(b.query, 80).trim();
  const location = str(b.location, 80).trim();
  if (!query || !location) throw new HttpError(400, 'Enter a business type and a place, like "roofers" in "Aurora, CO".');
  const filter = ['any', 'has_site', 'no_site'].includes(b.filter) ? b.filter : 'any';
  const openNow = b.openNow === true;
  const pageToken = typeof b.pageToken === 'string' && /^[\w-]{10,2000}$/.test(b.pageToken) ? b.pageToken : null;

  let leads; let next = null; let demo = false;
  if (!KEY()) {
    demo = true;
    leads = demoLeads(query, location);
    if (openNow) leads = leads.filter((l) => l.openNow);
  } else {
    ({ leads, next } = await fromSource({ query, location, openNow, pageToken }));
  }
  const fetched = leads.length;
  if (filter === 'has_site') leads = leads.filter((l) => l.website);
  if (filter === 'no_site') leads = leads.filter((l) => !l.website);
  send(res, 200, { leads, fetched, next, demo });
});
