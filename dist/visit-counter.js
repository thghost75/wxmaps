// Adapted from Romanian Climate Explorer's VisitCounter component for this vanilla JS site.
const liveOrigin = 'https://wxmaps-iota.vercel.app';
// Preserve the opt-out already saved by the browser-local counter.
const exclusionKey = 'wxmaps.page-visits.excluded.v1';
const countElement = document.getElementById('visit-count');
const noteElement = document.getElementById('visit-count-note');
const toggleElement = document.getElementById('visit-count-toggle');
let total = null;
let failed = false;

function preference() {
  try { return { excluded: localStorage.getItem(exclusionKey) === 'true', available: true }; }
  catch { return { excluded: true, available: false }; }
}

function renderCounter() {
  const { excluded, available } = preference();
  countElement.textContent = total ? new Intl.NumberFormat('en-GB').format(total.visits) : '—';
  const notes = [];
  if (location.origin !== liveOrigin) notes.push('Counter runs on the live site');
  else if (failed) notes.push('Site visit total temporarily unavailable');
  else if (!total) notes.push('Loading site visits…');
  else {
    if (total.since) notes.push('Since ' + new Date(total.since + 'T00:00:00Z').toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }));
    notes.push('Repeat visits within 30 minutes count once');
  }
  if (!available) notes.push('Browser storage blocked; your visits are excluded');
  else if (excluded) notes.push('Your browser is excluded');
  noteElement.textContent = notes.join(' · ');
  toggleElement.textContent = excluded ? 'Resume counting this browser' : 'Exclude this browser';
  toggleElement.disabled = !available;
}

async function loadTotal() {
  if (location.origin !== liveOrigin) return;
  try {
    // Excluded browsers can still read the shared total without increasing it.
    const response = await fetch('/api/visits', {
      method: preference().excluded ? 'GET' : 'POST',
      headers: { 'X-WxMaps-Visit': '1' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Counter unavailable');
    const result = await response.json();
    if (!Number.isSafeInteger(result.visits) || result.visits < 0
        || !(result.since === null || (typeof result.since === 'string'
          && /^\d{4}-\d{2}-\d{2}$/.test(result.since) && Number.isFinite(Date.parse(result.since))))) {
      throw new Error('Invalid counter response');
    }
    total = result;
  } catch { failed = true; }
  // Never retry a POST: a timeout may occur after the visit was counted.
  renderCounter();
}

renderCounter();
// Serialize page-load requests so other tabs receive the first tab's cookie.
const request = navigator.locks?.request
  ? navigator.locks.request('wxmaps.site-visits', loadTotal)
  : loadTotal();
request.catch(() => { failed = true; renderCounter(); });

toggleElement.addEventListener('click', () => {
  try {
    localStorage.setItem(exclusionKey, String(!preference().excluded));
    renderCounter();
  } catch {
    renderCounter();
    noteElement.textContent = 'Could not save counting preference. Check browser storage settings.';
  }
});
window.addEventListener('storage', event => {
  if (event.key === exclusionKey || event.key === null) renderCounter();
});
