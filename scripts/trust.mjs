#!/usr/bin/env node
// Trust service CLI (works without any HTTP server — demo-safe):
//   npm run trust -- commit  fixtures/sui/s2-selected-offer.json
//   npm run trust -- activation INC-S2 AVAILABLE     # → auto-settle
//   npm run trust -- activation INC-S7 FAILED        # → auto-refund
//   npm run trust -- settle   INC-S2
//   npm run trust -- refund   INC-S2
//   npm run trust -- reclaim  INC-S2:PROVIDER-B:001
//   npm run trust -- status   INC-S2
//   npm run trust -- events   [N]
import { readFileSync } from "node:fs";
import { TrustService } from "../src/sui/service.js";
import { EventLedger } from "../src/sui/events.js";
import { VoucherError } from "../src/sui/voucher.js";

const [command, ...args] = process.argv.slice(2);
const service = new TrustService();

async function main() {
  switch (command) {
    case "commit": {
      const selected = JSON.parse(readFileSync(args[0], "utf8"));
      const result = await service.commit(selected);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "activation": {
      const [incidentId, status, capacity] = args;
      const result = await service.activation({
        incidentId,
        status,
        recoveredCapacityMbps: capacity ? Number(capacity) : null
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "settle":
    case "refund": {
      const incidentId = args[0];
      const result = await service.activation({
        incidentId,
        status: command === "settle" ? "AVAILABLE" : "FAILED"
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "reclaim": {
      const result = await service.reclaim(args[0]);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "status":
    case "show": {
      console.log(JSON.stringify(service.status(args[0]), null, 2));
      break;
    }
    case "events": {
      const ledger = new EventLedger();
      const n = Number(args[0] ?? 10);
      const lines = ledger.rebuild();
      console.log(JSON.stringify({ totalEvents: lines }, null, 0));
      break;
    }
    default:
      console.error("usage: trust <commit|activation|settle|refund|reclaim|status|events> …");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[trust:${command}] ${err.code ?? ""} ${err.message}`);
  if (err.digest) console.error(`txDigest: ${err.digest}`);
  process.exit(1);
});
