#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string] $SshTarget,

    [string] $RemoteEnvPath = '/opt/bounty-escrow/.env.production',

    [switch] $ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Test-SshTarget {
    param([Parameter(Mandatory)][string] $Value)

    if ($Value.StartsWith('-') -or $Value -notmatch '^[A-Za-z0-9_.@:\[\]-]+$') {
        throw 'SshTarget must be a single SSH host or user@host value and must not contain options.'
    }
}

function Test-RemoteEnvPath {
    param([Parameter(Mandatory)][string] $Value)

    # Keep this credential writer confined to the deployment directory and env-shaped files.
    if ($Value -notmatch '^/opt/bounty-escrow/\.env(?:\.[A-Za-z0-9_-]+)*$') {
        throw 'RemoteEnvPath must be an absolute .env* file directly under /opt/bounty-escrow.'
    }
}

function ConvertFrom-SecureAscii {
    param(
        [Parameter(Mandatory)][Security.SecureString] $Secret,
        [Parameter(Mandatory)][string] $Name,
        [switch] $Hex64
    )

    if ($Secret.Length -eq 0) {
        throw "$Name must not be empty."
    }

    if ($Hex64 -and $Secret.Length -ne 64) {
        throw "$Name must contain exactly 64 hexadecimal characters."
    }

    $pointer = [IntPtr]::Zero
    $bytes = [byte[]]::new($Secret.Length)

    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Secret)

        for ($index = 0; $index -lt $Secret.Length; $index++) {
            $codePoint = [Runtime.InteropServices.Marshal]::ReadInt16($pointer, $index * 2)

            if ($codePoint -eq 0 -or $codePoint -eq 10 -or $codePoint -eq 13) {
                throw "$Name must not contain NUL, CR, or LF characters."
            }

            if ($codePoint -gt 127) {
                throw "$Name must contain ASCII characters only."
            }

            $isHex = (
                ($codePoint -ge 48 -and $codePoint -le 57) -or
                ($codePoint -ge 65 -and $codePoint -le 70) -or
                ($codePoint -ge 97 -and $codePoint -le 102)
            )

            $isApiTokenCharacter = (
                ($codePoint -ge 48 -and $codePoint -le 57) -or
                ($codePoint -ge 65 -and $codePoint -le 90) -or
                ($codePoint -ge 97 -and $codePoint -le 122) -or
                $codePoint -in 43, 45, 46, 47, 58, 61, 95
            )

            if (($Hex64 -and -not $isHex) -or (-not $Hex64 -and -not $isApiTokenCharacter)) {
                $expected = if ($Hex64) {
                    'exactly 64 hexadecimal characters'
                }
                else {
                    'only letters, digits, and the token characters + - . / : = _'
                }
                throw "$Name must contain $expected."
            }

            $bytes[$index] = [byte] $codePoint
        }

        return $bytes
    }
    catch {
        [Array]::Clear($bytes)
        throw
    }
    finally {
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pointer)
        }
    }
}

function Write-LengthPrefixedSecret {
    param(
        [Parameter(Mandatory)][IO.Stream] $Stream,
        [Parameter(Mandatory)][byte[]] $Value
    )

    $length = $Value.Length
    $header = [byte[]] @(
        (($length -shr 24) -band 0xff),
        (($length -shr 16) -band 0xff),
        (($length -shr 8) -band 0xff),
        ($length -band 0xff)
    )

    $Stream.Write($header, 0, $header.Length)
    $Stream.Write($Value, 0, $Value.Length)
}

Test-SshTarget -Value $SshTarget
Test-RemoteEnvPath -Value $RemoteEnvPath

$apiKeySecure = $null
$entitySecretSecure = $null
$apiKeyBytes = $null
$entitySecretBytes = $null

