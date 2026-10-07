# Apex AdBlock — iOS 26 URL Filter

This is the system-level Apex filtering target for the locked requirement:

- iPhone 14
- iOS 26.4
- native-app traffic where Apple URL Filter can observe it
- advertising-resource filtering rather than broad DNS blocking
- Google/YouTube content allowed by default
- fail-open when the filter cannot make a decision

## Current architecture

1. NEURLFilterManager enables Apple's iOS 26 URL Filter.
2. ApexURLFilterControlProvider supplies the on-device Bloom prefilter.
3. Apple's PIR service performs the privacy-preserving final URL lookup for Bloom-positive requests.
4. The filter dataset contains advertising-resource URLs, not broad Google/YouTube domains.

Apple documents that URL Filter evaluates full URLs system-wide for HTTP/HTTPS requests made through WebKit and URLSession. Apps using other networking stacks must voluntarily participate through NEURLFilter.

## iOS 26.4 deployment constraint

Apple's current PIR onboarding documentation says that, beginning with iOS/macOS 26.4, service and token-issuer URLs must use host-only HTTPS URLs rather than custom paths for distribution deployments. Development-installed builds may use paths during testing.

## Signing

A free Apple Account can create a Personal Team for device development; Apple states that personal-team provisioning expires after 7 days.

The Network Extension url-filter-provider entitlement is required.

## Current blocker to physical activation

The repository now has the corrected iOS 26 target foundation, but physical activation still requires the Apple-side signing/installation path and the actual PIR service. The previous DNS implementation is intentionally not being used because it violates the Google/YouTube compatibility requirement.

The next build target is the Apex PIR service plus an automated iOS build artifact.
