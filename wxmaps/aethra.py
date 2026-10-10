"""Server-only Aethra forecast proxy with shared expiry and a bounded API budget."""
import json
import math
import os
import time
import logging
from datetime import datetime, timezone
from http.client import HTTPException
from urllib.parse import parse_qs, urlsplit
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler
from wxmaps.visit_counter import credentials

TTL = 10800
PREFIX = 'wxmaps:aethra:v1:'
RESERVE = """
local cached = redis.call('GET', KEYS[1])
if cached then return {'hit', cached} end
if redis.call('EXISTS', KEYS[2]) == 1 then return {'busy'} end
if tonumber(redis.call('GET', KEYS[3]) or '0') >= 250
or tonumber(redis.call('GET', KEYS[4]) or '0') >= 20 then return {'limited'} end
redis.call('SET', KEYS[2], '1', 'EX', 60)
redis.call('INCR', KEYS[3])
redis.call('EXPIRE', KEYS[3], 172800)
redis.call('INCR', KEYS[4])
redis.call('EXPIRE', KEYS[4], 120)
return {'miss'}
"""
PUBLISH = """
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('DEL', KEYS[2])
return 1
"""
FIELDS = {
    'temperature_2m': ('temperature_c', '°C', -100, 65, 1),
    'precipitation': ('precipitation_mm', 'mm', 0, 1000, 1),
    'wind_speed_10m': ('wind_speed_ms', 'km/h', 0, 150, 3.6),
    'cloud_cover': ('cloud_cover_pct', '%', 0, 100, 1),
    'relative_humidity_2m': ('humidity_pct', '%', 0, 100, 1),
    'surface_pressure': ('pressure_hpa', 'hPa', 100, 1100, 1),
    'wind_direction_10m': ('wind_direction_deg', '°', 0, 360, 1),
}

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirect refused')

def request_json(url, payload, headers, timeout):
    request = Request(url, data=None if payload is None else json.dumps(payload).encode(), headers={
        'Content-Type': 'application/json', 'Accept': 'application/json',
        'User-Agent': 'WxMaps/1.0 (+https://wxmaps-iota.vercel.app)', **headers},
        method='GET' if payload is None else 'POST')
    with build_opener(NoRedirect).open(request, timeout=timeout) as response:
        body = response.read(262145)
    if len(body) > 262144:
        raise ValueError('Response too large')
    return json.loads(body)

def redis(command):
    url, token = credentials()
    result = request_json(url, command, {'Authorization': 'Bearer ' + token}, 4)
    if 'error' in result or 'result' not in result:
        raise ValueError('Storage unavailable')
    return result['result']

def epoch(value):
    if not isinstance(value, str):
        raise ValueError('Invalid timestamp')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.utcoffset() is None or parsed.utcoffset().total_seconds() != 0:
        raise ValueError('Expected UTC')
    return parsed.timestamp()

def number(value, low, high):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high

def normalize(raw, lat, lon, now):
    location = raw['location']
    if (not number(location['lat'], -90, 90) or not number(location['lon'], -180, 180)
            or abs(location['lat'] - lat) > .011 or abs(location['lon'] - lon) > .011):
        raise ValueError('Wrong location')
    generated = epoch(raw['generated_at'])
    if not -300 <= now - generated <= 86400:
        raise ValueError('Outdated forecast')
    rows = raw['forecast']
    if not isinstance(rows, list) or not 24 <= len(rows) <= 168:
        raise ValueError('Invalid forecast length')
    times = [epoch(row['time']) for row in rows]
    if (not all(t.is_integer() and (i == 0 or t - times[i - 1] == 3600) for i, t in enumerate(times))
            or not now - 86400 <= times[0] <= now + 7200 or times[-1] < now):
        raise ValueError('Invalid forecast times')
    hourly = {'time': [int(t) for t in times]}
    units = {'time': 'unixtime'}
    for target, (source, unit, low, high, factor) in FIELDS.items():
        values = [row.get(source) for row in rows]
        if any(value is not None and not number(value, low, high) for value in values):
            raise ValueError('Invalid reading')
        if not any(value is not None for value in values):
            raise ValueError('Missing variable')
        hourly[target] = [None if value is None else round(value * factor, 4) for value in values]
        units[target] = unit
    return {'source': 'aethra', 'timezone': 'Europe/Bucharest', 'generated_at': generated,
            'expires_at': now + TTL, 'hourly': hourly, 'hourly_units': units}

