
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const clone=x=>JSON.parse(JSON.stringify(x));
const row=(id,amount=1000)=>({id,date:'2024-01-02',amount,category:'Example',description:'Example '+id,company:'Example',links:[]});
const reg=rows=>({records:rows,categories:[],trips:[],closedYears:{}});
function setup(fetchImpl){
 const nodes=new Map(),storage=new Map(),timers=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',className:'',disabled:false,hidden:false,open:false,showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
 let uid=0;const events={};const ctx=vm.createContext({
 console,URL,JSON,Date,Error,encodeURIComponent,crypto:{randomUUID:()=>String(++uid)},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},
 PublicClientApplication:class{async acquireTokenSilent(){return{accessToken:'TEST'};}async initialize(){}async handleRedirectPromise(){return null;}getActiveAccount(){return {homeAccountId:'test',username:'test@example.org'};}setActiveAccount(){}getAllAccounts(){return[];}},
 InteractionRequiredAuthError:class extends Error{},
 location:{origin:'https://example.org',pathname:'/Steuerraum/'},document:{getElementById:node,querySelectorAll:()=>[]},
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 window:{addEventListener:(event,fn)=>events[event]=fn},fetch:fetchImpl,confirm:()=>false,prompt:()=>null,
 data:reg([]),year:'2024',validate:x=>x,money:n=>String(n),render:()=>{},
 persist(next){ctx.data=next;return true;}
 });
 vm.runInContext(fs.readFileSync('sync-core.js','utf8').replace(/^export /gm,''),ctx);
 vm.runInContext(fs.readFileSync('features.js','utf8'),ctx);
 const source=fs.readFileSync('cloud-entry.js','utf8').replace(/^import .*;\n/gm,'').replace(/\ninit\(\);\s*$/,'');
 vm.runInContext(source,ctx);
 vm.runInContext("cloudAccount={homeAccountId:'test',username:'test@example.org'};configuredPath='private/folder';initializing=false;authReady=true;",ctx);
 return {ctx,node,storage,timers,events};
}
function server(remote){
 const state={remote:clone(remote),etag:'v1',calls:[],backups:[],writes:[],race:false,failBackup:false,failPut:false};
 state.fetch=async(url,options={})=>{
 const method=options.method||'GET';state.calls.push({url,options});
 const response=(json,status=200)=>({ok:status<400,status,json:async()=>clone(json)});
 if(url.startsWith('https://download.example/'))return response(state.remote);
 if(url.includes('/_recovery'))return response({id:'recovery'});
 if(method==='PUT'&&url.includes('/items/recovery:')){if(state.failBackup)return response({},503);state.backups.push(JSON.parse(options.body));return response({id:'backup'});}
 if(method==='PUT'&&url.endsWith('/items/file/content')){
 if(state.failPut)return response({},503);
 if(state.race){state.race=false;state.etag='v2';state.remote.records.push(row('racing'));return response({},412);}
 if(options.headers['If-Match']!==state.etag)return response({},412);
 state.writes.push(JSON.parse(options.body));state.remote=JSON.parse(options.body);state.etag+='n';return response({id:'file',eTag:state.etag});
 }
 return response({id:'file',eTag:state.etag,size:100,'@microsoft.graph.downloadUrl':'https://download.example/register'});
 };return state;
}
function pending(ctx,local,base=null){ctx.local=clone(local);ctx.base=base===null?null:clone(base);vm.runInContext("data=local;baseline=base?JSON.stringify(base):null;dirty=true;cloudFile='file';etag='v1';",ctx);}
test('folder paths encode special characters and reject traversal',()=>{const {ctx}=setup();assert.equal(vm.runInContext("configuredPath='Some Folder/Taxes';filePath()",ctx),'/me/drive/root:/Some%20Folder/Taxes/register-2025.json');assert.throws(()=>vm.runInContext("pathParts('a/../b')",ctx));});
test('Graph requests use authenticated fixed origin',async()=>{let call;const {ctx}=setup(async(url,options)=>{call={url,options};return{ok:true};});await ctx.graph('/me/drive');assert.equal(call.url,'https://graph.microsoft.com/v1.0/me/drive');assert.equal(call.options.headers.Authorization,'Bearer TEST');});
test('stale pending flag clears automatically when local data equals OneDrive',async()=>{const data=reg([row('a')]),s=server(data),{ctx,storage}=setup(s.fetch);pending(ctx,data);storage.set('steuerraum-cloud-test-dirty','1');await ctx.loadCloud();assert.equal(vm.runInContext('dirty',ctx),false);assert.equal(storage.has('steuerraum-cloud-test-dirty'),false);assert.equal(s.writes.length,0);assert.equal(s.backups.length,0);});
test('legacy differing versions get automatic cloud backup and concrete conflict',async()=>{const remote=reg([row('a',2000)]),s=server(remote),{ctx,node}=setup(s.fetch);pending(ctx,reg([row('a',1500)]));await ctx.saveCloud();assert.equal(s.backups.length,1);assert.equal(s.backups[0].local.records[0].amount,1500);assert.equal(s.backups[0].remote.records[0].amount,2000);assert.equal(s.writes.length,0);assert.equal(ctx.data.records[0].amount,1500);assert.equal(vm.runInContext('conflict',ctx),true);assert.equal(node('syncConflict').open,true);assert.match(node('syncConflicts').innerHTML,/1500/);assert.doesNotMatch(node('cloudStatus').textContent,/JSON/);});
test('automatic recovery preserves cloud additions alongside unrelated local edits',async()=>{const base=reg([row('a')]),local=clone(base),remote=clone(base);local.records[0].amount=1500;remote.records.push(row('b'));const s=server(remote),{ctx}=setup(s.fetch);pending(ctx,local,base);await ctx.saveCloud();assert.equal(s.backups.length,1);assert.equal(s.writes.length,1);assert.equal(s.remote.records.length,2);assert.equal(s.remote.records[0].amount,1500);assert.equal(vm.runInContext('dirty',ctx),false);assert.equal(s.calls.find(c=>c.options.method==='PUT'&&c.url.endsWith('/items/file/content')).options.headers['If-Match'],'v1');});
test('confirmed save persists merge baseline and clears pending journal',async()=>{const base=reg([row('a')]),local=reg([row('a',1700)]),s=server(base),{ctx,storage}=setup(s.fetch);pending(ctx,local,base);await ctx.saveCloud();const journal=JSON.parse(storage.get(vm.runInContext('journalKey()',ctx)));assert.equal(journal.pending,false);assert.equal(journal.base.records[0].amount,1700);assert.equal(journal.local.records[0].amount,1700);assert.equal(vm.runInContext('dirty',ctx),false);});
test('pending journal restores data and baseline after restart',()=>{const {ctx,storage}=setup();const key=vm.runInContext('journalKey()',ctx);storage.set(key,JSON.stringify({version:2,path:'private/folder',pending:true,base:reg([row('a')]),local:reg([row('a',1500)])}));ctx.recoverJournal();assert.equal(ctx.data.records[0].amount,1500);assert.equal(vm.runInContext('baseData().records[0].amount',ctx),1000);assert.equal(vm.runInContext('recoveryPending',ctx),true);});
test('network failure preserves pending changes and schedules automatic retry',async()=>{const {ctx,node,timers}=setup(async()=>{throw Error('offline');});pending(ctx,reg([row('a')]));await ctx.saveCloud();assert.equal(ctx.data.records[0].id,'a');assert.equal(vm.runInContext('dirty',ctx),true);assert.ok(timers.some(t=>t.ms>=5000));assert.equal(node('cloudAlert').hidden,false);assert.doesNotMatch(node('storage').className,/isConnected/);});
test('failed recovery backup prevents any register replacement or upload',async()=>{const s=server(reg([row('a',2000)]));s.failBackup=true;const {ctx}=setup(s.fetch);pending(ctx,reg([row('a',1500)]));await ctx.saveCloud();assert.equal(s.writes.length,0);assert.equal(ctx.data.records[0].amount,1500);assert.equal(vm.runInContext('conflict',ctx),false);});
test('If-Match race rereads remote and merges rather than overwriting new entries',async()=>{const base=reg([row('a')]),s=server(base);s.race=true;const {ctx}=setup(s.fetch);pending(ctx,reg([row('a',1500)]),base);await ctx.saveCloud();assert.equal(s.remote.records.length,2);assert.equal(s.remote.records.find(r=>r.id==='racing').amount,1000);assert.equal(s.remote.records.find(r=>r.id==='a').amount,1500);assert.equal(vm.runInContext('dirty',ctx),false);});
test('edits made during upload remain pending instead of being marked saved',async()=>{const base=reg([row('a')]),s=server(base);let ctx;const fetch=async(url,options)=>{if(options?.method==='PUT'&&url.endsWith('/items/file/content')){ctx.persist(reg([row('a',1800)]));}return s.fetch(url,options);};const env=setup(fetch);ctx=env.ctx;pending(ctx,reg([row('a',1500)]),base);await ctx.saveCloud();assert.equal(s.remote.records[0].amount,1500);assert.equal(ctx.data.records[0].amount,1800);assert.equal(vm.runInContext('dirty',ctx),true);});
test('closed-year changes never silently merge into a closed cloud period',async()=>{const base=reg([row('a')]),remote=clone(base);remote.closedYears={'2024':{closedAt:'2025-01-01T00:00:00Z'}};const s=server(remote),{ctx,node}=setup(s.fetch);pending(ctx,reg([row('a',1500)]),base);await ctx.saveCloud();assert.equal(s.writes.length,0);assert.equal(s.backups.length,1);assert.equal(vm.runInContext('conflict',ctx),true);assert.match(node('syncConflicts').innerHTML,/закритий/);});
test('signed-in confirmed state shows sync indicator and hides login',()=>{const {ctx,node}=setup();vm.runInContext("cloudFile='file';baseline=JSON.stringify(data);lastCloudEvent={kind:'load',at:new Date()};controls()",ctx);assert.equal(node('cloudLogin').hidden,true);assert.equal(node('cloudLogout').hidden,false);assert.match(node('cloudIdentity').textContent,/Ви увійшли.*test@example.org/);assert.equal(node('storage').textContent,'✓ Синхронізовано з OneDrive');});
test('signed-out local copy never claims cloud sync',()=>{const {ctx,node}=setup();vm.runInContext("cloudAccount=null;authReady=false;cloudFile=null;controls()",ctx);assert.equal(node('cloudLogin').hidden,false);assert.match(node('storage').textContent,/Лише локальна копія/);});
test('expired session exposes re-login and retains changes',async()=>{const {ctx,node}=setup();vm.runInContext("client.acquireTokenSilent=async()=>{throw new InteractionRequiredAuthError('expired')}",ctx);await assert.rejects(ctx.token());assert.equal(node('cloudLogin').hidden,false);assert.equal(node('storage').textContent,'Потрібен повторний вхід');});
test('initialization automatically recovers old pending marker',async()=>{const data=reg([row('a')]),s=server(data),{ctx,storage}=setup(s.fetch);ctx.data=data;storage.set('steuerraum-cloud-test','private/folder');storage.set('steuerraum-cloud-test-dirty','1');await ctx.init();assert.equal(vm.runInContext('dirty',ctx),false);assert.equal(s.writes.length,0);});

