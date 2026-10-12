"use strict";
const zlib = require("zlib");
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};
function reply(status, body) {
  return { statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
// Экономный перевод: читаем из чертежа только слои и нужные объекты модели
// (линии, полилинии, окружности, подписи), без полной копии чертежа в памяти.
const T={TEXT:1,POLY2D:15,POLY3D:16,CIRCLE:18,LINE:19,MTEXT:44,LAYER:51,LWPOLY:77};
const num=v=>typeof v==="number"&&isFinite(v)?v:0;
const fmt=v=>!isFinite(v)||Math.abs(v)<1e-9?"0":v.toFixed(6).replace(/\.?0+$/,"")||"0";
async function convert(buf){
  const m=await import("@mlightcad/libredwg-web");
  const lib=await m.LibreDwg.create();
  let dwg; try{dwg=lib.dwg_read_data(buf,m.Dwg_File_Type.DWG);}catch{dwg=undefined}
  if(!dwg) return {error:"read"};
  try{ lib.decoder=new TextDecoder(m.dwgCodePageToEncoding(lib.dwg_get_codepage(dwg))); }catch{}
  let version=""; try{const v=lib.dwg_get_version_type(dwg); version=v?.description||v?.hdr||v?.type||"";}catch{}
  const w=lib.wasmInstance;
  const get=(tio,f)=>{try{return lib.dwg_dynapi_entity_data(tio,f)}catch{return undefined}};
  const n=w.dwg_get_num_objects(dwg);
  const layers=new Map();
  for(let i=0;i<n;i++){const o=w.dwg_get_object(dwg,i); if(!o||w.dwg_object_get_fixedtype(o)!==T.LAYER) continue;
    const tio=w.dwg_object_to_object_tio(o); if(!tio) continue;
    try{layers.set(String(lib.dwg_object_get_handle_object(o).value), get(tio,"name")||"0");}catch{}}
  const ents=lib.dwg_getall_entities_in_model_space(dwg);
  const out=[]; const pair=(c,v)=>{out.push(String(c));out.push(typeof v==="number"?fmt(v):String(v));};
  pair(0,"SECTION");pair(2,"ENTITIES");
  let used=0;
  for(const o of ents){
    const t=w.dwg_object_get_fixedtype(o);
    if(![T.TEXT,T.POLY2D,T.POLY3D,T.CIRCLE,T.LINE,T.MTEXT,T.LWPOLY].includes(t)) continue;
    const e=w.dwg_object_to_entity(o), tio=w.dwg_object_to_entity_tio(o);
    if(!e||!tio) continue;
    let layer="0"; try{layer=layers.get(String(lib.dwg_object_entity_get_layer_object_ref(e).handleref.value))||"0";}catch{}
    if(t===T.LINE){const s=get(tio,"start"),en=get(tio,"end"); if(!s||!en) continue;
      pair(0,"LINE");pair(8,layer);pair(10,num(s.x));pair(20,num(s.y));pair(30,num(s.z));pair(11,num(en.x));pair(21,num(en.y));pair(31,num(en.z));used++;continue;}
    if(t===T.LWPOLY){const np=get(tio,"num_points")||0; const pts=np?lib.dwg_ptr_to_point2d_array(get(tio,"points"),np):[]; if(pts.length<2) continue;
      const flag=get(tio,"flag")||0, el=num(get(tio,"elevation"));
      pair(0,"LWPOLYLINE");pair(8,layer);pair(90,pts.length);pair(70,flag&1?1:0);
      for(const p of pts){pair(10,num(p.x));pair(20,num(p.y));pair(30,el);} used++;continue;}
    if(t===T.POLY2D||t===T.POLY3D){
      const vs=(t===T.POLY2D?lib.dwg_entity_polyline_2d_get_vertices(o):lib.dwg_entity_polyline_3d_get_vertices(o))??[];
      if(vs.length<2) continue; const flag=get(tio,"flag")||0, el=num(get(tio,"elevation"));
      pair(0,"LWPOLYLINE");pair(8,layer);pair(90,vs.length);pair(70,flag&1?1:0);
      for(const v of vs){const p=v.point||{}; pair(10,num(p.x));pair(20,num(p.y));pair(30,p.z!==undefined?num(p.z):el);} used++;continue;}
    if(t===T.CIRCLE){const c=get(tio,"center"); if(!c) continue;
      pair(0,"CIRCLE");pair(8,layer);pair(10,num(c.x));pair(20,num(c.y));pair(30,num(c.z));pair(40,num(get(tio,"radius")));used++;continue;}
    if(t===T.TEXT||t===T.MTEXT){const tx=get(tio,t===T.TEXT?"text_value":"text"); const p=get(tio,"ins_pt"); if(!tx||!p) continue;
      pair(0,t===T.TEXT?"TEXT":"MTEXT");pair(8,layer);pair(10,num(p.x));pair(20,num(p.y));pair(30,num(p.z));pair(1,tx);used++;}
  }
  pair(0,"ENDSEC");pair(0,"EOF");
  try{lib.dwg_free(dwg)}catch{}
  return {version,total:ents.length,used,dxf:out.join("\n")};
}

/**
 * Переводит чертёж DWG в текст DXF на сервере.
 * Вход: POST { fileGzip | file: base64 }. Выход: { dxfGzip, version, total, used }.
 */
exports.handler = async function handler(event, context) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return reply(405, { error: "Только POST" });
  let payload;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "{}";
    payload = JSON.parse(raw);
  } catch {
    return reply(400, { error: "Неверный формат запроса" });
  }
  if (!payload || (!payload.file && !payload.fileGzip)) return reply(400, { error: "Файл не передан" });
  const bytes = payload.fileGzip
    ? zlib.gunzipSync(Buffer.from(payload.fileGzip, "base64"))
    : Buffer.from(payload.file, "base64");
  payload = null;
  event.body = "";
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const r = await convert(buf);
  if (r.error) {
    return reply(422, { error: "Не удалось прочитать файл DWG. Возможно, он повреждён или сохранён в неподдерживаемой версии. Сохраните чертёж в формате DXF и импортируйте его." });
  }
  if (r.total === 0) {
    return reply(422, { error: "В чертеже DWG не найдено ни одного объекта. Проверьте, что схема находится в пространстве модели, а не в листе." });
  }
  if (r.used === 0) {
    return reply(422, { error: `В чертеже прочитано ${r.total} объектов, но среди них нет линий и полилиний — строить схему не из чего.` });
  }
  return reply(200, {
    ok: true, version: r.version, total: r.total, used: r.used,
    dxfGzip: zlib.gzipSync(Buffer.from(r.dxf, "utf8")).toString("base64")
  });
};
