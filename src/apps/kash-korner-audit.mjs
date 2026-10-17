import { createHash } from 'node:crypto';
import { encodeCanonical } from '../core/apex-cbor.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
const money = value => Math.round(Number(value) * 100) / 100;
const date = value => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
};

function addFinding(findings, code, severity, path, message, evidence = {}) {
  findings.push({ code, severity, path, message, evidence });
}

/**
 * Deterministic consistency audit for structured contingency contracts/invoices.
 * It flags missing terms and arithmetic/reference discrepancies; it does not
 * decide enforceability, provide legal advice, authorize payment, or alter records.
 * No network calls or persistence occur in this module.
 */
export function auditContingencyContract({ contract, invoice } = {}) {
  if (!isRecord(contract) || !isRecord(invoice)) {
    throw new TypeError('contract and invoice must both be structured objects');
  }
  const sourceDigest = sha256(encodeCanonical({ contract, invoice }));
  const findings = [];
  const contractRequired = [
    ['id', 'Contract identifier'],
    ['counterparty', 'Counterparty'],
    ['currency', 'Currency'],
    ['grossAmount', 'Gross contract amount'],
    ['contingencyRatePercent', 'Contingency rate'],
    ['paymentTrigger', 'Payment trigger'],
    ['dueDays', 'Payment due interval'],
    ['terminationClause', 'Termination terms'],
    ['disputeResolutionClause', 'Dispute-resolution terms'],
    ['governingLaw', 'Governing-law field'],
    ['signedAt', 'Signature date/status']
  ];
  const invoiceRequired = [
    ['id', 'Invoice identifier'],
    ['contractId', 'Referenced contract identifier'],
    ['counterparty', 'Counterparty'],
    ['currency', 'Currency'],
    ['grossAmount', 'Gross invoice amount'],
    ['contingencyFee', 'Contingency fee'],
    ['issuedAt', 'Issue date'],
    ['dueAt', 'Due date']
  ];
  for (const [key, label] of contractRequired) {
    const value = contract[key];
    const missing = value == null || (typeof value === 'string' && !value.trim());
    if (missing) addFinding(findings, 'CONTRACT_TERM_MISSING', 'review', 'contract.' + key, label + ' is missing.');
  }
  for (const [key, label] of invoiceRequired) {
    const value = invoice[key];
    const missing = value == null || (typeof value === 'string' && !value.trim());
    if (missing) addFinding(findings, 'INVOICE_FIELD_MISSING', 'review', 'invoice.' + key, label + ' is missing.');
  }

  if (text(contract.id) && text(invoice.contractId) && text(contract.id) !== text(invoice.contractId)) {
    addFinding(findings, 'CONTRACT_REFERENCE_MISMATCH', 'high', 'invoice.contractId',
      'Invoice references a different contract.', { contractId: text(contract.id), invoiceContractId: text(invoice.contractId) });
  }
  if (text(contract.counterparty) && text(invoice.counterparty) &&
      text(contract.counterparty).toLocaleLowerCase() !== text(invoice.counterparty).toLocaleLowerCase()) {
    addFinding(findings, 'COUNTERPARTY_MISMATCH', 'high', 'invoice.counterparty',
      'Invoice and contract counterparty names do not match.', { contractCounterparty: text(contract.counterparty), invoiceCounterparty: text(invoice.counterparty) });
  }
  const contractCurrency = text(contract.currency).toUpperCase();
  const invoiceCurrency = text(invoice.currency).toUpperCase();
  if (contractCurrency && invoiceCurrency && contractCurrency !== invoiceCurrency) {
    addFinding(findings, 'CURRENCY_MISMATCH', 'high', 'invoice.currency',
      'Invoice and contract currencies do not match.', { contractCurrency, invoiceCurrency });
  }
  if (finite(contract.grossAmount) && finite(invoice.grossAmount) &&
      money(contract.grossAmount) !== money(invoice.grossAmount)) {
    addFinding(findings, 'GROSS_AMOUNT_MISMATCH', 'high', 'invoice.grossAmount',
      'Invoice gross amount differs from the contract amount.', { contractAmount: money(contract.grossAmount), invoiceAmount: money(invoice.grossAmount) });
  }

  if (finite(contract.grossAmount) && Number(contract.grossAmount) < 0) {
    addFinding(findings, 'NEGATIVE_CONTRACT_AMOUNT', 'high', 'contract.grossAmount', 'Contract gross amount cannot be negative.');
  }
  if (finite(contract.contingencyRatePercent) &&
      (Number(contract.contingencyRatePercent) < 0 || Number(contract.contingencyRatePercent) > 100)) {
    addFinding(findings, 'CONTINGENCY_RATE_OUT_OF_RANGE', 'high', 'contract.contingencyRatePercent',
      'Contingency rate must be between 0 and 100 percent.');
  }
  if (finite(contract.grossAmount) && finite(contract.contingencyRatePercent) &&
      Number(contract.grossAmount) >= 0 && Number(contract.contingencyRatePercent) >= 0 &&
      Number(contract.contingencyRatePercent) <= 100 && finite(invoice.contingencyFee)) {
    let expectedFee = Math.round(Number(contract.grossAmount) * Number(contract.contingencyRatePercent)) / 100;
    if (finite(contract.feeCapAmount)) {
      if (Number(contract.feeCapAmount) < 0) {
        addFinding(findings, 'NEGATIVE_FEE_CAP', 'high', 'contract.feeCapAmount', 'Fee cap cannot be negative.');
      } else expectedFee = Math.min(expectedFee, money(contract.feeCapAmount));
    }
    expectedFee = money(expectedFee);
    const actualFee = money(invoice.contingencyFee);
    if (actualFee !== expectedFee) {
      addFinding(findings, 'CONTINGENCY_FEE_MISMATCH', 'high', 'invoice.contingencyFee',
        'Invoice contingency fee differs from the arithmetic result of the stated rate and cap.',
        { expectedFee, invoiceFee: actualFee, ratePercent: Number(contract.contingencyRatePercent), feeCapAmount: finite(contract.feeCapAmount) ? money(contract.feeCapAmount) : null });
    }
  }

  if (finite(contract.dueDays) && Number(contract.dueDays) < 0) {
    addFinding(findings, 'INVALID_DUE_INTERVAL', 'high', 'contract.dueDays', 'Payment due interval cannot be negative.');
  }
  const issueTime = date(invoice.issuedAt);
  const dueTime = date(invoice.dueAt);
  if (issueTime !== null && dueTime !== null && dueTime < issueTime) {
    addFinding(findings, 'DUE_DATE_BEFORE_ISSUE_DATE', 'high', 'invoice.dueAt', 'Invoice due date precedes its issue date.');
  }
  if (issueTime !== null && dueTime !== null && finite(contract.dueDays) && Number(contract.dueDays) >= 0) {
    const expectedDue = issueTime + Number(contract.dueDays) * 86400000;
    if (Math.abs(dueTime - expectedDue) > 86400000) {
      addFinding(findings, 'DUE_DATE_INTERVAL_MISMATCH', 'review', 'invoice.dueAt',
        'Invoice due date differs from the contract interval by more than one day.',
        { expectedDueAt: new Date(expectedDue).toISOString(), invoiceDueAt: new Date(dueTime).toISOString() });
    }
  }

  const status = findings.some(item => item.severity === 'high')
    ? 'review-required'
    : findings.length ? 'needs-review' : 'checks-passed';
  return Object.freeze({
    schemaVersion: 'kash-korner.contingency-audit.v1',
    sourceDigest,
    status,
    findings: Object.freeze(findings.map(item => Object.freeze(item))),
    findingCount: findings.length,
    disclaimer: 'Automated consistency checks only. This is not legal, tax, accounting, or payment authorization.'
  });
}
