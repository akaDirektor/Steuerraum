
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ctx={URL,Date};vm.runInNewContext(fs.readFileSync('features.js','utf8'),ctx);const F=ctx.SteuerraumFeatures;
const income={id:'payment',date:'2026-01-20',company:'Example Services',amount:12300,description:'Invoice A1',countryCode:'DE',countryGroup:'Deutschland',links:[],bankSourceKeys:['key']};
const item={id:'attachment-doc',ledger:'income',status:'matched',recordId:'payment',fileItemId:'doc',fileName:'Example.pdf',fileHash:'quickxor:synthetic',fileSize:12,documentUrl:'https://example.sharepoint.com/sites/test/_layouts/15/Doc.aspx?sourcedoc=%7B11111111-1111-1111-1111-111111111111%7D',invoice:{number:'A1',date:'2026-01-10',amount:12300,countryCode:'DE'},expected:{date:income.date,company:income.company,amount:income.amount,description:income.description,countryCode:'DE'}};
const fixture=()=>({records:[],incomeRecords:[structuredClone(income)],categories:[],trips:[],closedYears:{},inboxProcessingLog:[{id:'unrelated',status:'attached'}]});
const batch=(items=[item])=>({version:1,id:'batch',items:structuredClone(items)});
test('attachment changes only links and invoice metadata, stays pending until verified and is idempotent after confirmation',()=>{
const before=fixture(),next=F.applyInvoiceAttachments(before,batch());assert.equal(before.incomeRecords[0].links.length,0);assert.equal(next.incomeRecords.length,1);assert.equal(next.incomeRecords[0].links.length,1);assert.equal(next.incomeRecords[0].links[0].documentDate,'2026-01-10');assert.equal(next.incomeRecords[0].amount,income.amount);assert.equal(next.incomeRecords[0].date,income.date);assert.equal(next.incomeRecords[0].bankSourceKeys[0],'key');assert.equal(next.inboxProcessingLog.at(-1).status,'needs_review');assert.equal(next.inboxProcessingLog[0].id,'unrelated');
const confirmed=F.confirmInvoiceAttachments(next,batch());assert.equal(confirmed.inboxProcessingLog.at(-1).status,'attached');assert.equal(F.applyInvoiceAttachments(confirmed,batch()).incomeRecords[0].links.length,1);
confirmed.incomeRecords[0].links=[];assert.equal(F.applyInvoiceAttachments(confirmed,batch()).incomeRecords[0].links.length,0);
});
test('country conflict, edited payment, missing payment, closed year, invalid source and unconfirmed invoice never attach or create income',()=>{
for(const change of [
d=>d.incomeRecords[0].countryCode='PL',d=>d.incomeRecords[0].description='Owner edit',d=>d.incomeRecords=[],d=>d.closedYears={'2026':{closedAt:'2027-01-01T00:00:00Z'}}
]){const d=fixture();change(d);const next=F.applyInvoiceAttachments(d,batch());assert.equal(next.incomeRecords.length,d.incomeRecords.length);assert.equal(next.incomeRecords[0]?.links.length||0,0);assert.equal(next.inboxProcessingLog.at(-1).status,'needs_review');}
for(const overrides of [{status:'needs_review'},{documentUrl:'https://public.example/document'},{invoice:{...item.invoice,date:'025.05.2026'}},{invoice:{...item.invoice,amount:1}},{invoice:{...item.invoice,countryCode:'PL'}}]){
assert.equal(F.applyInvoiceAttachments(fixture(),batch([{...item,...overrides}])).incomeRecords[0].links.length,0);
}
});
test('existing receipt and unrelated data survive; repeated file hash does not attach a second copy',()=>{
const d=fixture();d.incomeRecords[0].links=[{name:'Existing',url:'https://example.sharepoint.com/old',driveItemId:'other',sourceHash:item.fileHash}];d.annualDetails={example:'preserved'};const next=F.applyInvoiceAttachments(d,batch());assert.equal(next.incomeRecords[0].links.length,1);assert.strictEqual(next.annualDetails,d.annualDetails);assert.throws(()=>F.applyInvoiceAttachments(fixture(),batch([item,item])));
});
