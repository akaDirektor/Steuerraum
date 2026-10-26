const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c={URL,Date};for(const file of ['features.js','obligation-planning.js','tax-estimate.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),c);const f=c.SteuerraumFeatures,t=c.SteuerraumTax,p=c.SteuerraumPlanning;
const fixture=(year='2026')=>({records:[],incomeRecords:[{id:'income',date:year+'-02-01',amount:5000000,company:'Example',description:'Example',countryGroup:'Deutschland'}],insuranceRecords:[],taxPaymentRecords:[],categories:[],trips:[],closedYears:{},annualDetails:{[year]:{distanceKm:25.9,commuteDays:100}},taxEstimateProfile:{assessment:'single',churchRate:0,municipality:'liederbach',trade:true},insuranceProjectionProfile:{provider:'tk',sickPay:false,age:40,childrenUnder25:2,hasChildren:true}});
test('commute uses one-way whole kilometres, actual days and distinct 2025/2026 rates',()=>{
const a=f.commuteAllowance(fixture('2025'),'2025'),b=f.commuteAllowance(fixture(),'2026');assert.equal(a.fullKm,25);assert.equal(a.perDay,790);assert.equal(a.amount,79000);assert.equal(b.perDay,950);assert.equal(b.amount,95000);assert.equal(f.commuteAllowance({},'2027',{distanceKm:25,commuteDays:100}).amount,0);
assert.equal(f.commuteAllowance({},'2026',{distanceKm:25}).ready,false);assert.equal(f.commuteAllowance({},'2026',{distanceKm:25,commuteDays:0}).amount,0);
});
test('annual cap applies unless own/provided car is explicitly selected',()=>{
const capped=f.commuteAllowance({},'2026',{distanceKm:100,commuteDays:200});assert.equal(capped.gross,760000);assert.equal(capped.amount,450000);assert.equal(capped.capped,true);
const car=f.commuteAllowance({},'2026',{distanceKm:100,commuteDays:200,commuteOwnCar:true});assert.equal(car.amount,760000);assert.equal(car.capped,false);
});
test('daily counts are validated by calendar year; year settings and closed-year protections persist',()=>{
const d=fixture(),before=JSON.stringify(d),n=f.saveAnnualDetails(d,'2026',{...d.annualDetails['2026'],commuteDays:120});assert.equal(JSON.stringify(d),before);assert.equal(n.annualDetails['2026'].commuteDays,120);assert.strictEqual(n.records,d.records);assert.strictEqual(n.trips,d.trips);
for(const days of [-1,1.5,366,'100'])assert.throws(()=>f.saveAnnualDetails(d,'2026',{commuteDays:days}),/Кількість днів/);assert.doesNotThrow(()=>f.validateAnnualDetails({'2028':{commuteDays:366}}));assert.throws(()=>f.validateAnnualDetails({'2026':{commuteOwnCar:'yes'}}));
const closed=f.closeYear(d,'2026','2027-01-01T00:00:00Z');assert.throws(()=>f.saveAnnualDetails(closed,'2026',{commuteDays:0}),/закритий/);
});
test('commute reduces tax business profit and both tax bases exactly once, without an expense record or trip',()=>{
const d=fixture(),before=JSON.stringify(d),e=t.estimate(d,'2026');assert.equal(e.profit,5000000);assert.equal(e.commuteDeduction,95000);assert.equal(e.taxProfit,4905000);assert.equal(e.estimatedZve,4905000);assert.equal(e.tradeErtrag,4905000);assert.equal(e.roundedTrade,4900000);
const overview=f.taxOverview(d,'2026');assert.equal(overview.expenses,0);assert.equal(overview.profit,5000000);assert.equal(overview.taxProfit,4905000);assert.equal(JSON.stringify(d),before);assert.equal(d.records.length,0);assert.equal(d.trips.length,0);
d.taxEstimateSettings={'2026':{insuranceDeductionCents:200000}};const reduced=t.estimate(d,'2026');assert.equal(reduced.estimatedZve,4705000);assert.equal(reduced.tradeErtrag,4905000);
});
test('commute changes only registry-derived insurance profit; explicit forecast override stays owner controlled',()=>{
const d=fixture();assert.equal(p.insuranceProjection(d,'2026').profit,4905000);assert.equal(p.insuranceProjection(d,'2026').annualIncome,4905000);
d.insuranceProjectionSettings={'2026':{annualIncomeOverrideCents:7000000}};assert.equal(p.insuranceProjection(d,'2026').annualIncome,7000000);
});
test('accountant export shows days and deduction separately from unchanged business expenses',()=>{
const csv=f.annualSummaryCsv(fixture(),'2026');assert.ok(csv.includes('"Betriebsausgaben";"0,00"'));assert.ok(csv.includes('"Fahrten Wohnung - Betriebsstätte (Tage)";"100"'));assert.ok(csv.includes('"Entfernungspauschale gesamt EUR";"950,00"'));assert.ok(csv.includes('"Steuerlicher Gewinn nach Entfernungspauschale";"49050,00"'));
});
