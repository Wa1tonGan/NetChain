// Sui identity layer for Person 3. The demo's ed25519 identities are the
// fixture PEM keys (Person 2's A2A world) — this module derives Sui keypairs
// from the same seeds so the buyer/providers keep ONE identity across
// negotiation (canonical-JSON signatures) and settlement (Sui transactions).
// Verified in scripts/spike-keys.mjs: Node-crypto and SDK signatures over the
// same bytes are identical, so voucher signatures verify on-chain with the
// raw 32-byte public keys.
import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ed25519Keypair, Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";

// PKCS#8 ed25519 DER = RFC 8410 prefix + 32-byte seed.
export function pemSeed(privateKeyPem) {
  const der = createPrivateKey(privateKeyPem).export({ type: "pkcs8", format: "der" });
  return new Uint8Array(der.subarray(der.length - 32));
}

// SPKI ed25519 DER = RFC 8410 prefix + 32-byte raw public key (Move arg form).
export function pemRawPublicKey(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return new Uint8Array(der.subarray(der.length - 32));
}

export function keypairFromPem(privateKeyPem) {
  return Ed25519Keypair.fromSecretKey(pemSeed(privateKeyPem));
}

export function suiAddressFromPem(publicKeyPem) {
  return new Ed25519PublicKey(pemRawPublicKey(publicKeyPem)).toSuiAddress();
}

// Address = blake2b256(0x00 || raw 32-byte ed25519 public key) — the same
// derivation the Move-side voucher binding relies on.
export function addressFromRawPublicKey(rawPublicKey) {
  return new Ed25519PublicKey(rawPublicKey).toSuiAddress();
}
