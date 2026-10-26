const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const c={URL,Date};vm.runInNewContext(fs.readFileSync('features.js','utf8'),c);const f=c.SteuerraumFeatures;
const income=(id='old',countryGroup='Drittland')=>({id,date:'2026-02-03',amount:10000,company:'Example',description:'Service',countryGroup,bankReview:'reviewed',links:[{name:'Example',url:'https://example.org/document'}]});
const row=(n=1,ledger='income')=>({sourceKey:n.toString(16).padStart(64,'0'),date:'2026-02-03',valueDate:'2026-02-03',amount:n*100,currency:'EUR',direction:ledger==='income'?'credit':'debit',company:'New '+n,description:'Service '+n,ledger,included:true,category:'Arbeitsmittel',countryGroup:''});
const fixture=rows=>({records:[],incomeRecords:[],insuranceRecords:[],taxPaymentRecords:[],categories:[],trips:[],closedYears:{},bankImports:[{id:'batch',year:'2026',status:'needs_review',reviewStage:'allocation',periodFrom:'2026-02-03',coveredThrough:'2026-02-03',periodBasis:'transactions',uploadedAt:'2026-03-01T00:00:00Z',previewRows:rows}]});
test('concrete countries derive the three German groups, including non-EU European countries',()=>{
assert.equal(f.incomeCountries.length,249);assert.equal(f.incomeCountryGroup('DE'),'Deutschland');for(const code of ['PL','AT','CY','FR','IE'])assert.equal(f.incomeCountryGroup(code),'Europäische Union');for(const code of ['GB','CH','NO','UA','US'])assert.equal(f.incomeCountryGroup(code),'Drittland');
assert.equal(f.incomeCountryName('PL'),'Polen');assert.equal(f.incomeCountryName('DE'),'Deutschland');assert.throws(()=>f.incomeCountryGroup('XX'));assert.equal(f.incomeCountryGroup(''),'');
});
test('country choice corrects the derived group while preserving identity, money, receipts and legacy unknown country',()=>{
const original=income(),legacy=f.validateIncomeRecords([original])[0];assert.equal(legacy.countryCode,undefined);assert.equal(legacy.countryGroup,'Drittland');
const d={...fixture([]),incomeRecords:[original]},next=f.saveIncomeRecord(d,{...original,countryCode:'PL'}),r=next.incomeRecords[0];assert.equal(r.countryGroup,'Europäische Union');assert.equal(r.id,original.id);assert.equal(r.amount,original.amount);assert.strictEqual(r.links,original.links);assert.equal(d.incomeRecords[0].countryCode,undefined);assert.throws(()=>f.validateIncomeRecords([{...original,countryCode:'XX'}]));
});
test('pending draft requires country only for selected new income, then preserves it in the posted record and CSV',()=>{
const a=row(),b=row(2),before=fixture([a,b]);let d=f.requireStatementIncomeCountry(before,'batch');assert.strictEqual(d.incomeRecords,before.incomeRecords);assert.throws(()=>f.commitStatementPreview(d,'batch'),/країну платника/);
d=f.selectStatementRows(d,'batch',[a.sourceKey],'only');d=f.saveStatementPreview(d,'batch',[f.withIncomeCountry(a,'PL'),b]);const next=f.commitStatementPreview(d,'batch','2026-03-01T00:00:00Z');assert.equal(next.incomeRecords.length,1);assert.equal(next.incomeRecords[0].countryCode,'PL');assert.equal(next.incomeRecords[0].countryGroup,'Europäische Union');assert.equal(next.incomeRecords[0].bankReview,'reviewed');assert.equal(next.bankExclusions?.[b.sourceKey],undefined);
const csv=f.incomeCsv(next,'2026');assert.ok(csv.includes('"Land des Zahlers";"Land (ISO)";"Gebiet"'));assert.ok(csv.includes('"Polen";"PL";"Europäische Union"'));
});
test('existing matches retain the owners country and never become another income',()=>{
const existing={...income(),countryCode:'CH'},r={...row(),amount:existing.amount,countryCode:'PL',countryGroup:'Europäische Union',matchId:existing.id,included:false};const d={...fixture([r]),incomeRecords:[existing]};const next=f.commitStatementPreview(f.requireStatementIncomeCountry(d,'batch'),'batch','2026-03-01T00:00:00Z');assert.equal(next.incomeRecords.length,1);assert.equal(next.incomeRecords[0].countryCode,'CH');assert.equal(next.incomeRecords[0].countryGroup,'Drittland');assert.equal(next.incomeRecords[0].amount,existing.amount);
});
test('bulk country assignment updates only selected income and refuses closed-year changes',()=>{
const a=income('a'),b=income('b'),d={...fixture([]),incomeRecords:[a,b]};const next=f.setIncomeCountries(d,['a'],'DE');assert.equal(next.incomeRecords[0].countryGroup,'Deutschland');assert.strictEqual(next.incomeRecords[1],b);assert.equal(next.incomeRecords[0].amount,a.amount);const closed=f.closeYear(d,'2026','2027-01-01T00:00:00Z');assert.throws(()=>f.setIncomeCountries(closed,['a'],'PL'),/закритий/);
});


