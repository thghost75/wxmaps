const key = 'wxmaps.page-visits.v1';
const exclusionKey = 'wxmaps.page-visits.excluded.v1';
const countElement = document.getElementById('visit-count');
const noteElement = document.getElementById('visit-count-note');
const toggleElement = document.getElementById('visit-count-toggle');

function readCount() {
  const count = Number(localStorage.getItem(key));
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}
function showCount(count) {
  countElement.textContent = new Intl.NumberFormat('en-GB').format(count);
}
function isExcluded() {
  return localStorage.getItem(exclusionKey) === 'true';
}
function renderCounter() {
  const excluded = isExcluded();
  showCount(readCount());
  noteElement.textContent = excluded
    ? 'This browser is excluded · counting paused'
    : 'This browser · includes reloads';
  toggleElement.textContent = excluded ? 'Resume counting this browser' : 'Exclude this browser';
  toggleElement.disabled = false;
}
function unavailable() {
  countElement.textContent = '—';
  noteElement.textContent = 'Visit count unavailable · browser storage is blocked';
  toggleElement.disabled = true;
}
function recordVisit() {
  try {
    if (!isExcluded()) {
      const count = Math.min(readCount() + 1, Number.MAX_SAFE_INTEGER);
      localStorage.setItem(key, String(count));
    }
    renderCounter();
  } catch { unavailable(); }
}
// Serialize increments across tabs when Web Locks is available.
function withCounterLock(action) {
  if (navigator.locks?.request) return navigator.locks.request(key, action);
  return Promise.resolve().then(action);
}
withCounterLock(recordVisit).catch(unavailable);
toggleElement.addEventListener('click', () => {
  toggleElement.disabled = true;
  withCounterLock(() => {
    try {
      localStorage.setItem(exclusionKey, String(!isExcluded()));
      renderCounter();
    } catch {
      // Keep the actual saved state visible if a preference write fails.
      try { renderCounter(); } catch { unavailable(); }
      noteElement.textContent = 'Could not change counting preference. Check browser storage settings.';
    }
  }).catch(unavailable);
});
window.addEventListener('storage', event => {
  if (event.key !== key && event.key !== exclusionKey && event.key !== null) return;
  try { renderCounter(); } catch { unavailable(); }
});
