# Apex iOS 26 URL Filter build

The native iOS 26 URL Filter target is generated with XcodeGen and built on a macOS GitHub Actions runner.

The CI artifact is unsigned. A real iPhone installation requires Apple code signing plus the URL Filter entitlement and Apple Identity & Trust configuration. The production filter also requires the Apple PIR endpoint and Bloom prefilter.

Files:
- project.yml
- ApexURLFilter/ApexURLFilterApp.swift
- ApexURLFilter/URLFilterController.swift
- ApexURLFilter/ApexURLFilterControlProvider.swift
- ApexURLFilter/ApexURLFilter.entitlements
- ApexURLFilter/ApexURLFilter-Info.plist
