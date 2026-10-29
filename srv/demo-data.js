/**
 * Demo data lifecycle:
 *  - deploySchema: creates / upgrades the tables of a file database in place (data is kept)
 *  - seedDemo:     replays the demo invoices through the real AI pipeline into an empty database
 *  - resetAll:     wipes every ProcureIQ table and seeds the demo again (Settings page, Finance Manager)
 */
'use strict';
const cds = require('@sap/cds');
const path = require('path');
const fs = require('fs');
const settings = require('./engine/settings');
const s4 = require('./sap/s4-client');
const { escalateOverdue } = require('./workflow');

const LOG = cds.log('procureiq');
// children before parents, so nothing is left pointing at a deleted row
const TABLES = ['InvoiceComments', 'InvoiceItems', 'MatchResults', 'Anomalies', 'AuditLog', 'Invoices', 'PaymentRuns', 'BankChangeRequests', 'Vendors', 'Settings'];

const isInMemory = () => [cds.db.options.credentials?.url, cds.db.options.credentials?.database].includes(':memory:');

/** Where the data lives, for the UI. */
function storage() {
  if (cds.db.kind !== 'sqlite') return cds.db.kind === 'hana' ? 'SAP HANA Cloud' : cds.db.kind;
  return isInMemory() ? 'SQLite in memory (cleared on every restart)' : `SQLite file ${cds.db.options.credentials.url}`;
}

/**
 * A file database keeps its data across restarts, so its tables are created on first start and
 * upgraded in place afterwards (schema_evolution: 'auto' in package.json). In-memory databases are
 * deployed by cds itself; SAP HANA by the MTA deployer.
 */
async function deploySchema() {
  if (cds.db.kind !== 'sqlite' || isInMemory()) return;
  await cds.deploy('*').to(cds.db); // the source model, like cds does for in-memory - cds.model is already compiled for runtime
}

async function seedDemo() {
  if (process.env.SEED_DEMO === 'false') return 0;
  const { Invoices, Invoices: I } = cds.entities('procureiq');
  const { count } = await SELECT.one.from(Invoices).columns('count(1) as count');
  if (count > 0) return 0;

  // give the ML service a moment to come up (docker-compose starts both together)
  const ml = require('./engine/ml-client');
  for (let i = 0; i < 10 && (await ml.status()).state !== 'UP'; i++) await new Promise((r) => setTimeout(r, 500));

  const { processDocument } = require('./pipeline');
  const seeds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'samples', 'seed-invoices.json'), 'utf8'));
  const sources = ['Email', 'Upload', 'EDI', 'Email', 'Ariba Network'];
  const t0 = Date.now();
  for (const [n, s] of seeds.entries()) {
      // demo invoices arrived in AP a couple of days after their invoice date
      const invoiceDate = /Invoice Date:\s*(\d{2})-(\d{2})-(\d{4})/.exec(s.text);
      const receivedAt = invoiceDate ? new Date(Date.UTC(+invoiceDate[3], +invoiceDate[2] - 1, +invoiceDate[1] + 2, 9)).toISOString() : undefined;
      const r = await processDocument(Buffer.from(s.text), s.fileName, { forceLayout: true, useLLM: false, source: sources[n % sources.length], actor: 'system', receivedAt });
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
  return seeds.length;
}

/** Permanently delete all ProcureIQ data and start again from the demo dataset. @returns number of seeded invoices */
async function resetAll(actor) {
  const e = cds.entities('procureiq');
  for (const name of TABLES) await DELETE.from(e[name]);
  s4.resetSimulation();
  await INSERT.into(e.AuditLog).entries({ step: 0, action: 'DATA_RESET', actor, detail: 'All invoices, payments, vendor changes, comments, settings and audit entries were permanently deleted; demo data reloaded' });
  await settings.init();
  const seeded = await seedDemo();
  await escalateOverdue();
  LOG.info(`all data reset by ${actor}`);
  return seeded;
}

module.exports = { deploySchema, seedDemo, resetAll, storage };
