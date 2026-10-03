# Host firewall boundary

Do not apply a blanket DROP policy without an out-of-band recovery path.

The intended production topology is:

- Core services: no public Internet egress.
- SE-X: dedicated `apex-search` network with controlled HTTPS egress.
- PostgreSQL/Redis/Elasticsearch/registry/runners: internal-only.
- Inbound WAN traffic to internal data services: denied.
- Host management: limited to the approved administrative interface.

Before applying firewall changes:

1. Record `ip -br addr show`.
2. Record `ip route show table all`.
3. Record the active SSH source/interface.
4. Back up the existing firewall rules.
5. Apply changes from local console or an approved out-of-band channel.
6. Verify SSH, internal service reachability, and SE-X egress before ending the maintenance window.

The firewall is a host control. The repository cannot safely infer the correct interface, gateway, administrator subnet, Docker bridge addresses, or SE-X egress address for every deployment.
