import { z } from "zod";

// Provider profile = the pre-incident identity of a capacity provider.
// It doubles as the A2A Agent Card payload that the Readiness panel
// (Person 1) displays and that the Rescue Agent caches before any incident.

export const providerCategoryValues = [
  "TELCO_5G_QOD",
  "FWA_BURST",
  "LEO_SATELLITE"
];

export const activationClassValues = [
  "INSTANT",
  "FAST",
  "MEDIUM",
  "SLOW"
];

export const activationLaneValues = ["STANDARD", "P0_FAST"];

const publicKeySchema = z
  .object({
    algorithm: z.literal("ed25519"),
    keyId: z.string().min(1),
    // PEM-encoded SPKI public key. Distributing it here lets any verifier
    // (including Person 3's Sui-side checks) validate offers offline.
    value: z.string().startsWith("-----BEGIN PUBLIC KEY-----")
  })
  .strict();

export const providerProfileSchema = z
  .object({
    providerId: z.string().min(1),
    brand: z.string().min(1),
    category: z.enum(providerCategoryValues),
    description: z.string().min(1),
    agentCard: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1),
        protocol: z.literal("REST/JSON (A2A-semantic)"),
        endpoint: z.string().startsWith("http"),
        capabilities: z.array(z.string().min(1)).min(1),
        healthy: z.boolean(),
        credentialsReady: z.boolean(),
        lastHealthCheckAt: z.iso.datetime()
      })
      .strict(),
    policy: z
      .object({
        maxCapacityMbps: z.number().finite().positive(),
        baseFee: z.number().finite().nonnegative(),
        pricePer100MbpsPerHour: z.number().finite().nonnegative(),
        currency: z.enum(["MYR", "USD"])
      })
      .strict(),
    performance: z
      .object({
        latencyMs: z.number().finite().nonnegative(),
        packetLossPercent: z.number().finite().nonnegative(),
        reliabilityScore: z.number().min(0).max(1)
      })
      .strict(),
    activation: z
      .object({
        standard: z
          .object({
            class: z.enum(activationClassValues),
            timeMs: z.number().int().positive()
          })
          .strict(),
        // Pre-authorised P0 fast lane: only honoured when the incoming
        // request carries emergencyOverride, mirroring blueprint §5 (S5).
        p0FastLane: z
          .object({
            class: z.enum(activationClassValues),
            timeMs: z.number().int().positive()
          })
          .strict()
      })
      .strict(),
    publicKey: publicKeySchema
  })
  .strict();
