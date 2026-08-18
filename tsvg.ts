import { generateSvg } from "@/lib/svgExporter";
const nodes:any=[{id:"n1",x:0,y:0,z:0},{id:"n2",x:100,y:0,z:0}];
const branches:any=[{id:"b1",fromId:"n1",toId:"n2",area:12,flow:23.5,velocity:2,
 hasFan:true,fanName:"ZVN 1-9-55",fanPressure:1950,fanShaftPower:54000,fanEfficiency:0.69,
 fanType:"ВМП",fanReverse:false,lineWidth:2,
 indicators:{fanNameInd:true,fanFlow:true,fanPressure:true,fanShaftPower:true,fanEfficiency:true}}];
const symbols:any=[{id:"s1",typeId:"fan",x:50,y:0,branchId:"b1",t:0.5}];
const svg=generateSvg({nodes,branches,horizons:[],horizonMap:new Map(),
 proj:{}as any,viewState:{scale:1,offsetX:0,offsetY:0,azimuth:0,elevation:0},
 zScale:1,is3D:false,canvasW:800,canvasH:600,schemaSymbols:symbols} as any);
const has=(t:string)=>svg.includes(t)?"ЕСТЬ":"НЕТ ";
console.log(has("ZVN 1-9-55"),"название");
console.log(has("Qв="),"расход");
console.log(has("Нв="),"давление");
console.log(has("Nв="),"мощность");
console.log(has("ηв="),"КПД");
const m=svg.match(/<rect[^>]*fill="#2563eb"[^>]*>/);
console.log(m?"ЕСТЬ синяя плашка":"НЕТ плашки");
