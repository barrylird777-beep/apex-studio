# APEX sovereignty cutover — safe execution order

## Current state

This is a migration runbook, not proof that any host or self-hosted Git service exists. No server, domain, Forgejo instance, SSH key, or GPU host has been provisioned by this change.

## 1. Source control: Forgejo/Gitea

1. Provision Forgejo/Gitea on a host controlled by APEX and create an empty private repository.
2. Mirror the repository from an authenticated terminal using Git's mirror clone/push operations. Keep credentials in an environment-provided authorization header, never in a committed file or URL.
3. Compare all refs and tags; test clone, fetch, and push from a second client.
4. Mirror every canonical app repository and related assets; verify LFS objects separately if present.
5. Keep GitHub read-only as a temporary recovery copy until the Forgejo backup and restore test passes. Do not delete the source or cut CI over before verification.

## 2. Self-hosted build and release

1. Run a dedicated, unprivileged Forgejo Actions runner on the controlled host; do not expose a privileged Docker socket to untrusted pull-request jobs.
2. Build images locally, generate an SBOM, sign the image digest, and transfer artifacts to Peer-CAS using an authenticated, app-scoped protocol.
3. Verify clean rebuilds, artifact digests, secret isolation, runner restart, and restore before disabling GitHub Actions.
4. No public registry is required by the intended design. A local build still requires real CPU/RAM/storage and a controlled host.

## 3. Bare-metal execution

- No host has been selected or authenticated in this session, so provisioning or SSH deployment cannot be performed safely yet.
- Use a host with sufficient RAM, storage, and the exact GPU/driver/CUDA combination required by the pinned vLLM build. A phone can operate the host over SSH; it cannot replace the remote host's compute or physical GPU.
- Establish SSH keys, host-key pinning, firewall rules, a non-root deploy account, and a rollback path before deploying any container.
- Do not remove Railway until all six apps have independently passed health, restart, peer-disconnect, recovery, and restore tests on the replacement host.

## 4. Container hardening: distroless is a gate, not a label

The current worker depends on Python, PyTorch, vLLM, CUDA libraries, native extensions, and GPU runtime injection. Replacing its final stage with a generic distroless image without resolving these dependencies will likely break startup. First produce a minimal CUDA-compatible runtime, then verify model-loader registration, GPU visibility, actual inference, non-root execution, read-only root filesystem, and absence of shell/package managers. The current multi-stage Dockerfile is not yet a distroless image.

## 5. Transport and peer discovery

- Literal-IP bootstrap multiaddrs are now validated in code; DNS-form bootstrap entries fail closed. The owner must supply real, reachable bootstrap peer IPs and authenticated peer IDs.
- This removes DNS from the configured bootstrap list; it does not eliminate DNS use elsewhere in the operating system or guarantee NAT traversal.
- Browser WebRTC remains direct-candidate-only with manual signaling. A DHT-backed signaling protocol and a verified connection strategy are still required.

## 6. Quantization policy

Do not convert arbitrary model files at startup. AWQ and FP8 support depends on model architecture, checkpoint format, calibration/conversion workflow, and GPU kernels. Publish a quantized bundle as a separately versioned Peer-CAS artifact, record format/precision and digest in its manifest, and test quality plus inference compatibility before selecting it. The current loader does not automatically quantize FP16 weights.

## Exit criteria

No cutover is complete until a clean self-hosted build, digest verification, all six app deployments, peer loss/recovery, and a real model inference test pass. No provider or service should be called sovereign solely because its name or image is self-hosted.
