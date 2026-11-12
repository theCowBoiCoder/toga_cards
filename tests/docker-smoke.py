"""Exercise the complete Nginx/PHP/Node image using disposable data only."""

import argparse
import json
import http.cookiejar
import urllib.parse
import re
import subprocess
import time
import urllib.error
import urllib.request
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("image")
parser.add_argument("--port", type=int, default=3131)
args = parser.parse_args()
name = "toga-runtime-test-" + uuid.uuid4().hex[:10]
origin = "http://127.0.0.1:" + str(args.port)


def request(path, headers=None, data=None):
    try:
        return urllib.request.urlopen(urllib.request.Request(origin + path, headers=headers or {}, data=data), timeout=5)
    except urllib.error.HTTPError as error:
        return error


try:
    subprocess.run([
        "docker", "run", "--detach", "--name", name,
        "--publish", "127.0.0.1:" + str(args.port) + ":3000",
        "--tmpfs", "/app/data:uid=1000,gid=1000",
        "-e", "TOGA_PREVIEW=1", "-e", "APP_URL=" + origin,
        "-e", "ADMIN_PASSWORD=Synthetic-runtime-test-only-2026",
        "-e", "LARAVEL_ADMIN_EMAIL=admin@example.test",
        "-e", "ADMIN_SERVICE_KEY=" + "a" * 64,
        "-e", "LARAVEL_APP_KEY=base64:" + "A" * 43 + "=", args.image,
    ], check=True, capture_output=True)
    for attempt in range(40):
        try:
            with request("/api/health") as response:
                if response.status == 200 and json.load(response)["ok"]:
                    break
        except (OSError, ValueError):
            pass
        time.sleep(1)
    else:
        raise AssertionError("Combined image failed health check")
    with request("/admin/login") as response:
        html = response.read().decode()
        assert response.status == 200 and "Toga Cards" in html
        assert "no-store" in response.headers.get("Cache-Control", "")
    assets = re.findall(r'(?:href|src)="([^"]+(?:\.css|\.js)(?:\?[^\"]*)?)"', html)
    assert len(assets) >= 5, "Admin assets are missing"
    for asset in assets:
        assert asset.startswith(origin + "/"), "Admin asset origin/port is wrong"
        with request(asset[len(origin):]) as response:
            assert response.status == 200
            assert "text/html" not in response.headers.get("Content-Type", "")
    for path in ("/api/inventory", "/api/%61dmin/shop", "/api/admin/ping", "/api/export", "/API/EBAY/"):
        with request(path, {"X-Toga-Admin-Key": "a" * 64}) as response:
            assert response.status == 404, "Private Node API is exposed: " + path
    with request("/admin/inventory") as response:
        assert response.geturl() == origin + "/admin/login", "Guest was not redirected to login"
    with request("/admin/ebay/connect", data=b"") as response:
        assert response.status == 419, "Laravel CSRF protection did not reject the request"
    with request("/shop") as response:
        html = response.read().decode()
        assert response.status == 200, "Shop did not return HTTP 200"
        assert re.search(r"<title[^>]*>\s*Toga Cards\b", html, re.IGNORECASE), "Shop title is missing"
        assert 'aria-label="Search catalogue"' in html, "Shop catalogue did not render"
    with request("/account/login") as response:
        assert response.status == 200 and "Welcome back" in response.read().decode()
        assert "no-store" in response.headers.get("Cache-Control", "")
    with request("/account/orders") as response:
        assert response.geturl() == origin + "/account/login"
    with request("/account/login", data=b"") as response:
        assert response.status == 419, "Customer login must enforce CSRF"
    cookies = http.cookiejar.CookieJar()
    customer = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
    with customer.open(origin + "/account/register", timeout=10) as response:
        register = response.read().decode()
        csrf = re.search(r'name="_token" value="([^"]+)"', register).group(1)
    fields = {"_token": csrf, "name": "Synthetic customer", "email": "customer@example.test", "password": "Synthetic-customer-password-123", "password_confirmation": "Synthetic-customer-password-123"}
    with customer.open(origin + "/account/register", data=urllib.parse.urlencode(fields).encode(), timeout=10) as response:
        assert response.geturl() == origin + "/account/orders"
        assert "No orders yet" in response.read().decode()
    with customer.open(origin + "/account/collection?search=Max+Dowman", timeout=10) as response:
        assert "My collection" in response.read().decode()
    print("Combined Docker smoke passed: health, assets, login boundary, private API isolation, CSRF and storefront.")
except Exception:
    subprocess.run(["docker", "logs", "--tail", "60", name], check=False)
    raise
finally:
    subprocess.run(["docker", "rm", "--force", name], capture_output=True, check=False)
