"""Health-only public evidence marker; never serves generated source or a writable DB."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        body = json.dumps({"status": "UP", "gate": "G5 v0.4 compilation pilot",
                           "persistent_books_api_publicly_enabled": False}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self.send_error(404)

HTTPServer(("0.0.0.0", int(os.environ.get("PORT", "10000"))), Handler).serve_forever()
