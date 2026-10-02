## Development: Layers Bypass

For local development only, you can unlock the protected LAYERS system without a passcode.

### Requirements
- `NODE_ENV=development`
- `APEX_LAYERS_DEV_BYPASS=true`

### Usage

```bash
NODE_ENV=development APEX_LAYERS_DEV_BYPASS=true npm start
```

Then call:

``
POST /api/studio/layers/unlock
```

You will receive a temporary session token prefixed with `dev-`. The bypass is recorded in the audit log as `layers.dev-bypass`.

**Important:** This bypass is completely disabled in any non-development environment. Production always requires the real passcode.

## Layers access modes

The Layers wall supports explicit access modes through environment variables:

- `APEX_LAYERS_ACCESS_MODE=passcode` — default; uses the configured Layers passcode.
- `APEX_LAYERS_ACCESS_MODE=developer` — local development access without entering the passcode. Requires `NODE_ENV=development`.
- `APEX_LAYERS_ACCESS_MODE=dev-bypass` — legacy compatibility mode; requires both `NODE_ENV=development` and `APEX_LAYERS_DEV_BYPASS=true`.

Example:

```bash
NODE_ENV=development APEX_LAYERS_ACCESS_MODE=developer npm start
```

Developer sessions still receive temporary `dev-` tokens, respect the normal 1-minute to 24-hour TTL bounds, and are recorded in the Layers audit log. Production continues to use the passcode path.
