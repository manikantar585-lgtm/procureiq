/**
 * Invoice audit report (PDF) - one document with everything an internal or external auditor
 * asks for: extracted data, 3-way match, risk findings, AI reviewer note, decisions, discussion,
 * payment and the full audit trail, plus the SHA-256 of the original document.
 */
'use strict';
const PDFDocument = require('pdfkit');

const INK = '#1d2d3e', MUTED = '#556b82', ACCENT = '#0070f2', LINE = '#d9dee4';
const M = 48;

// The standard PDF fonts only cover WinAnsi: spell out the rupee sign and arrows used in app texts
const t = (s) => String(s ?? '-').replace(/₹/g, 'INR ').replace(/→/g, '->').replace(/≠/g, '!=').replace(/\*\*/g, '').replace(/[^\x00-\xFF–—‘’“”•…]/g, '');
const money = (n) => (n === null || n === undefined ? '-' : 'INR ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const stamp = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '-');
const num = (v) => (v === null || v === undefined ? '-' : String(Number(v)));
const STATUS = { OnHold: 'On hold' };
const HOLD = { VendorDispute: 'Vendor dispute', AwaitingCreditNote: 'Awaiting credit note', AwaitingGoodsReceipt: 'Awaiting goods receipt', BuyerConfirmation: 'Buyer confirmation', Other: 'Other' };

function heading(doc, text) {
  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).fillColor(ACCENT).text(text, M);
  doc.moveDown(0.3);
}

function keyValues(doc, pairs) {
  const colW = (doc.page.width - 2 * M) / 2;
  for (let i = 0; i < pairs.length; i += 2) {
    const y = doc.y;
    let h = 0;
    pairs.slice(i, i + 2).forEach(([k, v], j) => {
      const x = M + j * colW;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(k.toUpperCase(), x, y, { width: colW - 12 });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(t(v), x, doc.y + 1, { width: colW - 12 });
      h = Math.max(h, doc.y - y);
    });
    doc.x = M; doc.y = y + h + 6;
  }
}

function table(doc, cols, rows) {
  const width = cols.reduce((s, c) => s + c.width, 0);
  const row = (cells, header) => {
    doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: cols[i].width - 6 }))) + 6;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    let x = M;
    cells.forEach((c, i) => { doc.fillColor(header ? MUTED : INK).text(c, x + 3, y + 3, { width: cols[i].width - 6, align: cols[i].align || 'left' }); x += cols[i].width; });
    doc.moveTo(M, y + h).lineTo(M + width, y + h).strokeColor(LINE).lineWidth(0.5).stroke();
    doc.x = M; doc.y = y + h;
  };
  row(cols.map((c) => c.header), true);
  if (!rows.length) row(['None', ...cols.slice(1).map(() => '')]);
  rows.forEach((r) => row(r.map(t)));
}

function paragraph(doc, text, opts = {}) {
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(t(text), M, doc.y, { width: doc.page.width - 2 * M, ...opts });
}

/**
 * @param d { inv, items, match, anomalies, comments, audit, vendor, run, company, generatedBy }
 * @returns Promise<Buffer>
 */
