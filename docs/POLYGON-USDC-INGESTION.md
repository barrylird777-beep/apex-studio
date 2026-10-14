# Polygon PoS native USDC payment ingestion

The scanner in `src/core/polygon-usdc-listener.mjs` is mainnet-only. It pins
Polygon PoS chain ID 137 and the native USDC contract
`0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`. It checks Transfer logs for
one configured recipient and waits for the configured confirmation depth before
processing logs.

## Required integration contract

- `POLYGON_POS_RPC_URL`: HTTPS RPC endpoint for Polygon PoS mainnet.
- `APEX_USDC_RECIPIENT`: the exact receiving wallet address.
- `APEX_USDC_CONFIRMATIONS`: positive confirmation depth (default 128).
- `APEX_USDC_LOOKBACK_BLOCKS`: first-run discovery window (default 2000).
- `cursorStore.get/set`: shared durable cursor storage with atomic writes and
  rollback/reorg handling appropriate to the deployment.
- `enqueue`: durable, idempotent queue insertion keyed by transaction hash
  and log index.

The listener is an event-scanning module, not a payment-settlement system. It
must be wired to a supervised poller and a real shared durable cursor before
production use. The first scan only covers the configured lookback window;
bootstrap/backfill is required for older transactions. Production operations
must handle RPC outages, chain reorganizations, cursor recovery, and duplicate
events. Never credit an account directly from an unconfirmed event.

The task contains the exact raw token amount and `tokenDecimals: 6`; the
amount is not converted to a floating-point dollar value. A transfer event does
not prove that a specific customer is entitled to a request, that a payment
has not been refunded elsewhere, or that the issuer will redeem it. The API
must bind the payment to an order/customer, enforce amount and replay rules,
and mark each transaction/log as consumed in durable shared state.

This repository change does not supply an RPC provider, wallet, durable cursor
backend, customer/order ledger, refund policy, or a deployed mainnet listener.
Do not describe it as live revenue until those pieces and a small-value end-to-
end mainnet transaction have been verified.

## Cooperative render preemption

The priority gate deliberately does not use `SIGSTOP` or `SIGCONT`. A running
render must register `yieldForPriority` and `resumeFromPriorityCheckpoint`
callbacks in its render plan. The yield callback must finish and durably record
a complete segment, release the GPU/resource lease, and return a checkpoint
with `resourceReleased: true`. The resume callback must continue from that
checkpoint. Without those hooks, paid inference fails closed rather than
claiming a safe pause. Arbitrary FFmpeg plans are not automatically segmented
by this change.
