#!/usr/bin/env python3
"""Create a private final cutover bundle. Explicitly stops the local app."""

import argparse
import datetime
import hashlib
import json
import re
import sqlite3
import subprocess
import tarfile
import uuid
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--stop-local",
    action="store_true",
    required=True,
    help="Stop the local Docker app so only the Ubuntu copy will sync eBay",
)
args = parser.parse_args()
container = "togacards-cards-1"
mounts = json.loads(
    subprocess.check_output(
        ["docker", "inspect", container, "--format", "{{json .Mounts}}"], text=True
    )
)
assert any(
    m.get("Name") == "togacards_cards-data" and m["Destination"] == "/app/data"
    for m in mounts
), "Unexpected local inventory volume"
stamp = (
    datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    + "-"
    + uuid.uuid4().hex[:8]
)
directory = root / ".backups" / ("ubuntu-cutover-" + stamp)
directory.mkdir(parents=True)
subprocess.run(
    [
        "docker",
        "compose",
        "--project-name",
        "togacards",
        "--file",
        str(root / "compose.yaml"),
        "stop",
        "cards",
    ],
    check=True,
)
# Keep the original complete volume copy alongside the portable SQLite backup.
source = directory / "stopped-data"
source.mkdir()
subprocess.run(["docker", "cp", container + ":/app/data/.", str(source)], check=True)
with sqlite3.connect(
    (source / "cards.sqlite").resolve().as_uri() + "?mode=ro", uri=True
) as db:
    assert (
        db.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    ), "Source database failed integrity check"
    counts = {
        t: db.execute("SELECT COUNT(*) FROM " + t).fetchone()[0]
        for t in ["cards", "movements", "sales"]
    }
    with sqlite3.connect(directory / "inventory.sqlite") as portable:
        db.backup(portable)
values = {}
for line in (root / ".env").read_text().splitlines():
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    key, sep, value = line.partition("=")
    if not sep:
        raise ValueError("Invalid local environment line")
    if len(value) > 1 and value[0] == value[-1] and value[0] in ['"', "'"]:
        value = value[1:-1]
    if key.startswith(("EBAY_", "STRIPE_", "ADMIN_")) or key == "SHOP_SHIPPING_PENCE":
        values[key] = value
assert values.get("ADMIN_PASSWORD"), "Configure an admin password before export"
values["SHOP_URL"] = "https://togacards.co.uk"
values.setdefault("ADMIN_USER", "admin")
(directory / "runtime.env").write_text(
    "".join(k + "=" + v + "\n" for k, v in values.items()), encoding="utf-8"
)
with (directory / "inventory.sqlite").open("rb") as f:
    checksum = hashlib.file_digest(f, "sha256").hexdigest()
manifest = {
    "schema": 1,
    "database_sha256": checksum,
    "counts": counts,
    "ebay_key_sha256": hashlib.sha256(
        values.get("EBAY_TOKEN_KEY", "").encode()
    ).hexdigest(),
}
(directory / "manifest.json").write_text(json.dumps(manifest, indent=2))
bundle = directory / "inventory-cutover.tar.gz"
with tarfile.open(bundle, "w:gz") as tar:
    for name in ["inventory.sqlite", "runtime.env", "manifest.json"]:
        tar.add(directory / name, arcname=name)
print("Private inventory bundle:", bundle)
print(
    "The local container is STOPPED. Keep it stopped after Ubuntu starts syncing. Never commit or upload this bundle as a GitHub artifact."
)
