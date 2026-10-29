#!/usr/bin/env node
/**
 * Generates:
 *  - srv/sap/mock/*.json        S/4HANA-shaped mock data (OData V2 field names)
 *  - samples/seed-invoices.json invoices replayed through the pipeline on first start
 *  - samples/invoices/*.pdf     fresh supplier invoices for the live upload demo
 */
'use strict';
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const ds = require('./lib/demo-dataset');

const root = path.join(__dirname, '..');
const mockDir = path.join(root, 'srv/sap/mock');
const sampleDir = path.join(root, 'samples');

const { purchaseOrders, goodsReceipts } = ds.buildPurchasing();
const suppliers = ds.SUPPLIERS.map(({ Prefix, Address, Category, PaymentTerms, BankAccount, ...s }) => ({
  ...s, SupplierAccountGroup: 'SUPL', PostingIsBlocked: false,
  // fields not in A_Supplier itself but in related entities (bank / company code), flattened for the mock
  _Bank: BankAccount, _Category: Category, _PaymentTerms: PaymentTerms, _Address: Address
}));

fs.writeFileSync(path.join(mockDir, 'A_Supplier.json'), JSON.stringify(suppliers, null, 2));
fs.writeFileSync(path.join(mockDir, 'A_PurchaseOrder.json'), JSON.stringify(purchaseOrders, null, 2));
fs.writeFileSync(path.join(mockDir, 'A_MaterialDocumentItem.json'), JSON.stringify(goodsReceipts, null, 2));

const seeds = ds.buildSeedInvoices(purchaseOrders, goodsReceipts).map((s) => ({
  scenario: s.scenario, finalStatus: s.finalStatus, fileName: s.doc.invoiceNumber.replace(/\//g, '_') + '.pdf',
  text: ds.renderInvoiceText(s.doc)
}));
fs.writeFileSync(path.join(sampleDir, 'seed-invoices.json'), JSON.stringify(seeds, null, 2));

function writePdf(doc, file) {
  return new Promise((resolve) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Invoice ${doc.invoiceNumber}`, Author: doc.vendor.SupplierName } });
    const out = fs.createWriteStream(file);
    pdf.pipe(out);
    const accent = '#0a6ed1';
    pdf.rect(0, 0, pdf.page.width, 6).fill(accent);
    pdf.fillColor('#1d2d3e').font('Helvetica-Bold').fontSize(18).text(doc.vendor.SupplierName, 48, 36);
    pdf.font('Helvetica').fontSize(9).fillColor('#556b82').text(doc.vendor.Address).text(`GSTIN: ${doc.gstin}`);
    pdf.font('Helvetica-Bold').fontSize(20).fillColor(accent).text('TAX INVOICE', 380, 36, { width: 168, align: 'right' });
    pdf.moveDown(2);
    let y = 120;
    pdf.fontSize(10).fillColor('#1d2d3e');
    const kv = [[`Invoice No: ${doc.invoiceNumber}`, `PO Number: ${doc.poNumber || 'N/A'}`], [`Invoice Date: ${ds.dmy(doc.invoiceDate)}`, `Due Date: ${ds.dmy(doc.dueDate)}`]];
    kv.forEach(([a, b]) => { pdf.font('Helvetica').text(a, 48, y); pdf.text(b, 320, y); y += 16; });
    y += 6;
    pdf.font('Helvetica').text(`Bill To: ${ds.COMPANY.name}, ${ds.COMPANY.address}`, 48, y, { width: 500 }); y += 28;
    pdf.text(`Buyer GSTIN: ${ds.COMPANY.gstin}`, 48, y); y += 26;
    // Table rendered one row per text run so it survives PDF text extraction
    pdf.rect(48, y - 4, 500, 18).fill('#eff4f9');
    pdf.fillColor('#1d2d3e').font('Helvetica-Bold').fontSize(9).text('Sl Item Code Description Qty Unit Rate Amount', 54, y);
    y += 22;
    pdf.font('Helvetica').fontSize(9);
    doc.lines.forEach((l) => {
      pdf.text(`${l.lineNo} ${l.material} ${l.description} ${l.quantity} ${l.unit} ${ds.inr(l.unitPrice)} ${ds.inr(l.amount)}`, 54, y, { width: 490 });
      y += 18;
      pdf.moveTo(48, y - 5).lineTo(548, y - 5).strokeColor('#d9e1ea').stroke();
    });
    y += 10;
    pdf.font('Helvetica').fontSize(10);
    [[`Sub Total: ${ds.inr(doc.net)}`], [`${doc.taxLabel}: ${ds.inr(doc.tax)}`]].forEach(([t]) => { pdf.text(t, 320, y, { width: 228, align: 'right' }); y += 16; });
    pdf.font('Helvetica-Bold').fontSize(12).fillColor(accent).text(`Grand Total (INR): ${ds.inr(doc.gross)}`, 260, y + 4, { width: 288, align: 'right' });
    y += 46;
    pdf.font('Helvetica').fontSize(9).fillColor('#556b82').text(`Bank Account: ${doc.bankAccount}`, 48, y);
    pdf.text('Payment by NEFT/RTGS only. Subject to Hyderabad jurisdiction.', 48, y + 14);
    pdf.fontSize(8).text('This is a computer generated invoice for demonstration purposes (fictional companies).', 48, 780, { width: 500, align: 'center' });
    pdf.end();
    out.on('finish', resolve);
  });
}

(async () => {
  const uploads = ds.buildDemoUploads(purchaseOrders, goodsReceipts);
  const readme = ['# Demo invoices', '', 'Upload these in the ProcureIQ app (Invoices > Upload) to watch the pipeline live.', '', '| File | Scenario |', '|---|---|'];
  for (const u of uploads) {
    await writePdf(u.doc, path.join(sampleDir, 'invoices', u.file));
    readme.push(`| ${u.file} | ${u.scenario} |`);
  }
  fs.writeFileSync(path.join(sampleDir, 'invoices', 'README.md'), readme.join('\n') + '\n');
  console.log(`Generated ${suppliers.length} suppliers, ${purchaseOrders.length} POs, ${goodsReceipts.length} GR items, ${seeds.length} seed invoices, ${uploads.length} demo PDFs`);
})();
