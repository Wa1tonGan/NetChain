// Minimum-set unit tests for the trust layer. Signatures are fixed test
// vectors generated off-chain (see documents/person3-trust-contract.md §
// "Test vectors"): buyer seed = 32×0x07, provider seed = 32×0x09, and the
// addresses below are the real blake2b256-derived Sui addresses of those keys.
#[test_only]
module netchain::escrow_tests {
    use sui::clock::{Self, Clock};
    use sui::coin;
    use sui::sui;
    use sui::test_scenario::{Self, Scenario};
    use sui::transfer;
    use netchain::authority::{Self, AuthorityCap};
    use netchain::escrow::{Self, Escrow};

    // Abort codes mirrored from netchain::escrow / netchain::authority.
    const E_SIGNATURE_INVALID: u64 = 1;
    const E_VOUCHER_EXPIRED: u64 = 2;
    const E_NONCE_REPLAY: u64 = 3;
    const E_AUTHORITY_DISABLED: u64 = 4;
    const E_AUTHORITY_EXCEEDED: u64 = 5;
    const E_UNKNOWN_COMMITMENT: u64 = 7;
    const E_ALREADY_FINALIZED: u64 = 8;
    const E_NOT_EXPIRED: u64 = 9;

    // Commitment status mirrors.
    const STATUS_COMMITTED: u8 = 0;
    const STATUS_SETTLED: u8 = 1;
    const STATUS_REFUNDED: u8 = 2;
    const STATUS_RECLAIMED: u8 = 3;

    const BUYER: address = @0xa0ccc8bcc83f6c628340134f8546a21e0618fd1aaa02432bba454c4a2c2233da;
    const PROVIDER: address = @0x6c889013fb165a3a991a62d706af2435d3145a2655347074db6fc94b0eb97ad3;

    const NOW: u64 = 1_000;
    const EXPIRY: u64 = 61_000;
    const AFTER_EXPIRY: u64 = 61_500;
    const AMOUNT: u64 = 60;
    const LIMIT: u64 = 500;
    const FUND: u64 = 1_000;

    fun buyer_pk(): vector<u8> {
        x"ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c"
    }
    fun buyer_sig(): vector<u8> {
        x"e33fba7683b13481c3beae685ac3ced6674984f03c2b8755fa83950241269e6b8ec62ad9c3c26b19455c44de949cb483f00c6192b6b3d5f01f6c6efe35fa7802"
    }
    fun buyer_msg(): vector<u8> {
        x"494e432d543a50524f56494445522d423a3030317c7b61677265656d656e742d63616e6f6e6963616c2d62797465737d"
    }
    fun buyer_msg_tampered(): vector<u8> {
        x"494e432d543a50524f56494445522d423a3030317c7b61677265656d656e742d63616e6f6e6963616c2d62797465737e"
    }
    fun buyer_sig_corrupt(): vector<u8> {
        x"e23fba7683b13481c3beae685ac3ced6674984f03c2b8755fa83950241269e6b8ec62ad9c3c26b19455c44de949cb483f00c6192b6b3d5f01f6c6efe35fa7802"
    }
    fun provider_pk(): vector<u8> {
        x"fd1724385aa0c75b64fb78cd602fa1d991fdebf76b13c58ed702eac835e9f618"
    }
    fun provider_sig(): vector<u8> {
        x"236cffe2e237b726448009f4b88001ee04e063b93b20ab95c76f3b3d99b464e6ad4f3d2c43d720c047fb0c869ed8706acc3f438e8a487ff51cd2ff8e43d64c02"
    }
    fun provider_msg(): vector<u8> {
        x"494e432d543a50524f56494445522d423a3030317c7b6f666665722d63616e6f6e6963616c2d62797465737d"
    }
    fun nonce(): vector<u8> { b"INC-T:PROVIDER-B:001" }

    fun setup(scenario: &mut Scenario): (Escrow<sui::SUI>, AuthorityCap) {
        let mut escrow;
        let mut authority;
        {
            let ctx = scenario.ctx();
            let funding = coin::mint_for_testing(FUND, ctx);
            escrow = escrow::new(ctx);
            authority = authority::new(LIMIT, ctx);
            escrow::deposit(&mut escrow, funding);
        };
        (escrow, authority)
    }

    fun do_commit<T>(
        escrow: &mut Escrow<T>,
        authority: &mut AuthorityCap,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        escrow::commit(
            escrow, authority, clock,
            b"INC-T", b"PROVIDER-B", AMOUNT, EXPIRY, nonce(), PROVIDER,
            buyer_msg(), buyer_sig(), buyer_pk(),
            provider_msg(), provider_sig(), provider_pk(),
            ctx,
        );
    }

    fun finish(scenario: Scenario, escrow: Escrow<sui::SUI>, authority: AuthorityCap) {
        transfer::public_transfer(escrow, @0xBEEF);
        transfer::public_transfer(authority, @0xBEEF);
        scenario.end();
    }

