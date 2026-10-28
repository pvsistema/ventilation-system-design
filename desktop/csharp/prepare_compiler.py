"""
Подготовка компилятора C для Nuitka (MinGW64 от winlibs) — надёжно.

Зачем. Если на машине нет Visual Studio C++, Nuitka сама скачивает MinGW64 —
архив почти 380 МБ с GitHub. Встроенный загрузчик Nuitka качает его одним
запросом, без докачки: при обрыве связи, прокси или проверке антивирусом
архив оказывается неполным, Nuitka пишет «Problem with the downloaded zip
file, deleting it» и удаляет его — каждая новая попытка начинается с нуля.

Этот скрипт:
  * пропускает всё, если установлен Visual Studio C++ (Nuitka возьмёт его);
  * качает архив с ДОКАЧКОЙ (продолжает с места обрыва, до 20 попыток);
  * проверяет целостность архива перед распаковкой;
  * распаковывает ровно туда, где Nuitka ищет компилятор, и Nuitka больше
    ничего не скачивает;
  * если GitHub недоступен — подсказывает, как скачать архив браузером.

Папка кэша Nuitka задаётся короткой (NUITKA_CACHE_DIR), чтобы длинные пути
внутри архива не упирались в ограничение Windows в 260 символов.

Использование:
    python prepare_compiler.py <nuitka_cache_dir>
"""
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

# Ровно та сборка MinGW, которую ожидает Nuitka 2.8.x (nuitka/utils/Download.py).
# При обновлении Nuitka сверить URL с getCachedDownloadedMinGW64().
URL = ("https://github.com/brechtsanders/winlibs_mingw/releases/download/"
       "14.2.0posix-19.1.1-12.0.0-msvcrt-r2/"
       "winlibs-x86_64-posix-seh-gcc-14.2.0-llvm-19.1.1-mingw-w64msvcrt-12.0.0-r2.zip")
ZIP_NAME = URL.rsplit("/", 1)[1]
SPECIFICITY = URL.rsplit("/", 2)[1]
EXPECTED_SIZE = 378510354
GCC_REL = os.path.join("mingw64", "bin", "gcc.exe")

ATTEMPTS = 20
CHUNK = 1024 * 1024


def target_dir(cache_dir: str) -> str:
    # Путь повторяет логику Nuitka: <cache>/downloads/gcc/x86_64/<версия>/
    return os.path.join(cache_dir, "downloads", "gcc", "x86_64", SPECIFICITY)


def long_path(p: str) -> str:
    """Префикс \\\\?\\ снимает ограничение Windows в 260 символов на путь."""
    p = os.path.abspath(p)
    if os.name == "nt" and not p.startswith("\\\\?\\"):
        return "\\\\?\\" + p
    return p


def has_msvc() -> bool:
    """Установлен ли Visual Studio C++ — тогда MinGW не нужен вовсе."""
    if os.name != "nt":
        return False
    pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    vswhere = os.path.join(pf86, "Microsoft Visual Studio", "Installer", "vswhere.exe")
    if not os.path.exists(vswhere):
        return False
    try:
        out = subprocess.run(
            # Только VS 2022 (17.x) и новее: для Python 3.11+ Nuitka отвергает
            # более старый компилятор и всё равно уходит на MinGW.
            [vswhere, "-latest", "-products", "*", "-version", "[17.0,",
             "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
             "-property", "installationPath"],
            capture_output=True, text=True, timeout=30,
        ).stdout.strip()
        return bool(out)
    except Exception:
        return False


def manual_hint(zip_path: str) -> None:
    print()
    print("    КАК ОБОЙТИСЬ БЕЗ АВТОЗАГРУЗКИ")
    print("      Вариант 1. Скачайте архив браузером по ссылке:")
    print("        " + URL)
    print("      и положите его (не распаковывая) вот сюда:")
    print("        " + zip_path)
    print("      Затем запустите сборку ещё раз - она возьмёт готовый файл.")
    print()
    print("      Вариант 2. Установите Visual Studio Build Tools 2022")
    print("        https://visualstudio.microsoft.com/visual-cpp-build-tools/")
    print("      с компонентом \"Разработка классических приложений на C++\".")
    print("      Тогда MinGW не нужен: Nuitka возьмёт компилятор Visual Studio.")
    print()


