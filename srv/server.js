/**
 * Custom CAP server bootstrap:
 *  - serves the built Fiori/UI5 React app at /
 *  - health endpoint for container orchestration
 *  - creates / upgrades the database schema and replays the demo invoices through the real AI pipeline on first start
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

const SLA_CHECK_INTERVAL = 60 * 60 * 1000;

cds.on('served', async () => {
  const { deploySchema, seedDemo } = require('./demo-data');
  await deploySchema();
  await require('./engine/settings').init();
  await seedDemo(); // only into an empty database - a file database keeps its data across restarts
  // escalate exceptions / holds past the SLA now and every hour
  const { escalateOverdue } = require('./workflow');
  await escalateOverdue();
  setInterval(() => escalateOverdue().catch((e) => LOG.error('SLA check failed', e)), SLA_CHECK_INTERVAL).unref();
});

module.exports = cds.server;
