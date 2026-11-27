# 2026-11-27 Connector Scope & Generic Endpoint Guardrails

## Summary

Integration cards disclose connection type and data scope; generic endpoints require URL, reject private IPs and redirects.

## Changes

- Integration cards now disclose whether the connection is a native provider API, generic JSON endpoint, local folder adapter, or email webhook adapter, including the actual data scope and missing payment/bank matching. The email card shows the application webhook URL and states that no mailbox is provisioned.
- Generic catalog connectors now require an endpoint URL before a connection can be saved. Remote HTTP endpoints, private or reserved IP destinations, and redirect responses are rejected before a configured bearer token can be forwarded.
- DNS is checked immediately before connection and again before polling, but the runtime does not pin DNS resolution to the outbound socket. A production deployment still needs egress firewall rules or an endpoint allowlist.

## Verification

- No external provider was contacted and no cloud services were configured.