import hashlib
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from deploy.upsert_circle_phase2_env import (
    EnvironmentUpdateError,
    _assert_target_unchanged,
    _open_verified_target,
    _read_descriptor,
    render_updated_environment,
    update_production_environment,
    validate_required_secrets,
)


class RenderUpdatedEnvironmentTests(unittest.TestCase):
    def test_updates_only_managed_values_and_preserves_secrets(self) -> None:
        original = (
            b"CIRCLE_API_KEY=secret-api-key\n"
            b"CIRCLE_CONTRACTS_ENABLED=false\n"
            b"CIRCLE_ENTITY_SECRET=secret-entity-value\n"
            b"OTHER_SETTING=kept\n"
        )

        updated = render_updated_environment(original)

        self.assertIn(b"CIRCLE_API_KEY=secret-api-key\n", updated)
        self.assertIn(b"CIRCLE_ENTITY_SECRET=secret-entity-value\n", updated)
        self.assertIn(b"OTHER_SETTING=kept\n", updated)
        self.assertIn(b"CIRCLE_CONTRACTS_ENABLED=true\n", updated)
        self.assertIn(b"CIRCLE_GATEWAY_WEBHOOKS_ENABLED=true\n", updated)
        self.assertIn(
            b"CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS="
            b"39f66f5f-600d-4efa-9d99-a725c0af80f8\n",
            updated,
        )

    def test_rejects_duplicate_managed_keys_without_rendering_output(self) -> None:
        original = (
            b"CIRCLE_GATEWAY_WEBHOOKS_ENABLED=false\n"
            b"export CIRCLE_GATEWAY_WEBHOOKS_ENABLED=true\n"
        )

        with self.assertRaisesRegex(
            EnvironmentUpdateError,
            "Duplicate managed environment key",
        ):
            render_updated_environment(original)

    def test_preserves_crlf_when_appending_missing_keys(self) -> None:
        updated = render_updated_environment(b"OTHER_SETTING=kept\r\n")

        self.assertNotIn(b"\n", updated.replace(b"\r\n", b""))
        self.assertTrue(updated.endswith(b"\r\n"))

    def test_rejects_any_nonproduction_target_before_opening_it(self) -> None:
        with self.assertRaisesRegex(EnvironmentUpdateError, "unexpected environment path"):
            _open_verified_target(Path("/tmp/.env.production"))

    def test_requires_each_phase2_secret_once_without_reading_its_value(self) -> None:
        valid = (
            b"CIRCLE_API_KEY=api-secret\n"
            b"CIRCLE_ENTITY_SECRET=entity-secret\n"
            b"CIRCLE_DEPLOYMENT_WALLET_ID=wallet-id\n"
        )
        validate_required_secrets(valid)

        for invalid in (
            valid.replace(b"CIRCLE_API_KEY=api-secret\n", b""),
            valid.replace(b"CIRCLE_ENTITY_SECRET=entity-secret", b"CIRCLE_ENTITY_SECRET="),
            valid.replace(
                b"CIRCLE_ENTITY_SECRET=entity-secret",
                b'CIRCLE_ENTITY_SECRET="   "',
            ),
            valid + b"CIRCLE_DEPLOYMENT_WALLET_ID=duplicate\n",
        ):
            with self.assertRaises(EnvironmentUpdateError):
                validate_required_secrets(invalid)

    @unittest.skipUnless(os.name == "posix", "deployment safety is Linux-specific")
    def test_atomic_update_preserves_mode_owner_and_unmanaged_content(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / ".env.production"
            original = (
                b"CIRCLE_API_KEY=api-secret\n"
                b"CIRCLE_ENTITY_SECRET=entity-secret\n"
                b"CIRCLE_DEPLOYMENT_WALLET_ID=wallet-id\n"
                b"CIRCLE_CONTRACTS_ENABLED=false\n"
                b"UNMANAGED_SETTING=preserved-verbatim\n"
            )
            target.write_bytes(original)
            target.chmod(0o640)
            original_stat = target.stat()

            with patch(
                "deploy.upsert_circle_phase2_env.PRODUCTION_TARGET",
                target,
            ):
                update_production_environment(target)

            updated_stat = target.stat()
            self.assertEqual(
                stat.S_IMODE(updated_stat.st_mode),
                stat.S_IMODE(original_stat.st_mode),
            )
            self.assertEqual(updated_stat.st_uid, original_stat.st_uid)
            self.assertEqual(updated_stat.st_gid, original_stat.st_gid)
            updated = target.read_bytes()
            self.assertIn(b"UNMANAGED_SETTING=preserved-verbatim\n", updated)
            self.assertIn(b"CIRCLE_API_KEY=api-secret\n", updated)
            self.assertIn(b"CIRCLE_CONTRACTS_ENABLED=true\n", updated)

    @unittest.skipUnless(os.name == "posix", "deployment safety is Linux-specific")
    def test_rejects_symlink_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            parent = Path(temporary_directory)
            real_target = parent / "real.env"
            real_target.write_text("CIRCLE_API_KEY=secret\n", encoding="utf-8")
            target = parent / ".env.production"
            target.symlink_to(real_target)

            with patch(
                "deploy.upsert_circle_phase2_env.PRODUCTION_TARGET",
                target,
            ):
                with self.assertRaisesRegex(EnvironmentUpdateError, "symlink"):
                    _open_verified_target(target)

    @unittest.skipUnless(os.name == "posix", "deployment safety is Linux-specific")
    def test_detects_same_inode_change_before_replace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / ".env.production"
            target.write_bytes(b"ORIGINAL=value\n")
            with patch(
                "deploy.upsert_circle_phase2_env.PRODUCTION_TARGET",
                target,
            ):
                descriptor, original_stat = _open_verified_target(target)
                try:
                    original = _read_descriptor(descriptor)
                    target.write_bytes(b"CHANGED=value\n")
                    with self.assertRaisesRegex(
                        EnvironmentUpdateError,
                        "changed before atomic replacement",
                    ):
                        _assert_target_unchanged(
                            target,
                            descriptor,
                            original_stat,
                            hashlib.sha256(original).digest(),
                        )
                finally:
                    os.close(descriptor)

    @unittest.skipUnless(os.name == "posix", "deployment safety is Linux-specific")
    def test_cleans_temporary_file_when_replace_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / ".env.production"
            target.write_bytes(
                b"CIRCLE_API_KEY=api-secret\n"
                b"CIRCLE_ENTITY_SECRET=entity-secret\n"
                b"CIRCLE_DEPLOYMENT_WALLET_ID=wallet-id\n"
            )
            with (
                patch(
                    "deploy.upsert_circle_phase2_env.PRODUCTION_TARGET",
                    target,
                ),
                patch(
                    "deploy.upsert_circle_phase2_env.os.replace",
                    side_effect=OSError("simulated replace failure"),
                ),
                self.assertRaisesRegex(OSError, "simulated replace failure"),
            ):
                update_production_environment(target)

            self.assertEqual(
                list(target.parent.glob(".env.production.circle-phase2.*.tmp")),
                [],
            )

    def test_deploy_commits_good_state_only_after_circle_verifier(self) -> None:
        deploy_script = (
            Path(__file__).with_name("deploy.sh").read_text(encoding="utf-8")
        )

        trap_index = deploy_script.index("trap rollback ERR")
        start_index = deploy_script.index(
            "compose up --detach --remove-orphans --wait api web",
            trap_index,
        )
        verify_index = deploy_script.index(
            '"${APP_DIR}/verify-circle-phase2.sh"',
            start_index,
        )
        state_index = deploy_script.index(
            'printf \'IMAGE_NAMESPACE=%s\\nIMAGE_TAG=%s\\n\'',
            verify_index,
        )
        clear_trap_index = deploy_script.index("trap - ERR", state_index)

        self.assertLess(trap_index, start_index)
        self.assertLess(start_index, verify_index)
        self.assertLess(verify_index, state_index)
        self.assertLess(state_index, clear_trap_index)


if __name__ == "__main__":
    unittest.main()
