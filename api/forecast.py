"""Public weather data only; Aethra credentials stay inside this function."""
import json
from http.server import BaseHTTPRequestHandler
from wxmaps.aethra import forecast_response

class handler(BaseHTTPRequestHandler):
    def respond(self):
        status, payload, headers = forecast_response(self.command, self.path)
        body = json.dumps(payload, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
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
