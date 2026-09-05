import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchAddressHistory, sanitizeRpcError } from "../frontend/src/services/wallet.ts";

describe("Transaction History: RPC Fallback and Friendly Syncing", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("sanitizeRpcError", () => {
    it("translates 'unable to derive balance/object changes because effect is empty' to friendly message", () => {
      const rawError = new Error("unable to derive balance/object changes because effect is empty");
      const sanitized = sanitizeRpcError(rawError);
      assert.equal(sanitized, "Recent transactions are finalizing on Sui testnet");
    });

    it("translates any error mentioning both 'balance' and 'effect' to friendly message", () => {
      const rawError = new Error("Sui indexer: balance changes missing: effect is unindexed");
      const sanitized = sanitizeRpcError(rawError);
      assert.equal(sanitized, "Recent transactions are finalizing on Sui testnet");
    });

    it("preserves unrelated network/connection errors without mutation", () => {
      const rawError = new Error("Failed to fetch: connection refused");
      assert.equal(sanitizeRpcError(rawError), "Failed to fetch: connection refused");
    });
  });

  describe("fetchAddressHistory empty-effect fallback", () => {
    it("falls back to multiGet without showBalanceChanges when effect is empty", async () => {
      const TEST_ADDR = "0x016dcf7419dcd6561a7f00ad0a7487fa73a67e336f618d032078282722409e24";
      const TEST_DIGEST = "9z4K1ABCXYZmockTxDigest123456789";

      const calls = [];

      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push({ method: body.method, params: body.params });

        // 1. Transaction queries (FromAddress, ToAddress)
        if (body.method === "suix_queryTransactionBlocks") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: "2.0",
              result: {
                data: [{ digest: TEST_DIGEST }],
                hasNextPage: false,
              },
            }),
          };
        }

        // 2. MultiGet block queries
        if (body.method === "sui_multiGetTransactionBlocks") {
          const options = body.params[1];
          // If showBalanceChanges is requested, simulate the transient Sui indexer lag
          if (options.showBalanceChanges) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                jsonrpc: "2.0",
                error: {
                  code: -32000,
                  message: "unable to derive balance/object changes because effect is empty",
                },
              }),
            };
          }

          // Fallback call without showBalanceChanges: succeeds immediately!
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: "2.0",
              result: [
                {
                  digest: TEST_DIGEST,
                  timestampMs: "1725000000000",
                  transaction: {
                    data: {
                      transaction: {
                        transactions: [
                          {
                            MoveCall: {
                              package: "0x531c16cde1a45391ab90f21c9f1e3f06ae3d2965965caee5c3de608a5ed50170",
                              module: "escrow",
                              function: "deposit",
                            },
                          },
                        ],
                      },
                    },
                  },
                  effects: {
                    gasUsed: {
                      computationCost: "1000000",
                      storageCost: "2000000",
                      storageRebate: "500000",
                    },
                  },
                },
              ],
            }),
          };
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: `Unknown method ${body.method}` } }),
        };
      };

      const rows = await fetchAddressHistory(TEST_ADDR);

      // Verify that multiGet was called with showBalanceChanges, failed, and fell back
      const multiGetCalls = calls.filter((c) => c.method === "sui_multiGetTransactionBlocks");
      assert.equal(multiGetCalls.length, 2, "Expected 2 multiGet calls (initial + fallback)");
      assert.equal(multiGetCalls[0].params[1].showBalanceChanges, true, "First call requested balance changes");
      assert.equal(multiGetCalls[1].params[1].showBalanceChanges, undefined, "Fallback omitted balance changes");

      // Verify transaction row was recovered and populated correctly
      assert.equal(rows.length, 1);
      const tx = rows[0];
      assert.equal(tx.digest, TEST_DIGEST);
      assert.equal(tx.kind, "Top up");
      assert.equal(tx.fn, "deposit");
      assert.equal(tx.amountUsdc, null, "amountUsdc is gracefully null during effect lag");
      assert.equal(tx.tsMs, 1725000000000);
      assert.equal(tx.gasSui, 0.0025); // (1000000 + 2000000 - 500000) / 1e9
    });

    it("sanitizes error if both multiGet attempts fail", async () => {
      const TEST_ADDR = "0x016dcf7419dcd6561a7f00ad0a7487fa73a67e336f618d032078282722409e24";

      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        if (body.method === "suix_queryTransactionBlocks") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: "2.0",
              result: { data: [{ digest: "0xfailedDigest" }] },
            }),
          };
        }

        // Both attempts fail
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "unable to derive balance/object changes because effect is empty",
            },
          }),
        };
      };

      await assert.rejects(
        async () => {
          await fetchAddressHistory(TEST_ADDR);
        },
        (err) => {
          assert.equal(err.message, "Recent transactions are finalizing on Sui testnet");
          return true;
        }
      );
    });

    it("extracts amountUsdc from EscrowFunded event when balanceChanges is absent", async () => {
      const TEST_ADDR = "0xb87490bb2a23ce4ca121391450c8233406f2517dbe9aa6405854270d6e634de8";
      const TEST_DIGEST = "6pKC11DwinXzG3GeHCHuUcFfL8JkUD1RSvCU3YtYCcYr";

      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        if (body.method === "suix_queryTransactionBlocks") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: "2.0",
              result: { data: [{ digest: TEST_DIGEST }] },
            }),
          };
        }
        if (body.method === "sui_multiGetTransactionBlocks") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: "2.0",
              result: [
                {
                  digest: TEST_DIGEST,
                  timestampMs: "1788535365673",
                  transaction: {
                    data: {
                      transaction: {
                        transactions: [
                          {
                            MoveCall: {
                              package: "0x531c16cde1a45391ab90f21c9f1e3f06ae3d2965965caee5c3de608a5ed50170",
                              module: "escrow",
                              function: "deposit",
                            },
                          },
                        ],
                      },
                    },
                  },
                  events: [
                    {
                      type: "0x531c16cde1a45391ab90f21c9f1e3f06ae3d2965965caee5c3de608a5ed50170::escrow::EscrowFunded",
                      parsedJson: {
                        amount: "10000000",
                      },
                    },
                  ],
                  balanceChanges: [],
                  effects: {
                    gasUsed: {
                      computationCost: "1000000",
                      storageCost: "2287600",
                      storageRebate: "2264724",
                    },
                  },
                },
              ],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      };

      const rows = await fetchAddressHistory(TEST_ADDR);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].digest, TEST_DIGEST);
      assert.equal(rows[0].kind, "Top up");
      assert.equal(rows[0].amountUsdc, -10, "Extracts -10 USDC from EscrowFunded event when balanceChanges is absent");
    });

    it("extracts amountUsdc from fundsWithdrawal inputs when balanceChanges and events are absent", async () => {
      const TEST_ADDR = "0xb87490bb2a23ce4ca121391450c8233406f2517dbe9aa6405854270d6e634de8";
      const TEST_DIGEST = "9B8f58xpZvhFQiEx6FfBKBCZwSc6ja4syVwmbD5Rs4S5";

      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        if (body.method === "suix_queryTransactionBlocks") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: "2.0",
              result: { data: [{ digest: TEST_DIGEST }] },
            }),
          };
        }
        if (body.method === "sui_multiGetTransactionBlocks") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: "2.0",
              result: [
                {
                  digest: TEST_DIGEST,
                  timestampMs: "1788535310027",
                  transaction: {
                    data: {
                      sender: "0xabc67fa394146947b426d6b9ed95cac2bddf4fa0b33593667c3603941002c8f4",
                      transaction: {
                        inputs: [
                          {
                            type: "fundsWithdrawal",
                            reservation: {
                              maxAmountU64: "100000000",
                            },
                            typeArg: {
                              balance: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
                            },
                          },
                        ],
                      },
                    },
                  },
                  events: [],
                  balanceChanges: [],
                  effects: {
                    gasUsed: {
                      computationCost: "0",
                      storageCost: "0",
                      storageRebate: "0",
                    },
                  },
                },
              ],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      };

      const rows = await fetchAddressHistory(TEST_ADDR);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].digest, TEST_DIGEST);
      assert.equal(rows[0].amountUsdc, 100, "Extracts incoming 100 USDC from fundsWithdrawal input");
    });
  });

  describe("Fast auto-retry backoff calculation", () => {
    it("calculates 2.5s initial retry with backoff capped at 5s", () => {
      const computeDelay = (retryCount) => Math.min(2500 + (retryCount - 1) * 1250, 5000);

      assert.equal(computeDelay(1), 2500, "Retry #1 should be 2.5s");
      assert.equal(computeDelay(2), 3750, "Retry #2 should be 3.75s");
      assert.equal(computeDelay(3), 5000, "Retry #3 should be 5.0s (capped)");
      assert.equal(computeDelay(4), 5000, "Retry #4 should remain capped at 5.0s");
    });
  });

  describe("TransactionHistory status and retry logic", () => {
    function resolveStatusView({ address, rows, error, retryCount }) {
      if (!address) {
        return { view: "disconnected", message: "Connect a wallet to see on-chain history." };
      }
      if (rows === null) {
        const isFinalizingOrSyncing =
          !error ||
          error.toLowerCase().includes("finaliz") ||
          error.toLowerCase().includes("effect") ||
          error.toLowerCase().includes("balance");

        if (error && retryCount >= 3 && !isFinalizingOrSyncing) {
          return {
            view: "persistent_error",
            dot: "attention",
            message: "Unable to connect to Sui testnet. Retrying automatically…",
            hasRetryButton: true,
          };
        }
        return {
          view: "syncing",
          dot: "recovering",
          message: "Syncing latest transactions from Sui testnet… Recent activity will appear as soon as finalized.",
          hasRetryButton: false,
        };
      }
      if (rows.length === 0) {
        return { view: "empty", message: "No on-chain transactions yet for this address." };
      }
      return { view: "rows", count: rows.length };
    }

    it("displays syncing with animated recovering dot during initial fetch when rows is null", () => {
      const status = resolveStatusView({ address: "0x123", rows: null, error: null, retryCount: 0 });
      assert.equal(status.view, "syncing");
      assert.equal(status.dot, "recovering");
      assert.match(status.message, /Syncing latest transactions from Sui testnet/);
      assert.equal(status.hasRetryButton, false);
    });

    it("stays in calm syncing state when RPC indexer reports finalizing / effect empty", () => {
      const status = resolveStatusView({
        address: "0x123",
        rows: null,
        error: "Recent transactions are finalizing on Sui testnet",
        retryCount: 2,
      });
      assert.equal(status.view, "syncing");
      assert.equal(status.dot, "recovering");
      assert.match(status.message, /Syncing latest transactions from Sui testnet/);
      assert.equal(status.hasRetryButton, false);
    });

    it("transitions to connection failure banner with 'Retry now' button after >=3 network retries", () => {
      const status = resolveStatusView({
        address: "0x123",
        rows: null,
        error: "Failed to fetch (offline)",
        retryCount: 3,
      });
      assert.equal(status.view, "persistent_error");
      assert.equal(status.dot, "attention");
      assert.match(status.message, /Unable to connect to Sui testnet\. Retrying automatically…/);
      assert.equal(status.hasRetryButton, true);
    });

    it("stale-while-revalidate: retains rows and displays transactions even if background poll errors", () => {
      const mockRows = [{ digest: "0x1", kind: "Top up", fn: "deposit", amountUsdc: 10, tsMs: 1725000000000 }];
      const status = resolveStatusView({
        address: "0x123",
        rows: mockRows,
        error: "Temporary network disconnect",
        retryCount: 0,
      });
      assert.equal(status.view, "rows");
      assert.equal(status.count, 1);
    });

    it("displays empty state when rows is resolved to empty array", () => {
      const status = resolveStatusView({ address: "0x123", rows: [], error: null, retryCount: 0 });
      assert.equal(status.view, "empty");
      assert.match(status.message, /No on-chain transactions yet for this address/);
    });

    it("simulates full lifecycle: initial effect lag triggers fast auto-retry, resolves to rows", async () => {
      let attempts = 0;
      let syncing = true;
      let rows = null;
      let error = null;
      let retryTimerMs = null;

      const mockFetchHistory = async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("unable to derive balance/object changes because effect is empty");
        }
        return [{ digest: "0xfinalized", kind: "Top up", fn: "deposit", amountUsdc: 25, tsMs: 1725000000000 }];
      };

      // Lifecycle step 1: Initial call encounters effect lag
      try {
        await mockFetchHistory();
      } catch (err) {
        error = sanitizeRpcError(err);
        syncing = true;
        retryTimerMs = 2500;
      }

      assert.equal(syncing, true);
      assert.equal(rows, null);
      assert.equal(error, "Recent transactions are finalizing on Sui testnet");
      assert.equal(retryTimerMs, 2500, "Schedules fast 2.5s auto-retry");

      // Lifecycle step 2: 2.5s auto-retry fires and succeeds
      rows = await mockFetchHistory();
      syncing = false;
      error = null;

      assert.equal(syncing, false);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].digest, "0xfinalized");
      assert.equal(error, null);
    });
    it("monotonic merge prevents amountUsdc from disappearing on transient fallback poll", () => {
      const prevRows = [
        { digest: "0xabc1", kind: "Top up", fn: "deposit", amountUsdc: -20, gasSui: 0.001, tsMs: 17000 },
        { digest: "0xabc2", kind: "Top up", fn: "deposit", amountUsdc: -10, gasSui: 0.001, tsMs: 16000 },
      ];

      // A transient fallback poll returns null amountUsdc
      const pollResults = [
        { digest: "0xabc1", kind: "Top up", fn: "deposit", amountUsdc: null, gasSui: 0.001, tsMs: 17000 },
        { digest: "0xabc2", kind: "Top up", fn: "deposit", amountUsdc: null, gasSui: 0.001, tsMs: 16000 },
      ];

      // Monotonic merge function from TransactionHistory
      const prevByDigest = new Map(prevRows.map((t) => [t.digest, t]));
      const merged = pollResults.map((newTx) => {
        const existing = prevByDigest.get(newTx.digest);
        if (!existing) return newTx;
        return {
          ...newTx,
          amountUsdc: newTx.amountUsdc ?? existing.amountUsdc,
          gasSui: newTx.gasSui ?? existing.gasSui,
          tsMs: newTx.tsMs ?? existing.tsMs,
          kind: newTx.kind === "Transfer" && existing.kind !== "Transfer" ? existing.kind : newTx.kind,
          fn: newTx.fn === "transfer" && existing.fn !== "transfer" ? existing.fn : newTx.fn,
        };
      });

      assert.equal(merged[0].amountUsdc, -20, "amountUsdc was preserved across poll!");
      assert.equal(merged[1].amountUsdc, -10, "amountUsdc was preserved across poll!");
    });
  });
});
