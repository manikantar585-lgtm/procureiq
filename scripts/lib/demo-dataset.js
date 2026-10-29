/**
 * Deterministic demo dataset for ProcureIQ.
 *
 * Produces S/4HANA-shaped master & transactional data (suppliers, purchase orders,
 * goods receipts) for a fictional company "Aurora Industries Ltd" plus a set of
 * supplier invoices covering realistic Procure-to-Pay scenarios: clean matches,
 * price variances, partial deliveries, duplicates, bank-account fraud, threshold
 * splitting, GSTIN mismatches and invoices without a PO.
 */
'use strict';

// ---------- seeded PRNG (mulberry32) so the dataset is reproducible ----------
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261029);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
const round2 = (n) => Math.round(n * 100) / 100;

const COMPANY = {
  name: 'Aurora Industries Ltd',
  address: 'Survey No. 115, Genome Valley, Shamirpet, Hyderabad, Telangana 500078',
  gstin: '36AAACA4521K1ZQ',
  companyCode: 'IN01',
  purchasingOrg: 'IN10',
  plant: 'HY01'
};

const SUPPLIERS = [
  { Supplier: '17300001', SupplierName: 'Bharat Steel Components Pvt Ltd', CityName: 'Hyderabad', Country: 'IN', VATRegistration: '36AABCB1234F1Z5', BankAccount: 'HDFC0000412-50200012345678', Category: 'Raw Materials', PaymentTerms: 'NT30', CreationDate: '2019-04-11', Address: 'Plot 42, IDA Jeedimetla, Hyderabad, Telangana 500055', Prefix: 'BSC' },
  { Supplier: '17300002', SupplierName: 'Deccan Electricals & Controls', CityName: 'Secunderabad', Country: 'IN', VATRegistration: '36AAFCD7781M1Z2', BankAccount: 'ICIC0001290-129005001876', Category: 'Electrical', PaymentTerms: 'NT45', CreationDate: '2020-01-20', Address: '7-1-58, Rashtrapati Road, Secunderabad, Telangana 500003', Prefix: 'DEC' },
  { Supplier: '17300003', SupplierName: 'Sri Lakshmi Packaging Solutions', CityName: 'Vijayawada', Country: 'IN', VATRegistration: '37AAKFS5512P1Z9', BankAccount: 'SBIN0004471-38811290045', Category: 'Packaging', PaymentTerms: 'NT30', CreationDate: '2021-06-02', Address: 'Autonagar Industrial Estate, Vijayawada, Andhra Pradesh 520007', Prefix: 'SLP' },
  { Supplier: '17300004', SupplierName: 'TechNova IT Services LLP', CityName: 'Bengaluru', Country: 'IN', VATRegistration: '29AAQFT3390L1ZK', BankAccount: 'KKBK0008042-9412558830', Category: 'IT Services', PaymentTerms: 'NT15', CreationDate: '2022-09-14', Address: '3rd Floor, Prestige Tech Park, Outer Ring Road, Bengaluru 560103', Prefix: 'TNV' },
  { Supplier: '17300005', SupplierName: 'Godavari Chemicals Ltd', CityName: 'Rajahmundry', Country: 'IN', VATRegistration: '37AABCG6623Q1Z1', BankAccount: 'UBIN0531221-312201010087766', Category: 'Chemicals', PaymentTerms: 'NT60', CreationDate: '2018-11-30', Address: 'Industrial Area, Kadiyam Road, Rajahmundry, Andhra Pradesh 533103', Prefix: 'GCL' },
  { Supplier: '17300006', SupplierName: 'Precision Bearings India', CityName: 'Pune', Country: 'IN', VATRegistration: '27AAGCP9014N1ZA', BankAccount: 'HDFC0001855-50200077120034', Category: 'Mechanical', PaymentTerms: 'NT45', CreationDate: '2020-07-08', Address: 'MIDC Bhosari, Pune, Maharashtra 411026', Prefix: 'PBI' },
  { Supplier: '17300007', SupplierName: 'Krishna Logistics & Freight', CityName: 'Hyderabad', Country: 'IN', VATRegistration: '36AAMFK2241R1Z7', BankAccount: 'AXIS0000671-917020045512390', Category: 'Logistics', PaymentTerms: 'NT15', CreationDate: '2021-02-17', Address: 'Plot 9, Autonagar, Hayathnagar, Hyderabad 501505', Prefix: 'KLF' },
  { Supplier: '17300008', SupplierName: 'Nimbus Office Supplies', CityName: 'Hyderabad', Country: 'IN', VATRegistration: '36ABCPN8812E1Z3', BankAccount: 'SBIN0020063-40118852201', Category: 'Office Supplies', PaymentTerms: 'NT30', CreationDate: '2023-03-05', Address: 'Ameerpet X Roads, Hyderabad, Telangana 500016', Prefix: 'NOS' },
  { Supplier: '17300009', SupplierName: 'Apex Industrial Tools', CityName: 'Hyderabad', Country: 'IN', VATRegistration: '36AAZFA7710H1Z4', BankAccount: 'YESB0000213-021388700001462', Category: 'Tools', PaymentTerms: 'NT07', CreationDate: '2026-08-28', Address: 'Shed 14, Balanagar Industrial Area, Hyderabad 500037', Prefix: 'AIT' },
  { Supplier: '17300010', SupplierName: 'Vertex Safety Equipment', CityName: 'Chennai', Country: 'IN', VATRegistration: '33AAHCV4407G1ZM', BankAccount: 'IOBA0000384-038402000017221', Category: 'Safety', PaymentTerms: 'NT30', CreationDate: '2019-12-12', Address: 'Ambattur Industrial Estate, Chennai, Tamil Nadu 600058', Prefix: 'VSE' }
];