    #[test]
    fun commit_settle_happy_path() {
        let mut scenario = test_scenario::begin(BUYER);
        let (mut escrow, mut authority) = setup(&mut scenario);
        {
            let ctx = scenario.ctx();
            let mut clock = clock::create_for_testing(ctx);
            clock::set_for_testing(&mut clock, NOW);
            do_commit(&mut escrow, &mut authority, &clock, ctx);
            clock::destroy_for_testing(clock);
        };
        assert!(escrow::available_value(&escrow) == FUND - AMOUNT, 100);
        assert!(escrow::locked_value(&escrow, nonce()) == AMOUNT, 101);
        assert!(escrow::commitment_status(&escrow, nonce()) == STATUS_COMMITTED, 102);
        {
            let ctx = scenario.ctx();
            escrow::settle(&mut escrow, &authority, nonce(), ctx);
        };
        assert!(escrow::available_value(&escrow) == FUND - AMOUNT, 103);
        assert!(escrow::locked_value(&escrow, nonce()) == 0, 104);
        assert!(escrow::commitment_status(&escrow, nonce()) == STATUS_SETTLED, 105);
        finish(scenario, escrow, authority);
    }

    #[test]
    fun commit_idempotent_same_bytes() {
        let mut scenario = test_scenario::begin(BUYER);
        let (mut escrow, mut authority) = setup(&mut scenario);
        {
            let ctx = scenario.ctx();
            let mut clock = clock::create_for_testing(ctx);
            do_commit(&mut escrow, &mut authority, &clock, ctx);
            // Byte-identical resubmission: no abort, no double lock.
            do_commit(&mut escrow, &mut authority, &clock, ctx);
            clock::destroy_for_testing(clock);
        };
        assert!(escrow::available_value(&escrow) == FUND - AMOUNT, 110);
        assert!(escrow::commitment_status(&escrow, nonce()) == STATUS_COMMITTED, 111);
        finish(scenario, escrow, authority);
    }

    #[test]
    #[expected_failure(abort_code = E_NONCE_REPLAY, location = netchain::escrow)]
    fun commit_nonce_replay_different_bytes_aborts() {
        let mut scenario = test_scenario::begin(BUYER);
        let (mut escrow, mut authority) = setup(&mut scenario);
        {
            let ctx = scenario.ctx();
            let mut clock = clock::create_for_testing(ctx);
            do_commit(&mut escrow, &mut authority, &clock, ctx);
            // Same nonce, tampered bytes → different digest → replay abort.
            escrow::commit(
                &mut escrow, &mut authority, &clock,
                b"INC-T", b"PROVIDER-B", AMOUNT, EXPIRY, nonce(), PROVIDER,
                buyer_msg_tampered(), buyer_sig(), buyer_pk(),
                provider_msg(), provider_sig(), provider_pk(),
                ctx,
            );
            clock::destroy_for_testing(clock);
        };
        finish(scenario, escrow, authority);
    }

    #[test]
    #[expected_failure(abort_code = E_SIGNATURE_INVALID, location = netchain::escrow)]
    fun commit_bad_buyer_signature_aborts() {
        let mut scenario = test_scenario::begin(BUYER);
        let (mut escrow, mut authority) = setup(&mut scenario);
        {
            let ctx = scenario.ctx();
            let mut clock = clock::create_for_testing(ctx);
            escrow::commit(
                &mut escrow, &mut authority, &clock,
                b"INC-T", b"PROVIDER-B", AMOUNT, EXPIRY, nonce(), PROVIDER,
                buyer_msg(), buyer_sig_corrupt(), buyer_pk(),
                provider_msg(), provider_sig(), provider_pk(),
                ctx,
            );
            clock::destroy_for_testing(clock);
        };
        finish(scenario, escrow, authority);
    }

    #[test]
    #[expected_failure(abort_code = E_VOUCHER_EXPIRED, location = netchain::escrow)]
    fun commit_expired_voucher_aborts() {
        let mut scenario = test_scenario::begin(BUYER);
        let (mut escrow, mut authority) = setup(&mut scenario);
        {
            let ctx = scenario.ctx();
            let mut clock = clock::create_for_testing(ctx);
            clock::set_for_testing(&mut clock, AFTER_EXPIRY);
            do_commit(&mut escrow, &mut authority, &clock, ctx);
            clock::destroy_for_testing(clock);
        };
        finish(scenario, escrow, authority);
    }

    #[test]
    #[expected_failure(abort_code = E_ALREADY_FINALIZED, location = netchain::escrow)]
    fun settle_twice_aborts() {
        let mut scenario = test_scenario::begin(BUYER);
        let (mut escrow, mut authority) = setup(&mut scenario);
        {
            let ctx = scenario.ctx();
            let mut clock = clock::create_for_testing(ctx);
            do_commit(&mut escrow, &mut authority, &clock, ctx);
            clock::destroy_for_testing(clock);
        };
        {
            let ctx = scenario.ctx();
            escrow::settle(&mut escrow, &authority, nonce(), ctx);
            escrow::settle(&mut escrow, &authority, nonce(), ctx);
        };
        finish(scenario, escrow, authority);
    }

