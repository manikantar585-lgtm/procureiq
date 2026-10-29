/**
 * SAP S/4HANA connector.
 *
 * Talks to the standard S/4HANA Cloud OData V2 APIs:
 *   - API_PURCHASEORDER_PROCESS_SRV   (A_PurchaseOrder, A_PurchaseOrderItem)
 *   - API_MATERIAL_DOCUMENT_SRV       (A_MaterialDocumentItem - goods receipts, mvt 101)
 *   - API_BUSINESS_PARTNER            (A_Supplier)
 *   - API_SUPPLIERINVOICE_PROCESS_SRV (A_SupplierInvoice - posting)
 *
 * Modes (env SAP_MODE):
 *   mock     - local S/4-shaped JSON (default; no SAP access needed)
 *   sandbox  - SAP Business Accelerator Hub sandbox (needs SAP_API_KEY from api.sap.com)
 *   tenant   - a real S/4HANA system (SAP_BASE_URL + SAP_USER/SAP_PASSWORD, or a BTP destination)
 *
 * All modes return the same normalised shapes, so the rest of the app never knows the difference.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const cds = require('@sap/cds');

const LOG = cds.log('s4');
const MODE = (process.env.SAP_MODE || 'mock').toLowerCase();
const SANDBOX_URL = 'https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata/sap';
const BASE_URL = MODE === 'sandbox' ? SANDBOX_URL : (process.env.SAP_BASE_URL || '').replace(/\/$/, '') + '/sap/opu/odata/sap';

const mockDir = path.join(__dirname, 'mock');
const load = (f) => JSON.parse(fs.readFileSync(path.join(mockDir, f), 'utf8'));
let MOCK = null;
const mock = () => (MOCK ||= {
  suppliers: load('A_Supplier.json'),
  purchaseOrders: load('A_PurchaseOrder.json'),
  goodsReceipts: load('A_MaterialDocumentItem.json'),
  postedInvoices: []
});

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function odata(service, resource, query = {}) {
  const url = new URL(`${BASE_URL}/${service}/${resource}`);
  Object.entries({ $format: 'json', ...query }).forEach(([k, v]) => url.searchParams.set(k, v));
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.v;

  const headers = { Accept: 'application/json' };
  if (MODE === 'sandbox') headers.APIKey = process.env.SAP_API_KEY;
  if (MODE === 'tenant' && process.env.SAP_USER) {
    headers.Authorization = 'Basic ' + Buffer.from(`${process.env.SAP_USER}:${process.env.SAP_PASSWORD}`).toString('base64');
  }
  const t0 = Date.now();
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  LOG.debug(`GET ${service}/${resource} -> ${res.status} (${Date.now() - t0} ms)`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`S/4HANA ${service} responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const v = json.d?.results ?? json.d ?? json.value ?? json;
  cache.set(key, { t: Date.now(), v });
  return v;
}

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const odataDate = (v) => {
  if (!v) return null;
  const m = /\/Date\((\d+)/.exec(v);
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(v).slice(0, 10);
};

// ---------------------------------------------------------------- normalisers
function normPO(po) {
  if (!po) return null;
  const items = po.to_PurchaseOrderItem?.results ?? po.to_PurchaseOrderItem ?? [];
  return {
    poNumber: po.PurchaseOrder,
    companyCode: po.CompanyCode,
    supplier: po.Supplier,
    poDate: odataDate(po.PurchaseOrderDate || po.CreationDate),
    currency: po.DocumentCurrency,
    paymentTerms: po.PaymentTerms,
    items: items.map((i) => ({
      poItem: String(i.PurchaseOrderItem),
      material: i.Material,
      description: i.PurchaseOrderItemText,
      quantity: num(i.OrderQuantity),
      unit: i.PurchaseOrderQuantityUnit,
      netPrice: num(i.NetPriceAmount) / (num(i.NetPriceQuantity) || 1),
      plant: i.Plant
    }))
  };
}

const bankOverrides = new Map(); // approved bank master changes (see updateSupplierBankAccount)

function normSupplier(s) {
  if (!s) return null;
  return {
    id: s.Supplier,
    name: s.SupplierName,
    city: s.CityName,
    country: s.Country,
    gstin: s.VATRegistration || s.TaxNumber3 || null,
    bankAccount: bankOverrides.get(s.Supplier) || s._Bank || null,
    category: s._Category || null,
    paymentTerms: s._PaymentTerms || null,
    createdOn: odataDate(s.CreationDate),
    postingBlocked: !!s.PostingIsBlocked
  };
}

// ---------------------------------------------------------------- public API
async function getPurchaseOrder(poNumber) {
  if (!poNumber) return null;
  if (MODE === 'mock') return normPO(mock().purchaseOrders.find((p) => p.PurchaseOrder === String(poNumber)));
  return normPO(await odata('API_PURCHASEORDER_PROCESS_SRV', `A_PurchaseOrder('${poNumber}')`, { $expand: 'to_PurchaseOrderItem' }));
}

async function getGoodsReceipts(poNumber) {
  if (!poNumber) return [];
  let rows;
  if (MODE === 'mock') rows = mock().goodsReceipts.filter((g) => g.PurchaseOrder === String(poNumber));
  else rows = (await odata('API_MATERIAL_DOCUMENT_SRV', 'A_MaterialDocumentItem', { $filter: `PurchaseOrder eq '${poNumber}'` })) || [];
  return rows
    .filter((g) => ['101', '102'].includes(String(g.GoodsMovementType)))
    .map((g) => ({
      materialDocument: g.MaterialDocument,
      poItem: String(g.PurchaseOrderItem),
      material: g.Material,
      quantity: num(g.QuantityInEntryUnit) * (String(g.GoodsMovementType) === '102' ? -1 : 1),
      postingDate: odataDate(g.PostingDate)
    }));
}

async function getSupplier(id) {
  if (!id) return null;
  if (MODE === 'mock') return normSupplier(mock().suppliers.find((s) => s.Supplier === String(id)));
  return normSupplier(await odata('API_BUSINESS_PARTNER', `A_Supplier('${id}')`));
}

async function listSuppliers() {
  if (MODE === 'mock') return mock().suppliers.map(normSupplier);
  return ((await odata('API_BUSINESS_PARTNER', 'A_Supplier', { $top: 200 })) || []).map(normSupplier);
}

/** Find a supplier by GSTIN or (fuzzy) name - used when an invoice has no supplier number. */
async function findSupplier({ gstin, name }) {
  const all = await listSuppliers();
  if (gstin) {
    const byTax = all.find((s) => s.gstin && s.gstin.toUpperCase() === gstin.toUpperCase());
    if (byTax) return { supplier: byTax, matchedBy: 'GSTIN' };
  }
  if (name) {
    const n = normaliseName(name);
    const byName = all.find((s) => normaliseName(s.name) === n) || all.find((s) => normaliseName(s.name).includes(n) || n.includes(normaliseName(s.name)));
    if (byName) return { supplier: byName, matchedBy: 'NAME' };
  }
  return { supplier: null, matchedBy: null };
}
const normaliseName = (s) => String(s).toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|inc|co)\b/g, '').replace(/[^a-z0-9]/g, '');