const CATALOG = {
  17300001: [['RM-STL-0042', 'MS Steel Plate 6mm 1250x2500', 'EA', 2450], ['RM-STL-0118', 'SS304 Round Bar 25mm', 'KG', 268], ['RM-STL-0207', 'GI Sheet 1.2mm', 'EA', 1890]],
  17300002: [['EL-CTR-2201', 'Siemens Contactor 3RT2026 24V', 'EA', 4120], ['EL-CBL-0450', 'Armoured Cable 4C x 16 sq mm', 'M', 612], ['EL-MCB-0063', 'MCB 63A Triple Pole', 'EA', 1385]],
  17300003: [['PK-BOX-0310', 'Corrugated Box 5-Ply 600x400x400', 'EA', 78], ['PK-STR-0020', 'Stretch Wrap Film 23 micron', 'RL', 1460], ['PK-PAL-1210', 'Heat-Treated Wooden Pallet 1200x1000', 'EA', 1150]],
  17300004: [['SV-IT-AMC', 'SAP Basis Support AMC - Monthly', 'MON', 185000], ['SV-IT-LAP', 'Laptop Provisioning & Imaging', 'EA', 2400], ['SV-IT-NET', 'Network Security Audit', 'EA', 145000]],
  17300005: [['CH-SOL-0011', 'Industrial Solvent IPA 99%', 'L', 142], ['CH-LUB-0450', 'Hydraulic Oil ISO VG 68', 'L', 236], ['CH-ACD-0030', 'Sulphuric Acid 98% (Drum)', 'DR', 9850]],
  17300006: [['MC-BRG-6205', 'Deep Groove Ball Bearing 6205-2RS', 'EA', 286], ['MC-BRG-22210', 'Spherical Roller Bearing 22210', 'EA', 3420], ['MC-SEAL-0080', 'Oil Seal 80x100x10', 'EA', 145]],
  17300007: [['SV-LOG-FTL', 'Full Truck Load Hyderabad-Chennai', 'TRP', 38500], ['SV-LOG-LTL', 'Part Load Freight per Tonne', 'TO', 4200], ['SV-LOG-WH', 'Warehousing Charges - Monthly', 'MON', 65000]],
  17300008: [['OF-PAP-A4', 'A4 Copier Paper 75 GSM (Ream)', 'RM', 245], ['OF-TNR-88A', 'Toner Cartridge 88A', 'EA', 2950], ['OF-CHR-ERG', 'Ergonomic Office Chair', 'EA', 8900]],
  17300009: [['TL-DRL-1300', 'Cordless Drill Driver 18V Kit', 'EA', 14800], ['TL-WRN-SET', 'Torque Wrench Set 1/2"', 'EA', 22500], ['TL-GRD-0100', 'Angle Grinder 100mm 900W', 'EA', 5650]],
  17300010: [['SF-HLM-0001', 'Safety Helmet ISI Marked', 'EA', 395], ['SF-SHO-0007', 'Safety Shoes Steel Toe', 'PR', 1650], ['SF-GLV-0012', 'Cut Resistant Gloves Level 5', 'PR', 310]]
};

