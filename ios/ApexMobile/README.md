# Apex Mobile — Universal Local AI

Native iOS companion for the entire Apex universe. The local capability layer is shared by every Apex surface.

## Capabilities
- Local GGUF inference through llama.cpp
- Apple Metal acceleration
- Qwen, Llama, and other compatible GGUF models
- Offline-first inference; no cloud inference is required
- Siri / Shortcuts through App Intents
- Supported background App Intent execution
- Long-running App Intent support where iOS permits it
- Shared Apex capability routing for creation, scripture, visual, audio, video, and orchestration work
- No telemetry SDK and no inference network endpoint

## iOS boundary
A normal iOS application cannot be an unrestricted permanent daemon. Apex uses App Intents and supported background execution instead.

## Zero-cost policy
Apex never bypasses provider quotas, billing, account controls, CAPTCHAs, or terms. Free tiers are used only within published limits. Local inference remains available without an AI subscription once a compatible model is installed.

## Build
Run ./ios/ApexMobile/build.command on a Mac with Xcode, CMake, and XcodeGen. The script clones official llama.cpp, builds its iOS XCFramework with Metal enabled, generates the Xcode project, and opens it.
