#!/usr/bin/env python3
"""Create metadata for the exact Docker image built and tested by CI."""

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

revision, directory = sys.argv[1:]
if not re.fullmatch(r"[0-9a-f]{40}", revision):
    raise SystemExit("Invalid revision")
root = Path(directory)
image = "toga-cards:" + revision
image_id = subprocess.check_output(
    ["docker", "image", "inspect", image, "--format", "{{.Id}}"], text=True
).strip()
with (root / "image.tar.gz").open("rb") as f:
    digest = hashlib.file_digest(f, "sha256").hexdigest()
(root / "release.json").write_text(
    json.dumps(
        {
            "schema": 1,
            "repository": "theCowBoiCoder/toga_cards",
            "revision": revision,
            "image": image,
            "image_id": image_id,
            "sha256": digest,
        },
        indent=2,
    )
    + "\n"
)
