// One-off: convert the team's provider suiprivkey secrets into the PEM
// identity files the A2A agents expect (provider-{id}.private.pem PKCS8 +
// provider-{id}.public.pem SPKI), and patch the publicKey.value in
// fixtures/providers/provider-{id}.json — everything else (Person 2's USDC
// pricing) stays untouched.
// Usage: node scripts/convert-provider-keys.mjs <providerId> <suiprivkey>
//   node scripts/convert-provider-keys.mjs PROVIDER-A suiprivkey1qry…
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bech32 } from "@scure/base";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [providerId, secret] = process.argv.slice(2);
if (!providerId || !secret) {
  console.error("usage: node scripts/convert-provider-keys.mjs <PROVIDER-A|B|C> <suiprivkey…>");
  process.exit(1);
}

const fileStem = providerId.toLowerCase(); // provider-a

// suiprivkey bech32 = flag byte 0x00 + 32-byte ed25519 seed.
const decoded = bech32.decode(secret, 200);
const bytes = bech32.fromWords(decoded.words);
if (decoded.prefix !== "suiprivkey" || bytes[0] !== 0 || bytes.length !== 33) {
  console.error(`not a valid ed25519 suiprivkey for ${providerId}`);
  process.exit(1);
}
const seed = Buffer.from(bytes.slice(1));
const keypair = Ed25519Keypair.fromSecretKey(seed);
const suiAddress = keypair.toSuiAddress();
const rawPub = Buffer.from(keypair.getPublicKey().toRawBytes());

// PKCS#8 ed25519 DER = RFC 8410 prefix + 32-byte SEED (not the public key!).
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
// SPKI ed25519 DER = RFC 8410 prefix + 32-byte raw public key.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function wrapPem(label, der) {
  const b64 = der.toString("base64").replace(/(.{64})/g, "$1\n").split("\n").filter(Boolean);
  return [`-----BEGIN ${label}-----`, ...b64, `-----END ${label}-----`, ""].join("\n");
}

const privPem = wrapPem("PRIVATE KEY", Buffer.concat([PKCS8_PREFIX, seed]));
const pubPem = wrapPem("PUBLIC KEY", Buffer.concat([SPKI_PREFIX, rawPub]));

writeFileSync(path.join(projectRoot, "fixtures/keys", `${fileStem}.private.pem`), privPem);
writeFileSync(path.join(projectRoot, "fixtures/keys", `${fileStem}.public.pem`), pubPem);

// Round-trip check through the repo's own key utils.
const { keypairFromPem } = await import("../src/sui/keys.js");
const kp2 = keypairFromPem(privPem);
const derived = Buffer.from(kp2.getPublicKey().toRawBytes()).toString("hex");
const expected = rawPub.toString("hex");
if (derived !== expected || kp2.toSuiAddress() !== suiAddress) {
  console.error(`MISMATCH for ${providerId} — PEMs written but profile NOT patched`);
  process.exit(1);
}

// Patch ONLY publicKey.value in the provider profile (preserve all else).
const profilePath = path.join(projectRoot, "fixtures/providers", `${fileStem}.json`);
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const before = profile.publicKey.value;
profile.publicKey.value = pubPem.trim();
writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);

console.log(`${providerId}:`);
console.log(`  suiAddress : ${suiAddress}`);
console.log(`  pubRawB64  : ${rawPub.toString("base64")}`);
console.log(`  profile publicKey ${before === profile.publicKey.value ? "unchanged" : "patched"}`);
