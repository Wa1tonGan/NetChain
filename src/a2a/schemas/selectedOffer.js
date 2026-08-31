import { z } from "zod";
import {
  activationClassValues,
  activationLaneValues
} from "./providerProfile.js";
import { providerOfferSchema, signatureSchema } from "./providerOffer.js";

// Selected Offer = the Rescue Agent's signed handoff artifact to Person 3.
// Blueprint §9 "Recovery Result" + "Sui Voucher", merged: Person 3 reads
// `selectedProvider` + `agreement` + `signatures` to build the Sui
// authority/escrow commitment, and later reports activation/settlement
// status through the optional `activation` field.
//
// Signature coverage (verify with ../signing.js):
//   signatures.offerSignature  -> the original Provider Offer as signed by
//                                 the provider (key: provider profile's
//                                 publicKey). Copied verbatim from the
//                                 winning offer.
//   signatures.buyerSignature  -> canonical JSON of
//                                 { incidentId, selectedProvider, agreement }
//                                 signed by the Rescue Agent's buyer key.
//
// Timing fields use epoch milliseconds (blueprint §9 uses t_detect /
// t_decide / t_activate / t_recover); t_activate/t_recover are appended by
// the runtime in M4, not at selection time.

export const rejectionReasonValues = [
  "PROVIDER_UNAVAILABLE",
  "RESPONSE_TIMEOUT",
  "OFFER_INVALID",
  "TAMPERED_OFFER",
  "INSUFFICIENT_CAPACITY",
  "INSUFFICIENT_DURATION",
  "LATENCY_EXCEEDED",
  "PACKET_LOSS_EXCEEDED",
  "RELIABILITY_BELOW_MINIMUM",
  "BUDGET_EXCEEDED",
  "ACTIVATION_TOO_SLOW",
  "OFFER_EXPIRED",
  "RANKED_BELOW",
  "SUPERSEDED_BY_FIRST_VIABLE",
  "ACTIVATION_FAILED"
];

const selectedProviderSchema = z
  .object({
    providerId: z.string().min(1),
    brand: z.string().min(1),
    offerId: z.string().min(1),
    capacityMbps: z.number().finite().positive(),
    expectedActivationClass: z.enum(activationClassValues),
    expectedActivationTimeMs: z.number().int().positive(),
    activationLane: z.enum(activationLaneValues),
    price: z.number().finite().nonnegative(),
    currency: z.enum(["MYR", "USD"]),
    reliabilityScore: z.number().min(0).max(1),
    latencyMs: z.number().finite().nonnegative(),
    packetLossPercent: z.number().finite().nonnegative()
  })
  .strict();

