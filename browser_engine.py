#!/usr/bin/env python3
"""Small SeleniumBase session bridge used by the ImperialsBot Mini Browser.

The Node server owns the public HTTP routes. This process only keeps a real
Chromium session alive long enough to execute page JavaScript and return the
browser's cookies to the Node-side proxy.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import base64
import argparse
import json
import threading
import time
import uuid
from urllib.parse import urlparse

from seleniumbase import Driver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys


SESSION_TTL_SECONDS = 300
MAX_SESSIONS = 8
# Kept in sync with MAX_CLICK_X / MAX_CLICK_Y in execute_browser_action.
WINDOW_WIDTH = 700
WINDOW_HEIGHT = 720
sessions = {}
sessions_lock = threading.RLock()


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def valid_url(value):
    parsed = urlparse(str(value or ""))
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def serialize_session(session_id, session):
    driver = session["driver"]
    cookies = []
    for cookie in driver.get_cookies():
        cookies.append(
            {
                "name": cookie.get("name", ""),
                "value": cookie.get("value", ""),
                "domain": cookie.get("domain"),
                "path": cookie.get("path", "/"),
                "secure": bool(cookie.get("secure")),
                "expiry": cookie.get("expiry"),
            }
        )
    return {
        "id": session_id,
        "currentUrl": driver.current_url,
        "title": driver.title,
        "cookies": cookies,
        "readyState": driver.execute_script("return document.readyState"),
    }


class BrowserHandler(BaseHTTPRequestHandler):
    server_version = "ImperialsBotBrowserEngine/1.0"

    def log_message(self, format_string, *args):
        return

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 64 * 1024:
            raise ValueError("Request body is too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        if self.path == "/healthz":
            return json_response(self, 200, {"status": "ok", "sessions": len(sessions)})

        parts = self.path.split("?", 1)[0].strip("/").split("/")
        if len(parts) == 3 and parts[0] == "session" and parts[2] == "screenshot":
            session_id = parts[1]
            with sessions_lock:
                session = sessions.get(session_id)
            if not session:
                return json_response(self, 404, {"error": "Browser session not found"})
            try:
                with session["lock"]:
                    session["expiresAt"] = time.time() + SESSION_TTL_SECONDS
                    image = capture_screen(session["driver"])
                self.send_response(200)
                self.send_header(
                    "Content-Type",
                    "image/jpeg" if image[:3] == b"\xff\xd8\xff" else "image/png",
                )
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(image)))
                self.end_headers()
                self.wfile.write(image)
                return
            except Exception as error:
                return json_response(self, 502, {"error": str(error)})

        if len(parts) == 2 and parts[0] == "session":
            session_id = parts[1]
            with sessions_lock:
                session = sessions.get(session_id)
            if not session:
                return json_response(self, 404, {"error": "Browser session not found"})
            with session["lock"]:
                try:
                    session["expiresAt"] = time.time() + SESSION_TTL_SECONDS
                    return json_response(self, 200, serialize_session(session_id, session))
                except Exception as error:
                    return json_response(self, 502, {"error": str(error)})

        return json_response(self, 404, {"error": "Not found"})

    def do_POST(self):
        parts = self.path.split("?", 1)[0].strip("/").split("/")
        if len(parts) == 3 and parts[0] == "session" and parts[2] == "navigate":
            session_id = parts[1]
            with sessions_lock:
                session = sessions.get(session_id)
            if not session:
                return json_response(self, 404, {"error": "Browser session not found"})
            try:
                payload = self.read_json()
                url = str(payload.get("url", "")).strip()
                if not valid_url(url):
                    return json_response(self, 400, {"error": "A valid http(s) URL is required."})
                with session["lock"]:
                    session["driver"].get(url)
                    session["expiresAt"] = time.time() + SESSION_TTL_SECONDS
                    return json_response(self, 200, serialize_session(session_id, session))
            except Exception as error:
                return json_response(self, 502, {"error": str(error)})

        if len(parts) == 3 and parts[0] == "session" and parts[2] == "action":
            session_id = parts[1]
            with sessions_lock:
                session = sessions.get(session_id)
            if not session:
                return json_response(self, 404, {"error": "Browser session not found"})
            try:
                payload = self.read_json()
                with session["lock"]:
                    result = execute_browser_action(session["driver"], payload)
                    handles = session["driver"].window_handles
                    if handles:
                        session["driver"].switch_to.window(handles[-1])
                    session["expiresAt"] = time.time() + SESSION_TTL_SECONDS
                    return json_response(
                        self,
                        200,
                        {"status": "ok", "url": session["driver"].current_url, "result": result},
                    )
            except Exception as error:
                return json_response(self, 502, {"error": str(error)})

        if self.path != "/open":
            return json_response(self, 404, {"error": "Not found"})

        try:
            payload = self.read_json()
            url = str(payload.get("url", "")).strip()
            if not valid_url(url):
                return json_response(self, 400, {"error": "A valid http(s) URL is required."})

            with sessions_lock:
                if len(sessions) >= MAX_SESSIONS:
                    return json_response(self, 429, {"error": "Too many browser sessions"})

            # UC mode is used for normal browser compatibility and JavaScript
            # rendering. CAPTCHA decisions remain manual; this bridge never
            # clicks or solves a challenge.
            proxy = payload.get("proxy")
            if proxy and (not isinstance(proxy, str) or len(proxy) > 512):
                return json_response(self, 400, {"error": "Invalid proxy configuration."})
            driver = Driver(uc=True, headless=True, proxy=proxy or None)
            # The dashboard panel is at most ~540px wide. A 1280px window was
            # downscaled by 2.4x on screen, which shrank the captcha text into
            # unreadable mush, and a bigger frame also made every screenshot
            # slower to capture. Size it so one page pixel is one screen pixel.
            driver.set_window_size(WINDOW_WIDTH, WINDOW_HEIGHT)
            block_local_network_targets(driver)
            driver.set_page_load_timeout(35)
            driver.get(url)
            session_id = uuid.uuid4().hex
            session = {
                "driver": driver,
                "lock": threading.RLock(),
                "expiresAt": time.time() + SESSION_TTL_SECONDS,
            }
            with sessions_lock:
                sessions[session_id] = session
            return json_response(self, 200, serialize_session(session_id, session))
        except Exception as error:
            return json_response(self, 502, {"error": str(error)})

    def do_DELETE(self):
        parts = self.path.strip("/").split("/")
        if len(parts) != 2 or parts[0] != "session":
            return json_response(self, 404, {"error": "Not found"})

        session_id = parts[1]
        with sessions_lock:
            session = sessions.pop(session_id, None)
        if session:
            with session["lock"]:
                try:
                    session["driver"].quit()
                except Exception:
                    pass
        return json_response(self, 200, {"status": "closed"})


def capture_screen(driver):
    """Screenshot via CDP as JPEG.

    PNG of a 700x720 page is a few hundred KB per poll, and the dashboard has
    to decode all of it every tick. JPEG at q70 is visually equivalent for a
    captcha form, roughly an order of magnitude smaller, and CDP encodes it
    faster than get_screenshot_as_png. Falls back to PNG if CDP is missing.
    """
    try:
        shot = driver.execute_cdp_cmd(
            "Page.captureScreenshot",
            {"format": "jpeg", "quality": 70, "captureBeyondViewport": False},
        )
        payload = shot.get("data") if isinstance(shot, dict) else None
        if payload:
            return base64.b64decode(payload)
    except Exception:
        pass
    try:
        return driver.get_screenshot_as_png()
    except Exception:
        return b""


def execute_browser_action(driver, payload):
    action = str(payload.get("action", ""))

    if action == "click":
        # Bounds must match the window size, otherwise clicks near the edge
        # get clamped to the wrong pixel once the window shrinks.
        x = max(0, min(WINDOW_WIDTH - 1, int(payload.get("x", 0))))
        y = max(0, min(WINDOW_HEIGHT - 1, int(payload.get("y", 0))))
        return driver.execute_script(
            """
            const x = arguments[0], y = arguments[1];
            const target = document.elementFromPoint(x, y);
            if (!target) return false;
            target.focus?.({preventScroll: true});
            const eventInit = {bubbles: true, cancelable: true, view: window,
              clientX: x, clientY: y, screenX: x, screenY: y, button: 0};
            target.dispatchEvent(new PointerEvent('pointerdown', {...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true}));
            target.dispatchEvent(new MouseEvent('mousedown', eventInit));
            target.dispatchEvent(new PointerEvent('pointerup', {...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true}));
            target.dispatchEvent(new MouseEvent('mouseup', eventInit));
            target.click();
            return true;
            """,
            x,
            y,
        )

    if action == "type":
        text = str(payload.get("text", ""))
        if len(text) > 2000:
            raise ValueError("Text input is too long")
        driver.switch_to.active_element.send_keys(text)
        return True

    if action == "key":
        key_name = str(payload.get("key", "")).upper()
        if key_name in ("CTRL+A", "CTRL+C", "CTRL+V", "CTRL+X"):
            letter = key_name[-1].lower()
            ActionChains(driver).key_down(Keys.CONTROL).send_keys(letter).key_up(Keys.CONTROL).perform()
            return True
        allowed_keys = {
            "ENTER": Keys.ENTER,
            "TAB": Keys.TAB,
            "ESCAPE": Keys.ESCAPE,
            "BACKSPACE": Keys.BACKSPACE,
            "DELETE": Keys.DELETE,
            "ARROWUP": Keys.ARROW_UP,
            "ARROWDOWN": Keys.ARROW_DOWN,
            "ARROWLEFT": Keys.ARROW_LEFT,
            "ARROWRIGHT": Keys.ARROW_RIGHT,
            "SPACE": Keys.SPACE,
            "HOME": Keys.HOME,
            "END": Keys.END,
            "PAGEUP": Keys.PAGE_UP,
            "PAGEDOWN": Keys.PAGE_DOWN,
        }
        key = allowed_keys.get(key_name)
        if not key:
            raise ValueError("Unsupported key")
        driver.switch_to.active_element.send_keys(key)
        return True

    if action == "scroll":
        delta_x = max(-1200, min(1200, int(payload.get("deltaX", 0))))
        delta_y = max(-1600, min(1600, int(payload.get("deltaY", 0))))
        return driver.execute_script(
            "window.scrollBy({left: arguments[0], top: arguments[1], behavior: 'instant'});",
            delta_x,
            delta_y,
        )

    if action in ("back", "forward", "reload"):
        if action == "back":
            driver.back()
        elif action == "forward":
            driver.forward()
        else:
            driver.refresh()
        return True

    raise ValueError("Unsupported browser action")


def block_local_network_targets(driver):
    blocked = []
    for scheme in ("http", "https"):
        for host in (
            "localhost",
            "*.localhost",
            "127.*",
            "0.0.0.0",
            "10.*",
            "100.64.*",
            "169.254.*",
            "192.168.*",
            "[::1]",
        ):
            blocked.append(f"{scheme}://{host}/*")
        for second_octet in range(16, 32):
            blocked.append(f"{scheme}://172.{second_octet}.*/*")
    try:
        driver.execute_cdp_cmd("Network.enable", {})
        driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": blocked})
    except Exception:
        # Some SeleniumBase launchers don't expose CDP on the selected backend.
        pass


def cleanup_expired():
    while True:
        time.sleep(30)
        now = time.time()
        with sessions_lock:
            expired = [
                session_id
                for session_id, session in sessions.items()
                if session["expiresAt"] <= now
            ]
            expired_sessions = [sessions.pop(session_id) for session_id in expired]
        for session in expired_sessions:
            try:
                session["driver"].quit()
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()

    cleanup_thread = threading.Thread(target=cleanup_expired, daemon=True)
    cleanup_thread.start()
    class QuietHandler(BrowserHandler):
        """Swallow client-side disconnects.

        A tab that navigates away or closes mid-request aborts the socket, and
        socketserver then dumps a full traceback for what is routine noise.
        """

        def handle_one_request(self):
            try:
                super().handle_one_request()
            except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                self.close_connection = True

    server = ThreadingHTTPServer(("127.0.0.1", args.port), QuietHandler)
    print(f"SeleniumBase browser engine listening on 127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    finally:
        with sessions_lock:
            active_sessions = list(sessions.values())
            sessions.clear()
        for session in active_sessions:
            try:
                session["driver"].quit()
            except Exception:
                pass


if __name__ == "__main__":
    main()