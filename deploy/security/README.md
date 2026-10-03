# Apex Security Deployment Blueprint

This directory is the implementation companion to the APEX security model.

## Important boundary

Repository configuration cannot create a host firewall, local CA, disk encryption, physical network segmentation, or an air gap by itself. Those controls must be applied on the deployment host and then verified with the supplied audit commands.

The repository therefore contains:

- a machine-readable security baseline;
- an isolated SE-X container definition;
- runtime/application egress enforcement;
- manual host verification scripts;
- production-unlock criteria.

## SE-X requirements

SE-X is the only public research egress path. Core services must not have direct public Internet access.

Set an explicit host allowlist before starting SE-X:

`APEX_SEX_ALLOWED_HOSTS=example.org,api.example.org`

Do not place credentials in the URL. SE-X only permits HTTPS retrieval and GET requests.

Use an immutable image reference:

`APEX_SEX_IMAGE=registry.apex.internal/apex/se-x@sha256:<digest>`

Do not replace the digest with a mutable tag in production.

## Manual verification

Run as an administrator on the deployment host:

`node scripts/security/audit-se-x.mjs`

Then:

`bash scripts/security/verify-se-x-storage.sh`

and:

`bash scripts/security/verify-cert-permissions.sh`

The audit reports findings; it does not claim that a check passed when the host cannot be inspected.

## Production unlock

Production must remain locked until namespace isolation, privileges, routing, firewall policy, core egress blocking, SE-X allowlisted egress, database isolation, ephemeral storage, and certificate permissions have all been independently verified.
