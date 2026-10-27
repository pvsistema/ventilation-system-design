"""
Подготовка расчётного ядра к компиляции Nuitka.

Зачем. Раньше ядро упаковывалось PyInstaller в байт-код (.pyc), который
бесплатные утилиты распаковывают и переводят обратно в читаемый Python за
минуты. Nuitka переводит Python в C и компилирует в машинный код: исходного
кода и байт-кода в server.exe нет, восстановить логику (формулы и проверку
лицензии) можно только дизассемблированием машинного кода.

Nuitka включает в сборку только модули, найденные по import. Расчётные функции
ядро загружало по пути к файлу (backend_functions/<имя>/index.py) — такие
файлы Nuitka не видит. Поэтому раскладываем всё в одну плоскую папку:

    server.py, calc_*.py, server_entry.py   — само ядро
    bf_airflow.py, bf_rescue_calculator.py… — index.py каждой функции
    license_guard.py, solver.py, vgsch.py…  — их соседние модули
    dist/                                   — собранный интерфейс

и печатаем список модулей для --include-module.

Использование:
    python prepare_core.py <core_dir> <backend_dir> <entry_py> <out_dir>
"""
import filecmp
import os
import shutil
import sys

FUNCTIONS = ["airflow", "rescue-calculator", "water-hydraulics",
             "explosion-calculator", "aerodynamics"]
SKIP_FILES = {"tests.json", "requirements.txt"}


def main():
    if len(sys.argv) != 5:
        print("Usage: python prepare_core.py <core_dir> <backend_dir> <entry_py> <out_dir>")
        sys.exit(1)
    core, backend, entry, out = (os.path.abspath(a) for a in sys.argv[1:])

    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)

    modules = []

    for name in os.listdir(core):
        src = os.path.join(core, name)
        if name.endswith(".py"):
            shutil.copy2(src, os.path.join(out, name))
            if name != "server.py":
                modules.append(name[:-3])
    if not os.path.exists(os.path.join(out, "server.py")):
        print(f"ERROR: server.py not found in {core}")
        sys.exit(1)

    dist = os.path.join(core, "dist")
    if not os.path.exists(os.path.join(dist, "index.html")):
        print("ERROR: frontend build not found: " + os.path.join(dist, "index.html"))
        print("       Build the UI first (step 1) and copy dist-desktop there.")
        sys.exit(1)
    shutil.copytree(dist, os.path.join(out, "dist"))

    shutil.copy2(entry, os.path.join(out, "server_entry.py"))

    for fn in FUNCTIONS:
        fdir = os.path.join(backend, fn)
        index = os.path.join(fdir, "index.py")
        if not os.path.exists(index):
            print(f"ERROR: {index} not found")
            sys.exit(1)
        mod = "bf_" + fn.replace("-", "_")
        shutil.copy2(index, os.path.join(out, mod + ".py"))
        modules.append(mod)

        for name in os.listdir(fdir):
            if not name.endswith(".py") or name == "index.py" or name in SKIP_FILES:
                continue
            src = os.path.join(fdir, name)
            dst = os.path.join(out, name)
            if os.path.exists(dst):
                # Общий модуль (license_guard.py лежит копией в каждой функции).
                # Все копии обязаны совпадать — иначе одна из функций получила
                # бы чужую версию проверки лицензии.
                if not filecmp.cmp(src, dst, shallow=False):
                    print(f"ERROR: {fn}/{name} differs from another function's copy.")
                    print("       Shared modules must be identical in all functions.")
                    sys.exit(1)
                continue
            shutil.copy2(src, dst)
            modules.append(name[:-3])

    if "license_guard" not in modules:
        print("ERROR: license_guard.py not found - core would refuse every calculation")
        sys.exit(1)

    modules = sorted(set(modules))
    with open(os.path.join(out, "modules.txt"), "w", encoding="ascii") as f:
        f.write("\n".join(modules))
    print(f"Prepared core for Nuitka: {out}")
    print("Modules: " + ", ".join(modules))


if __name__ == "__main__":
    main()