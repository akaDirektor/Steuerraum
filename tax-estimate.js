'use strict';
(function(root){
const tariffs={
'2025':{basic:12096,second:17443,third:68480,top:277825,a:932.30,b:176.64,c:1015.13,d:10911.92,e:19246.67,soli:19950},
'2026':{basic:12348,second:17799,third:69878,top:277825,a:914.51,b:173.10,c:1034.87,d:11135.63,e:19470.38,soli:20350}
};
const municipalities={liederbach:{name:'Liederbach am Taunus',rates:{'2025':370,'2026':385},source:'https://www.frankfurt-main.ihk.de/recht/uebersicht-alle-rechtsthemen/steuerrecht/gewerbe-und-grundsteuer/realsteuerhebesaetze-5195618'}};
function cents(value,name,negative=false){if(!Number.isSafeInteger(value)||!negative&&value<0)throw Error('Перевір суму: '+name);return value;}
function tariffTax(zveCents,year){const p=tariffs[year];if(!p)throw Error('Для цього року ставки ще не перевірені');const x=Math.max(0,Math.floor(cents(zveCents,'оподатковуваний дохід',true)/100));let tax=0;
if(x>p.top)tax=.45*x-p.e;else if(x>p.third)tax=.42*x-p.d;else if(x>p.second){const z=(x-p.second)/10000;tax=(p.b*z+2397)*z+p.c;}else if(x>p.basic){const y=(x-p.basic)/10000;tax=(p.a*y+1400)*y;}
return Math.max(0,Math.floor(tax+1e-9))*100;}
function soliTax(estCents,year){const p=tariffs[year];if(!p)throw Error('Рік не підтримується');cents(estCents,'база Soli');return Math.max(0,Math.floor(Math.min(estCents*55/1000,Math.max(0,estCents-p.soli*100)*119/1000)+1e-7));}
function getSettings(data,year){const saved=data.taxEstimateSettings?.[year]||{},official=root.SteuerraumPlanning?.annualFor(data,year,'Krankenversicherung');return {insuranceDeductionCents:0,otherDeductionsCents:0,otherIncomeCents:0,tradeAdjustmentCents:0,...saved,...(official?.deductibleAmount!=null&&saved.useInsuranceAssessment!==false?{insuranceDeductionCents:official.deductibleAmount,insuranceDeductionSource:'notice'}:{})};}
function validateSettings(input){const result={useInsuranceAssessment:input.useInsuranceAssessment!==false};for(const field of ['insuranceDeductionCents','otherDeductionsCents','otherIncomeCents','tradeAdjustmentCents'])result[field]=cents(input[field]??0,field,field==='tradeAdjustmentCents');if(input.hebOverride!=null){if(!Number.isFinite(input.hebOverride)||input.hebOverride<200||input.hebOverride>1000)throw Error('Hebesatz має бути від 200 до 1000%');result.hebOverride=input.hebOverride;}return result;}
function saveSettings(data,year,input){if(!tariffs[year])throw Error('Рік не підтримується');if(root.SteuerraumFeatures?.closedYear(data,year))throw Error('Рік закритий');return {...data,taxEstimateSettings:{...(data.taxEstimateSettings||{}),[year]:validateSettings(input)}};}

function paymentBalance(data,year,estimates){
const byType={};for(const taxType of ['Einkommensteuer','Gewerbesteuer']){
const rows=(data.taxPaymentRecords||[]).filter(r=>String(r.taxYear)===String(year)&&r.taxType===taxType&&['advance','assessment','refund'].includes(r.kind)),sum=kind=>rows.filter(r=>r.kind===kind).reduce((s,r)=>s+cents(r.amount,'сплачений податок'),0),advance=sum('advance'),assessment=sum('assessment'),refund=sum('refund'),netPaid=advance+assessment-refund,official=root.SteuerraumPlanning?.annualFor(data,year,taxType),calculated=estimates[taxType],estimated=official?.amount??(Number.isSafeInteger(calculated)?cents(calculated,'орієнтовний податок'):null),balance=estimated==null?null:estimated-netPaid;
byType[taxType]={estimated,calculated,officialId:official?.id||null,source:official?'notice':'estimate',advance,assessment,refund,netPaid,balance,status:balance==null?'unknown':balance>0?'due':balance<0?'overpaid':'balanced',amount:balance==null?null:Math.abs(balance),recordIds:rows.map(r=>r.id)};
}
const total={};for(const field of ['estimated','advance','assessment','refund','netPaid','balance'])total[field]=Object.values(byType).some(r=>r[field]==null)?null:Object.values(byType).reduce((s,r)=>s+r[field],0);total.status=total.balance==null?'unknown':total.balance>0?'due':total.balance<0?'overpaid':'balanced';total.amount=total.balance==null?null:Math.abs(total.balance);
const unassigned=(data.taxPaymentRecords||[]).filter(r=>(String(r.taxYear)===String(year)||!r.taxYear&&r.date.startsWith(String(year)))&&(!r.taxYear||!['Einkommensteuer','Gewerbesteuer'].includes(r.taxType)||!['advance','assessment','refund'].includes(r.kind)));
return {byType,total,unassignedCount:unassigned.length};
}

function estimate(data,year){
const rule=tariffs[year];if(!rule)return {ready:false,reason:'Для '+year+' року податкові ставки ще не перевірені.'};
const profile=data.taxEstimateProfile;if(!profile||profile.assessment!=='single'||profile.churchRate!==0)return {ready:false,reason:'Потрібні підтверджені параметри: індивідуальна декларація та Kirchensteuer 0%.'};
const municipality=municipalities[profile.municipality];const settings=validateSettings(getSettings(data,year)),heb=settings.hebOverride??municipality?.rates[year];if(profile.trade!==false&&heb==null)return {ready:false,reason:'Обери громаду або вкажи перевірений Hebesatz.'};
const rows=(data.incomeRecords||[]).filter(r=>r.date.startsWith(String(year)));if(!rows.length)return {ready:false,reason:'Додай доходи за вибраний рік для розрахунку.'};
const income=rows.reduce((sum,r)=>sum+cents(r.amount,'дохід'),0),expenses=(data.records||[]).filter(r=>r.date.startsWith(String(year))).reduce((sum,r)=>sum+cents(r.amount,'витрати'),0),profit=income-expenses,personalDeductions=settings.insuranceDeductionCents+settings.otherDeductionsCents,estimatedZve=Math.max(0,profit+settings.otherIncomeCents-personalDeductions),tariff=tariffTax(estimatedZve,year);
const tradeErtrag=Math.max(0,profit+settings.tradeAdjustmentCents),roundedTrade=Math.floor(tradeErtrag/10000)*10000,tradeBase=profile.trade===false?0:Math.max(0,roundedTrade-2450000),messbetrag=Math.round(tradeBase*35/1000),gewerbe=Math.round(messbetrag*(heb||0)/100),positiveBusiness=Math.max(0,profit),positiveTotal=positiveBusiness+settings.otherIncomeCents,creditCap=positiveTotal>0?Math.floor(tariff*positiveBusiness/positiveTotal):0,credit=Math.min(4*messbetrag,gewerbe,creditCap),incomeTax=Math.max(0,tariff-credit),soli=soliTax(incomeTax,year),totalTax=gewerbe+incomeTax+soli,combinedBeforeTax=profit+settings.otherIncomeCents,remaining=combinedBeforeTax-totalTax;
const settlement=paymentBalance(data,year,{Einkommensteuer:incomeTax,Gewerbesteuer:gewerbe}),paid={Einkommensteuer:settlement.byType.Einkommensteuer.netPaid,Gewerbesteuer:settlement.byType.Gewerbesteuer.netPaid},unassignedPayments=settlement.unassignedCount;
return {ready:true,year:String(year),settings,municipality:municipality?.name||'Ручний Hebesatz',heb,rule,income,expenses,profit,personalDeductions,estimatedZve,tariff,tradeErtrag,roundedTrade,tradeBase,messbetrag,gewerbe,creditCap,credit,incomeTax,soli,totalTax,combinedBeforeTax,remaining,effectiveRate:combinedBeforeTax>0?totalTax/combinedBeforeTax:0,paid,settlement,estBalance:incomeTax-paid.Einkommensteuer,tradeBalance:gewerbe-paid.Gewerbesteuer,unassignedPayments};
}
root.SteuerraumTax={paymentBalance,tariffs,municipalities,tariffTax,soliTax,getSettings,validateSettings,saveSettings,estimate};
})(globalThis);