export const selectedOfferSchema = z
  .object({
    incidentId: z.string().min(1),
    customerId: z.string().min(1),
    selectionMode: z.enum(["NORMAL", "EMERGENCY"]),
    selectedProvider: selectedProviderSchema,
    agreement: z
      .object({
        // Fee economics (blueprint §1.3): the platform fee is computed on the
        // plan price (the provider's quote) and added on top — the escrow
        // locks plan + fee and settles as a split to two addresses.
        //   amount        = planPrice + platformFee  (escrow lock, customer pays)
        //   providerAmount = planPrice                (settles to provider)
        //   platformFee    = planPrice × percent/100  (settles to platformAddress)
        planPrice: z.number().finite().nonnegative(),
        platformFee: z.number().finite().nonnegative(),
        platformFeePercent: z.number().finite().min(0).max(100),
        providerAmount: z.number().finite().nonnegative(),
        platformAddress: z.string().min(1),
        amount: z.number().finite().nonnegative(),
        currency: z.enum(["MYR", "USD"]),
        durationMinutes: z.number().int().positive(),
        // Nonce format: `${incidentId}:${providerId}:${sequence}`. Re-running
        // the same incident must reuse the same nonce, not mint a new one —
        // this is the repeatability guarantee Person 3 relies on. A failover
        // attempt increments the sequence (:002 …).
        nonce: z.string().min(1),
        expiry: z.iso.datetime()
      })
      .strict(),
    signatures: z
      .object({
        offerSignature: signatureSchema,
        buyerSignature: signatureSchema
      })
      .strict(),
    // Live-runtime artifact (integration contract P2→P3, 2026-08-31): the
    // ORIGINAL signed Provider Offer the offerSignature was computed over.
    // Fixture-era offers omit it — Person 3 falls back to the offers
    // directory. Embedding it makes the envelope self-contained: the trust
    // service verifies the provider signature against the profile's pinned
    // key with zero fixture lookups. Buyer-signature-safe: the buyer signs
    // { incidentId, selectedProvider, agreement } only, so this field can be
    // present or absent without changing what the buyer signed.
    originalOffer: providerOfferSchema.optional(),
    rejectedOffers: z.array(
      z
        .object({
          providerId: z.string().min(1),
          reason: z.enum(rejectionReasonValues),
          detail: z.string().min(1)
        })
        .strict()
    ),
    timing: z
      .object({
        tDetect: z.number().int().nonnegative(),
        tDecide: z.number().int().nonnegative(),
        // Filled in by the activation runtime (P4); absent in M1 fixtures.
        tActivate: z.number().int().nonnegative().optional(),
        tRecover: z.number().int().nonnegative().optional()
      })
      .strict(),
    // Filled in later by the activation runtime (M4). Absent at selection.
    activation: z
      .object({
        status: z.enum(["PENDING", "ACTIVATING", "AVAILABLE", "FAILED"]),
        recoveredCapacityMbps: z.number().finite().nonnegative().optional(),
        confirmedAtMs: z.number().int().nonnegative().optional()
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((selected, context) => {
    if (selected.agreement.planPrice !== selected.selectedProvider.price) {
      context.addIssue({
        code: "custom",
        path: ["agreement", "planPrice"],
        message: "agreement.planPrice must equal selectedProvider.price (fee is computed on the plan price)"
      });
    }

    const expectedFee =
      Math.round(
        selected.agreement.planPrice * (selected.agreement.platformFeePercent / 100) * 100
      ) / 100;

    if (selected.agreement.platformFee !== expectedFee) {
      context.addIssue({
        code: "custom",
        path: ["agreement", "platformFee"],
        message: `agreement.platformFee must equal ${expectedFee} (planPrice × percent/100, 2-dp)`
      });
    }

    if (selected.agreement.providerAmount !== selected.agreement.planPrice) {
      context.addIssue({
        code: "custom",
        path: ["agreement", "providerAmount"],
        message: "agreement.providerAmount must equal the plan price"
      });
    }

    if (selected.agreement.amount !== selected.agreement.planPrice + selected.agreement.platformFee) {
      context.addIssue({
        code: "custom",
        path: ["agreement", "amount"],
        message: "agreement.amount must equal planPrice + platformFee (escrow lock)"
      });
    }

    if (selected.agreement.currency !== selected.selectedProvider.currency) {
      context.addIssue({
        code: "custom",
        path: ["agreement", "currency"],
        message: "agreement.currency must equal selectedProvider.currency"
      });
    }

    if (!selected.agreement.nonce.startsWith(`${selected.incidentId}:`)) {
      context.addIssue({
        code: "custom",
        path: ["agreement", "nonce"],
        message: `nonce must start with "${selected.incidentId}:"`
      });
    }

    for (const [index, rejected] of selected.rejectedOffers.entries()) {
      if (rejected.providerId === selected.selectedProvider.providerId) {
        context.addIssue({
          code: "custom",
          path: ["rejectedOffers", index, "providerId"],
          message: "selected provider cannot also appear in rejectedOffers"
        });
      }
    }

    if (selected.timing.tDecide < selected.timing.tDetect) {
      context.addIssue({
        code: "custom",
        path: ["timing", "tDecide"],
        message: "tDecide cannot be earlier than tDetect"
      });
    }
  });
