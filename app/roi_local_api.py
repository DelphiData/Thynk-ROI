#!/usr/bin/env python3
"""
ROI Local API (no third-party deps)
===================================

Run:
    python roi_local_api.py --json roi_tool_for_joey.json --port 8000

Endpoints:
    GET  /api/sheets
    GET  /api/sheet?name=Sheet1
    GET  /api/cell?sheet=Sheet1&a1=B7
    GET  /api/range?sheet=Sheet1&top=A1&bottom=C5
    GET  /api/tables
    GET  /api/table?name=Table1&sheet=Sheet1
    GET  /api/table_rows?name=Table1&sheet=Sheet1
    GET  /api/sources
    POST /api/cell   JSON body: {"sheet": "Sheet1", "a1": "B7", "value": 123}
    POST /api/save   JSON body: {"path": "roi_tool_for_joey.updated.json"}  # optional

Also serves a minimal UI at "/" (see roi_index.html).

This server is meant for local use; do not expose it to the internet.
"""

import json
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path
from typing import Any, Dict
from roi_workbook_model import ROIWorkbook

def json_response(handler: BaseHTTPRequestHandler, obj: Any, status: int = 200):
    data = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)

def text_response(handler: BaseHTTPRequestHandler, text: str, status: int = 200, content_type: str = "text/plain; charset=utf-8"):
    data = text.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)

def error(handler: BaseHTTPRequestHandler, msg: str, status: int = 400):
    json_response(handler, {"error": msg}, status=status)

class Handler(BaseHTTPRequestHandler):
    server_version = "ROIAPI/1.0"

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        q = parse_qs(parsed.query)

        # Root UI
        if path == "/" or path == "/index.html":
            try:
                html = (Path(__file__).with_name("roi_index.html")).read_text(encoding="utf-8")
            except Exception:
                html = "<h1>ROI API</h1><p>UI file not found.</p>"
            return text_response(self, html, 200, "text/html; charset=utf-8")

        try:
            if path == "/api/sheets":
                return json_response(self, self.server.wb.list_sheets())

            if path == "/api/sheet":
                name = (q.get("name") or [None])[0]
                if not name:
                    return error(self, "Missing 'name'")
                return json_response(self, self.server.wb.sheet_info(name))

            if path == "/api/cell":
                sheet = (q.get("sheet") or [None])[0]
                a1 = (q.get("a1") or [None])[0]
                if not sheet or not a1:
                    return error(self, "Missing 'sheet' or 'a1'")
                cell = self.server.wb.get_cell(sheet, a1)
                return json_response(self, {"sheet": sheet, "a1": a1.upper(), "cell": cell})

            if path == "/api/range":
                sheet = (q.get("sheet") or [None])[0]
                top = (q.get("top") or [None])[0]
                bottom = (q.get("bottom") or [None])[0]
                if not sheet or not top or not bottom:
                    return error(self, "Missing 'sheet', 'top', or 'bottom'")
                grid = self.server.wb.get_range(sheet, top, bottom)
                return json_response(self, {"sheet": sheet, "top": top, "bottom": bottom, "grid": grid})

            if path == "/api/tables":
                sheet = (q.get("sheet") or [None])[0]
                return json_response(self, self.server.wb.list_tables(sheet=sheet))

            if path == "/api/table":
                name = (q.get("name") or [None])[0]
                sheet = (q.get("sheet") or [None])[0]
                if not name:
                    return error(self, "Missing 'name'")
                return json_response(self, self.server.wb.get_table(name, sheet=sheet))

            if path == "/api/table_rows":
                name = (q.get("name") or [None])[0]
                sheet = (q.get("sheet") or [None])[0]
                if not name:
                    return error(self, "Missing 'name'")
                rows = self.server.wb.get_table_rows(name, sheet=sheet)
                return json_response(self, rows)

            if path == "/api/sources":
                return json_response(self, self.server.wb.find_sources())

            return error(self, f"Unknown path: {path}", status=404)
        except KeyError as ke:
            return error(self, f"Not found: {ke}", status=404)
        except Exception as e:
            return error(self, f"Server error: {e}", status=500)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            data = json.loads(body or "{}")
        except Exception:
            return error(self, "Invalid JSON body")

        try:
            if path == "/api/cell":
                sheet = data.get("sheet")
                a1 = data.get("a1")
                value = data.get("value")
                if not sheet or not a1:
                    return error(self, "Missing 'sheet' or 'a1'")
                self.server.wb.set_cell_value(sheet, a1, value)
                return json_response(self, {"ok": True, "sheet": sheet, "a1": a1.upper(), "value": value})

            if path == "/api/save":
                out_path = data.get("path") or "roi_tool_for_joey.updated.json"
                self.server.wb.save(out_path)
                return json_response(self, {"ok": True, "path": out_path})

            return error(self, f"Unknown path: {path}", status=404)
        except KeyError as ke:
            return error(self, f"Not found: {ke}", status=404)
        except Exception as e:
            return error(self, f"Server error: {e}", status=500)

class ROIHTTPServer(HTTPServer):
    def __init__(self, server_address, RequestHandlerClass, wb: ROIWorkbook):
        super().__init__(server_address, RequestHandlerClass)
        self.wb = wb

def main():
    parser = argparse.ArgumentParser(description="ROI Local API (no third-party deps)")
    parser.add_argument("--json", default="roi_tool_for_joey.json", help="Path to workbook JSON")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on (default: 8000)")
    args = parser.parse_args()

    json_path = Path(args.json)
    if not json_path.exists():
        raise SystemExit(f"JSON file not found: {json_path}")

    wb = ROIWorkbook.from_file(json_path)
    server = ROIHTTPServer((args.host, args.port), Handler, wb)
    print(f"Serving ROI Local API on http://{args.host}:{args.port}")
    print("Open http://127.0.0.1:8000/ in your browser.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.server_close()

if __name__ == "__main__":
    main()
