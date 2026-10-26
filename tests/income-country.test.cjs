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
