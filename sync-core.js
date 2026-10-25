
export function stable(value){if(value===undefined)return 'undefined';if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';return JSON.stringify(value);}
function equal(a,b){return stable(a)===stable(b);}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
const keyed={annualObligations:'id',paymentSchedule:'id',noticeImports:'id',inboxProcessingLog:'id',records:'id',trips:'id',categories:'name',links:'url',previewRows:'sourceKey',bankImports:'id',incomeRecords:'id',insuranceRecords:'id',taxPaymentRecords:'id'};
export function mergeRegisters(base,local,remote,choices={}){
const conflicts=[];const legacy=base===null;
function conflict(path,l,r){const key=JSON.stringify(path);if(choices[key]==='local')return l;if(choices[key]==='remote')return r;conflicts.push({key,path,local:l,remote:r});return r;}
function merge(b,l,r,path){
if(equal(l,r))return r;
if(!legacy&&equal(l,b))return r;
if(!legacy&&equal(r,b))return l;
const kind=path[path.length-1],identity=keyed[kind];
if(identity&&Array.isArray(l)&&Array.isArray(r)&&(!b||Array.isArray(b))){
const bm=new Map((b||[]).map(x=>[x[identity],x])),lm=new Map(l.map(x=>[x[identity],x])),rm=new Map(r.map(x=>[x[identity],x]));const result=[];
for(const id of new Set([...bm.keys(),...lm.keys(),...rm.keys()])){const v=merge(bm.get(id),lm.get(id),rm.get(id),[...path,id]);if(v!==undefined)result.push(v);}return result;
}
if(!legacy&&b===undefined&&l!==undefined&&r!==undefined&&path.length===2&&['records','trips','categories'].includes(path[0]))return conflict(path,l,r);
if(legacy&&path.length===2&&['records','trips','categories'].includes(path[0])){if(l===undefined)return r;if(object(l)&&object(r)&&Object.keys(l).every(key=>equal(l[key],r[key])))return r;return conflict(path,l,r);}
if(legacy){if(l===undefined)return r;if(r===undefined)return conflict(path,l,r);}
if(object(l)&&object(r)&&(object(b)||b===undefined)){
const result={};for(const key of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){const v=merge(b?.[key],l[key],r[key],[...path,key]);if(v!==undefined)result[key]=v;}return result;
}
return conflict(path,l,r);
}
return {data:merge(base??undefined,local,remote,[]),conflicts};
}
