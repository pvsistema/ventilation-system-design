"""
Выпуск аварийного ключа ПВ-Системы на своём компьютере — без сервера.

Нужен, когда облачные функции недоступны и выпустить ключ в админ-панели
нельзя. Ключ получается точно такой же, как из админ-панели: программа
проверяет его подпись сама, без интернета.

Что понадобится:
  1. Python 3.9+ (https://www.python.org/downloads/).
  2. Библиотека cryptography:   pip install cryptography
  3. Закрытый ключ — значение секрета «OFFLINE_KEY_PRIVATE» («Аварийный ключ»).

Запуск:   python make_offline_key.py
Скрипт задаст вопросы и выведет готовый ключ PVSO.… — его передают
пользователю, он вводит его в окне «Лицензия».

Закрытый ключ вводится скрыто, никуда не сохраняется и не отправляется.
"""
import base64
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from getpass import getpass

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
except ImportError:
    print("Не найдена библиотека cryptography. Установите её командой:")
    print("    pip install cryptography")
    input("\nНажмите Enter для выхода...")
    sys.exit(1)

# Публичный ключ, который зашит в программу. По нему скрипт проверяет, что
# введён правильный закрытый ключ: иначе ключ получится, но программа его
# не примет.
APP_PUBLIC_KEY = "MsyBGg0UlSyEns_shvQD_Ob82SJ-9Klds-naVhQl9hc"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def decode_private_key(s: str) -> bytes:
    """Принимает ключ в base64 (обычном или url-safe) или hex — как сервер."""
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
    raise ValueError("Закрытый ключ не распознан (ожидается base64 или hex).")


def ask(prompt: str, default: str = "") -> str:
    tail = f" [{default}]" if default else ""
    value = input(f"{prompt}{tail}: ").strip()
    return value or default


def make_key(sk: Ed25519PrivateKey, org: str, exp_iso: str, seats: int, fp: str) -> str:
    payload = {
        "org": org,
        "exp": exp_iso,
        "seats": int(seats),
        "iat": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if fp:
        payload["fp"] = fp
    payload_bytes = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    return f"PVSO.{b64url(payload_bytes)}.{b64url(sk.sign(payload_bytes))}"


def main() -> None:
    print("=== Выпуск аварийного ключа ПВ-Системы (без сервера) ===\n")

    priv = getpass("Закрытый ключ OFFLINE_KEY_PRIVATE (ввод скрыт): ").strip()
    if not priv:
        print("Ключ не введён.")
        return
    sk = Ed25519PrivateKey.from_private_bytes(decode_private_key(priv))
    pub = b64url(sk.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw))
    if pub != APP_PUBLIC_KEY:
        print("\nВНИМАНИЕ: этот закрытый ключ не подходит к программе —")
        print("выпущенный им ключ программа отклонит. Проверьте, что скопировано")
        print("значение секрета OFFLINE_KEY_PRIVATE целиком.")
        if ask("Всё равно продолжить? (да/нет)", "нет").lower() not in ("да", "y", "yes"):
            return
    else:
        print("Закрытый ключ подходит к программе.\n")

    while True:
        org = ask("Организация (будет видна в окне «Лицензия»)")
        if not org:
            print("Пустая строка — готово.")
            break

        default_exp = (datetime.now(timezone.utc) + timedelta(days=90)).strftime("%Y-%m-%d")
        exp_date = ask("Действует до (ГГГГ-ММ-ДД)", default_exp)
        try:
            exp = datetime.strptime(exp_date, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            print("Дата не распознана, нужен формат 2026-12-31.\n")
            continue
        if exp < datetime.now(timezone.utc):
            print("Дата уже прошла.\n")
            continue

        seats_s = ask("Число рабочих мест", "1")
        seats = int(seats_s) if seats_s.isdigit() and int(seats_s) > 0 else 1

        fp = ask("Код рабочего места (8 знаков из окна «Лицензия»; пусто — любой ПК)")
        fp = re.sub(r"[^0-9A-Za-z]", "", fp).upper()
        if fp and len(fp) != 8:
            print("Код рабочего места должен состоять из 8 знаков.\n")
            continue

        key = make_key(sk, org, exp.strftime("%Y-%m-%dT%H:%M:%SZ"), seats, fp)
        print("\n----- АВАРИЙНЫЙ КЛЮЧ -----")
        print(key)
        print("--------------------------")
        print(f"Организация: {org}; до {exp_date}; мест: {seats}; "
              f"{'только ПК ' + fp if fp else 'любой ПК'}")

        with open("выпущенные_ключи.txt", "a", encoding="utf-8") as f:
            f.write(f"{datetime.now():%Y-%m-%d %H:%M}\t{org}\tдо {exp_date}\t"
                    f"мест {seats}\t{fp or 'любой ПК'}\t{key}\n")
        print("Ключ также записан в файл «выпущенные_ключи.txt».\n")
        print("Следующий ключ — введите организацию, или Enter для выхода.\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nОшибка: {e}")
    input("\nНажмите Enter для выхода...")
