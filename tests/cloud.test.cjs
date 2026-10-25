const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function setup(fetchImpl){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',className:'',disabled:false,hidden:false});return nodes.get(id);};
 const storage=new Map();const ctx=vm.createContext({
 console,URL,JSON,Date,Error,encodeURIComponent,setTimeout,clearTimeout,
 PublicClientApplication:class{async acquireTokenSilent(){return{accessToken:'TEST'}}},InteractionRequiredAuthError:class extends Error{},
 location:{origin:'https://example.org',pathname:'/Steuerraum/'},document:{getElementById:node},
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 window:{addEventListener(){}},fetch:fetchImpl,confirm:()=>false,prompt:()=>null,
 data:{records:[],categories:[]},year:'2025',validate:x=>x,money:n=>String(n),render:()=>{},
 persist(next){ctx.data=next;return true;}
 });
 let source=fs.readFileSync('cloud-entry.js','utf8').replace(/^import .*;\n/,'').replace(/\ninit\(\);\s*$/,'');
 vm.runInContext(source,ctx);
 vm.runInContext("cloudAccount={homeAccountId:'test',username:'test@example.org'};configuredPath='private/folder';initializing=false;authReady=true;",ctx);
 return{ctx,node};
}
test('folder paths encode special characters and reject traversal',()=>{
 const {ctx}=setup();assert.equal(vm.runInContext("configuredPath='Some Folder/Taxes';filePath()",ctx),'/me/drive/root:/Some%20Folder/Taxes/register-2025.json');
 assert.throws(()=>vm.runInContext("pathParts('a/../b')",ctx));
});
test('Graph requests use authenticated fixed origin',async()=>{
 let call;const {ctx}=setup(async(url,options)=>{call={url,options};return{ok:true};});
 await vm.runInContext("graph('/me/drive')",ctx);assert.equal(call.url,'https://graph.microsoft.com/v1.0/me/drive');assert.equal(call.options.headers.Authorization,'Bearer TEST');
});
test('conflicting cloud version prevents upload and preserves local data',async()=>{
 const calls=[];const {ctx,node}=setup(async(url,options)=>{calls.push(options.method||'GET');return{ok:true,json:async()=>({eTag:'newer'})};});
 vm.runInContext("cloudFile='file';etag='older';baseline='old';data={records:[{id:'local'}],categories:[]};",ctx);
 await vm.runInContext('saveCloud()',ctx);
 assert.deepEqual(calls,['GET']);assert.equal(vm.runInContext('conflict',ctx),true);assert.equal(ctx.data.records[0].id,'local');assert.match(node('cloudStatus').textContent,/змінився/);
});
test('save sends expected version and only marks confirmed payload saved',async()=>{
 const calls=[];const {ctx}=setup(async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({eTag:options.method==='PUT'?'v2':'v1'})};});
 vm.runInContext("cloudFile='file';etag='v1';baseline='old';data={records:[{id:'local'}],categories:[]};",ctx);
 await vm.runInContext('saveCloud()',ctx);
 assert.equal(calls.length,2);assert.equal(calls[1].options.headers['If-Match'],'v1');assert.equal(JSON.parse(calls[1].options.body).records[0].id,'local');assert.equal(vm.runInContext('etag',ctx),'v2');assert.equal(vm.runInContext('dirty',ctx),false);
});

test('signed-in account and confirmed cloud data show clear sync status',()=>{
 const {ctx,node}=setup();
 vm.runInContext("cloudFile='file';baseline=JSON.stringify(data);lastCloudEvent={kind:'load',at:new Date()};controls()",ctx);
 assert.equal(node('cloudLogin').hidden,true);
 assert.equal(node('cloudLogout').hidden,false);
 assert.match(node('cloudIdentity').textContent,/Ви увійшли.*test@example.org/);
 assert.equal(node('storage').textContent,'✓ Синхронізовано з OneDrive');
 assert.match(node('cloudTimestamp').textContent,/Останнє завантаження/);
});
test('signed out local copy is never shown as cloud synchronized',()=>{
 const {ctx,node}=setup();
 vm.runInContext("cloudAccount=null;authReady=false;cloudFile=null;controls()",ctx);
 assert.equal(node('cloudLogin').hidden,false);
 assert.equal(node('cloudLogout').hidden,true);
 assert.match(node('cloudIdentity').textContent,/Ви не увійшли/);
 assert.match(node('storage').textContent,/Лише локальна копія/);
});
test('signed in without loaded register is distinct from synchronized',()=>{
 const {ctx,node}=setup();
 vm.runInContext('controls()',ctx);
 assert.equal(node('storage').textContent,'Вхід виконано — реєстр не завантажено');
 assert.equal(node('cloudSave').disabled,true);
});
test('expired session exposes re-login and removes connected indicator',async()=>{
 const {ctx,node}=setup();
 vm.runInContext("cloudFile='file';baseline=JSON.stringify(data);client.acquireTokenSilent=async()=>{throw new InteractionRequiredAuthError('expired')}",ctx);
 await assert.rejects(vm.runInContext('token()',ctx));
 assert.equal(node('cloudLogin').hidden,false);
 assert.equal(node('cloudLogin').textContent,'Повторно увійти через Microsoft');
 assert.match(node('cloudIdentity').textContent,/Потрібен повторний вхід/);
 assert.equal(node('storage').textContent,'Потрібен повторний вхід');
 assert.equal(node('cloudSave').disabled,true);
});
test('failed save keeps dirty local data and does not claim cloud success',async()=>{
 const {ctx,node}=setup(async()=>({ok:false,status:503}));
 vm.runInContext("cloudFile='file';etag='v1';baseline='old';data={records:[{id:'local'}],categories:[]};",ctx);
 await vm.runInContext('saveCloud()',ctx);
 assert.equal(vm.runInContext('dirty',ctx),true);
 assert.equal(node('storage').textContent,'Не збережено в OneDrive');
 assert.equal(ctx.data.records[0].id,'local');
 assert.equal(vm.runInContext('lastCloudEvent',ctx),null);
});
test('pending edits do not keep the green synchronized badge',()=>{
 const {ctx,node}=setup();
 vm.runInContext("cloudFile='file';baseline=JSON.stringify(data);dirty=true;controls()",ctx);
 assert.equal(node('storage').textContent,'Очікує збереження в OneDrive');
 assert.doesNotMatch(node('storage').className,/isConnected/);
});
test('hidden buttons and mobile status cannot be overridden by base CSS',()=>{
 const css=fs.readFileSync('style.css','utf8');
 assert.match(css,/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
 assert.match(css,/header #storage\{display:inline-block/);
});
