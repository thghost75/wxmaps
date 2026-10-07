export const STORAGE_KEY = 'wxmaps.saved-locations.v1';
export const MAX_LOCATIONS = 5;

export function locationKey(place) {
  return place.lat.toFixed(4) + ',' + place.lon.toFixed(4);
}

export function cleanLocation(place) {
  if (!place || typeof place.name !== 'string' || !place.name.trim() ||
      place.name.length > 120 || !Number.isFinite(place.lat) || !Number.isFinite(place.lon) ||
      place.lat < 43 || place.lat > 49 || place.lon < 20 || place.lon > 30) return null;
  return {
    name: place.name.trim(), lat: place.lat, lon: place.lon,
    county: typeof place.county === 'string' ? place.county.slice(0, 120) : '',
    ...(Number.isSafeInteger(place.id) ? {id: place.id} : {})
  };
}

export function readLocations(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {locations: [], error: ''};
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) throw new Error('Invalid saved locations');
    const unique = new Map();
    for (const entry of entries) {
      const clean = cleanLocation(entry);
      if (clean && !unique.has(locationKey(clean))) unique.set(locationKey(clean), clean);
    }
    return {locations: [...unique.values()].slice(0, MAX_LOCATIONS), error: ''};
  } catch {
    return {locations: [], error: 'Saved locations could not be read in this browser.'};
  }
}

export function addLocation(locations, place) {
  const clean = cleanLocation(place);
  if (!clean) throw new Error('This location cannot be saved.');
  if (locations.some(item => locationKey(item) === locationKey(clean))) throw new Error('This location is already saved.');
  if (locations.length >= MAX_LOCATIONS) throw new Error('All five slots are full. Remove a location to make room.');
  return [...locations, clean];
}

export function writeLocations(storage, locations) {
  storage.setItem(STORAGE_KEY, JSON.stringify(locations));
}
