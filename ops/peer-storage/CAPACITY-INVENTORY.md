# Peer-owned storage capacity inventory

Run this command **on each candidate storage host**, not on a central application server. A report is evidence only for the machine and filesystem where the command actually ran.

```sh
APEX_PEER_ID='<configured-libp2p-peer-id>' \
APEX_PEER_FAILURE_DOMAIN='<independently-verified-host-or-site-id>' \
APEX_PEER_OWNED_STORAGE_ROOT='/absolute/path/to/peer-owned-storage' \
APEX_PEER_STORAGE_RESERVED_BYTES='10737418240' \
npm run peer:capacity
```

The command reads actual filesystem capacity from the explicitly assigned storage root and emits total, available, reserved, and usable bytes, measurement time, expiry, and the explicit `MEASURED_UNAUTHENTICATED` status. It intentionally omits the filesystem path from output.

## Inventory requirements

- Run separately on each host and retain the report alongside the authenticated identity of that host.
- Independently verify the failure domain; do not assign the same failure-domain value to separate machines unless they truly share that failure domain.
- The report is not a signed advertisement, online heartbeat, replica receipt, or durability proof. Do not use it alone for placement or production readiness.
- Reports expire after one minute by default. A missing or expired report means capacity is unknown, not available.
- Record peer ID, verified host/site failure domain, usable bytes, timestamp, and whether the peer is currently reachable through the authenticated peer transport. Do not publish secrets or filesystem paths.

This command does not discover hosts or connect them to the mesh. Authenticated enrollment/heartbeat, placement, and independent-host durability tests remain separate gates.
