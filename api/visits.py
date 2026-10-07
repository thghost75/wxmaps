"""Vercel endpoint for the shared visit counter; no third-party dependencies."""
import json
from http.server import BaseHTTPRequestHandler

from wxmaps.visit_counter import visit_response


class handler(BaseHTTPRequestHandler):
    def respond(self):
        status, payload, headers = visit_response(self.command, self.headers)
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        if status == 405:
            self.send_header('Allow', 'GET, POST')
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    do_GET = respond
    do_POST = respond
    do_HEAD = respond
    do_OPTIONS = respond
    do_PUT = respond
    do_PATCH = respond
    do_DELETE = respond