try {
    $apiKeySecure = Read-Host 'CIRCLE_API_KEY' -AsSecureString
    $entitySecretSecure = Read-Host `
        'CIRCLE_ENTITY_SECRET (64 hexadecimal characters)' `
        -AsSecureString

    $apiKeyBytes = ConvertFrom-SecureAscii -Secret $apiKeySecure -Name 'CIRCLE_API_KEY'
    $entitySecretBytes = ConvertFrom-SecureAscii `
        -Secret $entitySecretSecure `
        -Name 'CIRCLE_ENTITY_SECRET' `
        -Hex64

    if ($ValidateOnly) {
        Write-Output 'Validation passed. No SSH connection was made and no file was changed.'
        return
    }

    $remotePython = @'
import datetime
import os
from pathlib import Path
import re
import stat
import struct
import sys
import tempfile

ROOT = Path("/opt/bounty-escrow")
KEYS = (b"CIRCLE_API_KEY", b"CIRCLE_ENTITY_SECRET")
LINE_PATTERNS = tuple(
    re.compile(rb"^[ \t]*" + re.escape(key) + rb"[ \t]*=") for key in KEYS
)


def fail(message):
    raise RuntimeError(message)


def read_exact(size):
    chunks = []
    remaining = size
    while remaining:
        chunk = sys.stdin.buffer.read(remaining)
        if not chunk:
            fail("Secret input ended unexpectedly.")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_secret(name, max_size):
    size = struct.unpack(">I", read_exact(4))[0]
    if size == 0 or size > max_size:
        fail(f"{name} has an invalid length.")
    value = read_exact(size)
    if b"\x00" in value or b"\r" in value or b"\n" in value:
        fail(f"{name} contains a forbidden control character.")
    return value


def main():
    if len(sys.argv) != 2:
        fail("Expected one remote environment path.")

    env_path = Path(sys.argv[1])
    if (
        not env_path.is_absolute()
        or env_path.parent != ROOT
        or not re.fullmatch(r"\.env(?:\.[A-Za-z0-9_-]+)*", env_path.name)
    ):
        fail("Remote environment path is outside the allowed deployment scope.")

    api_key = read_secret("CIRCLE_API_KEY", 4096)
    entity_secret = read_secret("CIRCLE_ENTITY_SECRET", 64)
    if sys.stdin.buffer.read(1):
        fail("Unexpected trailing secret input.")

    if not re.fullmatch(rb"[A-Za-z0-9_+./:=-]+", api_key):
        fail("CIRCLE_API_KEY contains unsupported characters.")
    if not re.fullmatch(rb"[0-9A-Fa-f]{64}", entity_secret):
        fail("CIRCLE_ENTITY_SECRET must contain exactly 64 hexadecimal characters.")

    path_stat = env_path.lstat()
    if stat.S_ISLNK(path_stat.st_mode) or not stat.S_ISREG(path_stat.st_mode):
        fail("Remote environment path must be an existing regular file, not a symlink.")
    if env_path.resolve(strict=True).parent != ROOT.resolve(strict=True):
        fail("Resolved remote environment path escaped the deployment directory.")

    original = env_path.read_bytes()
    newline = b"\r\n" if b"\r\n" in original else b"\n"
    replacements = dict(zip(KEYS, (api_key, entity_secret)))
    seen = set()
    output = bytearray()

    for line in original.splitlines(keepends=True):
        matching_index = next(
            (index for index, pattern in enumerate(LINE_PATTERNS) if pattern.match(line)),
            None,
        )
        if matching_index is None:
            output.extend(line)
            continue

        key = KEYS[matching_index]
        if key not in seen:
            line_ending = b"\r\n" if line.endswith(b"\r\n") else b"\n"
            output.extend(key + b"=" + replacements[key] + line_ending)
            seen.add(key)

    if output and not output.endswith((b"\n", b"\r")):
        output.extend(newline)
    for key in KEYS:
        if key not in seen:
            output.extend(key + b"=" + replacements[key] + newline)

    backup_dir = ROOT / ".env-backups"
    if backup_dir.exists() or backup_dir.is_symlink():
        backup_stat = backup_dir.lstat()
        if stat.S_ISLNK(backup_stat.st_mode) or not stat.S_ISDIR(backup_stat.st_mode):
            fail("Backup location is not a regular directory.")
    else:
        backup_dir.mkdir(mode=0o700)
    os.chmod(backup_dir, 0o700)

    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = backup_dir / f"{env_path.name}.{timestamp}.{os.getpid()}.bak"
    backup_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        backup_flags |= os.O_NOFOLLOW
    backup_descriptor = os.open(backup_path, backup_flags, 0o600)
    try:
        with os.fdopen(backup_descriptor, "wb", closefd=True) as backup_file:
            backup_descriptor = -1
            backup_file.write(original)
            backup_file.flush()
            os.fsync(backup_file.fileno())
    finally:
        if backup_descriptor >= 0:
            os.close(backup_descriptor)

    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{env_path.name}.", suffix=".tmp", dir=ROOT
    )
    temporary_path = Path(temporary_name)

    try:
        os.fchmod(file_descriptor, 0o600)
        try:
            os.fchown(file_descriptor, path_stat.st_uid, path_stat.st_gid)
        except PermissionError:
            if os.geteuid() != path_stat.st_uid:
                fail("Cannot preserve the existing environment file owner.")

        with os.fdopen(file_descriptor, "wb", closefd=True) as temporary_file:
            file_descriptor = -1
            temporary_file.write(output)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())

        os.replace(temporary_path, env_path)
        os.chmod(env_path, 0o600)
        directory_fd = os.open(ROOT, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if file_descriptor >= 0:
            os.close(file_descriptor)
        temporary_path.unlink(missing_ok=True)

    final_lines = env_path.read_bytes().splitlines()
    for key, pattern in zip(KEYS, LINE_PATTERNS):
        if sum(1 for line in final_lines if pattern.match(line)) != 1:
            fail(f"Redacted presence check failed for {key.decode('ascii')}.")

    print("Updated CIRCLE_API_KEY=<redacted> and CIRCLE_ENTITY_SECRET=<redacted>.")
    print(f"Environment: {env_path}")
    print(f"Backup: {backup_path}")
    print("API container was not restarted.")


try:
    main()
except Exception as error:
    print(f"Circle secret update failed: {error}", file=sys.stderr)
    sys.exit(1)
'@

    $remoteScriptBase64 = [Convert]::ToBase64String(
        [Text.Encoding]::UTF8.GetBytes($remotePython)
    )
    $remoteCommand = "python3 -c `"import base64;exec(base64.b64decode('$remoteScriptBase64'))`" '$RemoteEnvPath'"
    $ssh = Get-Command 'ssh' -CommandType Application -ErrorAction Stop

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $ssh.Source
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.ArgumentList.Add('-T')
    $startInfo.ArgumentList.Add('-o')
    $startInfo.ArgumentList.Add('BatchMode=yes')
    $startInfo.ArgumentList.Add('-o')
    $startInfo.ArgumentList.Add('StrictHostKeyChecking=yes')
    $startInfo.ArgumentList.Add('--')
    $startInfo.ArgumentList.Add($SshTarget)
    $startInfo.ArgumentList.Add($remoteCommand)

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo

    if (-not $process.Start()) {
        throw 'Failed to start ssh.'
    }

    $standardOutputTask = $process.StandardOutput.ReadToEndAsync()
    $standardErrorTask = $process.StandardError.ReadToEndAsync()

    try {
        Write-LengthPrefixedSecret -Stream $process.StandardInput.BaseStream -Value $apiKeyBytes
        Write-LengthPrefixedSecret -Stream $process.StandardInput.BaseStream -Value $entitySecretBytes
        $process.StandardInput.BaseStream.Flush()
    }
    finally {
        $process.StandardInput.Close()
    }

    $process.WaitForExit()
    $standardOutput = $standardOutputTask.GetAwaiter().GetResult()
    $standardError = $standardErrorTask.GetAwaiter().GetResult()

    if ($process.ExitCode -ne 0) {
        if ($standardError) {
            [Console]::Error.Write($standardError)
        }
        throw "Remote update failed with SSH exit code $($process.ExitCode)."
    }

    if ($standardOutput) {
        [Console]::Out.Write($standardOutput)
    }
    if ($standardError) {
        [Console]::Error.Write($standardError)
    }
}
finally {
    if ($null -ne $apiKeyBytes) {
        [Array]::Clear($apiKeyBytes)
    }
    if ($null -ne $entitySecretBytes) {
        [Array]::Clear($entitySecretBytes)
    }
    if ($null -ne $apiKeySecure) {
        $apiKeySecure.Dispose()
    }
    if ($null -ne $entitySecretSecure) {
        $entitySecretSecure.Dispose()
    }
}
