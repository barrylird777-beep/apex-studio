#!/bin/sh
set -euo pipefail

# Xcode Cloud post-clone hook for Apex Studio Ad Blocker.
# Keep signing controlled by Apple/Xcode Cloud; never store certificates,
# provisioning profiles, or Apple credentials in the repository.
echo "Preparing Apex Studio Ad Blocker for Xcode Cloud"
xcodebuild -project ios/ApexAdBlocker/ApexAdBlocker.xcodeproj   -scheme ApexAdBlocker   -showBuildSettings >/dev/null
