// Thin OData V4 client for P2PService
const BASE = '/odata/v4/p2p';
let credentials = null;

export const PERSONAS = {
  clerk: { user: 'clerk', password: 'clerk', name: 'Anita Rao', role: 'AP Clerk', initials: 'AR', roles: ['Clerk'] },
  approver: { user: 'approver', password: 'approver', name: 'Ravi Kumar', role: 'AP Lead · Approver', initials: 'RK', roles: ['Clerk', 'Approver'] },
  manager: { user: 'manager', password: 'manager', name: 'Priya Sharma', role: 'Finance Manager', initials: 'PS', roles: ['Clerk', 'Approver', 'Manager'] }
};

export function setCredentials(c) {
  credentials = c;
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (credentials) headers.Authorization = 'Basic ' + btoa(`${credentials.user}:${credentials.password}`);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(json?.error?.message || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const q = (params) => '?' + Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export const api = {
  systemStatus: () => request('/systemStatus()'),
  kpis: async () => {
    const k = await request('/kpis()');
    for (const f of ['statusBreakdown', 'riskBreakdown', 'spendByVendor', 'monthlyTrend']) k[f] = JSON.parse(k[f] || '{}');
    return k;
  },
  invoices: (params = {}) =>
    request('/Invoices' + q({
      $select: 'ID,invoiceNumber,vendor_ID,vendorName,poNumber,invoiceDate,dueDate,grossAmount,currency,status,matchStatus,riskScore,riskLevel,source,createdAt,sapDocument',
      $orderby: 'createdAt desc,riskScore desc',
      ...params
    })).then((r) => r.value),
  invoice: (id) =>
    request(`/Invoices(${id})` + q({ $expand: 'items($orderby=lineNo),matchResults($orderby=lineNo),anomalies($orderby=weight desc),vendor' })),
  audit: (invoiceId) =>
    request('/AuditLog' + q({ $filter: invoiceId ? `invoice_ID eq ${invoiceId}` : undefined, $orderby: 'createdAt desc,step desc', $top: invoiceId ? undefined : 300, $expand: invoiceId ? undefined : 'invoice($select=invoiceNumber)' })).then((r) => r.value),
  vendors: () => request('/Vendors' + q({ $expand: 'invoices($select=ID,invoiceNumber,grossAmount,status,riskLevel,riskScore,invoiceDate)', $orderby: 'riskScore desc' })).then((r) => r.value),
  upload: (fileName, contentBase64) => request('/uploadInvoice', { method: 'POST', body: { fileName, contentBase64 } }),
  approve: (id, comment) => request(`/Invoices(${id})/P2PService.approveInvoice`, { method: 'POST', body: { comment } }),
  reject: (id, reason) => request(`/Invoices(${id})/P2PService.rejectInvoice`, { method: 'POST', body: { reason } }),
  post: (id) => request(`/Invoices(${id})/P2PService.postToSAP`, { method: 'POST', body: {} }),
  ask: (question, history) => request('/askCopilot', { method: 'POST', body: { question, history: JSON.stringify(history || []) } }),
  sapPO: (poNumber) => request(`/sapPurchaseOrder(poNumber='${encodeURIComponent(poNumber)}')`).then((r) => JSON.parse(r.value))
};
