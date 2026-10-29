/**
 * Exception SLA: open exceptions and holds must be resolved within N days (setting slaDays),
 * otherwise they are escalated to the Finance Manager. Pure function, unit-tested.
 *
 * The clock starts when the invoice was received (exceptions) or put on hold (holds).
 */
'use strict';

const DAY = 86400000;
const SLA_STATUSES = ['Exception', 'OnHold'];

/** @returns { applies, since, ageDays, breached } */
function slaState(inv, slaDays, now = Date.now()) {
  if (!SLA_STATUSES.includes(inv.status)) return { applies: false, since: null, ageDays: 0, breached: false };
  const since = inv.status === 'OnHold' ? inv.heldAt : inv.receivedAt || inv.createdAt;
  const ageDays = since ? Math.max(0, Math.floor((now - Date.parse(since)) / DAY)) : 0;
  return { applies: true, since, ageDays, breached: ageDays >= slaDays };
}

module.exports = { slaState, SLA_STATUSES };