function buildAuditReport(d) {
  const { inv } = d;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: `Audit report ${inv.invoiceNumber}`, Author: 'ProcureIQ' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);

    // title band
    doc.rect(0, 0, doc.page.width, 86).fill('#061a3a');
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff').text('Invoice Audit Report', M, 26);
    doc.font('Helvetica').fontSize(9).fillColor('#c9d6ea').text(t(`${d.company} · Accounts Payable · generated ${stamp(new Date())} by ${d.generatedBy} · ProcureIQ`), M, 52);
    doc.y = 110;

    keyValues(doc, [
      ['Invoice number', inv.invoiceNumber],
      ['Status', (STATUS[inv.status] || inv.status) + (inv.escalated ? ' (SLA escalated)' : '')],
      ['Vendor', `${inv.vendorName}${inv.vendor_ID ? ` (SAP ${inv.vendor_ID})` : ''}`],
      ['Purchase order', inv.poNumber || 'none'],
      ['Invoice date / due date', `${inv.invoiceDate || '-'} / ${inv.dueDate || '-'}`],
      ['Gross amount', `${money(inv.grossAmount)} (net ${money(inv.netAmount)} + GST ${money(inv.taxAmount)})`],
      ['3-way match', inv.matchStatus],
      ['Risk', `${Math.round(Number(inv.riskScore))}/100 (${inv.riskLevel})`],
      ['Bank account on invoice', inv.bankAccount],
      ['Bank account in vendor master', d.vendor?.bankAccount],
      ['AI extraction', `${inv.extractionEngine} · ${num(inv.extractionConfidence)}% confidence`],
      ['ML model', inv.mlModel],
      ['Received', `${stamp(inv.receivedAt)} via ${inv.source}`],
      ['SAP document', inv.sapDocument ? `${inv.sapDocument} / ${inv.sapFiscalYear}` : 'not posted'],
      ['Payment', inv.paidOn ? `${money(inv.paidAmount)} on ${inv.paidOn}${d.run ? ` (run ${d.run.runId})` : ''}${Number(inv.discountTaken) ? `, cash discount ${money(inv.discountTaken)}` : ''}` : 'not paid'],
      ['Document file', inv.fileName]
    ]);
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`DOCUMENT SHA-256  ${inv.documentHash || '-'}`, M, doc.y + 2);

    heading(doc, 'AI reviewer note');
    paragraph(doc, inv.aiSummary || 'No reviewer note.');

    heading(doc, `Risk findings (${d.anomalies.length})`);
    table(doc, [{ header: 'Severity', width: 60 }, { header: 'Code', width: 120 }, { header: 'Finding', width: 319 }],
      d.anomalies.map((a) => [`${a.severity}`, `${a.code} (${a.source})`, `${a.title}. ${a.detail}`]));

    heading(doc, '3-way match (invoice vs SAP PO vs goods receipt)');
    d.match.filter((m) => m.lineNo === 0).forEach((h) => paragraph(doc, `${h.status}  ${h.description}: ${h.message}`));
    doc.moveDown(0.3);
    table(doc, [
      { header: 'Line', width: 30 }, { header: 'Material', width: 78 }, { header: 'Inv qty', width: 44, align: 'right' }, { header: 'PO qty', width: 44, align: 'right' },
      { header: 'GR qty', width: 44, align: 'right' }, { header: 'Inv price', width: 62, align: 'right' }, { header: 'PO price', width: 62, align: 'right' }, { header: 'Result', width: 135 }
    ], d.match.filter((m) => m.lineNo > 0).map((m) => [String(m.lineNo), m.material || '-', num(m.invoiceQty), num(m.poQty), num(m.grQty), num(m.invoicePrice), num(m.poPrice), `${m.status}: ${m.message}`]));

    heading(doc, 'Decision');
    paragraph(doc, inv.decisionBy ? `${inv.status === 'Rejected' ? 'Rejected' : 'Approved'} by ${inv.decisionBy}: ${inv.decisionComment || 'no comment'}` : 'No approval decision yet.');
    if (inv.status === 'OnHold') paragraph(doc, `On hold since ${stamp(inv.heldAt)} by ${inv.heldBy} (${HOLD[inv.holdCategory] || inv.holdCategory}): ${inv.holdReason}`);

    heading(doc, `Discussion (${d.comments.length})`);
    table(doc, [{ header: 'When', width: 95 }, { header: 'Author', width: 110 }, { header: 'Comment', width: 294 }],
      d.comments.map((c) => [stamp(c.createdAt), c.authorName || c.author, c.text]));

    heading(doc, `Audit trail (${d.audit.length} entries)`);
    table(doc, [{ header: 'Timestamp', width: 95 }, { header: 'Action', width: 85 }, { header: 'Actor', width: 60 }, { header: 'Detail', width: 259 }],
      d.audit.map((a) => [stamp(a.createdAt), a.action, a.actor, a.detail]));

    // footer on every page
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(t(`ProcureIQ audit report · ${inv.invoiceNumber} · page ${i + 1} of ${range.count} · fictional data for demonstration`), M, doc.page.height - 32, { width: doc.page.width - 2 * M, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { buildAuditReport };
