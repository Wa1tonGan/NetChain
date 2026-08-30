// Scoped spending authority (blueprint §4.1 / §6-E): granted and bounded
// BEFORE any incident, held by the buyer. The Rescue Agent's
// `preAuthorized: true` on every Provider Request is backed by this object.
// Passing the cap into escrow::commit/settle/refund proves the transaction
// was signed by the buyer — Sui enforces ownership.
module netchain::authority {
    use sui::transfer;

    public struct AuthorityCap has key, store {
        id: sui::object::UID,
        max_per_voucher: u64,
        enabled: bool,
        committed_total: u64, // audit: MYRC ever committed under this cap
        incident_count: u64,  // audit: distinct commitments made
    }

    /// Create the cap without transferring — callers transfer it explicitly
    /// (PTBs) or use `new_to_sender` in scripts.
    public fun new(max_per_voucher: u64, ctx: &mut TxContext): AuthorityCap {
        AuthorityCap {
            id: sui::object::new(ctx),
            max_per_voucher,
            enabled: true,
            committed_total: 0,
            incident_count: 0,
        }
    }

    public fun new_to_sender(max_per_voucher: u64, ctx: &mut TxContext) {
        let cap = new(max_per_voucher, ctx);
        transfer::transfer(cap, ctx.sender());
    }

    public fun set_enabled(cap: &mut AuthorityCap, enabled: bool) {
        cap.enabled = enabled;
    }

    public fun set_limit(cap: &mut AuthorityCap, max_per_voucher: u64) {
        cap.max_per_voucher = max_per_voucher;
    }

    public fun assert_can_spend(cap: &mut AuthorityCap, amount: u64) {
        assert!(cap.enabled, 4); // E_AUTHORITY_DISABLED
        assert!(amount <= cap.max_per_voucher, 5); // E_AUTHORITY_EXCEEDED
        cap.committed_total = cap.committed_total + amount;
        cap.incident_count = cap.incident_count + 1;
    }

    public fun enabled(cap: &AuthorityCap): bool { cap.enabled }
    public fun max_per_voucher(cap: &AuthorityCap): u64 { cap.max_per_voucher }
    public fun committed_total(cap: &AuthorityCap): u64 { cap.committed_total }
    public fun incident_count(cap: &AuthorityCap): u64 { cap.incident_count }
}
