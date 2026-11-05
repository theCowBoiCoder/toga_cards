"""Create missing local admin secrets without changing existing credentials."""

import base64
import re
import secrets
from pathlib import Path

root = Path(__file__).resolve().parent.parent
path = root / ".env"
text = path.read_text(encoding="utf-8-sig") if path.exists() else (root / ".env.example").read_text()
values = {}
for line in text.splitlines():
    key, separator, value = line.partition("=")
    if separator and not line.lstrip().startswith("#"):
        values[key.strip()] = value.strip().strip('"\'')
for key, pattern in {"ADMIN_SERVICE_KEY": r"[a-f0-9]{64}", "LARAVEL_APP_KEY": r"base64:[A-Za-z0-9+/]{43}="}.items():
    if values.get(key) and not re.fullmatch(pattern, values[key]):
        raise SystemExit(key + " has an unexpected format; preserve the existing key and investigate before changing it.")
defaults = {
    "LARAVEL_APP_KEY": "base64:" + base64.b64encode(secrets.token_bytes(32)).decode(),
    "ADMIN_SERVICE_KEY": secrets.token_hex(32),
    "LARAVEL_ADMIN_EMAIL": "admin@togacards.co.uk",
    "ADMIN_PASSWORD": secrets.token_urlsafe(24),
}
created = []
for key, value in defaults.items():
    if values.get(key):
        continue
    pattern = r"^" + re.escape(key) + r"=.*$"
    if re.search(pattern, text, re.M):
        text = re.sub(pattern, key + "=" + value, text, flags=re.M)
    else:
        text = text.rstrip() + "\n" + key + "=" + value + "\n"
    created.append(key)
if created:
    path.write_text(text, encoding="utf-8")
print("Created missing settings in ignored .env: " + ", ".join(created) if created else "Existing admin settings preserved.")
print("Keep LARAVEL_APP_KEY with database backups; it encrypts authenticator secrets. No credentials were printed.")
