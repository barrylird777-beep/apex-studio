# Peer-owned storage capacity inventory

Run this command **on each candidate storage host**, not on a central application server. A report is only evidence for the machine and filesystem where the command actually ran.

```sh
APEX_PEER_ID='<configured-libp2p-peer-id>' \
APEX_PEER_FAILURE_DOMAIN='<independently-verified-host-or-site-id>' \
APEX_PEER_OWNED_STORAGE_ROOT='/absolute/path/to/peer-owned-storage' \
APEX_PEER_STORAGE_RESERVED_BYTES='10737418240' \
npm run peer:capacity
```

The command reads filesystem capacity from the explicitly assigned storage root and emits total, available, reserved, and usable bytes plus a timestamp and short expiry. It intentionally omits the filesystem path from output.

## Inventory requirements

- Run separately on each host and retain the raw report with the host's authenticated peer identity.
- The failure-domain value must be independently verified by the operator; do not copy one value to multiple hosts to satisfy replica placement.
- A report marked `MEASURED_UNAUTHENTICATED` is **not** a signed advertisement, online heartbeat, replica receipt, or durability proof. Do not use it alone for placement or production readiness.
- Re-run the command to establish current availability. Reports expire after one minute by default; no recent report means capacity is unknown, not zero and not available.
- Record host/peer ID, failure domain, usable bytes, timestamp, and whether the peer is currently reachable through the authenticated peer transport. Do not publish secrets or filesystem paths.

This command does not discover hosts or connect them to the mesh. It makes the per-host capacity measurement repeatable; enrollment, authenticated heartbeat/identity binding, and independent-host durability tests remain separate gates.
