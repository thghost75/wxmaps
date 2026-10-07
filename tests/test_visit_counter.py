import io
import json
import os
import unittest
from unittest.mock import patch

from wxmaps import visit_counter as counter


class VisitCounterTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            'VERCEL_ENV': 'production',
            'COUNTER_REDIS_REST_URL': 'https://test.upstash.io',
            'COUNTER_REDIS_REST_TOKEN': 'test-secret-never-returned',
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.headers = {'Origin': counter.ORIGIN, 'X-WxMaps-Visit': '1', 'User-Agent': 'Mozilla/5.0'}

    def test_new_visit_cookie_then_repeat_and_expiry(self):
        total = 0

        def storage(url, token, increment, now):
            nonlocal total
            total += int(bool(increment))
            return {'visits': total, 'since': '2026-10-07'}

        with patch.object(counter, 'storage_total', side_effect=storage), patch.object(counter.time, 'time', return_value=2000) as clock:
            status, payload, extra = counter.visit_response('POST', self.headers)
            self.assertEqual((status, payload['visits']), (200, 1))
            cookie = extra['Set-Cookie']
            for attribute in ('Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=1800'):
                self.assertIn(attribute, cookie)
            self.assertEqual(extra['Cache-Control'], 'no-store')
            self.headers['Cookie'] = cookie.split(';')[0]
            clock.return_value = 3799
            status, payload, extra = counter.visit_response('POST', self.headers)
            self.assertEqual(payload['visits'], 1)
            self.assertNotIn('Set-Cookie', extra)
            clock.return_value = 3800
            self.assertEqual(counter.visit_response('POST', self.headers)[1]['visits'], 2)

    def test_cookie_rejects_tampering_malformed_and_future(self):
        secret = 'secret'
        message = '2000.nonce'
        value = message + '.' + counter.signature(message, secret)
        self.assertTrue(counter.recent_visit(counter.COOKIE + '=' + value, secret, 2001))
        for invalid in ('', 'garbage', counter.COOKIE + '=bad', counter.COOKIE + '=' + value.replace('nonce', 'edited')):
            self.assertFalse(counter.recent_visit(invalid, secret, 2001))
        self.assertFalse(counter.recent_visit(counter.COOKIE + '=' + value, secret, 1999))

    def test_excluded_browser_get_never_increments(self):
        with patch.object(counter, 'storage_total', return_value={'visits': 45, 'since': None}) as storage:
            status, payload, extra = counter.visit_response('GET', {})
            self.assertEqual((status, payload['visits']), (200, 45))
            self.assertFalse(storage.call_args.args[2])
            self.assertNotIn('Set-Cookie', extra)

    def test_common_bots_do_not_increment(self):
        with patch.object(counter, 'storage_total', return_value={'visits': 0, 'since': None}) as storage:
            for user_agent in ('Googlebot', 'Crawler', 'Spider', 'HeadlessChrome', 'LinkPreview'):
                with self.subTest(user_agent=user_agent):
                    counter.visit_response('POST', dict(self.headers, **{'User-Agent': user_agent}))
                    self.assertFalse(storage.call_args.args[2])

    def test_foreign_origin_missing_marker_and_preview_are_rejected(self):
        with patch.object(counter, 'storage_total') as storage:
            for headers in ({}, dict(self.headers, Origin='https://foreign.example'), dict(self.headers, **{'X-WxMaps-Visit': ''})):
                self.assertEqual(counter.visit_response('POST', headers)[0], 403)
            with patch.dict(os.environ, {'VERCEL_ENV': 'preview'}):
                self.assertEqual(counter.visit_response('POST', self.headers)[0], 403)
            storage.assert_not_called()

    def test_unsupported_method(self):
        self.assertEqual(counter.visit_response('DELETE', self.headers)[0], 405)

    def test_configuration_and_network_failures_do_not_leak_secrets(self):
        for error in (TimeoutError('test-secret-never-returned'), ValueError('test-secret-never-returned')):
            with patch.object(counter, 'storage_total', side_effect=error) as storage:
                result = counter.visit_response('POST', self.headers)
                self.assertEqual(result[0], 503)
                self.assertNotIn('test-secret-never-returned', str(result))
                storage.assert_called_once()  # No retry of ambiguous increments.
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(counter.visit_response('GET', {})[0], 503)

    def test_only_upstash_https_credentials_are_accepted(self):
        for url in ('http://test.upstash.io', 'https://upstash.io.attacker.example', 'https://test.upstash.io/path'):
            with patch.dict(os.environ, {'COUNTER_REDIS_REST_URL': url}):
                with self.assertRaises(ValueError):
                    counter.credentials()

    def test_marketplace_environment_aliases(self):
        for prefix, suffix in (('KV', '_REST_API'), ('UPSTASH_REDIS', '_REST')):
            with patch.dict(os.environ, {prefix + suffix + '_URL': 'https://test.upstash.io', prefix + suffix + '_TOKEN': 'token'}, clear=True):
                self.assertEqual(counter.credentials(), ('https://test.upstash.io', 'token'))

    def test_atomic_command_uses_only_wxmaps_key(self):
        with patch.object(counter, 'urlopen', return_value=io.BytesIO(b'{"result":["12","2026-10-07"]}')) as send:
            self.assertEqual(counter.storage_total('https://test.upstash.io', 'secret', True, 1791331200)['visits'], 12)
            command = json.loads(send.call_args.args[0].data)
            self.assertEqual(command[0], 'EVAL')
            self.assertEqual(command[2:5], [1, 'wxmaps:public-visits:v1', '1'])
            self.assertIn('HINCRBY', command[1])
            self.assertIn('HSETNX', command[1])

    def test_bad_storage_response_is_unavailable(self):
        for result in ({'result': ['-1', '']}, {'error': 'storage failed'}, {'result': ['NaN', '']}):
            with patch.object(counter, 'urlopen', return_value=io.BytesIO(json.dumps(result).encode())):
                self.assertEqual(counter.visit_response('GET', {})[0], 503)


if __name__ == '__main__':
    unittest.main()
