import ExcelJS from 'exceljs';
import './accountant-report.js';

// Generate only in the owner's browser. No upload, analytics or external document fetch.
window.downloadSteuerraumAccountant=async function(data,year){
const {workbook,model}=window.SteuerraumAccountantReport.createWorkbook(ExcelJS,data,year);
const bytes=await workbook.xlsx.writeBuffer(),blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),link=document.createElement('a');
link.href=url;link.download='Steuerraum-Steuerunterlagen-'+model.year+'.xlsx';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
return {year:model.year,expenses:model.expenses.length,income:model.income.length};
};
