const key = 'wxmaps.page-visits.v1';
const countElement = document.getElementById('visit-count');
const noteElement = document.getElementById('visit-count-note');

function readCount() {
  const count = Number(localStorage.getItem(key));
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}
function showCount(count) {
  countElement.textContent = new Intl.NumberFormat('en-GB').format(count);
}
function unavailable() {
  countElement.textContent = '—';
  noteElement.textContent = 'Visit count unavailable · browser storage is blocked';
}
function recordVisit() {
  try {
    const count = Math.min(readCount() + 1, Number.MAX_SAFE_INTEGER);
    localStorage.setItem(key, String(count));
    showCount(count);
  } catch { unavailable(); }
}
// Serialize increments across tabs when Web Locks is available.
if (navigator.locks?.request) {
  navigator.locks.request(key, recordVisit).catch(recordVisit);
} else {
  recordVisit();
}
window.addEventListener('storage', event => {
  if (event.key !== key && event.key !== null) return;
  try { showCount(readCount()); } catch { unavailable(); }
});
