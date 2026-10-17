import test from 'node:test';
import assert from 'node:assert/strict';
import { auditContingencyContract } from '../src/apps/kash-korner-audit.mjs';

const contract = () => ({
  id: 'contract-1',
  counterparty: 'Example Client',
  currency: 'USD',
  grossAmount: 1000,
  contingencyRatePercent: 10,
  feeCapAmount: 150,
  paymentTrigger: 'invoice paid',
  dueDays: 30,
  terminationClause: 'Written notice',
  disputeResolutionClause: 'Negotiation then mediation',
  governingLaw: 'State specified in signed agreement',
  signedAt: '2026-10-01T00:00:00.000Z'
});
const invoice = () => ({
  id: 'invoice-1',
  contractId: 'contract-1',
  counterparty: 'Example Client',
  currency: 'USD',
  grossAmount: 1000,
  contingencyFee: 100,
  issuedAt: '2026-10-01T00:00:00.000Z',
  dueAt: '2026-10-31T00:00:00.000Z'
});

test('Kash-Korner contingency audit reports arithmetic and references as consistent', () => {
  const result = auditContingencyContract({ contract: contract(), invoice: invoice() });
  assert.equal(result.status, 'checks-passed');
  assert.equal(result.findingCount, 0);
  assert.match(result.sourceDigest, /^[a-f0-9]{64}$/);
  assert.match(result.schemaVersion, /contingency-audit/);
  assert.match(result.disclaimer, /not legal/);
});

test('Kash-Korner audit flags contract, counterparty, currency, and fee discrepancies', () => {
  const bill = invoice();
  bill.contractId = 'contract-other';
  bill.counterparty = 'Different Client';
  bill.currency = 'EUR';
  bill.contingencyFee = 400;
  const result = auditContingencyContract({ contract: contract(), invoice: bill });
  assert.equal(result.status, 'review-required');
  const codes = new Set(result.findings.map(item => item.code));
  assert.ok(codes.has('CONTRACT_REFERENCE_MISMATCH'));
  assert.ok(codes.has('COUNTERPARTY_MISMATCH'));
  assert.ok(codes.has('CURRENCY_MISMATCH'));
  assert.ok(codes.has('CONTINGENCY_FEE_MISMATCH'));
});

test('Kash-Korner audit identifies missing terms and never mutates input records', () => {
  const sourceContract = contract();
  const sourceInvoice = invoice();
  delete sourceContract.governingLaw;
  delete sourceContract.terminationClause;
  delete sourceInvoice.dueAt;
  const beforeContract = structuredClone(sourceContract);
  const beforeInvoice = structuredClone(sourceInvoice);
  const result = auditContingencyContract({ contract: sourceContract, invoice: sourceInvoice });
  assert.equal(result.status, 'needs-review');
  assert.ok(result.findings.some(item => item.path === 'contract.governingLaw'));
  assert.ok(result.findings.some(item => item.path === 'contract.terminationClause'));
  assert.ok(result.findings.some(item => item.path === 'invoice.dueAt'));
  assert.deepEqual(sourceContract, beforeContract);
  assert.deepEqual(sourceInvoice, beforeInvoice);
});

test('Kash-Korner audit flags malformed amounts, currencies, and dates', () => {
  const sourceContract = contract();
  const sourceInvoice = invoice();
  sourceContract.grossAmount = 'not-a-number';
  sourceContract.currency = 'US';
  sourceInvoice.contingencyFee = 'NaN';
  sourceInvoice.issuedAt = 'not-a-date';
  const result = auditContingencyContract({ contract: sourceContract, invoice: sourceInvoice });
  const codes = new Set(result.findings.map(item => item.code));
  assert.equal(result.status, 'review-required');
  assert.ok(codes.has('INVALID_NUMERIC_CONTRACT_TERM'));
  assert.ok(codes.has('INVALID_CONTRACT_CURRENCY'));
  assert.ok(codes.has('INVALID_NUMERIC_INVOICE_FIELD'));
  assert.ok(codes.has('INVALID_INVOICE_DATE'));
});

test('KashKorner page exposes the structured contingency audit UI', async () => {
  const html = await (await import('node:fs/promises')).readFile(new URL('../public/kash-korner.html', import.meta.url), 'utf8');
  assert.match(html, /Contingency contract audit/);
  assert.match(html, /id="audit-contract"/);
  assert.match(html, /id="audit-invoice"/);
  assert.match(html, /\/api\/kash-korner\/audits\/contingency/);
  assert.match(html, /Not persisted; not transmitted to third parties/);
});

test('Kash-Korner audit rejects unstructured input', () => {
  assert.throws(() => auditContingencyContract({ contract: [], invoice: invoice() }), /structured objects/);
  assert.throws(() => auditContingencyContract({ contract: contract(), invoice: null }), /structured objects/);
});