const fmtDate = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return fmtDate(d); };

/** Build purchase orders + goods receipts across the last ~6 months. */
function buildPurchasing() {
  const purchaseOrders = [];
  const goodsReceipts = [];
  let poNo = 4500000101;
  let grNo = 5000001001;
  let apexCount = 0;
  const start = new Date('2026-04-20T00:00:00Z');
  const supplierCycle = ['17300001', '17300002', '17300003', '17300005', '17300006', '17300007', '17300008', '17300010', '17300004', '17300001', '17300002', '17300006', '17300003', '17300005', '17300010', '17300008', '17300007', '17300001', '17300002', '17300006', '17300004', '17300003', '17300005', '17300010', '17300001', '17300002', '17300006', '17300008', '17300009', '17300009', '17300001', '17300003', '17300005', '17300002', '17300010', '17300006'];

  supplierCycle.forEach((sup, idx) => {
    const d = new Date(start); d.setUTCDate(d.getUTCDate() + idx * 5 + between(0, 3));
    const poDate = fmtDate(d);
    const cat = CATALOG[sup];
    const itemCount = sup === '17300004' || sup === '17300007' || sup === '17300009' ? 1 : between(1, 3);
    const used = new Set();
    const items = [];
    for (let i = 0; i < itemCount; i++) {
      let m; do { m = pick(cat); } while (used.has(m[0]) && used.size < cat.length);
      if (sup === '17300009') m = apexCount++ % 2 === 0 ? cat[0] : cat[1]; // engineered split-invoicing scenario
      used.add(m[0]);
      const big = ['EA', 'PR', 'KG', 'M', 'L', 'RM'].includes(m[2]);
      let qty = m[3] > 50000 ? 1 : big ? between(2, 40) * (m[3] < 500 ? 25 : 5) : between(1, 6);
      if (sup === '17300009') qty = m[0] === 'TL-WRN-SET' ? 37 : 56; // each invoice lands just under the 10 lakh approval limit
      items.push({
        PurchaseOrder: String(poNo),
        PurchaseOrderItem: String((i + 1) * 10),
        Material: m[0],
        PurchaseOrderItemText: m[1],
        OrderQuantity: qty,
        PurchaseOrderQuantityUnit: m[2],
        NetPriceAmount: m[3],
        NetPriceQuantity: 1,
        DocumentCurrency: 'INR',
        Plant: COMPANY.plant,
        TaxCode: 'G8'
      });
    }
    const po = {
      PurchaseOrder: String(poNo),
      CompanyCode: COMPANY.companyCode,
      PurchaseOrderType: 'NB',
      PurchasingOrganization: COMPANY.purchasingOrg,
      PurchasingGroup: pick(['P01', 'P02', 'P03']),
      Supplier: sup,
      PurchaseOrderDate: poDate,
      DocumentCurrency: 'INR',
      PaymentTerms: SUPPLIERS.find((s) => s.Supplier === sup).PaymentTerms,
      PurchasingProcessingStatus: '05',
      to_PurchaseOrderItem: items
    };
    purchaseOrders.push(po);

    // Goods receipt (movement type 101). Some POs are partially delivered.
    const partial = idx % 7 === 3;
    const grDate = addDays(poDate, between(4, 12));
    items.forEach((it) => {
      const q = partial ? Math.max(1, Math.floor(it.OrderQuantity * 0.6)) : it.OrderQuantity;
      goodsReceipts.push({
        MaterialDocument: String(grNo),
        MaterialDocumentYear: grDate.slice(0, 4),
        MaterialDocumentItem: it.PurchaseOrderItem.replace(/0$/, ''),
        GoodsMovementType: '101',
        Material: it.Material,
        Plant: COMPANY.plant,
        PurchaseOrder: it.PurchaseOrder,
        PurchaseOrderItem: it.PurchaseOrderItem,
        QuantityInEntryUnit: q,
        EntryUnit: it.PurchaseOrderQuantityUnit,
        PostingDate: grDate
      });
    });
    grNo++;
    poNo++;
  });
  return { purchaseOrders, goodsReceipts };
}

