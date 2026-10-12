// Запуск облачной функции dwg-convert на резервном сервере.
// Вход: событие запроса (JSON) через stdin. Выход: строка-маркер + ответ функции.
const path = require("path");
const { handler } = require(path.join(__dirname, "..", "backend", "dwg-convert", "index.js"));

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", async () => {
  try {
    const result = await handler(JSON.parse(input || "{}"), {});
    process.stdout.write("\n@@PVS_RESULT@@" + JSON.stringify(result));
  } catch (e) {
    process.stdout.write("\n@@PVS_RESULT@@" + JSON.stringify({
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ error: String((e && e.message) || e).slice(0, 300) }),
    }));
  }
});