def schema(value, depth=0):
    if depth > 7:
        return type(value).__name__
    if isinstance(value, dict):
        return {str(key)[:60]: schema(item, depth + 1) for key, item in list(value.items())[:35]}
    if isinstance(value, list):
        return {'length': len(value), 'first': schema(value[0], depth + 1) if value else None}
    return type(value).__name__

def forecast_response(method, path):
    headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
    if method != 'GET':
        return 405, {'error': 'Use GET.'}, {**headers, 'Allow': 'GET'}
    try:
        query = parse_qs(urlsplit(path).query, strict_parsing=True)
        if set(query) != {'lat', 'lon'} or any(len(values) != 1 for values in query.values()):
            raise ValueError()
        lat, lon = float(query['lat'][0]), float(query['lon'][0])
        if not number(lat, 43.5, 48.4) or not number(lon, 20, 30):
            raise ValueError()
        lat, lon = round(lat, 2), round(lon, 2)
    except (ValueError, KeyError):
        return 400, {'error': 'Choose a location in Romania.'}, headers
    unavailable = {'error': 'Aethra is temporarily unavailable. Try ECMWF or retry later.'}
    if os.getenv('VERCEL_ENV') != 'production' or not os.getenv('AETHRA_API_KEY'):
        return 503, unavailable, headers
    now = int(time.time())
    key = PREFIX + f'{lat:.2f},{lon:.2f}'
    try:
        result = redis(['EVAL', RESERVE, 4, key, key + ':lock',
                        PREFIX + 'day:' + str(now // 86400), PREFIX + 'minute:' + str(now // 60)])
        if result[0] == 'hit':
            cached = json.loads(result[1])
            if 'error' in cached:
                return 503, unavailable, {**headers, 'Retry-After': '120'}
            if cached['expires_at'] <= now:
                return 503, unavailable, headers
            return 200, cached, headers
        if result[0] in ('limited', 'busy'):
            status = 429 if result[0] == 'limited' else 503
            return status, unavailable, {**headers, 'Retry-After': '60'}
        if result[0] != 'miss':
            raise ValueError('Unexpected storage response')
        try:
            raw = request_json(f'https://api.aethra.dev/v1/forecast?lat={lat:.2f}&lon={lon:.2f}',
                               None, {'Authorization': 'Bearer ' + os.environ['AETHRA_API_KEY']}, 8)
            # Log structure only when integration validation fails; never values or credentials.
            try:
                data = normalize(raw, lat, lon, now)
            except (ValueError, KeyError, TypeError, OverflowError):
                logging.warning('Aethra schema: %s', schema(raw))
                sample = raw.get('data', {}).get('daily', [{}])[0].get('hourly', [{}])[0]
                logging.warning('Aethra hourly sample: %s', {
                    k: v for k, v in sample.items()
                    if number(v, -100000, 100000) or (k in ('time', 'date') and isinstance(v, str) and len(v) < 40)})
                logging.warning('Aethra response time: %s', raw.get('timestamp', '')[:40])
                raise
        except (OSError, HTTPException, ValueError, KeyError, TypeError, OverflowError) as exc:
            logging.warning('Aethra provider unavailable: %s status=%s',
                            type(exc).__name__, exc.code if isinstance(exc, HTTPError) else 'validation')
            redis(['EVAL', PUBLISH, 2, key, key + ':lock', json.dumps(unavailable), 120])
            return 503, unavailable, {**headers, 'Retry-After': '120'}
        redis(['EVAL', PUBLISH, 2, key, key + ':lock', json.dumps(data), TTL])
        return 200, data, headers
    except (OSError, HTTPException, ValueError, KeyError, TypeError, IndexError):
        # Fail closed: never bypass caching/budget when shared storage is unavailable.
        return 503, unavailable, headers
