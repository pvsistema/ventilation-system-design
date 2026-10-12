"use strict";
var import_zlib = require("zlib");
const loadLib = () => import("@mlightcad/libredwg-web");
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};
const USED_TYPES = /* @__PURE__ */ new Set([
  "LINE",
  "LWPOLYLINE",
  "POLYLINE",
  "POLYLINE2D",
  "POLYLINE3D",
  "CIRCLE",
  "TEXT",
  "MTEXT"
]);
const num = (v) => typeof v === "number" && isFinite(v) ? v : 0;
const fmt = (v) => !isFinite(v) || Math.abs(v) < 1e-9 ? "0" : v.toFixed(6).replace(/\.?0+$/, "") || "0";
function toDxf(entities) {
  const out = [];
  const pair = (c, v) => {
    out.push(String(c));
    out.push(typeof v === "number" ? fmt(v) : v);
  };
  pair(0, "SECTION");
  pair(2, "ENTITIES");
  let used = 0;
  for (const e of entities) {
    const type = e.type ?? "";
    if (!USED_TYPES.has(type)) continue;
    const layer = e.layer || "0";
    if (type === "LINE" && e.startPoint && e.endPoint) {
      pair(0, "LINE");
      pair(8, layer);
      pair(10, num(e.startPoint.x));
      pair(20, num(e.startPoint.y));
      pair(30, num(e.startPoint.z));
      pair(11, num(e.endPoint.x));
      pair(21, num(e.endPoint.y));
      pair(31, num(e.endPoint.z));
      used++;
      continue;
    }
    if (type.startsWith("POLYLINE") || type === "LWPOLYLINE") {
      const pts = e.vertices ?? [];
      if (pts.length < 2) continue;
      const closed = e.closed === true || ((e.flag ?? 0) & 1) === 1;
      pair(0, "LWPOLYLINE");
      pair(8, layer);
      pair(90, pts.length);
      pair(70, closed ? 1 : 0);
      for (const p of pts) {
        pair(10, num(p.x));
        pair(20, num(p.y));
        pair(30, p.z !== void 0 ? num(p.z) : num(e.elevation));
      }
      used++;
      continue;
    }
    if (type === "CIRCLE" && e.center) {
      pair(0, "CIRCLE");
      pair(8, layer);
      pair(10, num(e.center.x));
      pair(20, num(e.center.y));
      pair(30, num(e.center.z));
      pair(40, num(e.radius));
      used++;
      continue;
    }
    if ((type === "TEXT" || type === "MTEXT") && e.text) {
      const p = e.startPoint ?? e.insertionPoint ?? e.position;
      if (!p) continue;
      pair(0, type);
      pair(8, layer);
      pair(10, num(p.x));
      pair(20, num(p.y));
      pair(30, num(p.z));
      pair(1, e.text);
      used++;
    }
  }
  pair(0, "ENDSEC");
  pair(0, "EOF");
  return { dxf: out.join("\n"), used };
}
function reply(status, body) {
  return {
    statusCode: status,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}
exports.handler = async function handler(event, context) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") return reply(405, { error: "\u0422\u043E\u043B\u044C\u043A\u043E POST" });
  let payload = {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "{}";
    payload = JSON.parse(raw);
  } catch {
    return reply(400, { error: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0444\u043E\u0440\u043C\u0430\u0442 \u0437\u0430\u043F\u0440\u043E\u0441\u0430" });
  }
  if (!payload.file && !payload.fileGzip) return reply(400, { error: "\u0424\u0430\u0439\u043B \u043D\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u043D" });
  const bytes = payload.fileGzip ? (0, import_zlib.gunzipSync)(Buffer.from(payload.fileGzip, "base64")) : Buffer.from(payload.file, "base64");
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const import_libredwg_web = await loadLib();
  const lib = await import_libredwg_web.LibreDwg.create();
  let dwg;
  try {
    dwg = lib.dwg_read_data(buf, import_libredwg_web.Dwg_File_Type.DWG);
  } catch {
    dwg = void 0;
  }
  if (!dwg) {
    return reply(422, {
      error: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u0444\u0430\u0439\u043B DWG. \u0412\u043E\u0437\u043C\u043E\u0436\u043D\u043E, \u043E\u043D \u043F\u043E\u0432\u0440\u0435\u0436\u0434\u0451\u043D \u0438\u043B\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D \u0432 \u043D\u0435\u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043C\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0438. \u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0435 \u0447\u0435\u0440\u0442\u0451\u0436 \u0432 \u0444\u043E\u0440\u043C\u0430\u0442\u0435 DXF \u0438 \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u0443\u0439\u0442\u0435 \u0435\u0433\u043E."
    });
  }
  let version = "";
  try {
    const v = lib.dwg_get_version_type(dwg);
    version = v?.description || v?.hdr || v?.type || "";
  } catch {
    version = "";
  }
  const db = lib.convert(dwg);
  try {
    lib.dwg_free(dwg);
  } catch {
  }
  const entities = db?.entities ?? [];
  if (entities.length === 0) {
    return reply(422, {
      error: "\u0412 \u0447\u0435\u0440\u0442\u0435\u0436\u0435 DWG \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E \u043D\u0438 \u043E\u0434\u043D\u043E\u0433\u043E \u043E\u0431\u044A\u0435\u043A\u0442\u0430. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435, \u0447\u0442\u043E \u0441\u0445\u0435\u043C\u0430 \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0441\u044F \u0432 \u043F\u0440\u043E\u0441\u0442\u0440\u0430\u043D\u0441\u0442\u0432\u0435 \u043C\u043E\u0434\u0435\u043B\u0438, \u0430 \u043D\u0435 \u0432 \u043B\u0438\u0441\u0442\u0435."
    });
  }
  const { dxf, used } = toDxf(entities);
  if (used === 0) {
    return reply(422, {
      error: `\u0412 \u0447\u0435\u0440\u0442\u0435\u0436\u0435 \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043E ${entities.length} \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u0432, \u043D\u043E \u0441\u0440\u0435\u0434\u0438 \u043D\u0438\u0445 \u043D\u0435\u0442 \u043B\u0438\u043D\u0438\u0439 \u0438 \u043F\u043E\u043B\u0438\u043B\u0438\u043D\u0438\u0439 \u2014 \u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0441\u0445\u0435\u043C\u0443 \u043D\u0435 \u0438\u0437 \u0447\u0435\u0433\u043E.`
    });
  }
  return reply(200, {
    ok: true,
    version,
    total: entities.length,
    used,
    dxfGzip: (0, import_zlib.gzipSync)(Buffer.from(dxf, "utf8")).toString("base64")
  });
}
