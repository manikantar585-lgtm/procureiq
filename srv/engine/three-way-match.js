/**
 * 3-way match: Supplier Invoice  vs  Purchase Order  vs  Goods Receipt.
 *
 * Mirrors the logic of SAP Logistics Invoice Verification (MIRO) tolerance keys:
 *   PP - price variance        (TOL_PRICE_PCT, default 2 %)
 *   DQ - quantity > delivered  (invoice qty must not exceed GR qty)
 *   BW - GR-based IV           (no GR -> blocked)
 * Pure function: no I/O, fully unit-tested.
 */
'use strict';

const DEFAULTS = {
  pricePctWarn: Number(process.env.TOL_PRICE_PCT || 2),   // within -> OK, above -> WARN
  pricePctFail: Number(process.env.TOL_PRICE_PCT_FAIL || 5),
  qtyAbsTolerance: 0.001
};

const r2 = (n) => Math.round(n * 100) / 100;

function similarity(a = '', b = '') {
  const tok = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1));
  const A = tok(a), B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach((t) => B.has(t) && inter++);
  return inter / Math.max(A.size, B.size);
}

/** Pick the PO line an invoice line refers to: explicit item no. > material > description similarity. */
function findPoItem(line, poItems, used) {
  const free = poItems.filter((p) => !used.has(p.poItem));
  if (line.poItem) { const x = free.find((p) => p.poItem === String(line.poItem)); if (x) return { item: x, by: 'PO item' }; }
  if (line.material) { const x = free.find((p) => p.material && p.material.toUpperCase() === line.material.toUpperCase()); if (x) return { item: x, by: 'material' }; }
  let best = null, score = 0;
  for (const p of free) { const s = similarity(line.description, p.description); if (s > score) { score = s; best = p; } }
  return score >= 0.5 ? { item: best, by: `description (${Math.round(score * 100)}%)` } : { item: null, by: null };
}

/**
 * @param invoice  { vendorId, currency, items:[{lineNo, material, description, quantity, unitPrice, amount}] }
 * @param po       normalised PO or null
 * @param grs      normalised goods receipts [{poItem, quantity}]
 * @returns { status: 'MATCHED'|'EXCEPTION'|'NO_PO', header:[...], lines:[...], varianceAmount }
 */
function threeWayMatch(invoice, po, grs = [], opts = {}) {
  const tol = { ...DEFAULTS, ...opts };
  const header = [];
  if (!po) {
    return {
      status: 'NO_PO',
      header: [{ check: 'PO_EXISTS', status: 'FAIL', message: invoice.poNumber ? `Purchase order ${invoice.poNumber} not found in SAP S/4HANA` : 'Invoice does not reference a purchase order' }],
      lines: (invoice.items || []).map((l) => ({ lineNo: l.lineNo, material: l.material, description: l.description, invoiceQty: l.quantity, invoicePrice: l.unitPrice, status: 'FAIL', message: 'No purchase order to match against' })),
      varianceAmount: 0
    };
  }

  header.push({ check: 'PO_EXISTS', status: 'OK', message: `PO ${po.poNumber} found (${po.items.length} item(s))` });
  if (invoice.vendorId && po.supplier && invoice.vendorId !== po.supplier) {
    header.push({ check: 'VENDOR', status: 'FAIL', message: `Invoice vendor ${invoice.vendorId} differs from PO supplier ${po.supplier}` });
  } else header.push({ check: 'VENDOR', status: 'OK', message: 'Invoicing party matches PO supplier' });
  if (invoice.currency && po.currency && invoice.currency !== po.currency) {
    header.push({ check: 'CURRENCY', status: 'FAIL', message: `Currency ${invoice.currency} differs from PO currency ${po.currency}` });
  }

  const grByItem = {};
  grs.forEach((g) => { grByItem[g.poItem] = (grByItem[g.poItem] || 0) + g.quantity; });

  const used = new Set();
  let varianceAmount = 0;
  const lines = (invoice.items || []).map((l) => {
    const { item, by } = findPoItem(l, po.items, used);
    if (!item) {
      return { lineNo: l.lineNo, material: l.material, description: l.description, invoiceQty: l.quantity, invoicePrice: l.unitPrice, status: 'FAIL', message: 'No matching PO line (unordered item)' };
    }
    used.add(item.poItem);
    const grQty = grByItem[item.poItem] || 0;
    const pricePct = item.netPrice ? r2(((l.unitPrice - item.netPrice) / item.netPrice) * 100) : 0;
    const msgs = [];
    let status = 'OK';
    const worsen = (s) => { if (s === 'FAIL' || (s === 'WARN' && status === 'OK')) status = s; };

    if (grQty <= 0) { worsen('FAIL'); msgs.push('No goods receipt posted (GR-based IV)'); }
    else if (l.quantity - grQty > tol.qtyAbsTolerance) {
      worsen('FAIL');
      msgs.push(`Billed ${l.quantity} ${item.unit} but only ${grQty} received`);
      varianceAmount += (l.quantity - grQty) * l.unitPrice;
    }
    if (l.quantity - item.quantity > tol.qtyAbsTolerance) { worsen('FAIL'); msgs.push(`Billed qty exceeds ordered qty ${item.quantity}`); }

    if (pricePct > tol.pricePctFail) { worsen('FAIL'); msgs.push(`Unit price ${pricePct}% above PO price ${item.netPrice}`); }
    else if (pricePct > tol.pricePctWarn) { worsen('WARN'); msgs.push(`Unit price ${pricePct}% above PO price (tolerance ${tol.pricePctWarn}%)`); }
    else if (pricePct < -tol.pricePctFail) { worsen('WARN'); msgs.push(`Unit price ${Math.abs(pricePct)}% below PO price - verify`); }
    if (pricePct > 0) varianceAmount += (l.unitPrice - item.netPrice) * Math.min(l.quantity, grQty || l.quantity);

    if (!msgs.length) msgs.push(`Matched by ${by}`);
    return {
      lineNo: l.lineNo, poItem: item.poItem, material: l.material || item.material, description: l.description,
      invoiceQty: l.quantity, poQty: item.quantity, grQty, invoicePrice: l.unitPrice, poPrice: item.netPrice,
      priceVariancePct: pricePct, status, message: msgs.join('; ')
    };
  });

  const anyFail = header.some((h) => h.status === 'FAIL') || lines.some((l) => l.status === 'FAIL');
  const anyWarn = lines.some((l) => l.status === 'WARN');
  return { status: anyFail || anyWarn ? 'EXCEPTION' : 'MATCHED', header, lines, varianceAmount: r2(varianceAmount) };
}

module.exports = { threeWayMatch, similarity, DEFAULTS };
