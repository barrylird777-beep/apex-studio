# Apex PIR service

Uses Apple's open-source PIR service implementation for iOS 26 URL filtering.

The service is intentionally isolated under this directory so the existing Apex API/worker services are unchanged.

The URL-filter dataset is exact URL-key matching as required by Apple's NEURLFilter format. Broader host/resource filtering remains in Apex's Safari Web Extension and DNS fallback layers.

Production requirements:
- Replace the placeholder token with a secret Railway variable before enabling the iOS app.
- Set the final extension bundle identifier consistently in service-config.json and the iOS target.
- Register the URL-filter configuration with Apple Identity & Trust / CloudKit.
- Distribution builds also require Apple's OHTTP relay onboarding.