def download(zip_path: str) -> bool:
    """Качает архив с докачкой. True — файл полный."""
    part = zip_path + ".part"
    # Полный архив, положенный вручную, используем как есть.
    if os.path.exists(zip_path) and os.path.getsize(zip_path) == EXPECTED_SIZE:
        return True
    if os.path.exists(zip_path):
        os.replace(zip_path, part)

    for attempt in range(1, ATTEMPTS + 1):
        have = os.path.getsize(part) if os.path.exists(part) else 0
        if have > EXPECTED_SIZE:
            os.remove(part)
            have = 0
        if have == EXPECTED_SIZE:
            break
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": "PVS-build"})
            if have:
                req.add_header("Range", f"bytes={have}-")
            with urllib.request.urlopen(req, timeout=60) as r:
                # Сервер проигнорировал Range — начинаем файл заново.
                mode = "ab" if (have and r.status == 206) else "wb"
                if mode == "wb":
                    have = 0
                with open(part, mode) as f:
                    last = -1
                    while True:
                        chunk = r.read(CHUNK)
                        if not chunk:
                            break
                        f.write(chunk)
                        have += len(chunk)
                        pct = have * 100 // EXPECTED_SIZE
                        if pct // 5 != last:
                            last = pct // 5
                            print(f"      {pct:3d}%  {have // (1024 * 1024)} / "
                                  f"{EXPECTED_SIZE // (1024 * 1024)} MB", flush=True)
        except Exception as e:
            print(f"      Обрыв загрузки ({e}). Попытка {attempt}/{ATTEMPTS}, "
                  f"продолжаю с {have // (1024 * 1024)} MB...", flush=True)
            time.sleep(min(30, 3 * attempt))
            continue

    if os.path.exists(part) and os.path.getsize(part) == EXPECTED_SIZE:
        os.replace(part, zip_path)
        return True
    return False


def extract(zip_path: str, dest: str) -> None:
    """Распаковка во временную папку и перенос на место — без полуготовых копий."""
    tmp = dest + ".tmp"
    if os.path.exists(tmp):
        shutil.rmtree(long_path(tmp), ignore_errors=True)
    with zipfile.ZipFile(zip_path) as z:
        bad = z.testzip()
        if bad is not None:
            raise zipfile.BadZipFile(f"повреждён файл внутри архива: {bad}")
        z.extractall(long_path(tmp))
    src = os.path.join(tmp, "mingw64")
    dst = os.path.join(dest, "mingw64")
    if os.path.exists(dst):
        shutil.rmtree(long_path(dst), ignore_errors=True)
    os.replace(long_path(src), long_path(dst))
    shutil.rmtree(long_path(tmp), ignore_errors=True)


def main():
    if len(sys.argv) != 2:
        print("Usage: python prepare_compiler.py <nuitka_cache_dir>")
        sys.exit(1)
    cache_dir = os.path.abspath(sys.argv[1])

    if has_msvc():
        print("    Найден Visual Studio C++ - Nuitka использует его, MinGW не нужен.")
        return

    dest = target_dir(cache_dir)
    gcc = os.path.join(dest, GCC_REL)
    if os.path.exists(gcc):
        print("    Компилятор MinGW64 уже подготовлен: " + gcc)
        return

    os.makedirs(dest, exist_ok=True)
    zip_path = os.path.join(dest, ZIP_NAME)

    print("    Visual Studio C++ не найден - готовлю компилятор MinGW64 (~380 MB, один раз).")
    print("    Загрузка с докачкой: при обрыве продолжит с того же места.")
    if not download(zip_path):
        print()
        print("ERROR: архив компилятора не удалось скачать полностью.")
        print("       Частая причина - GitHub заблокирован прокси или антивирусом.")
        manual_hint(zip_path)
        sys.exit(1)

    print("    Проверяю и распаковываю архив (1-3 минуты)...")
    try:
        extract(zip_path, dest)
    except zipfile.BadZipFile as e:
        print(f"ERROR: архив компилятора повреждён ({e}).")
        print("       Удаляю его - при следующем запуске сборка скачает заново.")
        try:
            os.remove(zip_path)
        except OSError:
            pass
        manual_hint(zip_path)
        sys.exit(1)
    except OSError as e:
        print(f"ERROR: не удалось распаковать компилятор: {e}")
        print("       Чаще всего файлы блокирует антивирус. Добавьте папку")
        print("         " + cache_dir)
        print("       в исключения антивируса и запустите сборку ещё раз")
        print("       (архив уже скачан, второй раз качать не придётся).")
        sys.exit(1)

    if not os.path.exists(gcc):
        print("ERROR: после распаковки не найден " + gcc)
        sys.exit(1)

    # Архив больше не нужен: Nuitka проверяет наличие gcc.exe, а не zip.
    try:
        os.remove(zip_path)
    except OSError:
        pass
    print("    OK: компилятор MinGW64 готов.")


if __name__ == "__main__":
    main()
