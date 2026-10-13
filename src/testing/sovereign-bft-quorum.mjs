import { sign, verify } from "node:crypto";

const canonical = vote => JSON.stringify([
  Number(vote.height),
  Number(vote.round),
  String(vote.proposalHash),
  String(vote.prevHash)
]);

function nonNegativeInteger(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(name + " must be a safe integer >= " + minimum);
  return value;
}

export function signSovereignVote({ peerId, height, round = 0, proposalHash, prevHash, privateKey }) {
  const vote = {
    peerId: String(peerId || ""),
    height: nonNegativeInteger(height, "height", 1),
    round: nonNegativeInteger(round, "round"),
    proposalHash: String(proposalHash || ""),
    prevHash: String(prevHash || "")
  };
  if (!vote.peerId || !vote.proposalHash || !vote.prevHash || !privateKey) {
    throw new TypeError("peerId, proposalHash, prevHash, and privateKey are required");
  }
  return {
    ...vote,
    signature: sign(null, Buffer.from(canonical(vote)), privateKey).toString("base64")
  };
}

export function verifySovereignQuorum({ height, round = 0, proposalHash, prevHash, votes = [], validators }) {
  if (!(validators instanceof Map) || validators.size < 1) {
    throw new TypeError("validators must be a non-empty Map of peer IDs to public keys");
  }
  if (!Array.isArray(votes)) throw new TypeError("votes must be an array");
  const target = {
    height: nonNegativeInteger(height, "height", 1),
    round: nonNegativeInteger(round, "round"),
    proposalHash: String(proposalHash || ""),
    prevHash: String(prevHash || "")
  };
  if (!target.proposalHash || !target.prevHash) throw new TypeError("proposalHash and prevHash are required");

  const maxFaults = Math.floor((validators.size - 1) / 3);
  const quorum = validators.size - maxFaults;
  const accepted = [];
  const rejected = [];
  const quarantine = new Set();
  const firstVoteByPeer = new Map();

  for (const vote of votes) {
    const peerId = String(vote?.peerId || "");
    const publicKey = validators.get(peerId);
    if (!publicKey) {
      rejected.push({ peerId, reason: "unknown-validator" });
      continue;
    }

    const fingerprint = canonical(vote);
    let signatureValid = false;
    try {
      signatureValid = typeof vote.signature === "string" &&
        verify(null, Buffer.from(canonical(vote)), publicKey, Buffer.from(vote.signature, "base64"));
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      rejected.push({ peerId, reason: "invalid-signature" });
      continue;
    }

    const previous = firstVoteByPeer.get(peerId);
    if (previous && previous !== fingerprint) {
      quarantine.add(peerId);
      const acceptedIndex = accepted.indexOf(peerId);
      if (acceptedIndex >= 0) accepted.splice(acceptedIndex, 1);
      rejected.push({ peerId, reason: "equivocation" });
      continue;
    }
    if (previous) {
      rejected.push({ peerId, reason: "duplicate-vote" });
      continue;
    }
    firstVoteByPeer.set(peerId, fingerprint);

    if (vote.height !== target.height || vote.round !== target.round ||
        vote.proposalHash !== target.proposalHash || vote.prevHash !== target.prevHash) {
      rejected.push({ peerId, reason: "conflicting-proposal" });
      continue;
    }
    accepted.push(peerId);
  }

  return {
    valid: accepted.length >= quorum,
    validatorCount: validators.size,
    maxFaults,
    quorum,
    acceptedSigners: accepted,
    rejected,
    quarantine: [...quarantine]
  };
}
