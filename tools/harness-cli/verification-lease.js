"use strict";

const os = require("node:os");
const VERIFICATION_LEASE_MS = 30 * 60 * 1000;

function createVerificationOwner(now = Date.now()) {
  return { pid: process.pid, host: os.hostname(), expires_at: new Date(now + VERIFICATION_LEASE_MS).toISOString() };
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}

function reconcileVerificationLeases(state, nowMs, isAlive = processIsAlive) {
  let changed = false;
  for (const ticket of state.tickets) {
    if (ticket.status !== "VERIFYING") continue;
    const owner = ticket.verification_owner;
    // Legacy leases have no provable owner; leave them for manual inspection.
    if (!owner || owner.host !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0) continue;
    const expiry = Date.parse(owner.expires_at);
    if (!Number.isFinite(expiry) || expiry > nowMs || isAlive(owner.pid)) continue;
    ticket.status = "PREPARED";
    ticket.error = "Verification owner exited; full verification must run again";
    delete ticket.verification_lease;
    delete ticket.verification_owner;
    delete ticket.verification;
    changed = true;
  }
  return changed;
}

module.exports = { createVerificationOwner, reconcileVerificationLeases };
