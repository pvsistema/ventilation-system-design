"""
Подпись расчётного ядра (server.exe) при сборке.

PVS.exe при КАЖДОМ запуске сверяет server.exe с файлом server.sig рядом с ним:
считает SHA-256 файла и проверяет, что эта сумма подписана нашим закрытым
ключом Ed25519 (тот же ключ, что подписывает лицензии и обновления). Изменённое
ядро, например с вырезанной проверкой лицензии, не запустится.

Закрытый ключ — значение секрета OFFLINE_KEY_PRIVATE. Берётся из переменной
окружения OFFLINE_KEY_PRIVATE, а если её нет — спрашивается скрытым вводом.
Ключ никуда не сохраняется.

Использование:
    python sign_core.py <path-to-server.exe>
Результат: server.sig рядом с server.exe.
"""
import base64
import hashlib
import json
import os
import re
import sys
from getpass import getpass

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

APP_PUBLIC_KEY = "MsyBGg0UlSyEns_shvQD_Ob82SJ-9Klds-naVhQl9hc"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def decode_private_key(s: str) -> bytes:
    conv = s.replace("-", "+").replace("_", "/")
    b64chars = re.sub(r"[^A-Za-z0-9+/]", "", conv).rstrip("=")
    try:
        raw = base64.b64decode(b64chars + "=" * (-len(b64chars) % 4))
        if len(raw) >= 32:
            return raw[:32]
    except Exception:
        pass
    try:
        raw = bytes.fromhex(re.sub(r"[^0-9a-fA-F]", "", s))
        if len(raw) >= 32:
            return raw[:32]
    except Exception:
        pass
    raise ValueError("private key not recognized (base64 or hex expected)")


def main():
    if len(sys.argv) != 2:
        print("Usage: python sign_core.py <server.exe>")
        sys.exit(1)
    exe = os.path.abspath(sys.argv[1])
    if not os.path.exists(exe):
        print(f"ERROR: {exe} not found")
        sys.exit(1)

    priv = os.environ.get("OFFLINE_KEY_PRIVATE", "").strip()
    if not priv:
        print("    Private key OFFLINE_KEY_PRIVATE is needed to sign server.exe.")
        priv = getpass("    Paste it here (input is hidden) and press Enter: ").strip()
    if not priv:
        print("ERROR: private key not provided - server.exe is NOT signed.")
        sys.exit(1)

    try:
        sk = Ed25519PrivateKey.from_private_bytes(decode_private_key(priv))
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
    pub = b64url(sk.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw))
    if pub != APP_PUBLIC_KEY:
        print("ERROR: this private key does not match the app public key.")
        print("       PVS.exe would reject the core. Copy OFFLINE_KEY_PRIVATE completely.")
        sys.exit(1)

    h = hashlib.sha256()
    with open(exe, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    digest = h.hexdigest()
    sig = b64url(sk.sign(digest.encode("ascii")))

    sig_path = os.path.join(os.path.dirname(exe), "server.sig")
    with open(sig_path, "w", encoding="ascii") as f:
        json.dump({"sha256": digest, "sig": sig}, f)
    print(f"    Signed: sha256={digest}")
    print(f"    Signature file: {sig_path}")


if __name__ == "__main__":
    main()