/**
 * Post the supplier invoice to S/4HANA (A_SupplierInvoice, MIRO equivalent).
 * The public sandbox is read-only, so in mock/sandbox mode the posting is simulated
 * and returns a document number in the same format S/4 would.
 */
async function postSupplierInvoice(inv) {
  const payload = {
    CompanyCode: 'IN01',
    DocumentDate: `/Date(${Date.parse(inv.invoiceDate)})/`,
    PostingDate: `/Date(${Date.now()})/`,
    InvoicingParty: inv.vendor_ID,
    SupplierInvoiceIDByInvcgParty: inv.invoiceNumber,
    DocumentCurrency: inv.currency,
    InvoiceGrossAmount: String(inv.grossAmount),
    TaxIsCalculatedAutomatically: true,
    to_SuplrInvcItemPurOrdRef: (inv.items || []).map((it, i) => ({
      SupplierInvoiceItem: String(i + 1).padStart(6, '0'),
      PurchaseOrder: inv.poNumber,
      PurchaseOrderItem: it.poItem,
      DocumentCurrency: inv.currency,
      SupplierInvoiceItemAmount: String(it.amount),
      PurchaseOrderQuantityUnit: it.unit,
      QuantityInPurchaseOrderUnit: String(it.quantity),
      TaxCode: 'G8'
    }))
  };
  if (MODE === 'tenant') {
    const url = `${BASE_URL}/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice`;
    const auth = 'Basic ' + Buffer.from(`${process.env.SAP_USER}:${process.env.SAP_PASSWORD}`).toString('base64');
    const tokenRes = await fetch(url, { method: 'HEAD', headers: { Authorization: auth, 'x-csrf-token': 'fetch' } });
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': tokenRes.headers.get('x-csrf-token'), cookie: tokenRes.headers.get('set-cookie') || '' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Posting failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const d = (await res.json()).d;
    return { document: d.SupplierInvoice, fiscalYear: d.FiscalYear, simulated: false, payload };
  }
  const m = mock();
  const document = String(5105600000 + m.postedInvoices.length + 1);
  m.postedInvoices.push({ document, payload });
  return { document, fiscalYear: String(new Date().getFullYear()), simulated: true, payload };
}

/**
 * Apply a dual-control approved bank master change. In S/4HANA this is a change to the
 * business partner bank details (API_BUSINESS_PARTNER, A_BusinessPartnerBank); here the write-back
 * is simulated: the new account overrides the replicated value in every mode, so the
 * bank-account fraud rule compares invoices against the approved account.
 */
function updateSupplierBankAccount(id, bankAccount) {
  bankOverrides.set(String(id), bankAccount);
  LOG.info(`bank details of supplier ${id} changed (simulated write-back)`);
  return { simulated: true };
}

/** Forget simulated postings and bank changes (used when all ProcureIQ data is reset). */
function resetSimulation() {
  bankOverrides.clear();
  cache.clear();
  if (MOCK) MOCK.postedInvoices = [];
}

function status() {
  return {
    mode: MODE,
    endpoint: MODE === 'mock' ? 'local mock (S/4HANA OData V2 shape)' : BASE_URL,
    ready: MODE === 'mock' || (MODE === 'sandbox' ? !!process.env.SAP_API_KEY : !!process.env.SAP_BASE_URL)
  };
}

module.exports = { getPurchaseOrder, getGoodsReceipts, getSupplier, listSuppliers, findSupplier, postSupplierInvoice, updateSupplierBankAccount, resetSimulation, status, _normPO: normPO };
