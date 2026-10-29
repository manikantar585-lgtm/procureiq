/**
 * Workflow jobs that run outside a single user decision: SLA escalation of open exceptions and holds.
 * Called from the scheduler in server.js and from the runSlaCheck action.
 */
'use strict';
const cds = require('@sap/cds');
const settings = require('./engine/settings');
const { slaState, SLA_STATUSES } = require('./engine/sla');

const LOG = cds.log('workflow');

/** Escalate every open exception / hold that is past the SLA. @returns number of newly escalated invoices */
async function escalateOverdue(actor = 'system') {
  const { Invoices, AuditLog } = cds.entities('procureiq');
  const { slaDays } = await settings.current();
  const open = await SELECT.from(Invoices).columns('ID', 'status', 'escalated', 'receivedAt', 'createdAt', 'heldAt').where({ status: { in: SLA_STATUSES } });
  const now = Date.now();
  const due = open.filter((i) => !i.escalated).map((i) => ({ ...i, sla: slaState(i, slaDays, now) })).filter((i) => i.sla.breached);
  if (!due.length) return 0;
  const at = new Date(now).toISOString();
  await UPDATE(Invoices).set({ escalated: true, escalatedAt: at }).where({ ID: { in: due.map((i) => i.ID) } });
  await INSERT.into(AuditLog).entries(due.map((i) => ({
    invoice_ID: i.ID, step: 10, action: 'ESCALATED', actor,
    detail: `Open ${i.sla.ageDays} days as ${i.status === 'OnHold' ? 'on hold' : 'exception'} (SLA ${slaDays} days) - escalated to Finance Manager`
  })));
  LOG.info(`escalated ${due.length} invoice(s) past the ${slaDays}-day SLA`);
  return due.length;
}

module.exports = { escalateOverdue };
