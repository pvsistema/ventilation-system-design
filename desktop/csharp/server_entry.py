"""
ПВ-Система — точка входа Flask-сервера для C#-обёртки.
Запускается как server.exe, диалоги сохранения файлов — через C# (не tkinter).

Ядро компилируется Nuitka в машинный код: модуль server и расчётные функции
(bf_<имя>) уже внутри server.exe, отдельных файлов рядом нет.
"""
import os
import sys


def _add_legacy_core_path():
    """Запуск из исходников: ядро лежит в соседней папке pvs-core."""
    if globals().get("__compiled__") is not None:
        return
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (os.path.join(here, "pvs-core"),
                 os.path.join(os.path.dirname(here), "pywebview", "pvs-core")):
        if os.path.isdir(path) and path not in sys.path:
            sys.path.insert(0, path)


if __name__ == "__main__":
    _add_legacy_core_path()
    import importlib
    server = importlib.import_module("server")
    server.app.run(host="127.0.0.1", port=5173, threaded=True, debug=False, use_reloader=False)
