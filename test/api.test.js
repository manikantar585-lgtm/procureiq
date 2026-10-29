'use strict';
// Integration test: boots the CAP server in-process (in-memory SQLite, demo data seeded through the real pipeline)
process.env.CDS_ENV = 'test'; // [test] profile = in-memory database; must be set before cds loads its config
const { describe, it } = require('node:test');
const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');

process.env.ML_SERVICE_URL = 'http://127.0.0.1:1'; // force the ML fallback so the test is self-contained
const { GET, POST, expect, axios } = cds.test(path.join(__dirname, '..'));
const as = (u) => ({ auth: { username: u, password: u } });
axios.defaults.validateStatus = () => true;

describe('P2PService API', () => {
  it('requires authentication', async () => {
    const r = await GET('/odata/v4/p2p/Invoices');
    expect(r.status).to.equal(401);
  });

  it('seeds the demo ledger and computes KPIs', async () => {
    const { data } = await GET('/odata/v4/p2p/kpis()', as('clerk'));
    expect(data.totalInvoices).to.be.greaterThan(20);
    expect(data.highRisk).to.be.greaterThan(0);
  });

  let id;
  it('processes an uploaded PDF end-to-end', async () => {
    const pdf = fs.readFileSync(path.join(__dirname, '../samples/invoices/01-clean-bharat-steel.pdf'));
    const { status, data } = await POST('/odata/v4/p2p/uploadInvoice', { fileName: 'a.pdf', contentBase64: pdf.toString('base64') }, as('clerk'));
    expect(status).to.equal(200);
    expect(data.status).to.equal('Matched');
    id = data.ID;
  });

  it('blocks re-upload of the same document', async () => {
    const pdf = fs.readFileSync(path.join(__dirname, '../samples/invoices/01-clean-bharat-steel.pdf'));
    const r = await POST('/odata/v4/p2p/uploadInvoice', { fileName: 'a.pdf', contentBase64: pdf.toString('base64') }, as('clerk'));
    expect(r.status).to.equal(409);
  });

  it('flags bank-account fraud as Critical', async () => {
    const pdf = fs.readFileSync(path.join(__dirname, '../samples/invoices/03-bank-fraud-godavari.pdf'));
    const { data } = await POST('/odata/v4/p2p/uploadInvoice', { fileName: 'b.pdf', contentBase64: pdf.toString('base64') }, as('clerk'));
    expect(data.riskLevel).to.equal('Critical');
  });

  it('enforces segregation of duties', async () => {
    const r = await POST(`/odata/v4/p2p/Invoices(${id})/P2PService.approveInvoice`, { comment: 'x' }, as('clerk'));
    expect(r.status).to.equal(403);
  });

  it('approves and posts to SAP', async () => {
    let r = await POST(`/odata/v4/p2p/Invoices(${id})/P2PService.approveInvoice`, { comment: 'ok' }, as('approver'));
    expect(r.data.status).to.equal('Approved');
    r = await POST(`/odata/v4/p2p/Invoices(${id})/P2PService.postToSAP`, {}, as('approver'));
    expect(r.data.status).to.equal('Posted');
    expect(r.data.sapDocument).to.match(/^51056/);
  });

  it('copilot answers with tool calls', async () => {
    const { data } = await POST('/odata/v4/p2p/askCopilot', { question: 'Which invoices are high risk?' }, as('clerk'));
    expect(data.toolCalls.length).to.be.greaterThan(0);
    expect(data.answer).to.match(/High or Critical/);
  });
});
