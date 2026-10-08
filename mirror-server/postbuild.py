"""
Доводит собранный сайт (dist/index.html) до полной автономности:
  • убирает служебные скрипты poehali.dev (при аварии они не загрузятся
    и тормозили бы открытие страницы);
  • фоновый детектор версий направляет на /api/app-version зеркала;
  • иконку сайта берёт из локального файла.
Вызывается из build_site.sh автоматически.
"""
import os
import re
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DIST = os.path.join(ROOT, "dist")
INDEX = os.path.join(DIST, "index.html")


def main() -> int:
    if not os.path.isfile(INDEX):
        print("dist/index.html не найден — сначала соберите сайт")
        return 1
    html = open(INDEX, encoding="utf-8").read()

    # Служебные скрипты платформы
    html = re.sub(r'\s*<script[^>]+src="https://cdn\.poehali\.dev/intertnal/[^"]+"[^>]*></script>', "", html)
    # Детектор версий
    html = re.sub(r'var VERSION_URL = "https://functions\.poehali\.dev/[^"]+";',
                  'var VERSION_URL = "/api/app-version";', html)

    # Иконка — локальной копией
    m = re.search(r'href="(https://cdn\.poehali\.dev/[^"]+favicon[^"]+)"', html)
    if m:
        try:
            with urllib.request.urlopen(m.group(1), timeout=20) as r:
                open(os.path.join(DIST, "favicon-pvs.png"), "wb").write(r.read())
            html = html.replace(m.group(1), "/favicon-pvs.png")
        except Exception as ex:  # noqa: BLE001
            print("иконка не скачана (не критично):", ex)

    open(INDEX, "w", encoding="utf-8").write(html)
    left = re.findall(r"https://functions\.poehali\.dev/[\w-]+", html)
    print("index.html подготовлен для зеркала", "(остались ссылки: %s)" % left if left else "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