test('new imports suggest countries from reviewed exact counterparties across years without changing identity or history',()=>{
const history=[{...income('known'),date:'2025-02-03',company:'Example Consulting 12 GmbH',countryCode:'GB'}];
const r={...row(),company:'  EXAMPLE Consulting 12 GmbH  '},before=JSON.stringify(history),next=f.suggestStatementCountries([r],history)[0];
assert.equal(next.countryCode,'GB');assert.equal(next.countryGroup,'Drittland');assert.equal(next.countrySelection,'auto');assert.equal(next.countrySuggestedBy,'known');
assert.equal(next.sourceKey,r.sourceKey);assert.equal(next.amount,r.amount);assert.equal(next.date,r.date);assert.equal(r.countryCode,undefined);assert.equal(JSON.stringify(history),before);
assert.equal(f.suggestStatementCountries([{...r,company:'Example Consulting 13 GmbH'}],history)[0].countryCode,undefined);
});
test('conflicting, pending, group-only, unknown and intermediary history do not guess countries',()=>{
const r={...row(),company:'Example Consulting'};
for(const history of [
[{...income('a'),company:r.company,countryCode:'DE'},{...income('b'),company:r.company,countryCode:'PL'}],
[{...income(),company:r.company,countryCode:'DE',bankReview:'pending'}],
[{...income(),company:r.company}],
[{...income(),company:r.company,countryCode:'XX'}]
])assert.equal(f.suggestStatementCountries([r],history)[0].countryCode,undefined);
for(const company of ['PayPal Europe','Wise Payments','Stripe','Unbekannt']){
assert.equal(f.suggestStatementCountries([{...r,company}],[{...income(),company,countryCode:'DE'}])[0].countryCode,undefined);
}
});
test('owner country overrides and explicit clearing survive repeated suggestions; matches and other ledgers are preserved',()=>{
const base={...row(),company:'Example Consulting'},history=[{...income(),company:base.company,countryCode:'DE'}];
const candidates=[{...base,countryCode:'PL'},{...base,countrySelection:'manual',countryCode:''},{...base,matchId:'old'},{...base,included:false},{...base,ledger:'insurance'},{...base,direction:'debit'}];
const next=f.suggestStatementCountries(candidates,history);candidates.forEach((r,i)=>assert.strictEqual(next[i],r));
const automatic=f.suggestStatementCountries([base],history)[0];
const corrected={...f.withIncomeCountry(automatic,'CH'),countrySelection:'manual',countrySuggestedBy:null};
assert.equal(f.suggestStatementCountries([corrected],history)[0].countryCode,'CH');
assert.equal(f.suggestStatementCountries([automatic],[...history,{...history[0],id:'other',countryCode:'PL'}])[0].countryCode,'');
assert.equal(JSON.stringify(f.suggestStatementCountries(f.suggestStatementCountries([base],history),history)),JSON.stringify(f.suggestStatementCountries([base],history)));
});
test('saving a suggested preview changes no ledger until confirmation and retains selection and duplicate protection',()=>{
const r={...row(),company:'Example Consulting'},existing={...income('history'),date:'2025-01-02',company:r.company,countryCode:'PL'};
const d={...fixture([r,row(2)]),incomeRecords:[existing]},saved=f.saveStatementPreview(d,'batch',[r,row(2)]);
assert.strictEqual(saved.incomeRecords,d.incomeRecords);assert.strictEqual(saved.records,d.records);assert.equal(saved.bankImports[0].previewRows[0].countryCode,'PL');
let selected=f.selectStatementRows(saved,'batch',[r.sourceKey],'only');selected=f.requireStatementIncomeCountry(selected,'batch');
const posted=f.commitStatementPreview(selected,'batch','2026-03-01T00:00:00Z');assert.equal(posted.incomeRecords.length,2);assert.equal(posted.incomeRecords[1].countryCode,'PL');assert.equal(posted.bankExclusions?.[row(2).sourceKey],undefined);assert.throws(()=>f.commitStatementPreview(posted,'batch'));
const closed=f.closeYear(d,'2026','2027-01-01T00:00:00Z');assert.throws(()=>f.saveStatementPreview(closed,'batch',[r]),/закритий/);
});