/** Turn a PO into an invoice document (plain-text layout identical to the PDF). */
function invoiceFromPO(po, gr, opts = {}) {
  const sup = SUPPLIERS.find((s) => s.Supplier === (opts.supplier || po.Supplier));
  const lines = po.to_PurchaseOrderItem.map((it, i) => {
    const grQty = gr.filter((g) => g.PurchaseOrder === it.PurchaseOrder && g.PurchaseOrderItem === it.PurchaseOrderItem)
      .reduce((s, g) => s + g.QuantityInEntryUnit, 0);
    let qty = opts.billFullPO ? it.OrderQuantity : grQty || it.OrderQuantity;
    let price = it.NetPriceAmount;
    if (opts.priceUplift && i === 0) price = round2(price * (1 + opts.priceUplift));
    if (opts.qtyOverride && i === 0) qty = opts.qtyOverride;
    if (opts.priceOverride && i === 0) price = opts.priceOverride;
    return { lineNo: i + 1, material: it.Material, description: it.PurchaseOrderItemText, quantity: qty, unit: it.PurchaseOrderQuantityUnit, unitPrice: price, amount: round2(qty * price) };
  });
  const net = round2(lines.reduce((s, l) => s + l.amount, 0));
  const intra = sup.VATRegistration.startsWith('36');
  const tax = round2(net * 0.18);
  const invDate = opts.invoiceDate || addDays(gr.find((g) => g.PurchaseOrder === po.PurchaseOrder)?.PostingDate || po.PurchaseOrderDate, between(1, 6));
  const termDays = parseInt(sup.PaymentTerms.replace('NT', ''), 10) || 30;
  return {
    vendor: sup,
    invoiceNumber: opts.invoiceNumber || `${sup.Prefix}/${invDate.slice(2, 4)}-${String(between(100, 999))}/${String(between(1000, 9999))}`,
    invoiceDate: invDate,
    dueDate: addDays(invDate, termDays),
    poNumber: opts.noPO ? null : (opts.poNumberOverride || po.PurchaseOrder),
    gstin: opts.gstinOverride || sup.VATRegistration,
    bankAccount: opts.bankOverride || sup.BankAccount,
    lines,
    net,
    taxLabel: intra ? 'CGST 9% + SGST 9%' : 'IGST 18%',
    tax,
    gross: round2(net + tax)
  };
}

const inr = (n) => {
  const [int, dec] = Number(n).toFixed(2).split('.');
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3);
  return (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3 + '.' + dec;
};
const dmy = (iso) => iso.split('-').reverse().join('-');

function renderInvoiceText(inv) {
  const out = [];
  out.push('TAX INVOICE');
  out.push(inv.vendor.SupplierName);
  out.push(inv.vendor.Address);
  out.push(`GSTIN: ${inv.gstin}`);
  out.push('');
  out.push(`Invoice No: ${inv.invoiceNumber}`);
  out.push(`Invoice Date: ${dmy(inv.invoiceDate)}`);
  out.push(`Due Date: ${dmy(inv.dueDate)}`);
  out.push(`PO Number: ${inv.poNumber || 'N/A'}`);
  out.push(`Bill To: ${COMPANY.name}, ${COMPANY.address}`);
  out.push(`Buyer GSTIN: ${COMPANY.gstin}`);
  out.push('');
  out.push('Sl Item Code Description Qty Unit Rate Amount');
  inv.lines.forEach((l) => out.push(`${l.lineNo} ${l.material} ${l.description} ${l.quantity} ${l.unit} ${inr(l.unitPrice)} ${inr(l.amount)}`));
  out.push('');
  out.push(`Sub Total: ${inr(inv.net)}`);
  out.push(`${inv.taxLabel}: ${inr(inv.tax)}`);
  out.push(`Grand Total (INR): ${inr(inv.gross)}`);
  out.push('');
  out.push(`Bank Account: ${inv.bankAccount}`);
  out.push('Payment by NEFT/RTGS only. Subject to Hyderabad jurisdiction.');
  return out.join('\n');
}

