#!/usr/bin/env python3
"""Atomically enable the audited Circle phase-2 production configuration."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import re
import stat
import tempfile

try:
    import fcntl
except ImportError:  # pragma: no cover - production deployment is Linux.
    fcntl = None


PRODUCTION_TARGET = Path("/opt/bounty-escrow/.env.production")
DESIRED_VALUES = {
    b"CIRCLE_CONTRACTS_ENABLED": b"true",
    b"CIRCLE_GATEWAY_WEBHOOKS_ENABLED": b"true",
    b"CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS": (
        b"39f66f5f-600d-4efa-9d99-a725c0af80f8"
    ),
}
REQUIRED_SECRETS = (
    b"CIRCLE_API_KEY",
    b"CIRCLE_ENTITY_SECRET",
    b"CIRCLE_DEPLOYMENT_WALLET_ID",
)
ASSIGNMENT_PATTERNS = {
    key: re.compile(rb"^[ \t]*(?:export[ \t]+)?" + re.escape(key) + rb"[ \t]*=")
    for key in DESIRED_VALUES
}
REQUIRED_SECRET_PATTERNS = {
    key: re.compile(
        rb"^[ \t]*(?:export[ \t]+)?"
        + re.escape(key)
        + rb"[ \t]*=[ \t]*(.*?)[ \t]*(?:\r?\n)?$"
    )
    for key in REQUIRED_SECRETS
}


class EnvironmentUpdateError(RuntimeError):
    """Raised before replacing the production environment file."""


def render_updated_environment(original: bytes) -> bytes:
    """Return an updated env file without interpreting or exposing other values."""

    matches = {key: 0 for key in DESIRED_VALUES}
    output = bytearray()
    newline = b"\r\n" if b"\r\n" in original else b"\n"

    for line in original.splitlines(keepends=True):
        matching_keys = [
            key for key, pattern in ASSIGNMENT_PATTERNS.items() if pattern.match(line)
        ]
        if len(matching_keys) > 1:
            raise EnvironmentUpdateError("Ambiguous managed environment assignment.")
        if not matching_keys:
            output.extend(line)
            continue

        key = matching_keys[0]
        matches[key] += 1
        if matches[key] > 1:
            raise EnvironmentUpdateError(
                f"Duplicate managed environment key: {key.decode('ascii')}."
            )
        line_ending = b"\r\n" if line.endswith(b"\r\n") else (
            b"\n" if line.endswith(b"\n") else b""
        )
        output.extend(key + b"=" + DESIRED_VALUES[key] + line_ending)

    missing = [key for key, count in matches.items() if count == 0]
    if missing:
        if output and not output.endswith((b"\n", b"\r")):
            output.extend(newline)
        for key in missing:
            output.extend(key + b"=" + DESIRED_VALUES[key] + newline)

    return bytes(output)


def validate_required_secrets(original: bytes) -> None:
    """Fail without revealing values unless every required secret occurs once."""

    matches = {key: [] for key in REQUIRED_SECRETS}
    for line in original.splitlines(keepends=True):
        for key, pattern in REQUIRED_SECRET_PATTERNS.items():
            match = pattern.match(line)
            if match is not None:
                matches[key].append(match.group(1).strip())

    for key, values in matches.items():
        if len(values) != 1:
            raise EnvironmentUpdateError(
                f"Expected exactly one required secret assignment: {key.decode('ascii')}."
            )
        value = values[0].strip()
        if (
            len(value) >= 2
            and value[:1] in (b'"', b"'")
            and value[-1:] == value[:1]
        ):
            value = value[1:-1].strip()
        if not value:
            raise EnvironmentUpdateError(
                f"Required secret is blank: {key.decode('ascii')}."
            )


def _open_verified_target(path: Path) -> tuple[int, os.stat_result]:
    if path != PRODUCTION_TARGET:
        raise EnvironmentUpdateError("Refusing to update an unexpected environment path.")
    if not path.is_absolute():
        raise EnvironmentUpdateError("Production environment path must be absolute.")

    parent_stat = path.parent.lstat()
    if stat.S_ISLNK(parent_stat.st_mode) or not stat.S_ISDIR(parent_stat.st_mode):
        raise EnvironmentUpdateError("Production directory must be a real directory.")
    if path.parent.resolve(strict=True) != PRODUCTION_TARGET.parent:
        raise EnvironmentUpdateError("Production directory resolved outside the allowed target.")
    initial_path_stat = path.lstat()
    if stat.S_ISLNK(initial_path_stat.st_mode) or not stat.S_ISREG(
        initial_path_stat.st_mode
    ):
        raise EnvironmentUpdateError("Production environment must not be a symlink.")

    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        if fcntl is not None:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        elif os.name == "posix":
            raise EnvironmentUpdateError(
                "Exclusive production environment locking is unavailable."
            )
        target_stat = os.fstat(descriptor)
        if not stat.S_ISREG(target_stat.st_mode):
            raise EnvironmentUpdateError("Production environment must be a regular file.")
        path_stat = path.lstat()
        if stat.S_ISLNK(path_stat.st_mode) or not stat.S_ISREG(path_stat.st_mode):
            raise EnvironmentUpdateError("Production environment must not be a symlink.")
        if (path_stat.st_dev, path_stat.st_ino) != (
            target_stat.st_dev,
            target_stat.st_ino,
        ):
            raise EnvironmentUpdateError(
                "Production environment changed during validation."
            )
    except BlockingIOError as error:
        os.close(descriptor)
        raise EnvironmentUpdateError(
            "Production environment is locked by another updater."
        ) from error
    except Exception:
        os.close(descriptor)
        raise
    return descriptor, target_stat


def _read_descriptor(descriptor: int) -> bytes:
    os.lseek(descriptor, 0, os.SEEK_SET)
    chunks = []
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)


def _stable_metadata(file_stat: os.stat_result) -> tuple[int, ...]:
    return (
        file_stat.st_dev,
        file_stat.st_ino,
        stat.S_IMODE(file_stat.st_mode),
        file_stat.st_uid,
        file_stat.st_gid,
        file_stat.st_size,
        file_stat.st_mtime_ns,
        file_stat.st_ctime_ns,
    )


def _assert_target_unchanged(
    path: Path,
    descriptor: int,
    original_stat: os.stat_result,
    original_digest: bytes,
) -> None:
    current_path_stat = path.lstat()
    current_descriptor_stat = os.fstat(descriptor)
    if (
        stat.S_ISLNK(current_path_stat.st_mode)
        or not stat.S_ISREG(current_path_stat.st_mode)
        or _stable_metadata(current_path_stat) != _stable_metadata(original_stat)
        or _stable_metadata(current_descriptor_stat) != _stable_metadata(original_stat)
        or hashlib.sha256(_read_descriptor(descriptor)).digest() != original_digest
    ):
        raise EnvironmentUpdateError(
            "Production environment changed before atomic replacement."
        )


def update_production_environment(path: Path) -> None:
    descriptor, original_stat = _open_verified_target(path)
    try:
        original = _read_descriptor(descriptor)
        original_digest = hashlib.sha256(original).digest()
        validate_required_secrets(original)
        updated = render_updated_environment(original)
        temporary_descriptor = -1
        temporary_path: Path | None = None
        try:
            temporary_descriptor, temporary_name = tempfile.mkstemp(
                prefix=".env.production.circle-phase2.",
                suffix=".tmp",
                dir=path.parent,
            )
            temporary_path = Path(temporary_name)
            os.fchmod(temporary_descriptor, stat.S_IMODE(original_stat.st_mode))
            temporary_stat = os.fstat(temporary_descriptor)
            if (temporary_stat.st_uid, temporary_stat.st_gid) != (
                original_stat.st_uid,
                original_stat.st_gid,
            ):
                os.fchown(
                    temporary_descriptor,
                    original_stat.st_uid,
                    original_stat.st_gid,
                )
            with os.fdopen(temporary_descriptor, "wb", closefd=True) as destination:
                temporary_descriptor = -1
                destination.write(updated)
                destination.flush()
                os.fsync(destination.fileno())

            _assert_target_unchanged(
                path,
                descriptor,
                original_stat,
                original_digest,
            )
            os.replace(temporary_path, path)
            temporary_path = None
            directory_descriptor = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)
        finally:
            if temporary_descriptor >= 0:
                os.close(temporary_descriptor)
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
    finally:
        if fcntl is not None:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", type=Path, default=PRODUCTION_TARGET)
    arguments = parser.parse_args()
    update_production_environment(arguments.path)
    print("Circle phase-2 nonsecret production settings updated atomically.")


if __name__ == "__main__":
    main()