test('choosing a concrete conflict merges and saves without manual backup files',async()=>{const base=reg([row('a')]),s=server(reg([row('a',2000)])),{ctx,node}=setup(s.fetch);pending(ctx,reg([row('a',1500)]),base);await ctx.saveCloud();ctx.document.querySelectorAll=()=>[{value:'local',dataset:{syncChoice:'0'}}];await node('syncResolve').onclick();assert.equal(s.remote.records[0].amount,1500);assert.equal(vm.runInContext('dirty',ctx),false);assert.equal(vm.runInContext('conflict',ctx),false);assert.equal(node('syncConflict').open,false);});
test('conflict resolution rereads OneDrive and preserves changes made meanwhile',async()=>{const base=reg([row('a')]),s=server(reg([row('a',2000)])),{ctx,node}=setup(s.fetch);pending(ctx,reg([row('a',1500)]),base);await ctx.saveCloud();s.remote.records.push(row('added-later'));s.etag='newer';ctx.document.querySelectorAll=()=>[{value:'local',dataset:{syncChoice:'0'}}];await node('syncResolve').onclick();assert.equal(s.remote.records.length,2);assert.equal(s.remote.records[0].amount,1500);assert.equal(s.remote.records[1].id,'added-later');});
test('permission errors preserve local data without a retry storm',async()=>{const {ctx,timers}=setup(async()=>({ok:false,status:403}));pending(ctx,reg([row('a')]));await ctx.saveCloud();assert.equal(ctx.data.records.length,1);assert.equal(timers.length,0);});
test('journal does not restore pending changes from another configured folder',()=>{const {ctx,storage}=setup();storage.set(vm.runInContext('journalKey()',ctx),JSON.stringify({path:'other/folder',pending:true,local:reg([row('private-other')])}));assert.throws(()=>ctx.recoverJournal(),/папку/);assert.equal(ctx.data.records.length,0);});
