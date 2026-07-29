#!/usr/bin/env python3
"""Atomically install the fixed, public hackathon waiver expiry."""

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
WAIVER_KEY = b"LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL"
WAIVER_VALUE = b"2026-08-07T16:59:00Z"
ASSIGNMENT_PATTERN = re.compile(
    rb"^[ \t]*(?:export[ \t]+)?" + re.escape(WAIVER_KEY) + rb"[ \t]*="
)


class EnvironmentUpdateError(RuntimeError):
    """Raised before replacing an unsafe or inconsistent target."""


def _validate_value(value: bytes) -> None:
    if value != WAIVER_VALUE:
        raise EnvironmentUpdateError("Unexpected hackathon waiver value.")


def render_updated_environment(original: bytes, value: bytes = WAIVER_VALUE) -> bytes:
    """Set only the managed assignment while preserving all other bytes."""
    _validate_value(value)
    matches = 0
    output = bytearray()
    newline = b"\r\n" if b"\r\n" in original else b"\n"

    for line in original.splitlines(keepends=True):
        if not ASSIGNMENT_PATTERN.match(line):
            output.extend(line)
            continue

        matches += 1
        if matches > 1:
            raise EnvironmentUpdateError("Duplicate hackathon waiver assignment.")
        line_ending = b"\r\n" if line.endswith(b"\r\n") else (
            b"\n" if line.endswith(b"\n") else b""
        )
        output.extend(WAIVER_KEY + b"=" + value + line_ending)

    if matches == 0:
        if output and not output.endswith((b"\n", b"\r")):
            output.extend(newline)
        output.extend(WAIVER_KEY + b"=" + value + newline)

    return bytes(output)


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
    if stat.S_ISLNK(initial_path_stat.st_mode) or not stat.S_ISREG(initial_path_stat.st_mode):
        raise EnvironmentUpdateError("Production environment must be a regular non-symlink file.")

    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        if fcntl is not None:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        elif os.name == "posix":
            raise EnvironmentUpdateError("Exclusive production environment locking is unavailable.")
        target_stat = os.fstat(descriptor)
        path_stat = path.lstat()
        if (
            not stat.S_ISREG(target_stat.st_mode)
            or stat.S_ISLNK(path_stat.st_mode)
            or not stat.S_ISREG(path_stat.st_mode)
            or (path_stat.st_dev, path_stat.st_ino) != (target_stat.st_dev, target_stat.st_ino)
        ):
            raise EnvironmentUpdateError("Production environment changed while opening it.")
    except BlockingIOError as error:
        os.close(descriptor)
        raise EnvironmentUpdateError("Production environment is locked by another updater.") from error
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
    path_stat = path.lstat()
    descriptor_stat = os.fstat(descriptor)
    if (
        stat.S_ISLNK(path_stat.st_mode)
        or not stat.S_ISREG(path_stat.st_mode)
        or _stable_metadata(path_stat) != _stable_metadata(original_stat)
        or _stable_metadata(descriptor_stat) != _stable_metadata(original_stat)
        or hashlib.sha256(_read_descriptor(descriptor)).digest() != original_digest
    ):
        raise EnvironmentUpdateError("Production environment changed before atomic replacement.")


def update_production_environment(path: Path) -> None:
    descriptor, original_stat = _open_verified_target(path)
    try:
        original = _read_descriptor(descriptor)
        original_digest = hashlib.sha256(original).digest()
        updated = render_updated_environment(original)
        temporary_descriptor = -1
        temporary_path: Path | None = None
        try:
            temporary_descriptor, temporary_name = tempfile.mkstemp(
                prefix=".env.production.hackathon-waiver.",
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
                os.fchown(temporary_descriptor, original_stat.st_uid, original_stat.st_gid)

            with os.fdopen(temporary_descriptor, "wb", closefd=True) as destination:
                temporary_descriptor = -1
                destination.write(updated)
                destination.flush()
                os.fsync(destination.fileno())

            _assert_target_unchanged(path, descriptor, original_stat, original_digest)
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


if __name__ == "__main__":
    main()
