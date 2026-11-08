const documentExtension = /\.(pdf|jpe?g|png|heic|webp|tiff?|docx?|xlsx?|eml|msg)$/i;
const dateInName = /(?<!\d)(20\d{2})[._ -](\d{2})[._ -](\d{2})(?!\d)/;
const amountInName = /(?:^|[^\d.,])(\d+(?:[., ]\d{3})*[.,]\d{2})\s*(EUR|USD|GBP|PLN|CHF|€)(?![a-z])/gi;

function withoutBankDetails(value) {
  return String(value ?? '')
    .replace(/\b[A-Z]{2}\d{2}(?:[ \t-]?[A-Z0-9]){10,30}\b/gi, '[IBAN]')
    .replace(/\b(?:BIC|SWIFT)\s*[:=]?\s*[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gi, '[BIC]')
    .replace(/\b(?:Kontonummer|Konto(?:-?Nr\.?)?|Bankleitzahl|BLZ|account\s+(?:number|no\.?))\s*[:=#]?\s*\d(?:[\d -]{3,}\d)\b/gi, '[bank details]')
    .replace(/\b\d(?:[ -]?\d){11,}\b/g, '[number]');
}

function fileAddress(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return '';
    const path = decodeURIComponent(url.pathname).normalize('NFC').toLowerCase();
    const id = url.searchParams.get('sourcedoc');
    return url.origin + path + (id ? '?sourcedoc=' + id.toLowerCase() : '');
  } catch {
    return '';
  }
}

function indexDocument(index, id, url) {
  const address = fileAddress(url);
  if (id) index.add('id:' + id);
  if (address) index.add('url:' + address);
}

function indexedDocument(index, id, url) {
  return (id && index.has('id:' + id)) || index.has('url:' + fileAddress(url));
}

function words(value) {
  return String(value || '').normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function candidateMetadata(name) {
  const match = name.match(dateInName);
  if (!match) return null;
  const date = match.slice(1, 4).join('-');
  const stem = name.replace(documentExtension, '').replace(dateInName, ' ');
  const amounts = [...stem.matchAll(amountInName)].map(([, value, code]) => ({
    amountCents: Number(value.replace(/[^\d]/g, '')),
    currency: code === '€' ? 'EUR' : code.toUpperCase(),
  }));
  return { date, amounts, vendorText: ' ' + words(stem) + ' ' };
}

function amountMatches(record, candidate) {
  return candidate?.amounts.some(({ amountCents, currency }) =>
    (currency === 'EUR' && amountCents === record.amount) ||
    (currency === record.originalCurrency && amountCents === record.originalAmountCents));
}

function filenameMatches(record, candidate) {
  const company = words(record.company);
  if (!candidate || company.replace(/ /g, '').length < 3 ||
      !candidate.vendorText.includes(' ' + company + ' ')) return false;
  const days = Math.abs(Date.parse(record.date) - Date.parse(candidate.date)) / 86400000;
  return days <= 7 && amountMatches(record, candidate);
}

export function buildMissingExpenseDocuments(register, files, lastSuccessfulSyncAt) {
  const expenses = register.records;
  const excluded = new Set();
  const attached = new Set();
  for (const entry of [...(register.bankImports || []), ...(register.noticeImports || [])]) {
    indexDocument(excluded, entry.sourceFileItemId, entry.sourceUrl);
    indexDocument(excluded, entry.manifestItemId, entry.manifestUrl);
  }
  for (const record of [...expenses, ...(register.incomeRecords || []),
    ...(register.insuranceRecords || []), ...(register.taxPaymentRecords || [])]) {
    indexDocument(excluded, null, record.bankStatementUrl);
  }
  const evidenceLinks = record => (record.links || []).filter(link =>
    fileAddress(link.url) && !indexedDocument(excluded, link.driveItemId, link.url));
  for (const record of [...expenses, ...(register.incomeRecords || []),
    ...(register.insuranceRecords || []), ...(register.taxPaymentRecords || [])]) {
    for (const link of evidenceLinks(record)) indexDocument(attached, link.driveItemId, link.url);
  }
  const candidates = files.filter(file => file.id && documentExtension.test(file.name || '') &&
    !indexedDocument(excluded, file.id, file.url) && !indexedDocument(attached, file.id, file.url))
    .map(file => ({ ...file, metadata: candidateMetadata(file.name) }));
  const log = (register.inboxProcessingLog || []).filter(entry =>
    entry.ledger === 'expense' && entry.status === 'needs_review' && entry.recordId);
  const amountsByDate = new Map();
  for (const record of expenses) {
    const key = record.date + '|' + record.amount;
    amountsByDate.set(key, (amountsByDate.get(key) || 0) + 1);
  }
  const summaryByYear = {};
  const transactions = [];
  const ids = new Set();
  for (const record of expenses) {
    const year = record.date.slice(0, 4);
    if (!record.id || ids.has(record.id) || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
        !Number.isSafeInteger(record.amount) || record.amount < 0) {
      throw new Error('Invalid or duplicate expense record');
    }
    ids.add(record.id);
    const summary = summaryByYear[year] ??= { total: 0, withDocuments: 0, withoutDocuments: 0, uploadedUnlinked: 0 };
    summary.total++;
    if (evidenceLinks(record).length) {
      summary.withDocuments++;
      continue;
    }
    summary.withoutDocuments++;
    const candidateDocuments = candidates.flatMap(file => {
      const recorded = record.sourceDocumentItemId === file.id || log.some(entry =>
        entry.recordId === record.id && fileAddress(entry.documentUrl) &&
        fileAddress(entry.documentUrl) === fileAddress(file.url));
      let match = recorded ? 'record_reference' : '';
      if (!match && filenameMatches(record, file.metadata)) match = 'filename_candidate';
      if (!match && file.location === 'archive' && !words(record.company) &&
          file.metadata?.date === record.date && amountsByDate.get(record.date + '|' + record.amount) === 1 &&
          file.metadata.amounts.some(value => value.currency === 'EUR' && value.amountCents === record.amount)) {
        match = 'date_amount_candidate';
      }
      if (!match) return [];
      return [{
        itemId: file.id, name: withoutBankDetails(file.name), location: file.location,
        match,
      }];
    }).sort((a, b) => a.itemId.localeCompare(b.itemId));
    if (candidateDocuments.length) summary.uploadedUnlinked++;
    const transaction = {
      transactionId: record.id, date: record.date, company: withoutBankDetails(record.company),
      amountCents: record.amount, currency: 'EUR', description: withoutBankDetails(record.description),
      category: withoutBankDetails(record.category),
      source: record.bankSourceKeys?.length || record.type === 'Bankauszug' ? 'bank_statement' :
        record.bankAccountKey || /^Bankkonto\b/i.test(record.type || '') ? 'bank_account' : 'expense_register',
      documentStatus: candidateDocuments.length ? 'uploaded_unlinked' : 'missing',
    };
    if (Number.isSafeInteger(record.originalAmountCents) && /^[A-Z]{3}$/.test(record.originalCurrency || '')) {
      transaction.originalAmountCents = record.originalAmountCents;
      transaction.originalCurrency = record.originalCurrency;
    }
    if (candidateDocuments.length) transaction.candidateDocuments = candidateDocuments;
    transactions.push(transaction);
  }
  transactions.sort((a, b) => b.date.localeCompare(a.date) || a.transactionId.localeCompare(b.transactionId));
  return {
    schemaVersion: 1, lastSuccessfulSyncAt,
    summary: {
      total: expenses.length, withDocuments: expenses.length - transactions.length,
      withoutDocuments: transactions.length,
      uploadedUnlinked: transactions.filter(row => row.documentStatus === 'uploaded_unlinked').length,
    },
    summaryByYear,
    transactions,
  };
}
