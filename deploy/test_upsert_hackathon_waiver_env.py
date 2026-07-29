import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from deploy.upsert_hackathon_waiver_env import (
    EnvironmentUpdateError,
    WAIVER_VALUE,
    _open_verified_target,
    render_updated_environment,
    update_production_environment,
)


class HackathonWaiverEnvironmentTests(unittest.TestCase):
    def test_replaces_only_the_managed_assignment(self) -> None:
        original = (
            b"API_SECRET=preserve-this-verbatim\n"
            b"export LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL=expired\n"
            b"OTHER_SETTING = keep spacing\n"
        )

        self.assertEqual(
            render_updated_environment(original),
            b"API_SECRET=preserve-this-verbatim\n"
            b"LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL=" + WAIVER_VALUE + b"\n"
            b"OTHER_SETTING = keep spacing\n",
        )

    def test_appends_with_the_existing_newline_style(self) -> None:
        updated = render_updated_environment(b"OTHER_SETTING=kept\r\n")

        self.assertEqual(
            updated,
            b"OTHER_SETTING=kept\r\n"
            b"LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL=" + WAIVER_VALUE + b"\r\n",
        )

    def test_rejects_duplicate_assignments(self) -> None:
        with self.assertRaisesRegex(EnvironmentUpdateError, "Duplicate"):
            render_updated_environment(
                b"LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL=first\n"
                b"export LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL=second\n"
            )

    def test_rejects_every_value_except_the_fixed_release_waiver(self) -> None:
        for value in (
            b"",
            b"2026-08-07T16:59:00z",
            b"2026-08-07T23:59:00+07:00",
            b"2026-08-08T16:59:00Z",
        ):
            with self.subTest(value=value):
                with self.assertRaisesRegex(EnvironmentUpdateError, "Unexpected"):
                    render_updated_environment(b"OTHER=value\n", value)

    def test_rejects_an_unapproved_target_before_opening_it(self) -> None:
        with self.assertRaisesRegex(EnvironmentUpdateError, "unexpected environment path"):
            _open_verified_target(Path("/tmp/.env.production"))

    def test_ci_tests_and_upserts_the_waiver_before_migrations(self) -> None:
        workflow = (
            Path(__file__).parents[1] / ".github" / "workflows" / "ci-cd.yml"
        ).read_text(encoding="utf-8")

        test_index = workflow.index("test_upsert_hackathon_waiver_env.py")
        update_index = workflow.index("upsert_hackathon_waiver_env.py", test_index)
        migration_index = workflow.index("Apply migrations and deploy", update_index)
        self.assertLess(test_index, update_index)
        self.assertLess(update_index, migration_index)

    @unittest.skipUnless(os.name == "posix", "deployment safety is Linux-specific")
    def test_atomic_update_preserves_mode_owner_and_unmanaged_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / ".env.production"
            original = b"API_SECRET=secret\nUNMANAGED = preserved verbatim\n"
            target.write_bytes(original)
            target.chmod(0o640)
            original_stat = target.stat()

            with patch("deploy.upsert_hackathon_waiver_env.PRODUCTION_TARGET", target):
                update_production_environment(target)

            updated_stat = target.stat()
            self.assertEqual(stat.S_IMODE(updated_stat.st_mode), stat.S_IMODE(original_stat.st_mode))
            self.assertEqual(updated_stat.st_uid, original_stat.st_uid)
            self.assertEqual(updated_stat.st_gid, original_stat.st_gid)
            updated = target.read_bytes()
            self.assertIn(original, updated)
            self.assertIn(b"LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL=" + WAIVER_VALUE + b"\n", updated)

    @unittest.skipUnless(os.name == "posix", "deployment safety is Linux-specific")
    def test_rejects_a_symlink_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            parent = Path(temporary_directory)
            real_target = parent / "real.env"
            real_target.write_bytes(b"OTHER=value\n")
            target = parent / ".env.production"
            target.symlink_to(real_target)

            with patch("deploy.upsert_hackathon_waiver_env.PRODUCTION_TARGET", target):
                with self.assertRaisesRegex(EnvironmentUpdateError, "non-symlink"):
                    _open_verified_target(target)

    @unittest.skipUnless(os.name == "posix", "deployment safety is Linux-specific")
    def test_cleans_the_temporary_file_when_replace_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / ".env.production"
            target.write_bytes(b"OTHER=value\n")

            with (
                patch("deploy.upsert_hackathon_waiver_env.PRODUCTION_TARGET", target),
                patch(
                    "deploy.upsert_hackathon_waiver_env.os.replace",
                    side_effect=OSError("simulated replace failure"),
                ),
                self.assertRaisesRegex(OSError, "simulated replace failure"),
            ):
                update_production_environment(target)

            self.assertEqual(
                list(target.parent.glob(".env.production.hackathon-waiver.*.tmp")),
                [],
            )


if __name__ == "__main__":
    unittest.main()
