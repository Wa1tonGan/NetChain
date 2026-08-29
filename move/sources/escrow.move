// Sui Trust Layer core (blueprint §3.1/§9): pre-funded escrow with nonce-keyed
// commitments, ON-CHAIN verification of the A2A voucher's two ed25519
// signatures (provider offer + buyer agreement, both over Person 2's
// canonical-JSON bytes), settlement, refund, and permissionless post-expiry
// reclaim. Generic over the payment asset T; the demo instantiates MYRC.
//
// Authorization model:
//   commit / settle / refund require the buyer's AuthorityCap (Sui ownership
//   enforces that the buyer signed the transaction; the buyer is
//   tx_context::sender at commit time).
//   reclaim is permissionless after expiry — no fund can stay stuck if the
//   buyer key is offline (liveness guarantee).
//
// Idempotency (blueprint §6.1 Duplicate-Safety):
//   The nonce is the idempotency key. Same nonce + same voucher digest →
//   no-op success (Committed event with idempotent=true). Same nonce +
//   different digest → abort E_NONCE_REPLAY. Service-layer dedupe sits in
//   front; on-chain stays strict.
module netchain::escrow {
    use sui::hash;
    use sui::table::{Self, Table};
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::ed25519;
    use sui::event;
    use sui::object::{Self, ID, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use netchain::authority::{AuthorityCap, assert_can_spend};

    // ---- error codes (registry shared in documents/person3-trust-contract.md)
    const E_SIGNATURE_INVALID: u64 = 1;
    const E_VOUCHER_EXPIRED: u64 = 2;
    const E_NONCE_REPLAY: u64 = 3;
    const E_INSUFFICIENT_ESCROW: u64 = 6;
    const E_UNKNOWN_COMMITMENT: u64 = 7;
    const E_ALREADY_FINALIZED: u64 = 8;
    const E_NOT_EXPIRED: u64 = 9;

    // ---- commitment status
    const STATUS_COMMITTED: u8 = 0;
    const STATUS_SETTLED: u8 = 1;
    const STATUS_REFUNDED: u8 = 2;
    const STATUS_RECLAIMED: u8 = 3;
    const STATUS_UNKNOWN: u8 = 255;

    public struct Commitment has store {
        incident_id: vector<u8>,
        provider_id: vector<u8>,
        amount: u64,
        expiry_ms: u64,
        voucher_digest: vector<u8>, // blake2b256(canonical buyer-agreement bytes)
        buyer: address,
        provider: address,
        status: u8,
    }

    /// Pre-funded escrow (blueprint §4.1: funded BEFORE any incident).
    /// `available` is the spendable pool; each commitment locks its amount
    /// in `locked` at commit time, so settle/refund/reclaim can never fail
    /// for lack of funds.
    public struct Escrow<phantom T> has key, store {
        id: UID,
        available: Balance<T>,
        locked: Table<vector<u8>, Balance<T>>,
        commitments: Table<vector<u8>, Commitment>,
    }

    // ---- events (the on-chain half of the recovery event ledger)
    public struct EscrowFunded has copy, drop {
        escrow_id: ID, amount: u64, available: u64,
    }
    public struct Committed has copy, drop {
        escrow_id: ID, incident_id: vector<u8>, provider_id: vector<u8>,
        nonce: vector<u8>, amount: u64, expiry_ms: u64,
        voucher_digest: vector<u8>, buyer: address, provider: address,
        idempotent: bool, status: u8,
    }
    public struct Settled has copy, drop {
        escrow_id: ID, incident_id: vector<u8>, nonce: vector<u8>,
        amount: u64, provider: address,
    }
    public struct Refunded has copy, drop {
        escrow_id: ID, incident_id: vector<u8>, nonce: vector<u8>,
        amount: u64, buyer: address,
    }
    public struct Reclaimed has copy, drop {
        escrow_id: ID, incident_id: vector<u8>, nonce: vector<u8>,
        amount: u64, buyer: address,
    }

    // ---- lifecycle ---------------------------------------------------------

    public fun new<T>(ctx: &mut TxContext): Escrow<T> {
        Escrow {
            id: object::new(ctx),
            available: balance::zero(),
            locked: table::new(ctx),
            commitments: table::new(ctx),
        }
    }

    /// Fund the escrow before incidents (blueprint §4.1 readiness phase).
    public fun deposit<T>(escrow: &mut Escrow<T>, coin: Coin<T>) {
        let amount = coin::value(&coin);
        balance::join(&mut escrow.available, coin::into_balance(coin));
        event::emit(EscrowFunded {
            escrow_id: object::id(escrow),
            amount,
            available: balance::value(&escrow.available),
        });
    }

    /// Commit to a recovery voucher: verify BOTH A2A signatures on-chain,
    /// check the scoped authority and voucher expiry, lock funds under the
    /// nonce. Idempotent for byte-identical resubmission; aborts with
    /// E_NONCE_REPLAY if the same nonce arrives with different bytes.
    public fun commit<T>(
        escrow: &mut Escrow<T>,
        authority: &mut AuthorityCap,
        clock: &Clock,
        incident_id: vector<u8>,
        provider_id: vector<u8>,
        amount: u64,
        expiry_ms: u64,
        nonce: vector<u8>,
        provider: address,
        buyer_msg: vector<u8>,
        buyer_sig: vector<u8>,
        buyer_pk: vector<u8>,
        provider_msg: vector<u8>,
        provider_sig: vector<u8>,
        provider_pk: vector<u8>,
        ctx: &mut TxContext,
    ) {
        let digest = hash::blake2b256(&buyer_msg);
        let buyer = tx_context::sender(ctx);

        if (table::contains(&escrow.commitments, nonce)) {
            let existing = table::borrow(&escrow.commitments, nonce);
            // Byte-identical resubmission is a no-op success (the service
            // layer retries, crashes, or replays the same voucher).
            assert!(existing.voucher_digest == digest, E_NONCE_REPLAY);
            event::emit(Committed {
                escrow_id: object::id(escrow),
                incident_id: existing.incident_id,
                provider_id: existing.provider_id,
                nonce,
                amount: existing.amount,
                expiry_ms: existing.expiry_ms,
                voucher_digest: digest,
                buyer: existing.buyer,
                provider: existing.provider,
                idempotent: true,
                status: existing.status,
            });
            return
        };

        assert!(
            ed25519::ed25519_verify(&provider_sig, &provider_pk, &provider_msg),
            E_SIGNATURE_INVALID
        );
        assert!(
            ed25519::ed25519_verify(&buyer_sig, &buyer_pk, &buyer_msg),
            E_SIGNATURE_INVALID
        );
        assert_can_spend(authority, amount);
        assert!(clock::timestamp_ms(clock) < expiry_ms, E_VOUCHER_EXPIRED);
        assert!(balance::value(&escrow.available) >= amount, E_INSUFFICIENT_ESCROW);

        let locked = balance::split(&mut escrow.available, amount);
        table::add(&mut escrow.locked, nonce, locked);
        table::add(&mut escrow.commitments, nonce, Commitment {
            incident_id,
            provider_id,
            amount,
            expiry_ms,
            voucher_digest: digest,
            buyer,
            provider,
            status: STATUS_COMMITTED,
        });

        event::emit(Committed {
            escrow_id: object::id(escrow),
            incident_id,
            provider_id,
            nonce,
            amount,
            expiry_ms,
            voucher_digest: digest,
            buyer,
            provider,
            idempotent: false,
            status: STATUS_COMMITTED,
        });
    }

    /// Buyer releases the locked payment to the provider after the recovery
    /// was verified (activation AVAILABLE). Gated by the AuthorityCap so the
    /// provider cannot self-claim past verification.
    #[allow(lint(unused_object_with_fields))]
    public fun settle<T>(
        escrow: &mut Escrow<T>,
        _authority: &AuthorityCap,
        nonce: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(table::contains(&escrow.commitments, nonce), E_UNKNOWN_COMMITMENT);
        {
            let c = table::borrow(&escrow.commitments, nonce);
            assert!(c.status == STATUS_COMMITTED, E_ALREADY_FINALIZED);
        };
        assert!(table::contains(&escrow.locked, nonce), E_UNKNOWN_COMMITMENT);
        let locked = table::remove(&mut escrow.locked, nonce);
        let payment = coin::from_balance(locked, ctx);
        let (provider, amount, incident_id) = {
            let c = table::borrow_mut(&mut escrow.commitments, nonce);
            c.status = STATUS_SETTLED;
            (c.provider, c.amount, c.incident_id)
        };
        transfer::public_transfer(payment, provider);
        event::emit(Settled {
            escrow_id: object::id(escrow),
            incident_id,
            nonce,
            amount,
            provider,
        });
    }

    /// Buyer recovers the locked funds when activation FAILED (or the flow
    /// otherwise cannot proceed). Gated by the AuthorityCap.
    #[allow(lint(unused_object_with_fields))]
    public fun refund<T>(
        escrow: &mut Escrow<T>,
        _authority: &AuthorityCap,
        nonce: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(table::contains(&escrow.commitments, nonce), E_UNKNOWN_COMMITMENT);
        {
            let c = table::borrow(&escrow.commitments, nonce);
            assert!(c.status == STATUS_COMMITTED, E_ALREADY_FINALIZED);
        };
        assert!(table::contains(&escrow.locked, nonce), E_UNKNOWN_COMMITMENT);
        let locked = table::remove(&mut escrow.locked, nonce);
        let returned = coin::from_balance(locked, ctx);
        let (buyer, amount, incident_id) = {
            let c = table::borrow_mut(&mut escrow.commitments, nonce);
            c.status = STATUS_REFUNDED;
            (c.buyer, c.amount, c.incident_id)
        };
        transfer::public_transfer(returned, buyer);
        event::emit(Refunded {
            escrow_id: object::id(escrow),
            incident_id,
            nonce,
            amount,
            buyer,
        });
    }

    /// Permissionless post-expiry reclaim: anyone may return the locked funds
    /// to the buyer once the voucher expired un-settled. Liveness guarantee —
    /// nothing is stuck if the buyer key is offline.
    public fun reclaim<T>(escrow: &mut Escrow<T>, nonce: vector<u8>, clock: &Clock, ctx: &mut TxContext) {
        assert!(table::contains(&escrow.commitments, nonce), E_UNKNOWN_COMMITMENT);
        assert!(table::contains(&escrow.locked, nonce), E_UNKNOWN_COMMITMENT);
        {
            let c = table::borrow(&escrow.commitments, nonce);
            assert!(c.status == STATUS_COMMITTED, E_ALREADY_FINALIZED);
            assert!(clock::timestamp_ms(clock) >= c.expiry_ms, E_NOT_EXPIRED);
        };
        let locked = table::remove(&mut escrow.locked, nonce);
        let returned = coin::from_balance(locked, ctx);
        let (buyer, amount, incident_id) = {
            let c = table::borrow_mut(&mut escrow.commitments, nonce);
            c.status = STATUS_RECLAIMED;
            (c.buyer, c.amount, c.incident_id)
        };
        transfer::public_transfer(returned, buyer);
        event::emit(Reclaimed {
            escrow_id: object::id(escrow),
            incident_id,
            nonce,
            amount,
            buyer,
        });
    }

    // ---- views -------------------------------------------------------------

    public fun available_value<T>(escrow: &Escrow<T>): u64 {
        balance::value(&escrow.available)
    }

    public fun has_commitment<T>(escrow: &Escrow<T>, nonce: vector<u8>): bool {
        table::contains(&escrow.commitments, nonce)
    }

    public fun commitment_status<T>(escrow: &Escrow<T>, nonce: vector<u8>): u8 {
        if (table::contains(&escrow.commitments, nonce)) {
            table::borrow(&escrow.commitments, nonce).status
        } else {
            STATUS_UNKNOWN
        }
    }

    public fun locked_value<T>(escrow: &Escrow<T>, nonce: vector<u8>): u64 {
        if (table::contains(&escrow.locked, nonce)) {
            let locked = table::borrow(&escrow.locked, nonce);
            balance::value(locked)
        } else {
            0
        }
    }
}
