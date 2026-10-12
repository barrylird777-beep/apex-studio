import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicPeerAddress } from "../src/network/public-peer-address.mjs";

test("explicit public peer settings take precedence", () => {
  assert.equal(
    buildPublicPeerAddress("12D3KooWPeerId", {
      APEX_P2P_PUBLIC_HOST: "peer.example.net",
      APEX_P2P_PUBLIC_PORT: "24567",
      RAILWAY_TCP_PROXY_DOMAIN: "fallback.example.net",
      RAILWAY_TCP_PROXY_PORT: "30000"
    }),
    "/dns4/peer.example.net/tcp/24567/p2p/12D3KooWPeerId"
  );
});

test("Railway TCP proxy metadata supplies the public address when overrides are absent", () => {
  assert.equal(
    buildPublicPeerAddress("12D3KooWPeerId", {
      RAILWAY_TCP_PROXY_DOMAIN: "proxy.example.net",
      RAILWAY_TCP_PROXY_PORT: "30000"
    }),
    "/dns4/proxy.example.net/tcp/30000/p2p/12D3KooWPeerId"
  );
});

test("missing or invalid public address settings fail closed", () => {
  assert.equal(buildPublicPeerAddress("12D3KooWPeerId", {}), null);
  assert.equal(buildPublicPeerAddress("bad/id", {
    RAILWAY_TCP_PROXY_DOMAIN: "proxy.example.net",
    RAILWAY_TCP_PROXY_PORT: "30000"
  }), null);
  assert.equal(buildPublicPeerAddress("12D3KooWPeerId", {
    RAILWAY_TCP_PROXY_DOMAIN: "proxy.example.net",
    RAILWAY_TCP_PROXY_PORT: "70000"
  }), null);
});
