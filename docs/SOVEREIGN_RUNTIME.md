# Apex Sovereign Runtime

This layer pushes the private-first design toward an operator-controlled deployment.

## Controls
- Network egress is explicitly denied unless enabled.
- Optional hostname allowlisting provides a narrow remote boundary.
- Local authentication/session primitives are available without a third-party identity service.
- AES-256-GCM helpers support encrypted state at the application boundary.
- Audit records capture attempted network egress.

## Deployment model
A strong private deployment can run Apex with local storage and local model servers, expose no public port, and keep backups under operator control.

The software does not attempt to defeat lawful access, conceal criminal activity, or bypass platform/provider safeguards. Its purpose is legitimate privacy, ownership, resilience, and reduced unnecessary data exposure.
