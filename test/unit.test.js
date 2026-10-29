'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { threeWayMatch } = require('../srv/engine/three-way-match');
const rules = require('../srv/engine/risk-rules');
const { layoutParse, validate, toISODate } = require('../srv/ai/extractor');
const knowledge = require('../srv/ai/knowledge');
const payments = require('../srv/engine/payment-run');
const { slaState } = require('../srv/engine/sla');
const settings = require('../srv/engine/settings');

const PO = { poNumber: '4500000101', supplier: '17300001', currency: 'INR', poDate: '2026-05-01',
  items: [{ poItem: '10', material: 'RM-STL-0042', description: 'MS Steel Plate 6mm', quantity: 100, unit: 'EA', netPrice: 2450 }] };
const GR = [{ poItem: '10', quantity: 100 }];
const inv = (o = {}) => ({ vendorId: '17300001', currency: 'INR', items: [{ lineNo: 1, material: 'RM-STL-0042', description: 'MS Steel Plate 6mm', quantity: 100, unitPrice: 2450, amount: 245000, ...o }] });

describe('3-way match', () => {
  test('clean invoice matches', () => assert.equal(threeWayMatch(inv(), PO, GR).status, 'MATCHED'));
  test('price within 2% tolerance is OK', () => assert.equal(threeWayMatch(inv({ unitPrice: 2490 }), PO, GR).lines[0].status, 'OK'));
  test('price 3% above PO warns', () => assert.equal(threeWayMatch(inv({ unitPrice: 2524 }), PO, GR).lines[0].status, 'WARN'));
  test('price 8% above PO fails', () => assert.equal(threeWayMatch(inv({ unitPrice: 2646 }), PO, GR).lines[0].status, 'FAIL'));
  test('billing more than received fails and computes overpayment', () => {
    const r = threeWayMatch(inv({ quantity: 100 }), PO, [{ poItem: '10', quantity: 60 }]);
    assert.equal(r.status, 'EXCEPTION');
    assert.equal(r.varianceAmount, 40 * 2450);
  });
  test('no goods receipt fails (GR-based IV)', () => assert.equal(threeWayMatch(inv(), PO, []).lines[0].status, 'FAIL'));
  test('missing PO -> NO_PO', () => assert.equal(threeWayMatch(inv(), null, []).status, 'NO_PO'));
  test('vendor mismatch is a header failure', () => assert.equal(threeWayMatch({ ...inv(), vendorId: '999' }, PO, GR).header.find((h) => h.check === 'VENDOR').status, 'FAIL'));
  test('matches by description when material is missing', () => assert.equal(threeWayMatch(inv({ material: null }), PO, GR).lines[0].poItem, '10'));
});

describe('risk rules', () => {
  const supplier = { id: '17300001', name: 'Bharat Steel', gstin: '36AABCB1234F1Z5', bankAccount: 'HDFC0000412-50200012345678', createdOn: '2019-01-01' };
  const base = { invoiceNumber: 'BSC/1', vendorName: 'Bharat Steel', vendorGstin: supplier.gstin, bankAccount: supplier.bankAccount, invoiceDate: '2026-05-05', grossAmount: 289100, items: inv().items };
  const ctx = (o = {}, extra = {}) => ({ invoice: { ...base, ...o }, supplier, po: PO, match: threeWayMatch(inv(), PO, GR), history: [], ...extra });
  const codes = (c) => rules.evaluate(c).map((f) => f.code);

  test('clean invoice has no findings', () => assert.deepEqual(codes(ctx()), []));
  test('bank account change is critical and floors the score', () => {
    const f = rules.evaluate(ctx({ bankAccount: 'IDFB0080214-1' }));
    assert.ok(f.some((x) => x.code === 'BANK_ACCOUNT_MISMATCH' && x.severity === 'Critical'));
    assert.equal(rules.aggregate(f).level, 'Critical');
  });
  test('duplicate invoice number', () => assert.ok(codes(ctx({}, { history: [{ vendor_ID: '17300001', invoiceNumber: 'bsc-1', grossAmount: 1, invoiceDate: '2026-04-01', status: 'Posted' }] })).includes('DUPLICATE_INVOICE')));
  test('GSTIN mismatch', () => assert.ok(codes(ctx({ vendorGstin: '36AAACX9921B1Z0' })).includes('GSTIN_MISMATCH')));
  test('split invoicing across approval limit', () => {
    const history = [{ vendor_ID: '17300001', invoiceNumber: 'X', grossAmount: 900000, invoiceDate: '2026-05-01', status: 'Exception' }];
    assert.ok(codes(ctx({ grossAmount: 950000 }, { history })).includes('SPLIT_INVOICING'));
  });
  test('feature vector has the ML contract fields', () => assert.deepEqual(Object.keys(rules.features(ctx())).length, 10));
  test('vendor payment block is critical', () => {
    const f = rules.evaluate({ ...ctx(), supplier: { ...supplier, paymentBlocked: true, blockReason: 'fraud investigation' } });
    assert.ok(f.some((x) => x.code === 'VENDOR_PAYMENT_BLOCKED' && x.severity === 'Critical'));
  });
  test('runtime approval limit drives threshold checks', () => {
    assert.ok(!codes(ctx()).includes('THRESHOLD_PROXIMITY'));
    assert.ok(codes({ ...ctx(), approvalLimit: 300000 }).includes('THRESHOLD_PROXIMITY'));
  });
});

