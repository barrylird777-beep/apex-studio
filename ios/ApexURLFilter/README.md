# Apex URL Filter

Apex's iOS 26 full-URL ad/tracker filtering layer.

Policy:
- Allow by default.
- Block dedicated ad/tracker resource URLs.
- Never block main-frame website navigation.
- Preserve first-party content.
- DNS remains the fallback layer.
- No HTTPS man-in-the-middle.
- No browsing-history collection.

## Apple requirements

This target uses Apple's Network Extension URL Filter API. It must be packaged as a signed iOS app with the URL-filter-provider entitlement and registered through Apple's Identity & Trust / CloudKit onboarding.

The URL Filter also requires Apple's privacy-preserving PIR service configuration. The Apex Railway server is not a substitute for that cryptographic service.

Apple documents that URL Filters operate system-wide for URL requests made through WebKit and URLSession and can filter specific resources by full URL rather than blocking an entire hostname.

## Source layout

- `ApexURLFilterApp.swift` — minimal configuration app.
- `URLFilterController.swift` — enables/disables the system URL filter.
- `ApexURLFilterControlProvider.swift` — supplies the local prefilter.
- `ApexURLFilter.entitlements` — Network Extension URL-filter-provider entitlement.
- `ApexURLFilter-Info.plist` — extension configuration metadata.

Before distribution, replace the placeholder bundle identifiers and PIR configuration with the values issued during Apple's onboarding.
