// Spike B: prove the fixture ed25519 PEM keys and Sui keypairs are the same
// identity. Folds into src/sui/keys.js once green. Temporary.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { canonicalBytes, signPayload, verifyPayload } from "../src/a2a/signing.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keysDir = path.join(root, "fixtures", "keys");

function pemSeed(privateKeyPem) {
  const der = createPrivateKey(privateKeyPem).export({ type: "pkcs8", format: "der" });
  return new Uint8Array(der.subarray(der.length - 32));
}

function pemRawPublicKey(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return new Uint8Array(der.subarray(der.length - 32));
}

const buyerPrivatePem = readFileSync(path.join(keysDir, "buyer.private.pem"), "utf8");
const buyerPublicPem = readFileSync(path.join(keysDir, "buyer.public.pem"), "utf8");

const keypair = Ed25519Keypair.fromSecretKey(pemSeed(buyerPrivatePem));
const sdkPub = new Uint8Array(keypair.getPublicKey().toRawBytes());
const nodePub = pemRawPublicKey(buyerPublicPem);

console.log("sdk pubkey == pem pubkey:", Buffer.from(sdkPub).equals(Buffer.from(nodePub)));
console.log("buyer sui address:", keypair.toSuiAddress());

// Signature equivalence: P2's Node-crypto signing vs the SDK signer, over the
// same canonical bytes. If these match, the A2A voucher signature verifies
// on-chain with the raw public key.
const payload = { incidentId: "INC-SPIKE", agreement: { nonce: "INC-SPIKE:X:001" } };
const nodeSig = signPayload(buyerPrivatePem, payload);
const sdkSigned = await keypair.sign(canonicalBytes(payload));
const sdkSig = Buffer.from(sdkSigned).toString("base64");

console.log("signatures identical:", nodeSig === sdkSig);
console.log("node verifies sdk sig:", verifyPayload(buyerPublicPem, payload, sdkSig));

// Raw public key passed to Move will be this 32-byte value:
console.log("raw pubkey (base64 for Move arg):", Buffer.from(nodePub).toString("base64"));
