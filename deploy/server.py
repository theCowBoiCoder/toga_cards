#!/usr/bin/env python3
"""Root-owned release receiver. The deployment SSH key cannot run arbitrary commands."""

import contextlib
import datetime
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

ROOT = Path("/var/lib/toga-cards")
CONFIG = Path("/etc/toga-cards")
VOLUME = "toga_cards_production_data"
MAX_ARCHIVE = 2 * 1024**3


def run(args, **kwargs):
    return subprocess.run(
        args, check=True, text=True, capture_output=True, **kwargs
    ).stdout.strip()


def compose(image, *args):
    return run(
        [
            "docker",
            "compose",
            "--project-name",
            "toga-cards",
            "--file",
            str(CONFIG / "compose.yaml"),
            *args,
        ],
        env={**os.environ, "TOGA_IMAGE": image},
    )


def digest(path):
    with Path(path).open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def extract_exact(archive, destination, names):
    """No links, nested paths, duplicate entries or tar extraction traversal."""
    with tarfile.open(archive, "r:*") as tar:
        entries = tar.getmembers()
        if len(entries) != len(names) or {e.name for e in entries} != set(names):
            raise ValueError("Unexpected archive entries")
        if any(not e.isfile() or e.size < 0 or e.size > MAX_ARCHIVE for e in entries):
            raise ValueError("Invalid archive entry")
        if sum(e.size for e in entries) > MAX_ARCHIVE:
            raise ValueError("Archive is too large")
        for entry in entries:
            with tar.extractfile(entry) as source, (destination / entry.name).open(
                "xb"
            ) as target:
                shutil.copyfileobj(source, target)


def validate_release(directory):
    m = json.loads((directory / "release.json").read_text())
    sha = m.get("revision", "")
    if (
        m.get("schema") != 1
        or m.get("repository") != "theCowBoiCoder/toga_cards"
        or not re.fullmatch("[0-9a-f]{40}", sha)
    ):
        raise ValueError("Invalid release identity")
    if m.get("image") != "toga-cards:" + sha or not re.fullmatch(
        "sha256:[0-9a-f]{64}", m.get("image_id", "")
    ):
        raise ValueError("Invalid image identity")
    if digest(directory / "image.tar.gz") != m.get("sha256"):
        raise ValueError("Image checksum mismatch")
    # A deployment key may load only this application's single tagged image.
    with tarfile.open(directory / "image.tar.gz", "r:gz") as image:
        member = image.getmember("manifest.json")
        if not member.isfile() or member.size > 65536:
            raise ValueError("Invalid image manifest")
        manifest = json.load(image.extractfile(member))
        if len(manifest) != 1 or manifest[0].get("RepoTags") != [m["image"]]:
            raise ValueError("Unexpected image tags")
    return m


def volume_path():
    data = json.loads(run(["docker", "volume", "inspect", VOLUME]))[0]
    if data["Name"] != VOLUME or data["Driver"] != "local":
        raise ValueError("Unexpected inventory volume")
    path = Path(data["Mountpoint"])
    if path.is_symlink() or not path.is_dir():
        raise ValueError("Invalid inventory directory")
    return path


def inspect_database(path):
    if path.is_symlink():
        raise ValueError("Database must not be a symlink")
    with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True) as db:
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Database integrity check failed")
        return {
            name: db.execute('SELECT COUNT(*) FROM "' + name + '"').fetchone()[0]
            for name in ("cards", "movements", "sales")
        }


def backup_database(destination):
    destination.mkdir(mode=0o700, parents=True)
    source = volume_path()
    if not (source / "cards.sqlite").is_file():
        raise ValueError("Existing inventory database is missing")
    for name in ("cards.sqlite", "cards.sqlite-wal", "cards.sqlite-shm"):
        path = source / name
        if path.is_symlink():
            raise ValueError("Inventory contains an unexpected symlink")
        if path.exists():
            shutil.copy2(path, destination / name)
    counts = inspect_database(destination / "cards.sqlite")
    (destination.parent / "database-counts.json").write_text(
        json.dumps(counts, indent=2)
    )
    return counts


def wait_for_health(revision):
    for _ in range(60):
        try:
            with urllib.request.urlopen(
                "http://127.0.0.1:3100/api/health", timeout=3
            ) as response:
                health = json.load(response)
            if health.get("ok") and health.get("revision") == revision:
                return
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise RuntimeError("New application failed its revision health check")


