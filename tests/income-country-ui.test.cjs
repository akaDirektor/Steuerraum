const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){const nodes=new Map(),node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',disabled:false,prepend(){},appendChild(){},showModal(){},close(){}});return nodes.get(s);};const c={URL,Date,Intl,localStorage:{getItem:()=>null,setItem(){}},document:{querySelector:node,querySelectorAll:s=>s==='[data-preview-field]'?[Object.assign(node('#countryInput'),{dataset:{previewField:'countryCode'},closest:()=>({dataset:{previewKey:'1'.padStart(64,'0')}})})]:[],createElement:()=>({})},window:{addEventListener(){}},confirm:()=>true};vm.createContext(c);vm.runInContext(fs.readFileSync('features.js','utf8'),c);vm.runInContext(fs.readFileSync('app.js','utf8').replace(/render\(\);\s*$/,''),c);
const row=(n)=>({sourceKey:n.toString(16).padStart(64,'0'),date:'2026-02-03',valueDate:'2026-02-03',amount:n*100,currency:'EUR',direction:'credit',company:'New '+n,description:'Service '+n,ledger:'income',included:true,countryGroup:''});c.fixture={records:[],incomeRecords:[{id:'old',date:'2026-01-01',amount:10000,company:'Legacy',description:'Service',countryGroup:'Drittland'}],insuranceRecords:[],taxPaymentRecords:[],categories:[],trips:[],closedYears:{},bankImports:[{id:'batch',year:'2026',status:'needs_review',reviewStage:'allocation',periodFrom:'2026-02-03',coveredThrough:'2026-02-03',uploadedAt:'2026-03-01T00:00:00Z',previewRows:[row(1),row(2)]}]};vm.runInContext("data=fixture;statementSelection='batch';year='2026';",c);return {c,node};}
test('income preview asks for concrete country and posts only after bulk country choice',()=>{
const {c,node}=setup();c.renderStatementPreview();assert.equal(node('#statementCommit').disabled,true);assert.ok(node('#statementPreviewRows').innerHTML.includes('data-preview-field="countryCode"'));assert.ok(node('#statementSelectionSummary').textContent.includes('обери країну для 2'));
node('#statementBulkCountry').value='PL';node('#statementBulkCountryApply').onclick();assert.equal(node('#statementCommit').disabled,false);assert.ok(node('#statementPreviewRows').innerHTML.includes('Europäische Union'));
node('#statementCommit').onclick();assert.equal(vm.runInContext('data.incomeRecords.length',c),3);assert.equal(vm.runInContext('data.incomeRecords.filter(r=>r.countryCode==="PL").length',c),2);
});
test('income register shows country and read-only automatic group and bulk updates only filtered records',()=>{
const {c,node}=setup();c.renderIncome();assert.ok(node('#view').innerHTML.includes('Країна платника'));assert.ok(node('#incomeRows').innerHTML.includes('data-income-country="old"'));assert.ok(!node('#incomeRows').innerHTML.includes('data-income-group'));
node('#incomeBulkCountry').value='CH';node('#incomeBulkApply').onclick();assert.equal(vm.runInContext('data.incomeRecords[0].countryCode',c),'CH');assert.ok(node('#incomeRows').innerHTML.includes('Drittland'));assert.equal(vm.runInContext('data.incomeRecords[0].amount',c),10000);
});

test('preview immediately suggests country from previous income and owner correction or clearing survives redraw',()=>{
const {c,node}=setup();vm.runInContext("data.incomeRecords[0]={...data.incomeRecords[0],company:'New 1',countryCode:'GB',bankReview:'reviewed'};",c);
c.renderStatementPreview();assert.equal(vm.runInContext('data.bankImports[0].previewRows[0].countryCode',c),'GB');
assert.ok(node('#statementPreviewRows').innerHTML.includes('Автопідбір · перевір'));
assert.ok(node('#statementPreviewRows').innerHTML.includes('Drittland'));
const change=value=>{node('#countryInput').value=value;node('#countryInput').onchange();};
change('DE');c.renderStatementPreview();assert.equal(vm.runInContext('data.bankImports[0].previewRows[0].countryCode',c),'DE');assert.equal(vm.runInContext('data.bankImports[0].previewRows[0].countrySelection',c),'manual');
change('');c.renderStatementPreview();assert.equal(vm.runInContext('data.bankImports[0].previewRows[0].countryCode',c),'');assert.equal(node('#statementCommit').disabled,true);
});