describe('payment run', () => {
  const inv = (o = {}) => ({ ID: 'i1', invoiceNumber: 'X/1', vendor_ID: 'V1', vendorName: 'V', invoiceDate: '2026-10-01', dueDate: '2026-10-31', grossAmount: 100000, ...o });
  const net30 = { paymentTerms: 'NT30' }; // 2% within 10 days, net 30
  const at = (paymentDate, i = inv(), v = net30, horizonDays = 7) => payments.evaluateItem(i, v, { paymentDate, horizonDays });

  test('overdue invoices are paid', () => {
    const r = at('2026-11-05');
    assert.deepEqual([r.include, r.daysToDue, r.discount], [true, -5, 0]);
    assert.equal(r.lostDiscount, 2000);
  });
  test('invoices due within the horizon are paid', () => assert.equal(at('2026-10-26').include, true));
  test('pays early to capture the cash discount', () => {
    const r = at('2026-10-08');
    assert.deepEqual([r.include, r.discount, r.payAmount], [true, 2000, 98000]);
    assert.match(r.reason, /cash discount/);
  });
  test('not yet due without discount is left for a later run', () => assert.equal(at('2026-10-15').include, false));
  test('vendor payment block excludes the invoice', () => {
    const r = at('2026-11-05', inv(), { ...net30, paymentBlocked: true, blockReason: 'BEC suspicion' });
    assert.deepEqual([r.include, r.blocked], [false, true]);
  });
  test('due date falls back to payment terms', () => assert.equal(at('2026-10-20', inv({ dueDate: null }), { paymentTerms: 'NT15' }).dueDate, '2026-10-16'));
  test('proposal totals and aging add up', () => {
    const p = payments.proposal([inv(), inv({ ID: 'i2', dueDate: '2026-08-01', grossAmount: 50000 }), inv({ ID: 'i3', dueDate: '2026-12-31', invoiceDate: '2026-09-01' })],
      { V1: net30 }, { paymentDate: '2026-10-29', horizonDays: 7 });
    assert.equal(p.totals.openItems, 3);
    assert.equal(p.totals.proposedItems, 2);
    assert.equal(p.totals.overdueAmount, 50000);
    assert.equal(p.aging.reduce((s, b) => s + b.amount, 0), p.totals.openAmount);
    assert.equal(p.forecast[0].week, 'Overdue');
  });
});

describe('exception SLA', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  test('old exception breaches the SLA', () => assert.equal(slaState({ status: 'Exception', receivedAt: '2026-10-20T09:00:00Z' }, 5, now).breached, true));
  test('fresh exception is within the SLA', () => assert.equal(slaState({ status: 'Exception', receivedAt: '2026-10-27T09:00:00Z' }, 5, now).breached, false));
  test('hold clock starts when the invoice was put on hold', () => {
    const s = slaState({ status: 'OnHold', receivedAt: '2026-06-01T00:00:00Z', heldAt: '2026-10-28T00:00:00Z' }, 5, now);
    assert.deepEqual([s.ageDays, s.breached], [1, false]);
  });
  test('approved invoices are not under the exception SLA', () => assert.equal(slaState({ status: 'Approved', receivedAt: '2026-01-01' }, 5, now).applies, false));
});

describe('runtime settings', () => {
  const all = settings.defaults();
  test('accepts a value within bounds', () => assert.equal(settings.validate('slaDays', 10, all), null));
  test('rejects out-of-range values', () => assert.match(settings.validate('pricePctWarn', 30, all), /between/));
  test('block tolerance cannot be below confirm tolerance', () => assert.match(settings.validate('pricePctFail', 1, all), /cannot be lower/));
  test('rejects unknown settings', () => assert.match(settings.validate('foo', 1, all), /Unknown/));
});

describe('document extraction (layout parser)', () => {
  const text = `TAX INVOICE\nBharat Steel Components Pvt Ltd\nGSTIN: 36AABCB1234F1Z5\nInvoice No: BSC/26-247/4964\nInvoice Date: 04-05-2026\nDue Date: 03-06-2026\nPO Number: 4500000101\nBuyer GSTIN: 36AAACA4521K1ZQ\n1 RM-STL-0042 MS Steel Plate 6mm 1250x2500 120 EA 2,450.00 2,94,000.00\nSub Total: 2,94,000.00\nCGST 9% + SGST 9%: 52,920.00\nGrand Total (INR): 3,46,920.00\nBank Account: HDFC0000412-50200012345678`;
  const r = layoutParse(text);
  test('parses header fields with Indian number format', () => {
    assert.equal(r.invoiceNumber, 'BSC/26-247/4964');
    assert.equal(r.poNumber, '4500000101');
    assert.equal(r.invoiceDate, '2026-05-04');
    assert.equal(r.grossAmount, 346920);
    assert.equal(r.vendorGstin, '36AABCB1234F1Z5');
  });
  test('parses line items', () => assert.deepEqual([r.items.length, r.items[0].quantity, r.items[0].amount], [1, 120, 294000]));
  test('validation passes arithmetic checks', () => assert.equal(validate(r).confidence, 100));
  test('date normalisation', () => assert.equal(toISODate('5/7/26'), '2026-07-05'));
});

describe('policy RAG', () => {
  test('finds tolerance policy', () => assert.match(knowledge.search('price tolerance above PO')[0].title, /tolerance/i));
  test('finds MSME rule', () => assert.match(knowledge.search('MSME payment 45 days')[0].content, /45 days/));
});
