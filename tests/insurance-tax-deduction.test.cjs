const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={URL,Date};for(const file of ['features.js','obligation-planning.js','tax-estimate.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),ctx);const t=ctx.SteuerraumTax,p=ctx.SteuerraumPlanning;
const fixture=()=>({records:[],incomeRecords:[{id:'i',date:'2026-03-01',amount:5000000}],insuranceRecords:[],taxPaymentRecords:[],categories:[],trips:[],closedYears:{},taxEstimateProfile:{assessment:'single',churchRate:0,municipality:'liederbach',trade:true},insuranceProjectionProfile:{provider:'tk',sickPay:false,age:40,hasChildren:true,childrenUnder25:2}});
const payment=(id,date,direction,amount,reportYear='2026')=>({id,date,direction,amount,reportYear,company:'Insurer',description:'Contribution'});
test('automatic forecast follows posted cash payments and refunds by payment year, without changing business profit or trade tax',()=>{
const d=fixture(),without=t.estimate(d,'2026');d.insuranceRecords=[payment('a','2026-01-01','debit',300000,'2025'),payment('b','2026-02-01','credit',50000,'2025'),payment('c','2025-12-01','debit',90000,'2026')];const before=JSON.stringify(d),e=t.estimate(d,'2026');
assert.equal(e.settings.insuranceDeductionCents,250000);assert.equal(e.settings.insuranceDeductionSource,'payments');assert.equal(e.settings.insuranceDeductionIsEstimate,true);assert.equal(e.estimatedZve,4750000);assert.equal(e.profit,without.profit);assert.equal(e.gewerbe,without.gewerbe);assert.ok(e.tariff<without.tariff);assert.equal(JSON.stringify(d),before);
d.insuranceRecords.push(payment('d','2026-03-01','debit',100000));assert.equal(t.getSettings(d,'2026').insuranceDeductionCents,350000);
});
test('automatic mode stays dynamic after saving settings and legacy zero defaults become payment estimates',()=>{
let d=fixture();d.insuranceRecords=[payment('a','2026-01-01','debit',200000)];d.taxEstimateSettings={'2026':{insuranceDeductionCents:0}};assert.equal(t.getSettings(d,'2026').insuranceDeductionCents,200000);
d=t.saveSettings(d,'2026',{insuranceDeductionMode:'auto',insuranceDeductionCents:200000});d.insuranceRecords.push(payment('b','2026-02-01','debit',50000));assert.equal(t.getSettings(d,'2026').insuranceDeductionCents,250000);
});
test('certificate deductible amount replaces, never adds to, the provisional payments; annual unpaid totals and calendar plans are excluded',()=>{
let d=fixture();d.insuranceRecords=[payment('a','2026-01-01','debit',300000)];d=p.saveAnnual(d,{id:'assessment',year:'2026',type:'Krankenversicherung',amount:900000});d=p.saveSchedule(d,{id:'future',year:'2026',type:'Krankenversicherung',kind:'assessment',amount:600000,dueDate:'2026-12-01',status:'planned'});assert.equal(t.getSettings(d,'2026').insuranceDeductionCents,300000);
d=p.saveAnnual(d,{...d.annualObligations[0],deductibleAmount:280000});const settings=t.getSettings(d,'2026');assert.equal(settings.insuranceDeductionCents,280000);assert.equal(settings.insuranceDeductionSource,'notice');assert.equal(settings.insuranceDeductionIsEstimate,false);assert.equal(d.insuranceRecords.length,1);
const zero=p.saveAnnual(d,{...d.annualObligations[0],deductibleAmount:0});assert.equal(t.getSettings(zero,'2026').insuranceDeductionCents,0);
});
test('explicit and existing manual amounts remain owner controlled and never count twice',()=>{
let d=fixture();d.insuranceRecords=[payment('a','2026-01-01','debit',300000)];d.taxEstimateSettings={'2026':{insuranceDeductionCents:120000}};assert.equal(t.getSettings(d,'2026').insuranceDeductionCents,120000);assert.equal(t.getSettings(d,'2026').insuranceDeductionSource,'manual');
d=p.saveAnnual(d,{id:'certificate',year:'2026',type:'Krankenversicherung',amount:350000,deductibleAmount:290000});assert.equal(t.getSettings(d,'2026').insuranceDeductionCents,290000);
d=t.saveSettings(d,'2026',{insuranceDeductionMode:'manual',insuranceDeductionCents:0});assert.equal(t.getSettings(d,'2026').insuranceDeductionCents,0);assert.equal(t.getSettings(d,'2026').insuranceDeductionSource,'manual');
assert.throws(()=>t.validateSettings({insuranceDeductionMode:'bad'}));
});
test('Krankengeld estimate reduces the allocated health portion by four percent while preserving Pflege; no deductions become negative',()=>{
const d=fixture();d.insuranceProjectionProfile.sickPay=true;d.insuranceRecords=[payment('a','2026-01-01','debit',206400)];const settings=t.getSettings(d,'2026');assert.equal(settings.insuranceDeductionCents,199484);assert.equal(settings.insurancePayments.krankengeldAdjusted,true);
d.insuranceRecords.push(payment('b','2026-02-01','credit',300000));assert.equal(t.getSettings(d,'2026').insuranceDeductionCents,0);
});
test('automatic forecast does not write into a closed year and zero-data estimates stay zero',()=>{
const d=fixture(),before=JSON.stringify(d);assert.equal(t.getSettings(d,'2026').insuranceDeductionCents,0);assert.equal(t.getSettings(d,'2026').insuranceDeductionSource,'none');d.closedYears={'2026':{closedAt:'2027-01-01T00:00:00Z'}};const closed=JSON.stringify(d);t.estimate(d,'2026');assert.equal(JSON.stringify(d),closed);assert.throws(()=>t.saveSettings(d,'2026',{insuranceDeductionMode:'auto'}),/закритий/);
});
