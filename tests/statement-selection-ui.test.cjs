const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
const nodes=new Map(),storage=new Map();const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',disabled:false,prepend(){},appendChild(){}});return nodes.get(s);};
let rowCheckboxes=[];const document={querySelector:node,createElement:()=>({}),querySelectorAll:selector=>{if(selector!=='[data-preview-select]')return [];rowCheckboxes=[...node('#statementPreviewRows').innerHTML.matchAll(/<input[^>]*data-preview-select="([^"]+)"[^>]*>/g)].map(m=>({dataset:{previewSelect:m[1]},checked:/\schecked(?:\s|>)/.test(m[0])}));return rowCheckboxes;}};
const c={URL,Date,Intl,document,localStorage:{getItem:()=>null,setItem:(k,v)=>storage.set(k,v)},window:{addEventListener(){}},confirm:()=>true};vm.createContext(c);vm.runInContext(fs.readFileSync('features.js','utf8'),c);vm.runInContext(fs.readFileSync('app.js','utf8').replace(/render\(\);\s*$/,''),c);
const row=(n,company)=>({sourceKey:n.toString(16).padStart(64,'0'),date:'2026-02-03',valueDate:'2026-02-03',amount:n*100,currency:'EUR',direction:'debit',company,description:'Service '+n,ledger:'expense',category:'Arbeitsmittel',included:true});
c.fixture={records:[],incomeRecords:[],insuranceRecords:[],taxPaymentRecords:[],trips:[],categories:[],closedYears:{},bankImports:[{id:'batch',sourceName:'example.csv',year:'2026',status:'needs_review',reviewStage:'allocation',uploadedAt:'2026-03-01T00:00:00Z',periodFrom:'2026-02-03',coveredThrough:'2026-02-03',previewRows:[row(1,'Target'),row(2,'Target'),row(3,'Other')]}]};
vm.runInContext("data=fixture;statementSelection='batch';year='2026';",c);c.renderStatementPreview();return {c,node,storage,checkboxes:()=>rowCheckboxes};}
test('counterparty filter prevents hidden selection from posting and only-shown button persists exact choice',()=>{
const {c,node,storage}=setup();assert.ok(node('#statementPreview').innerHTML.includes('statementCompany'));
node('#statementCompany').oninput({target:{value:'Target'}});assert.ok(!node('#statementPreviewRows').innerHTML.includes('<b>Other</b>'));assert.equal(node('#statementCommit').disabled,true);assert.ok(node('#statementSelectionSummary').textContent.includes('поза фільтром обрано 1'));
node('#statementSelectOnly').onclick();assert.equal(c.activeStatement().selectedSourceKeys.length,2);assert.equal(node('#statementCommit').disabled,false);const saved=JSON.parse(storage.get('steuerraum-v1'));assert.equal(saved.records.length,0);assert.equal(saved.bankImports[0].selectedSourceKeys.length,2);
node('#statementCommit').onclick();assert.equal(vm.runInContext('data.records.length',c),2);assert.equal(c.activeStatement().status,'completed');
});
test('individual checkbox, visible master checkbox and clear/reset controls keep counts in sync',()=>{
const {c,node,checkboxes}=setup();node('#statementSelectNone').onclick();assert.equal(node('#statementCommit').disabled,true);
node('#statementCompany').oninput({target:{value:'Target'}});let toggle=node('#statementSelectVisible');toggle.checked=true;toggle.onchange();assert.equal(c.activeStatement().selectedSourceKeys.length,2);
const first=checkboxes()[0];first.checked=false;first.onchange();assert.equal(c.activeStatement().selectedSourceKeys.length,1);assert.equal(node('#statementSelectVisible').indeterminate,true);
node('#statementCompany').oninput({target:{value:'Other'}});assert.equal(node('#statementCommit').disabled,true);
node('#statementResetFilters').onclick();assert.equal(node('#statementCommit').disabled,false);assert.ok(node('#statementPreviewRows').innerHTML.includes('<b>Other</b>'));assert.equal(c.activeStatement().selectedSourceKeys.length,1);
});

test('clear all, filter counterparty, select all shown and confirm posts only the selected counterparty',()=>{
const {c,node}=setup();node('#statementSelectNone').onclick();assert.equal(c.activeStatement().selectedSourceKeys.length,0);assert.equal(node('#statementCommit').disabled,true);
node('#statementCompany').oninput({target:{value:'Target'}});node('#statementSelectAllShown').onclick();assert.equal(c.activeStatement().selectedSourceKeys.length,2);assert.equal(node('#statementCommit').disabled,false);
node('#statementCommit').onclick();assert.equal(vm.runInContext('data.records.length',c),2);assert.equal(vm.runInContext('data.records.every(r=>r.company==="Target")',c),true);assert.equal(vm.runInContext('Object.keys(data.bankExclusions).length',c),0);
});
test('select all shown adds visible rows while preserving a previous selection and empty results disable it',()=>{
const {c,node}=setup();node('#statementSelectNone').onclick();node('#statementCompany').oninput({target:{value:'Target'}});node('#statementSelectAllShown').onclick();node('#statementCompany').oninput({target:{value:'Other'}});node('#statementSelectAllShown').onclick();assert.equal(c.activeStatement().selectedSourceKeys.length,3);
node('#statementCompany').oninput({target:{value:'No results'}});assert.equal(node('#statementSelectAllShown').disabled,true);
node('#statementResetFilters').onclick();assert.equal(node('#statementCommit').disabled,false);
});
