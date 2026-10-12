# Apex Network Fabric

This repository contains two distinct iOS networking layers:

- `ios/ApexNetworkFabric`: reusable Network.framework path monitoring, authenticated mobile control-plane client, storage client, and OS-permitted background refresh helpers.
- `ios/ApexMobile/Sources/ApexNearbyMesh.swift`: native MultipeerConnectivity transport for nearby device-to-device messages when cellular service is unavailable.

## Nearby carrier-independent transport

Both devices must have a compatible, signed build of Apex Mobile installed, grant local-network permission, run the app, and enter the same randomly generated 32-byte-or-stronger pairing secret. Sessions require MultipeerConnectivity encryption; application messages are HMAC-SHA256 authenticated with timestamp and replay checks.

This provides **nearby app-to-app communication**, not ordinary cellular service, a general internet connection, or a system-wide VPN. Wider-area communication still needs a reachable gateway, Wi-Fi/Starlink/other internet path, or supported satellite service. No iOS code can invent a radio link where no compatible network or peer exists.

## iOS constraints

iOS does not permit an unrestricted permanent app daemon. Background work is best-effort under Apple's permitted scheduling rules. Peer communication requires the app to be installed and active enough for iOS to run it; real-device behavior must be tested.

The implementation does not modify carrier settings, bypass hotspot limits, or defeat network access controls.
