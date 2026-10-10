import copy
import json
import os
import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from wxmaps import aethra

NOW = 1791622800
LAT, LON = 44.43, 26.10
ENV = {'VERCEL_ENV': 'production', 'AETHRA_API_KEY': 'test-only-secret'}
PATH = '/api/forecast?lat=44.4268&lon=26.1025'

def fixture():
    stamp = lambda seconds: datetime.fromtimestamp(seconds, timezone.utc).isoformat()
    return {'location': {'lat': LAT, 'lon': LON}, 'generated_at': stamp(NOW),
            'forecast': [{'time': stamp(NOW + i * 3600), 'temperature_c': 12.5,
                          'humidity_pct': 60, 'wind_speed_ms': 5,
                          'wind_direction_deg': 270, 'pressure_hpa': 930,
                          'precipitation_mm': 0, 'cloud_cover_pct': 20} for i in range(168)]}

class ForecastTests(unittest.TestCase):
    def test_units_pressure_missing_values(self):
        raw = fixture()
        raw['forecast'][1]['temperature_c'] = None
        data = aethra.normalize(raw, LAT, LON, NOW)
        self.assertEqual(data['hourly']['wind_speed_10m'][0], 18)
        self.assertEqual(data['hourly']['surface_pressure'][0], 930)
        self.assertNotIn('pressure_msl', data['hourly'])
        self.assertNotIn('snowfall', data['hourly'])
        self.assertIsNone(data['hourly']['temperature_2m'][1])
        self.assertEqual(data['expires_at'], NOW + 10800)

    def test_rejects_wrong_location_stale_time_gaps_and_bad_values(self):
        changes = [
            lambda d: d['location'].update(lat=40),
            lambda d: d.update(generated_at='2000-01-01T00:00:00Z'),
            lambda d: d['forecast'][1].update(time=d['forecast'][0]['time']),
            lambda d: d['forecast'][0].update(wind_speed_ms=-1),
            lambda d: d['forecast'][0].update(humidity_pct=True),
            lambda d: d['forecast'][0].update(temperature_c=float('nan')),
            lambda d: d['forecast'][0].update(time='2026-10-10T12:00:00'),
            lambda d: [row.pop('pressure_hpa') for row in d['forecast']],
        ]
        for change in changes:
            with self.subTest(change=change):
                raw = fixture()
                change(raw)
                with self.assertRaises(ValueError):
                    aethra.normalize(raw, LAT, LON, NOW)

    def test_invalid_requests_never_access_services(self):
        with patch.object(aethra, 'redis') as storage, patch.object(aethra, 'request_json') as upstream:
            for path in ['/api/forecast', PATH + '&lat=45', '/api/forecast?lat=nan&lon=26',
                         '/api/forecast?lat=52&lon=26', PATH + '&url=https://other.test']:
                self.assertEqual(aethra.forecast_response('GET', path)[0], 400)
            self.assertEqual(aethra.forecast_response('POST', PATH)[0], 405)
            storage.assert_not_called()
            upstream.assert_not_called()

    @patch.dict(os.environ, ENV)
    def test_cache_hit_and_budget_rejection_never_call_provider(self):
        data = aethra.normalize(fixture(), LAT, LON, NOW)
        for reservation, status in [(['hit', json.dumps(data)], 200), (['limited'], 429), (['busy'], 503)]:
            with self.subTest(status=status), patch.object(aethra.time, 'time', return_value=NOW), \
                    patch.object(aethra, 'redis', return_value=reservation), \
                    patch.object(aethra, 'request_json') as upstream:
                self.assertEqual(aethra.forecast_response('GET', PATH)[0], status)
                upstream.assert_not_called()

    @patch.dict(os.environ, ENV)
    def test_cache_miss_fetches_once_and_stores_only_public_data(self):
        with patch.object(aethra.time, 'time', return_value=NOW), \
                patch.object(aethra, 'redis', side_effect=[['miss'], 1]) as storage, \
                patch.object(aethra, 'request_json', return_value=fixture()) as upstream:
            status, data, headers = aethra.forecast_response('GET', PATH)
            self.assertEqual(status, 200)
            upstream.assert_called_once_with('https://api.aethra.dev/v1/forecast?lat=44.43&lon=26.10',
                None, {'Authorization': 'Bearer test-only-secret'}, 8)
            self.assertEqual(storage.call_args.args[0][-1], 10800)
            self.assertNotIn('test-only-secret', json.dumps(data))
            self.assertEqual(headers['Cache-Control'], 'no-store')

    @patch.dict(os.environ, ENV)
    def test_provider_failure_is_sanitized_and_briefly_cached(self):
        with patch.object(aethra, 'redis', side_effect=[['miss'], 1]) as storage, \
                patch.object(aethra, 'request_json', side_effect=ValueError('private diagnostic test-only-secret')):
            status, data, _ = aethra.forecast_response('GET', PATH)
            self.assertEqual(status, 503)
            self.assertNotIn('test-only-secret', json.dumps(data))
            self.assertEqual(storage.call_args.args[0][-1], 120)

    @patch.dict(os.environ, ENV)
    def test_storage_failure_does_not_bypass_budget(self):
        with patch.object(aethra, 'redis', side_effect=OSError()), patch.object(aethra, 'request_json') as upstream:
            self.assertEqual(aethra.forecast_response('GET', PATH)[0], 503)
            upstream.assert_not_called()

    def test_no_provider_calls_outside_production(self):
        with patch.dict(os.environ, {'VERCEL_ENV': 'preview', 'AETHRA_API_KEY': 'test-only-secret'}), \
                patch.object(aethra, 'redis') as storage:
            self.assertEqual(aethra.forecast_response('GET', PATH)[0], 503)
            storage.assert_not_called()

    def test_redirects_cannot_forward_key(self):
        with self.assertRaises(ValueError):
            aethra.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.test')
