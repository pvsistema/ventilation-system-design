"""Сборка PDF комплекта для реестра: docs/*.md -> public/reestr/*.pdf + ZIP.
Запуск: pip install --target=/tmp/pylibs markdown && PYTHONPATH=/tmp/pylibs python3 docs/_build/build_pdf.py
"""
import glob, os, re, subprocess, zipfile, html, json, urllib.request
import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, "docs")
OUT = os.path.join(ROOT, "public", "reestr")
TMP = "/tmp/pdfbuild"
FILES = ["00_ШПАРГАЛКА_ЗАПОЛНЕНИЯ_ЗАЯВКИ", "01_ИНСТРУКЦИЯ_ПО_УСТАНОВКЕ", "02_ФУНКЦИОНАЛЬНЫЕ_ХАРАКТЕРИСТИКИ",
         "03_ЖИЗНЕННЫЙ_ЦИКЛ_И_ПОДДЕРЖКА", "04_РУКОВОДСТВО_ПО_ЭКСПЛУАТАЦИИ", "05_ТЕХНИЧЕСКАЯ_ДОКУМЕНТАЦИЯ",
         "06_ШАБЛОНЫ_СПРАВОК", "07_ХРАНЕНИЕ_ИСХОДНОГО_ТЕКСТА", "08_ЛИЦЕНЗИОННЫЕ_КЛЮЧИ",
         "11_ИНСТРУКЦИЯ_ДЛЯ_ЭКСПЕРТА", "ОПИСЬ_КОМПЛЕКТА"]
# На сайт (public/reestr) — только документы для эксперта. Документы 07, 08, 11
# (адрес, ключ эксперта) — во внутреннюю папку docs/private/reestr.
PRIVATE = {"00_ШПАРГАЛКА_ЗАПОЛНЕНИЯ_ЗАЯВКИ", "06_ШАБЛОНЫ_СПРАВОК", "07_ХРАНЕНИЕ_ИСХОДНОГО_ТЕКСТА",
           "08_ЛИЦЕНЗИОННЫЕ_КЛЮЧИ", "11_ИНСТРУКЦИЯ_ДЛЯ_ЭКСПЕРТА", "ОПИСЬ_КОМПЛЕКТА"}
PRIVATE_OUT = os.path.join(ROOT, "docs", "private", "reestr")
# ── Номер версии берётся из программы, а не вписывается в документы руками ──
# В .md стоят метки {{VERSION}}, {{BUILD_DATE}}, {{EXE_SHA256}}. При сборке они
# заменяются значениями из src/lib/appVersion.ts (единый источник версии) и
# контрольной суммой опубликованного установщика (функция app-version).
VERSION_URL = "https://functions.poehali.dev/0ddfea8a-386f-4cb2-9fe0-37274caf2e16"


def read_app_version() -> dict:
    src = open(os.path.join(ROOT, "src", "lib", "appVersion.ts"), encoding="utf-8").read()
    ver = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', src).group(1)
    date = re.search(r'APP_BUILD_DATE\s*=\s*"([^"]+)"', src).group(1)
    vals = {"VERSION": ver, "BUILD_DATE": date, "EXE_SHA256": ""}
    try:
        with urllib.request.urlopen(VERSION_URL, timeout=30) as r:
            pub = json.loads(r.read().decode("utf-8"))
        if pub.get("version") == ver:
            vals["EXE_SHA256"] = pub.get("exe_sha256", "")
        else:
            print(f"ВНИМАНИЕ: в программе версия {ver}, а опубликован установщик "
                  f"{pub.get('version')}. Сначала опубликуйте установщик этой версии.")
    except Exception as e:
        print(f"ВНИМАНИЕ: не удалось получить контрольную сумму установщика: {e}")
    if not vals["EXE_SHA256"]:
        vals["EXE_SHA256"] = "(контрольная сумма будет указана после публикации установщика)"
    return vals


VALUES = read_app_version()


def fill(md: str) -> str:
    for k, v in VALUES.items():
        md = md.replace("{{" + k + "}}", v)
    left = re.findall(r"\{\{[A-Z_0-9]+\}\}", md)
    if left:
        raise SystemExit(f"Неизвестные метки в документе: {sorted(set(left))}")
    return md


CSS = """
@page { size: A4; margin: 20mm 15mm 20mm 25mm; }
body { font-family: 'Noto Serif', 'Times New Roman', serif; font-size: 11pt; line-height: 1.45; color: #000; }
h1 { font-size: 15pt; text-align: center; margin: 0 0 10pt; }
h2 { font-size: 13pt; margin: 16pt 0 6pt; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; page-break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 10pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { border: 0.6pt solid #000; padding: 3pt 5pt; vertical-align: top; text-align: left; }
th { background: #eee; }
thead tr:has(th:empty:first-child):has(th:empty:last-child) { display: none; }
pre { background: #f4f4f4; border: 0.6pt solid #999; padding: 6pt; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-all; font-size: 9.5pt; font-family: 'Noto Sans Mono', monospace; }
code { font-family: 'Noto Sans Mono', monospace; font-size: 9.5pt; }
blockquote { border-left: 2pt solid #999; margin: 6pt 0; padding: 2pt 8pt; color: #222; }
hr { border: 0; border-top: 0.6pt solid #999; margin: 10pt 0; }
ul, ol { margin: 4pt 0 4pt 18pt; padding: 0; }
li { margin: 1pt 0; }
"""

def build(name: str):
    md = fill(open(os.path.join(DOCS, name + ".md"), encoding="utf-8").read())
    body = markdown.markdown(md, extensions=["tables", "fenced_code", "sane_lists"])
    os.makedirs(TMP, exist_ok=True)
    h = os.path.join(TMP, name + ".html")
    open(h, "w", encoding="utf-8").write(
        f"<!doctype html><html lang='ru'><head><meta charset='utf-8'><title>{html.escape(name)}</title>"
        f"<style>{CSS}</style></head><body>{body}</body></html>")
    pdf = os.path.join(PRIVATE_OUT if name in PRIVATE else OUT, name + ".pdf")
    subprocess.run(["timeout", "90", "chromium", "--headless", "--no-sandbox", "--disable-gpu",
                    "--disable-dev-shm-usage", "--no-pdf-header-footer", "--virtual-time-budget=5000",
                    "--timeout=30000", f"--print-to-pdf={pdf}", "file://" + h],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return pdf

if __name__ == "__main__":
    import pypdf
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PRIVATE_OUT, exist_ok=True)
    print("Версия", VALUES["VERSION"], "от", VALUES["BUILD_DATE"])
    for n in FILES:
        p = build(n)
        print(n, len(pypdf.PdfReader(p).pages), "стр")
    # Полный комплект — только во внутренней папке, на сайт не попадает.
    z = os.path.join(PRIVATE_OUT, "ПВ-Система_комплект_для_реестра_РФ.zip")
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for n in FILES:
            zf.write(os.path.join(PRIVATE_OUT if n in PRIVATE else OUT, n + ".pdf"), n + ".pdf")
    print("zip", round(os.path.getsize(z) / 1048576, 2), "MB")
