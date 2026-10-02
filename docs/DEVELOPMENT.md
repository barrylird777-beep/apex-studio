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
