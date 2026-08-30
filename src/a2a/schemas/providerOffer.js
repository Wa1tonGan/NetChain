import { z } from "zod";
import { activationClassValues, activationLaneValues } from "./providerProfile.js";

// Provider Offer = one provider's signed answer to a Provider Request.
// Blueprint §9 "Provider Offer". The signature covers the canonical JSON of
// the whole offer object minus the `signature` field (see ../signing.js).

export const signatureSchema = z
  .object({
    algorithm: z.literal("ed25519"),
    keyId: z.string().min(1),
    value: z.string().min(1)
  })
  .strict();

export const providerOfferSchema = z
  .object({
    offerId: z.string().min(1),
    incidentId: z.string().min(1),
    providerId: z.string().min(1),
    available: z.boolean(),
    capacityMbps: z.number().finite().positive(),
    // Duration is first-class (blueprint: "Duration as a first-class field in
    // intents, provider plans and offers"): every offer quotes the length of
    // service it covers, mirroring the request's durationMinutes it answers.
    durationMinutes: z.number().int().positive(),
    expectedActivationClass: z.enum(activationClassValues),
    expectedActivationTimeMs: z.number().int().positive(),
    activationLane: z.enum(activationLaneValues),
    price: z.number().finite().nonnegative(),
    currency: z.enum(["MYR", "USD"]),
    reliabilityScore: z.number().min(0).max(1),
    latencyMs: z.number().finite().nonnegative(),
    packetLossPercent: z.number().finite().nonnegative(),
    offerExpiry: z.iso.datetime(),
    // Optional Gonka-generated extras. Included pre-signature when they make
    // it in before the bid deadline, absent otherwise — schema stays valid
    // either way. Display-only for the Rescue Agent (MVP): "LLM enriches,
    // determinism decides."
    enrichment: z
      .object({
        pitch: z.string().min(1).optional(),
        counterOffer: z
          .object({
            capacityMbps: z.number().finite().positive(),
            price: z.number().finite().nonnegative(),
            expectedActivationTimeMs: z.number().int().positive()
          })
          .strict()
          .optional()
      })
      .strict()
      .optional(),
    signature: signatureSchema
  })
  .strict()
  .superRefine((offer, context) => {
    if (!offer.available && offer.capacityMbps > 0 && offer.price > 0) {
      // An unavailable provider may still answer, but it must not quote
      // sellable capacity and price at the same time.
      context.addIssue({
        code: "custom",
        path: ["available"],
        message: "Unavailable offers cannot quote capacity and price"
      });
    }
  });
