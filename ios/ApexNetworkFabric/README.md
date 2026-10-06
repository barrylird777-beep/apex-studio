# Apex Network Fabric

The phone network fabric is independent of Apex Studio's web/runtime process.

- Native iOS Network.framework connectivity monitoring.
- Multipeer Connectivity for nearby authorized peer discovery.
- Required encryption for peer sessions.
- Background refresh through Apple's permitted background-task mechanism.
- Local-first operation when WAN connectivity disappears.
- Apex Studio consumes the fabric when active; the fabric does not depend on Apex Studio being open.

## iOS constraint

iOS does not permit an arbitrary application process to run continuously in the background. The fabric therefore uses OS-supported background execution rather than an unrestricted daemon.

The implementation does not modify carrier settings, bypass hotspot limits, or defeat network access controls.
