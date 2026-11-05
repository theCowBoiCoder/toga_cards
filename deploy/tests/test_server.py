import hashlib
import importlib.util
import io
import json
import sqlite3
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "server", Path(__file__).resolve().parents[1] / "server.py"
)
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


def tar_files(path, files):
    with tarfile.open(path, "w") as tar:
        for name, data in files:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


class ReceiverTests(unittest.TestCase):
    def test_release_checks_identity_checksum_and_single_image_tag(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sha = "a" * 40
            image = root / "image.tar.gz"
            with tarfile.open(image, "w:gz") as tar:
                data = json.dumps([{"RepoTags": ["toga-cards:" + sha]}]).encode()
                info = tarfile.TarInfo("manifest.json")
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
            metadata = {
                "schema": 1,
                "repository": "theCowBoiCoder/toga_cards",
                "revision": sha,
                "image": "toga-cards:" + sha,
                "image_id": "sha256:" + "b" * 64,
                "sha256": server.digest(image),
            }
            (root / "release.json").write_text(json.dumps(metadata))
            self.assertEqual(server.validate_release(root)["revision"], sha)
            metadata["repository"] = "another/repo"
            (root / "release.json").write_text(json.dumps(metadata))
            with self.assertRaisesRegex(ValueError, "identity"):
                server.validate_release(root)
            metadata["repository"] = "theCowBoiCoder/toga_cards"
            metadata["sha256"] = "0" * 64
            (root / "release.json").write_text(json.dumps(metadata))
            with self.assertRaisesRegex(ValueError, "checksum"):
                server.validate_release(root)

    def test_extraction_rejects_traversal_links_and_duplicate_members(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "payload.tar"
            target = root / "out"
            target.mkdir()
            for entries in [[("../escape", b"bad")], [("one", b"a"), ("one", b"b")]]:
                tar_files(archive, entries)
                with self.assertRaises(ValueError):
                    server.extract_exact(archive, target, {"one"})
            with tarfile.open(archive, "w") as tar:
                link = tarfile.TarInfo("one")
                link.type = tarfile.SYMTYPE
                link.linkname = "/etc/passwd"
                tar.addfile(link)
            with self.assertRaises(ValueError):
                server.extract_exact(archive, target, {"one"})
            self.assertEqual(list(target.iterdir()), [])

    def test_import_checks_records_and_key_then_refuses_existing_database(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = root / "volume"
            data.mkdir()
            source = root / "source.sqlite"
            with sqlite3.connect(source) as db:
                for name in ["cards", "movements", "sales"]:
                    db.execute("CREATE TABLE " + name + " (id INTEGER PRIMARY KEY)")
                db.execute("INSERT INTO cards VALUES (1)")
            admin = root / "admin.sqlite"
            with sqlite3.connect(admin) as db:
                db.execute("CREATE TABLE users (email TEXT)")
                db.execute("INSERT INTO users VALUES ('synthetic@example.test')")
            photos = root / "photos.tar"
            tar_files(photos, [("cards/synthetic.png", b"synthetic-image")])
            environment = (
                "SHOP_URL=https://togacards.co.uk\nADMIN_PASSWORD=synthetic-test-only\nADMIN_SERVICE_KEY=" + "a" * 64 + "\nLARAVEL_APP_KEY=base64:" + "A" * 43 + "=\nEBAY_TOKEN_KEY="
                + "c" * 64
                + "\n"
            )
            metadata = {
                "schema": 2,
                "counts": {"cards": 1, "movements": 0, "sales": 0},
                "database_sha256": server.digest(source),
                "ebay_key_sha256": hashlib.sha256(("c" * 64).encode()).hexdigest(),
                "files": {"admin.sqlite": server.digest(admin), "photos.tar": server.digest(photos)},
            }
            bundle = root / "bundle.tar"
            tar_files(
                bundle,
                [
                    ("inventory.sqlite", source.read_bytes()),
                    ("admin.sqlite", admin.read_bytes()),
                    ("photos.tar", photos.read_bytes()),
                    ("runtime.env", environment.encode()),
                    ("manifest.json", json.dumps(metadata).encode()),
                ],
            )
            with patch.object(server, "ROOT", root / "state"), patch.object(
                server, "CONFIG", root / "config"
            ), patch.object(server, "volume_path", return_value=data), patch.object(
                server, "run", return_value=""
            ), patch.object(
                server.os, "chown"
            ) as ownership:
                server.import_inventory(bundle)
                self.assertEqual(
                    server.inspect_database(data / "cards.sqlite"), metadata["counts"]
                )
                ownership.assert_any_call(data / "cards.sqlite", 1000, 1000)
                self.assertEqual(server.digest(data / "admin.sqlite"), server.digest(admin))
                self.assertEqual((data / "admin-public/cards/synthetic.png").read_bytes(), b"synthetic-image")
                with self.assertRaisesRegex(ValueError, "already exists"):
                    server.import_inventory(bundle)
                self.assertEqual(
                    server.inspect_database(data / "cards.sqlite"), metadata["counts"]
                )

    def test_backup_preserves_admin_accounts_and_uploaded_photos(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = root / "volume"
            data.mkdir()
            with sqlite3.connect(data / "cards.sqlite") as db:
                for name in ["cards", "movements", "sales"]:
                    db.execute("CREATE TABLE " + name + " (id INTEGER PRIMARY KEY)")
            (data / "admin.sqlite").write_bytes(b"synthetic-admin-database")
            photos = data / "admin-public/cards"
            photos.mkdir(parents=True)
            (photos / "test.jpg").write_bytes(b"synthetic-photo")
            backup = root / "backup/data"
            with patch.object(server, "volume_path", return_value=data):
                server.backup_database(backup)
            self.assertEqual((backup / "admin.sqlite").read_bytes(), b"synthetic-admin-database")
            self.assertEqual((backup / "admin-public/cards/test.jpg").read_bytes(), b"synthetic-photo")

    def test_rollback_restarts_old_image_without_restoring_or_erasing_database(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / "config"
            config.mkdir()
            (config / "runtime.env").write_text("ADMIN_PASSWORD=synthetic\n")
            (root / "inventory-imported.json").write_text("{}")
            archive = root / "input.tar"
            tar_files(archive, [("image.tar.gz", b"fake"), ("release.json", b"{}")])
            metadata = {
                "revision": "a" * 40,
                "image": "toga-cards:" + "a" * 40,
                "image_id": "sha256:" + "b" * 64,
            }
            calls = []

            def compose(image, *args):
                calls.append((image, args))
                if args[0] == "ps":
                    return "old-container"
                if args[0] == "up" and image == metadata["image"]:
                    raise RuntimeError("Synthetic new-release failure")
                return ""

            def run(args, **kwargs):
                if args[:3] == ["docker", "image", "inspect"]:
                    return metadata["image_id"]
                if args[:2] == ["docker", "inspect"]:
                    return (
                        "sha256:" + "c" * 64
                        if args[-1] == "{{.Image}}"
                        else "old-revision"
                    )
                return ""

            class Input:
                def __init__(self, b):
                    self.buffer = io.BytesIO(b)

            with patch.object(server, "ROOT", root), patch.object(
                server, "CONFIG", config
            ), patch.object(server, "compose", side_effect=compose), patch.object(
                server, "run", side_effect=run
            ), patch.object(
                server, "validate_release", return_value=metadata
            ), patch.object(
                server,
                "backup_database",
                side_effect=lambda path: path.mkdir(parents=True),
            ), patch.object(
                server.sys, "stdin", Input(archive.read_bytes())
            ):
                with self.assertRaisesRegex(RuntimeError, "Synthetic"):
                    server.receive()
            self.assertIn(
                ("sha256:" + "c" * 64, ("up", "--detach", "--no-build", "cards")), calls
            )
            self.assertFalse(any("down" in args for _, args in calls))


if __name__ == "__main__":
    unittest.main()