@contextlib.contextmanager
def deployment_lock():
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (ROOT / "deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def receive():
    if not (ROOT / "inventory-imported.json").is_file():
        raise ValueError("Import the existing inventory before the first deployment")
    with deployment_lock(), tempfile.TemporaryDirectory(
        prefix="release-", dir=ROOT
    ) as temporary:
        staging = Path(temporary)
        archive = staging / "release.tar"
        total = 0
        with archive.open("xb") as target:
            while chunk := sys.stdin.buffer.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_ARCHIVE:
                    raise ValueError("Release is too large")
                target.write(chunk)
        extract_exact(archive, staging, {"image.tar.gz", "release.json"})
        m = validate_release(staging)
        run(["docker", "load", "--input", str(staging / "image.tar.gz")])
        if (
            run(["docker", "image", "inspect", m["image"], "--format", "{{.Id}}"])
            != m["image_id"]
        ):
            raise ValueError("Loaded image digest does not match")
        container = compose(m["image"], "ps", "--all", "--quiet", "cards")
        old_image = (
            run(["docker", "inspect", container, "--format", "{{.Image}}"])
            if container
            else None
        )
        old_revision = (
            run(
                [
                    "docker",
                    "inspect",
                    container,
                    "--format",
                    '{{index .Config.Labels "org.opencontainers.image.revision"}}',
                ]
            )
            if container
            else None
        )
        stamp = (
            datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            + "-"
            + uuid.uuid4().hex[:8]
        )
        backup = ROOT / "backups" / stamp
        switched = False
        try:
            if container:
                compose(old_image, "stop", "--timeout", "45", "cards")
            backup_database(backup / "data")
            shutil.copy2(CONFIG / "runtime.env", backup / "runtime.env")
            if old_image:
                (backup / "previous-release.json").write_text(
                    json.dumps({"image": old_image, "revision": old_revision})
                )
            switched = True
            compose(
                m["image"],
                "up",
                "--detach",
                "--no-build",
                "--wait",
                "--wait-timeout",
                "120",
                "cards",
            )
            wait_for_health(m["revision"])
            (ROOT / "current.json").write_text(json.dumps(m, indent=2))
            print(
                "Deployed "
                + m["revision"]
                + "; inventory volume retained; backup "
                + stamp
            )
        except Exception:
            # Roll back the image, never automatically overwrite a database that
            # may already contain a paid order accepted by the new version.
            if old_image:
                compose(old_image, "up", "--detach", "--no-build", "cards")
                print(
                    "Deployment failed; previous image restarted with the existing database.",
                    file=sys.stderr,
                )
            elif switched:
                compose(m["image"], "stop", "cards")
            raise


def parse_environment(text):
    result = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch("[A-Z][A-Z0-9_]*", key):
            raise ValueError("Invalid environment file")
        result[key] = value
    return result


def import_inventory(bundle):
    with deployment_lock(), tempfile.TemporaryDirectory(
        prefix="import-", dir=ROOT
    ) as temporary:
        staging = Path(temporary)
        extract_exact(
            bundle, staging, {"inventory.sqlite", "runtime.env", "manifest.json"}
        )
        m = json.loads((staging / "manifest.json").read_text())
        if m.get("schema") != 1 or digest(staging / "inventory.sqlite") != m.get(
            "database_sha256"
        ):
            raise ValueError("Inventory checksum mismatch")
        counts = inspect_database(staging / "inventory.sqlite")
        if counts != m.get("counts"):
            raise ValueError("Inventory record counts differ")
        env = parse_environment((staging / "runtime.env").read_text())
        if (
            not env.get("ADMIN_PASSWORD")
            or env.get("SHOP_URL") != "https://togacards.co.uk"
        ):
            raise ValueError(
                "Production admin password and canonical HTTPS URL required"
            )
        if hashlib.sha256(env.get("EBAY_TOKEN_KEY", "").encode()).hexdigest() != m.get(
            "ebay_key_sha256"
        ):
            raise ValueError("eBay encryption key mismatch")
        if run(["docker", "ps", "--quiet", "--filter", "volume=" + VOLUME]):
            raise ValueError("Stop containers using the inventory volume before import")
        data = volume_path()
        target = data / "cards.sqlite"
        if any(
            (data / n).exists()
            for n in ("cards.sqlite", "cards.sqlite-wal", "cards.sqlite-shm")
        ):
            raise ValueError(
                "Production database already exists; refusing to overwrite it"
            )
        # The external volume was created before its first container mount, so
        # Docker cannot copy the image directory's Node ownership into it.
        os.chown(data, 1000, 1000)
        os.chmod(data, 0o700)
        with target.open("xb") as destination, (staging / "inventory.sqlite").open(
            "rb"
        ) as source:
            shutil.copyfileobj(source, destination)
        os.chmod(target, 0o600)
        os.chown(target, 1000, 1000)
        CONFIG.mkdir(mode=0o700, parents=True, exist_ok=True)
        environment = CONFIG / "runtime.env"
        descriptor = os.open(environment, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as f:
            f.write("".join(k + "=" + v + "\n" for k, v in env.items()))
        os.chmod(environment, 0o600)
        (ROOT / "inventory-imported.json").write_text(json.dumps(m, indent=2))
        print(
            "Imported and verified existing inventory. Keep the old PC container stopped."
        )


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run through the installed root receiver or sudo")
    signal.alarm(900)
    if sys.argv[1:] == ["receive"]:
        receive()
    elif len(sys.argv) == 3 and sys.argv[1] == "import":
        import_inventory(Path(sys.argv[2]))
    else:
        raise SystemExit("Usage: server.py receive | import PRIVATE_BUNDLE")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Deployment stopped: " + str(error), file=sys.stderr)
        raise SystemExit(1)
