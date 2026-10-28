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
    python sign_core.py <path-to-server.exe>   — подписать ядро
    python sign_core.py --check                — только проверить ключ
Результат: server.sig рядом с server.exe.
"""
import base64
import hashlib
import json
import os
import re
import sys
from getpass import getpass

# Библиотеку импортируем лениво: ранняя проверка ключа (--check) выполняется
# до установки зависимостей сборки, и обычный import на верхнем уровне ронял бы
# её с ImportError ещё до того, как сборка дошла бы до pip install.
def _crypto():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    return Ed25519PrivateKey, Encoding, PublicFormat

APP_PUBLIC_KEY = "MsyBGg0UlSyEns_shvQD_Ob82SJ-9Klds-naVhQl9hc"

# Подсказка печатается всякий раз, когда ключа нет или он не подошёл: без неё
# сборщик видел только «ключ не задан» и не знал, где его взять и куда вписать.
WHERE_TO_GET = r"""
    ГДЕ ВЗЯТЬ КЛЮЧ
      Это секрет проекта OFFLINE_KEY_PRIVATE («Аварийный ключ») на
      poehali.dev: откройте проект -> Секреты -> OFFLINE_KEY_PRIVATE ->
      скопируйте значение целиком. Тот же ключ используется скриптом
      tools/offline-key/make_offline_key.py для выпуска аварийных ключей.

    КАК ПЕРЕДАТЬ ЕГО СБОРКЕ (любой способ на выбор)
      1) Вставить его, когда сборка спросит ключ на шаге подписи ядра
         (правой кнопкой мыши по окну; вместо символов появятся
         звёздочки, даётся 3 попытки).
      2) На один сеанс, в том же окне командной строки:
             set OFFLINE_KEY_PRIVATE=<значение>
             desktop\csharp\build.bat
         Сборку нужно запускать из этого же окна, а не двойным щелчком.
      3) Навсегда (достаточно один раз), затем открыть НОВОЕ окно:
             setx OFFLINE_KEY_PRIVATE "<значение>"

    Ключ нигде не сохраняется и никуда не отправляется: им только
    подписывается server.exe на этом компьютере. Не храните его в файлах
    рядом с проектом и не передавайте по почте."""


def fail(*lines, hint: bool = True) -> None:
    """Печатает понятную причину и подсказку, затем выходит с кодом 1."""
    for line in lines:
        print(line)
    if hint:
        print(WHERE_TO_GET)
    sys.exit(1)


def read_masked(prompt: str) -> str:
    """Скрытый ввод, но с '*' на каждый символ: видно, что вставка сработала.

    Обычный getpass на Windows не показывает ничего - после вставки неясно,
    попал ли ключ в окно, и легко нажать Enter впустую.
    """
    if os.name != "nt":
        return getpass(prompt)
    import msvcrt
    sys.stdout.write(prompt)
    sys.stdout.flush()
    buf = []
    while True:
        ch = msvcrt.getwch()
        if ch in ("\r", "\n"):
            break
        if ch == "\x03":
            raise KeyboardInterrupt
        if ch in ("\x00", "\xe0"):
            msvcrt.getwch()
            continue
        if ch == "\b":
            if buf:
                buf.pop()
                sys.stdout.write("\b \b")
                sys.stdout.flush()
            continue
        if ch == "\x16":
            # Ctrl+V в старой консоли не вставляет текст, а даёт этот символ.
            sys.stdout.write("\n    Ctrl+V здесь не работает - вставьте ПРАВОЙ кнопкой мыши.\n")
            sys.stdout.write(prompt + "*" * len(buf))
            sys.stdout.flush()
            continue
        if ch < " ":
            continue
        buf.append(ch)
        sys.stdout.write("*")
        sys.stdout.flush()
    sys.stdout.write("\n")
    sys.stdout.flush()
    return "".join(buf)


ATTEMPTS = 3


def ask_key():
    """Ключ из переменной окружения, иначе - ввод с подсказкой и повторами."""
    priv = os.environ.get("OFFLINE_KEY_PRIVATE", "").strip()
    if priv:
        sk, err = check_key(priv)
        if sk is None:
            fail("ERROR: ключ из переменной OFFLINE_KEY_PRIVATE не подошёл.", *err)
        return sk

    print()
    print("    Для подписи расчётного ядра нужен закрытый ключ OFFLINE_KEY_PRIVATE.")
    print("    Переменная окружения OFFLINE_KEY_PRIVATE не задана.")
    print(WHERE_TO_GET)
    print()
    print("    Вставка: правой кнопкой мыши по окну (или Ctrl+Shift+V / Ctrl+V).")
    print("    Вместо символов ключа появятся звёздочки - так и должно быть.")
    for attempt in range(1, ATTEMPTS + 1):
        print()
        try:
            priv = read_masked(f"    Ключ (попытка {attempt} из {ATTEMPTS}), затем Enter: ").strip()
        except (EOFError, KeyboardInterrupt):
            priv = ""
            print()
            break
        if not priv:
            print("    Ничего не вставлено. Скопируйте значение секрета и вставьте ещё раз.")
            continue
        print(f"    Получено символов: {len(priv)}")
        sk, err = check_key(priv)
        if sk is not None:
            print("    Ключ подходит.")
            return sk
        for line in err:
            print(line)

    fail("ERROR: закрытый ключ не введён или не подошёл - server.exe НЕ подписан.",
         "       PVS.exe откажется запускать неподписанное ядро.")


def check_key(priv: str):
    """(ключ, None) если подходит, иначе (None, [строки с причиной])."""
    try:
        Ed25519PrivateKey, Encoding, PublicFormat = _crypto()
    except ImportError:
        fail("ERROR: не установлена библиотека cryptography - подписать ядро нечем.",
             "       Установите зависимости сборки:",
             "           python -m pip install -r desktop\\csharp\\requirements-build.txt",
             hint=False)
    try:
        sk = Ed25519PrivateKey.from_private_bytes(decode_private_key(priv))
    except Exception:
        return None, ["    Это не похоже на закрытый ключ: ожидается строка в base64 или hex.",
                      "    Скопируйте значение секрета целиком, без лишних символов."]
    pub = b64url(sk.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw))
    if pub != APP_PUBLIC_KEY:
        return None, ["    Этот ключ не подходит к программе - подписанное им ядро PVS.exe отвергнет.",
                      "    Чаще всего значение скопировано не полностью или взят другой секрет."]
    return sk, None


def load_key(priv: str):
    sk, err = check_key(priv)
    if sk is None:
        fail("ERROR: закрытый ключ не подошёл.", *err)
    return sk


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
        print("Usage: python sign_core.py <server.exe> | --check")
        sys.exit(1)

    # --check: проверка ключа ДО долгой компиляции ядра. Раньше неверный ключ
    # всплывал только в самом конце - после 5-20 минут работы Nuitka.
    if sys.argv[1] == "--check":
        priv = os.environ.get("OFFLINE_KEY_PRIVATE", "").strip()
        if not priv:
            # Ключа нет - это НЕ ошибка: его спросят на шаге подписи.
            print("    OFFLINE_KEY_PRIVATE не задана - ключ будет запрошен при подписи ядра.")
            print(WHERE_TO_GET)
            return
        try:
            _crypto()
        except ImportError:
            # Ранняя проверка идёт ДО установки зависимостей сборки: убедиться
            # в подлинности ключа пока нечем, сверим его на шаге подписи.
            print("    Ключ задан; проверка подлинности - на шаге подписи ядра.")
            return
        load_key(priv)
        print("    Ключ подписи ядра на месте и подходит к программе.")
        return

    exe = os.path.abspath(sys.argv[1])
    if not os.path.exists(exe):
        print(f"ERROR: {exe} not found")
        sys.exit(1)

    sk = ask_key()

    h = hashlib.sha256()
    with open(exe, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    digest = h.hexdigest()
    sig = b64url(sk.sign(digest.encode("ascii")))

    sig_path = os.path.join(os.path.dirname(exe), "server.sig")
    with open(sig_path, "w", encoding="ascii") as f:
        json.dump({"sha256": digest, "sig": sig}, f)
    print(f"    Подписано: sha256={digest}")
    print(f"    Файл подписи: {sig_path}")


if __name__ == "__main__":
    main()