/**
 * Seed invoices with their intended final workflow state.
 * scenario labels are only used for documentation - the pipeline discovers issues itself.
 */
function buildSeedInvoices(purchaseOrders, goodsReceipts) {
  const P = (i) => purchaseOrders[i];
  const seeds = [];
  const add = (po, opts, finalStatus, scenario) => seeds.push({ scenario, finalStatus, doc: invoiceFromPO(po, goodsReceipts, opts) });

  // Older, clean invoices -> already posted to SAP
  [0, 1, 2, 4, 5, 6, 7, 8, 9, 11, 12, 13].forEach((i) => add(P(i), {}, 'Posted', 'clean'));
  // Clean, waiting for approval
  [14, 15, 18, 19].forEach((i) => add(P(i), {}, 'Matched', 'clean'));
  // Price variance +7.5% on the first line
  add(P(16), { priceUplift: 0.075 }, null, 'price-variance');
  add(P(20), { priceUplift: 0.12 }, 'Rejected', 'price-variance');
  // Partial delivery billed in full (qty invoiced > qty received)
  add(P(3), { billFullPO: true }, null, 'qty-over-gr');
  add(P(17), { billFullPO: true }, null, 'qty-over-gr');
  // Duplicate submission of an already posted invoice
  seeds.push({ scenario: 'duplicate', finalStatus: null, doc: { ...seeds[2].doc, invoiceDate: addDays(seeds[2].doc.invoiceDate, 9) } });
  // Bank account changed on invoice (classic vendor-impersonation fraud)
  add(P(21), { bankOverride: 'IDFB0080214-10084471920' }, null, 'bank-mismatch');
  // GSTIN on invoice does not belong to the supplier
  add(P(22), { gstinOverride: '36AAACX9921B1Z0' }, null, 'gstin-mismatch');
  // Brand-new vendor, two invoices engineered just under the 10 lakh approval limit
  add(P(28), {}, null, 'new-vendor-threshold');
  add(P(29), {}, null, 'new-vendor-threshold');
  // Invoice referencing a PO that does not exist in SAP
  add(P(23), { poNumberOverride: '4500009999' }, null, 'po-not-found');
  // Clean & approved, awaiting posting
  [24, 25].forEach((i) => add(P(i), {}, 'Approved', 'clean'));
  return seeds;
}

/** Fresh invoices (not seeded) shipped as PDFs for the live upload demo. */
function buildDemoUploads(purchaseOrders, goodsReceipts) {
  return [
    { file: '01-clean-bharat-steel.pdf', scenario: 'Clean 3-way match - should auto-match', doc: invoiceFromPO(purchaseOrders[30], goodsReceipts, {}) },
    { file: '02-price-variance-sri-lakshmi.pdf', scenario: 'Unit price 9% above PO price', doc: invoiceFromPO(purchaseOrders[31], goodsReceipts, { priceUplift: 0.09 }) },
    { file: '03-bank-fraud-godavari.pdf', scenario: 'Bank account differs from SAP vendor master', doc: invoiceFromPO(purchaseOrders[32], goodsReceipts, { bankOverride: 'PUNB0412300-4123000100098821' }) },
    { file: '04-over-billing-deccan.pdf', scenario: 'Quantity billed exceeds goods received', doc: invoiceFromPO(purchaseOrders[33], goodsReceipts, { qtyOverride: 999 }) },
    { file: '05-clean-vertex-safety.pdf', scenario: 'Clean 3-way match', doc: invoiceFromPO(purchaseOrders[34], goodsReceipts, {}) }
  ];
}

module.exports = { COMPANY, SUPPLIERS, CATALOG, buildPurchasing, buildSeedInvoices, buildDemoUploads, renderInvoiceText, inr, dmy };
