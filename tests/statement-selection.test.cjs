const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={URL,Date};vm.runInNewContext(fs.readFileSync('features.js','utf8'),ctx);const f=ctx.SteuerraumFeatures;
const row=(n,company,ledger='expense')=>({sourceKey:n.toString(16).padStart(64,'0'),date:'2026-02-03',valueDate:'2026-02-03',amount:n*100,currency:'EUR',direction:ledger==='income'?'credit':'debit',company,description:'Service '+n,bankReference:'ref-'+n,ledger,category:'Arbeitsmittel',included:ledger!=='ignore',countryGroup:ledger==='income'?'Deutschland':'',reportYear:'2026',kind:'advance'});
const fixture=(rows)=>({records:[],incomeRecords:[],insuranceRecords:[],taxPaymentRecords:[],bankExclusions:{},trips:[],categories:[],closedYears:{},bankImports:[{id:'batch',year:'2026',status:'needs_review',reviewStage:'allocation',importScope:'all',periodFrom:'2026-02-03',coveredThrough:'2026-02-03',periodBasis:'statement',uploadedAt:'2026-03-01T00:00:00Z',previewRows:rows}]});
test('counterparty filtering normalizes names, combines scope/search/category, and preserves source rows',()=>{
const rows=[row(1,'  Example   GmbH '),row(2,'Other GmbH'),row(3,'EXAMPLE GmbH','income')],entry=fixture(rows).bankImports[0];
assert.deepEqual(Array.from(f.filterStatementRows(entry,{company:'example gmbh'}),r=>r.sourceKey),[rows[0].sourceKey,rows[2].sourceKey]);
assert.equal(f.filterStatementRows({...entry,importScope:'expenses'},{company:'example',category:'Arbeitsmittel',search:'service 1'}).length,1);
assert.equal(f.filterStatementRows(entry,{company:'not here'}).length,0);assert.equal(rows.length,3);assert.equal(rows[0].company,'  Example   GmbH ');
});
test('only shown selection survives serialization and touches no ledgers until confirmation',()=>{
const rows=[row(1,'Target'),row(2,'Other'),row(3,'Target','income'),row(4,'Own','ignore')],before=fixture(rows);
const draft=f.selectStatementRows(before,'batch',[rows[0].sourceKey,rows[2].sourceKey],'only');
for(const key of ['records','incomeRecords','insuranceRecords','taxPaymentRecords','bankExclusions'])assert.strictEqual(draft[key],before[key]);
assert.equal(before.bankImports[0].selectedSourceKeys,undefined);assert.equal(draft.bankImports[0].previewRows.length,4);
const saved=JSON.parse(JSON.stringify(draft));f.validateBankImports(saved.bankImports);assert.equal(f.statementSelectionRows(saved.bankImports[0]).length,2);
const next=f.commitStatementPreview(saved,'batch','2026-03-01T00:00:00Z');
assert.equal(next.records.length,1);assert.equal(next.incomeRecords.length,1);
assert.equal(next.records[0].company,'Target');assert.deepEqual(Object.keys(next.bankExclusions),[]);
assert.equal(next.bankImports[0].previewRows.length,4);
assert.equal(f.bankCoverage(next,'2026').coveredThrough,null);
});
test('unchecked rows and hidden matches are deferred without exclusions or source attachment; later import can add them',()=>{
const selected=row(1,'Target'),other=row(2,'Later'),match={...row(3,'Receipt'),included:false,matchId:'receipt'};
const before=fixture([selected,other,match]);before.records=[{id:'receipt',date:match.date,amount:match.amount,company:match.company,description:'Receipt',category:'Fortbildung',links:[]}];
const draft=f.selectStatementRows(before,'batch',[selected.sourceKey],'only');
const posted=f.commitStatementPreview(draft,'batch','2026-03-01T00:00:00Z');assert.equal(posted.records.length,2);assert.equal(posted.records[0].bankSourceKeys,undefined);assert.equal(posted.bankExclusions[other.sourceKey],undefined);assert.equal(posted.bankExclusions[match.sourceKey],undefined);
const repeat={...posted,bankImports:[...posted.bankImports,{...before.bankImports[0],id:'second'}]};
const next=f.commitStatementPreview(f.selectStatementRows(repeat,'second',[other.sourceKey,match.sourceKey],'only'),'second','2026-03-02T00:00:00Z');
assert.equal(next.records.length,3);assert.ok(next.records.find(r=>r.id==='receipt').bankSourceKeys.includes(match.sourceKey));
});
test('bulk and individual selection support add/remove/clear, respect scope and reject empty commit and closed/completed drafts',()=>{
const rows=[row(1,'A'),row(2,'B'),row(3,'A','income'),row(4,'Own','ignore')],before=fixture(rows);
let next=f.selectStatementRows(before,'batch',[],'clear');assert.equal(f.statementSelectionRows(next.bankImports[0]).length,0);assert.throws(()=>f.commitStatementPreview(next,'batch'),/немає операцій/);
next=f.selectStatementRows(next,'batch',[rows[0].sourceKey],'add');next=f.selectStatementRows(next,'batch',[rows[1].sourceKey],'add');next=f.selectStatementRows(next,'batch',[rows[0].sourceKey],'remove');
assert.equal(f.statementSelectionRows(next.bankImports[0])[0].company,'B');
next=f.selectStatementRows(next,'batch',[rows[3].sourceKey],'add');assert.equal(f.statementSelectionRows(next.bankImports[0]).length,1);
next.bankImports[0].importScope='expenses';assert.throws(()=>f.selectStatementRows(next,'batch',[rows[2].sourceKey],'add'),/відборі/);
assert.throws(()=>f.selectStatementRows(next,'batch',['bad'],'only'),/відборі/);
const closed={...next,closedYears:{'2026':{closedAt:'2027-01-01T00:00:00Z'}}};assert.throws(()=>f.selectStatementRows(closed,'batch',[],'clear'),/закритий/);
const completed={...next,bankImports:[{...next.bankImports[0],status:'completed'}]};assert.throws(()=>f.selectStatementRows(completed,'batch',[],'clear'),/недоступна/);
});
test('selection validation rejects malformed or repeated keys',()=>{
const before=fixture([row(1,'A')]);assert.throws(()=>f.validateBankImports([{...before.bankImports[0],selectedSourceKeys:['bad']}]),/вибір/);
assert.throws(()=>f.validateBankImports([{...before.bankImports[0],selectedSourceKeys:[before.bankImports[0].previewRows[0].sourceKey,before.bankImports[0].previewRows[0].sourceKey]}]),/вибір/);
});
