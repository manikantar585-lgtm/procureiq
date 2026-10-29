/**
 * Custom CAP server bootstrap:
 *  - serves the built Fiori/UI5 React app at /
 *  - health endpoint for container orchestration
 *  - replays the demo invoices through the real AI pipeline on first start
 */
'use strict';
const cds = require('@sap/cds');
const path = require('path');
const fs = require('fs');
const express = require('express');

const LOG = cds.log('procureiq');

cds.on('bootstrap', (app) => {
  app.get('/health', (_req, res) => res.json({ status: 'UP', service: 'procureiq-srv' }));
  // demo supplier invoices (PDF) for the "try a sample" feature in the UI
  app.use('/samples', express.static(path.join(__dirname, '..', 'samples', 'invoices')));
  const ui = path.join(__dirname, '..', 'app', 'ui');
  if (fs.existsSync(path.join(ui, 'index.html'))) {
    app.use('/ui', express.static(ui));
    app.get(/^\/ui\/(?!assets\/).*/, (_req, res) => res.sendFile(path.join(ui, 'index.html')));
    app.get('/', (req, res, next) => (req.query.cds ? next() : res.redirect('/ui/')));
  }
});

cds.on('served', async () => {
  if (process.env.SEED_DEMO === 'false') return;
  const { Invoices, Invoices: I } = cds.entities('procureiq');
  const { count } = await SELECT.one.from(Invoices).columns('count(1) as count');
  if (count > 0) return;

  // give the ML service a moment to come up (docker-compose starts both together)
  const ml = require('./engine/ml-client');
  for (let i = 0; i < 10 && (await ml.status()).state !== 'UP'; i++) await new Promise((r) => setTimeout(r, 500));

  const { processDocument } = require('./pipeline');
  const s4 = require('./sap/s4-client');
  const seeds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'samples', 'seed-invoices.json'), 'utf8'));
  const sources = ['Email', 'Upload', 'EDI', 'Email', 'Ariba Network'];
  const t0 = Date.now();
  for (const [n, s] of seeds.entries()) {
      const r = await processDocument(Buffer.from(s.text), s.fileName, { forceLayout: true, useLLM: false, source: sources[n % sources.length], actor: 'system' });
      if (['Approved', 'Posted', 'Rejected'].includes(s.finalStatus)) {
        const patch = { status: s.finalStatus === 'Posted' ? 'Approved' : s.finalStatus, decisionBy: 'approver', decisionComment: s.finalStatus === 'Rejected' ? 'Price above contract - vendor asked to re-issue at PO price' : null };
        await UPDATE(I, r.ID).with(patch);
        if (s.finalStatus === 'Posted') {
          const inv = await SELECT.one.from(I, r.ID).columns((x) => { x`.*`, x.items((i) => i`.*`); });
          const post = await s4.postSupplierInvoice(inv);
          await UPDATE(I, r.ID).with({ status: 'Posted', sapDocument: post.document, sapFiscalYear: post.fiscalYear });
        }
      }
  }
  LOG.info(`Seeded ${seeds.length} demo invoices through the AI pipeline in ${Date.now() - t0} ms`);
});

module.exports = cds.server;
