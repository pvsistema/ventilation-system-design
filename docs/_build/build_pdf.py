"""Сборка PDF комплекта для реестра: docs/*.md -> public/reestr/*.pdf + ZIP.
Запуск: pip install --target=/tmp/pylibs markdown && PYTHONPATH=/tmp/pylibs python3 docs/_build/build_pdf.py
"""
import glob, os, subprocess, zipfile, html
import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, "docs")
OUT = os.path.join(ROOT, "public", "reestr")
TMP = "/tmp/pdfbuild"
FILES = ["00_ШПАРГАЛКА_ЗАПОЛНЕНИЯ_ЗАЯВКИ", "01_ИНСТРУКЦИЯ_ПО_УСТАНОВКЕ", "02_ФУНКЦИОНАЛЬНЫЕ_ХАРАКТЕРИСТИКИ",
         "03_ЖИЗНЕННЫЙ_ЦИКЛ_И_ПОДДЕРЖКА", "04_РУКОВОДСТВО_ПО_ЭКСПЛУАТАЦИИ", "05_ТЕХНИЧЕСКАЯ_ДОКУМЕНТАЦИЯ",
         "06_ШАБЛОНЫ_СПРАВОК", "ОПИСЬ_КОМПЛЕКТА"]
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
pre { background: #f4f4f4; border: 0.6pt solid #999; padding: 6pt; white-space: pre-wrap; font-size: 9.5pt; font-family: 'Noto Sans Mono', monospace; }
code { font-family: 'Noto Sans Mono', monospace; font-size: 9.5pt; }
blockquote { border-left: 2pt solid #999; margin: 6pt 0; padding: 2pt 8pt; color: #222; }
hr { border: 0; border-top: 0.6pt solid #999; margin: 10pt 0; }
ul, ol { margin: 4pt 0 4pt 18pt; padding: 0; }
li { margin: 1pt 0; }
"""

def build(name: str):
    md = open(os.path.join(DOCS, name + ".md"), encoding="utf-8").read()
    body = markdown.markdown(md, extensions=["tables", "fenced_code", "sane_lists"])
    os.makedirs(TMP, exist_ok=True)
    h = os.path.join(TMP, name + ".html")
    open(h, "w", encoding="utf-8").write(
        f"<!doctype html><html lang='ru'><head><meta charset='utf-8'><title>{html.escape(name)}</title>"
        f"<style>{CSS}</style></head><body>{body}</body></html>")
    pdf = os.path.join(OUT, name + ".pdf")
    subprocess.run(["timeout", "90", "chromium", "--headless", "--no-sandbox", "--disable-gpu",
                    "--disable-dev-shm-usage", "--no-pdf-header-footer", "--virtual-time-budget=5000",
                    "--timeout=30000", f"--print-to-pdf={pdf}", "file://" + h],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return pdf

if __name__ == "__main__":
    import pypdf
    os.makedirs(OUT, exist_ok=True)
    for n in FILES:
        p = build(n)
        print(n, len(pypdf.PdfReader(p).pages), "стр")
    z = os.path.join(OUT, "ПВ-Система_комплект_для_реестра_РФ.zip")
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for n in FILES:
            zf.write(os.path.join(OUT, n + ".pdf"), n + ".pdf")
    print("zip", round(os.path.getsize(z) / 1048576, 2), "MB")
