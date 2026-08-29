// Recovery event ledger (blueprint §8: "recovery event ledger") — append-only
// JSONL that the Telemetry Dashboard can tail, plus the in-memory nonce
// registry the trust service uses for duplicate-safety (blueprint §6.1).
// The registry rebuilds from the ledger, so a service restart keeps the
// idempotency guarantee. The on-chain events are the durable second half.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const EVENTS_PATH = path.resolve("events/reliability-events.jsonl");

export class EventLedger {
  constructor(eventsPath = EVENTS_PATH) {
    this.path = eventsPath;
    this.registry = new Map(); // nonce → commitment state
    this.rebuild();
  }

  rebuild() {
    this.registry.clear();
    if (!existsSync(this.path)) return 0;
    const lines = readFileSync(this.path, "utf8").split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        this.indexEvent(JSON.parse(line));
      } catch {
        // torn tail write (crash mid-append): ignore the incomplete line
      }
    }
    return lines.length;
  }

  indexEvent(event) {
    if (!event.nonce) return;
    const state = this.registry.get(event.nonce) ?? { nonce: event.nonce };
    if (event.incidentId) state.incidentId = event.incidentId;
    if (event.txDigest) state.txDigest = event.txDigest;
    if (event.type === "COMMITTED") {
      state.committedAtMs = event.ts;
      state.status = "COMMITTED";
      state.idempotent = Boolean(event.data?.idempotent);
      state.amount = event.data?.amount ?? null;
      state.provider = event.data?.provider ?? null;
    }
    if (event.type === "SETTLED") { state.status = "SETTLED"; state.settledAtMs = event.ts; }
    if (event.type === "REFUNDED") { state.status = "REFUNDED"; state.refundedAtMs = event.ts; }
    if (event.type === "RECLAIMED") { state.status = "RECLAIMED"; state.reclaimedAtMs = event.ts; }
    this.registry.set(event.nonce, state);
  }

  emit(type, { incidentId = null, nonce = null, txDigest = null, data = {} } = {}) {
    mkdirSync(path.dirname(this.path), { recursive: true });
    const seq = this.rebuild() + 1;
    const event = { seq, ts: Date.now(), type, incidentId, nonce, txDigest, data };
    appendFileSync(this.path, `${JSON.stringify(event)}\n`);
    this.indexEvent(event);
    return event;
  }

  lookup(nonce) {
    return this.registry.get(nonce) ?? null;
  }

  byIncident(incidentId) {
    return [...this.registry.values()].filter((s) => s.incidentId === incidentId);
  }
}