    #[test]
    #[expected_failure(abort_code = E_UNKNOWN_COMMITMENT, location = netchain::escrow)]
    fun settle_unknown_nonce_aborts() {
        let mut scenario = test_scenario::begin(BUYER);
        let (mut escrow, mut authority) = setup(&mut scenario);
        {
            let ctx = scenario.ctx();
            escrow::settle(&mut escrow, &authority, b"INC-T:PROVIDER-B:999", ctx);
        };
        finish(scenario, escrow, authority);
    }

    #[test]
    fun refund_returns_funds() {
        let mut scenario = test_scenario::begin(BUYER);
        let (mut escrow, mut authority) = setup(&mut scenario);
        {
            let ctx = scenario.ctx();
            let mut clock = clock::create_for_testing(ctx);
            do_commit(&mut escrow, &mut authority, &clock, ctx);
            clock::destroy_for_testing(clock);
        };
        {
            let ctx = scenario.ctx();
            escrow::refund(&mut escrow, &authority, nonce(), ctx);
        };
        assert!(escrow::available_value(&escrow) == FUND - AMOUNT, 120);
        assert!(escrow::locked_value(&escrow, nonce()) == 0, 121);
        assert!(escrow::commitment_status(&escrow, nonce()) == STATUS_REFUNDED, 122);
        finish(scenario, escrow, authority);
    }

    #[test]
    #[expected_failure(abort_code = E_ALREADY_FINALIZED, location = netchain::escrow)]
    fun refund_twice_aborts() {
        let mut scenario = test_scenario::begin(BUYER);
        let (mut escrow, mut authority) = setup(&mut scenario);
        {
            let ctx = scenario.ctx();
            let mut clock = clock::create_for_testing(ctx);
            do_commit(&mut escrow, &mut authority, &clock, ctx);
            clock::destroy_for_testing(clock);
        };
        {
            let ctx = scenario.ctx();
            escrow::refund(&mut escrow, &authority, nonce(), ctx);
            escrow::refund(&mut escrow, &authority, nonce(), ctx);
        };
        finish(scenario, escrow, authority);
    }

    #[test]
    #[expected_failure(abort_code = E_NOT_EXPIRED, location = netchain::escrow)]
    fun reclaim_before_expiry_aborts() {
        let mut scenario = test_scenario::begin(BUYER);
        let (mut escrow, mut authority) = setup(&mut scenario);
        {
            let ctx = scenario.ctx();
            let mut clock = clock::create_for_testing(ctx);
            clock::set_for_testing(&mut clock, NOW);
            do_commit(&mut escrow, &mut authority, &clock, ctx);
            // Permissionless (no AuthorityCap argument), but only after expiry.
            escrow::reclaim(&mut escrow, nonce(), &clock, ctx);
            clock::destroy_for_testing(clock);
        };
        finish(scenario, escrow, authority);
    }

    #[test]
    fun reclaim_after_expiry_returns_funds() {
        let mut scenario = test_scenario::begin(BUYER);
        let (mut escrow, mut authority) = setup(&mut scenario);
        {
            let ctx = scenario.ctx();
            let mut clock = clock::create_for_testing(ctx);
            clock::set_for_testing(&mut clock, NOW);
            do_commit(&mut escrow, &mut authority, &clock, ctx);
            clock::set_for_testing(&mut clock, AFTER_EXPIRY);
            // Any third party may reclaim — no AuthorityCap argument.
            escrow::reclaim(&mut escrow, nonce(), &clock, ctx);
            clock::destroy_for_testing(clock);
        };
        assert!(escrow::available_value(&escrow) == FUND - AMOUNT, 130);
        assert!(escrow::locked_value(&escrow, nonce()) == 0, 131);
        assert!(escrow::commitment_status(&escrow, nonce()) == STATUS_RECLAIMED, 132);
        finish(scenario, escrow, authority);
    }

    #[test]
    #[expected_failure(abort_code = E_AUTHORITY_DISABLED, location = netchain::authority)]
    fun authority_disabled_blocks_commit() {
        let mut scenario = test_scenario::begin(BUYER);
        let (mut escrow, mut authority) = setup(&mut scenario);
        authority::set_enabled(&mut authority, false);
        {
            let ctx = scenario.ctx();
            let mut clock = clock::create_for_testing(ctx);
            do_commit(&mut escrow, &mut authority, &clock, ctx);
            clock::destroy_for_testing(clock);
        };
        finish(scenario, escrow, authority);
    }

    #[test]
    #[expected_failure(abort_code = E_AUTHORITY_EXCEEDED, location = netchain::authority)]
    fun authority_limit_blocks_commit() {
        let mut scenario = test_scenario::begin(BUYER);
        let mut escrow;
        let mut authority;
        {
            let ctx = scenario.ctx();
            let funding = coin::mint_for_testing(FUND, ctx);
            escrow = escrow::new(ctx);
            authority = authority::new(AMOUNT - 1, ctx); // below voucher amount
            escrow::deposit(&mut escrow, funding);
        };
        {
            let ctx = scenario.ctx();
            let mut clock = clock::create_for_testing(ctx);
            do_commit(&mut escrow, &mut authority, &clock, ctx);
            clock::destroy_for_testing(clock);
        };
        finish(scenario, escrow, authority);
    }
}
