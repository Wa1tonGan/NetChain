// MYRC — demo Malaysian-ringgit unit (1 unit = 1 MYR), the payment asset the
// demo escrow is instantiated with. The escrow itself is generic over
// Coin<T>: swapping in a regulated MYR stablecoin or USDC is a type-argument
// change, not a contract change (real-world-readiness story, blueprint §13).
module netchain::myrc {
    use sui::coin::{Self, TreasuryCap};
    use sui::transfer;
    use std::option;

    public struct MYRC has drop {}

    #[allow(deprecated_usage)]
    fun init(witness: MYRC, ctx: &mut TxContext) {
        let (treasury, metadata) = coin::create_currency(
            witness,
            0, // decimals: 1 unit = 1 MYR, matching fixture amounts (60, 140)
            b"MYRC",
            b"NetChain Ringgit (demo)",
            b"1:1 demo Malaysian Ringgit unit for recovery-capacity settlement",
            option::none(),
            ctx,
        );
        transfer::public_freeze_object(metadata);
        // Treasury stays with the publisher (the buyer, who pre-funds escrow).
        transfer::public_transfer(treasury, ctx.sender());
    }
}
