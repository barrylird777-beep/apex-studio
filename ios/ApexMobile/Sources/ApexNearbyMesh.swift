import Foundation
import UIKit
import Combine
import CryptoKit
@preconcurrency import MultipeerConnectivity

/// Nearby, carrier-independent app-to-app transport. It does not provide general internet access.
public final class ApexNearbyMesh: NSObject, ObservableObject, @unchecked Sendable {
    public static let serviceType = "apex-fabric"

    public static func makePairingSecret() -> String {
        let key = SymmetricKey(size: .bits256)
        return key.withUnsafeBytes { Data($0).base64EncodedString() }
    }
    private let localPeer: MCPeerID
    private let session: MCSession
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?
    private let stateLock = NSLock()
    private var peerIndex: [String: MCPeerID] = [:]
    private var signingKey: SymmetricKey?
    private var isRunning = false
    private var seenNonces: [String: TimeInterval] = [:]
    private var seenMessageIDs: [String: TimeInterval] = [:]

    @Published public private(set) var status = "Stopped"
    @Published public private(set) var nearbyPeers: [String] = []
    @Published public private(set) var connectedPeers: [String] = []
    @Published public private(set) var lastMessage = "No authenticated peer messages yet."

    public init(displayName: String = UIDevice.current.name) {
        let peer = MCPeerID(displayName: String(displayName.prefix(48)))
        localPeer = peer
        session = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
        super.init()
        session.delegate = self
    }

    deinit {
        advertiser?.stopAdvertisingPeer()
        browser?.stopBrowsingForPeers()
        session.disconnect()
    }

    /// Use the same strong, privately exchanged pairing secret on both devices (32+ UTF-8 bytes).
    /// The secret stays in memory only and authenticates every application message with HMAC-SHA256.
    public func start(pairingSecret: String) throws {
        guard pairingSecret.utf8.count >= 32 else {
            throw NSError(domain: "ApexNearbyMesh", code: 1, userInfo: [NSLocalizedDescriptionKey: "Use a randomly generated pairing secret of at least 32 UTF-8 bytes."])
        }
        stop()
        stateLock.lock()
        signingKey = SymmetricKey(data: Data(pairingSecret.utf8))
        isRunning = true
        seenNonces.removeAll()
        seenMessageIDs.removeAll()
        stateLock.unlock()
        let info = ["role": "apex-nearby-node", "protocol": "1"]
        let nextAdvertiser = MCNearbyServiceAdvertiser(peer: localPeer, discoveryInfo: info, serviceType: Self.serviceType)
        let nextBrowser = MCNearbyServiceBrowser(peer: localPeer, serviceType: Self.serviceType)
        nextAdvertiser.delegate = self
        nextBrowser.delegate = self
        advertiser = nextAdvertiser
        browser = nextBrowser
        nextAdvertiser.startAdvertisingPeer()
        nextBrowser.startBrowsingForPeers()
        setStatus("Searching nearby devices • carrier not required")
    }

    public func stop() {
        advertiser?.stopAdvertisingPeer()
        browser?.stopBrowsingForPeers()
        session.disconnect()
        stateLock.lock()
        signingKey = nil
        isRunning = false
        peerIndex.removeAll()
        seenNonces.removeAll()
        seenMessageIDs.removeAll()
        stateLock.unlock()
        DispatchQueue.main.async {
            self.nearbyPeers = []
            self.connectedPeers = []
            self.status = "Stopped"
        }
    }

    public func connect(to displayName: String) {
        stateLock.lock()
        let peer = peerIndex[displayName]
        stateLock.unlock()
        guard let peer, let key = keySnapshot() else {
            setStatus("Peer is no longer discoverable, or pairing is not started.")
            return
        }
        let timestamp = String(Int(Date().timeIntervalSince1970))
        let nonce = UUID().uuidString
        let signed = Data("invite|1|\(timestamp)|\(nonce)|\(peer.displayName)".utf8)
        let signature = HMAC<SHA256>.authenticationCode(for: signed, using: key)
        let context: [String: String] = [
            "version": "1",
            "timestamp": timestamp,
            "nonce": nonce,
            "target": peer.displayName,
            "signature": Data(signature).base64EncodedString()
        ]
        guard let encoded = try? JSONSerialization.data(withJSONObject: context, options: [.sortedKeys]) else {
            setStatus("Could not create authenticated peer invitation.")
            return
        }
        browser?.invitePeer(peer, to: session, withContext: encoded, timeout: 20)
    }

    private func validateInvitation(_ context: Data?) -> Bool {
        guard let key = keySnapshot(),
              let context,
              let object = try? JSONSerialization.jsonObject(with: context) as? [String: String],
              object["version"] == "1",
              object["target"] == localPeer.displayName,
              let timestampText = object["timestamp"],
              let timestamp = TimeInterval(timestampText),
              abs(Date().timeIntervalSince1970 - timestamp) <= 300,
              let nonce = object["nonce"], UUID(uuidString: nonce) != nil,
              let signatureText = object["signature"],
              let signature = Data(base64Encoded: signatureText) else { return false }
        let signed = Data("invite|1|\(timestampText)|\(nonce)|\(localPeer.displayName)".utf8)
        guard HMAC<SHA256>.isValidAuthenticationCode(signature, authenticating: signed, using: key) else { return false }
        stateLock.lock()
        seenNonces = seenNonces.filter { Date().timeIntervalSince1970 - $0.value <= 300 }
        let replay = seenNonces[nonce] != nil
        if !replay { seenNonces[nonce] = timestamp }
        stateLock.unlock()
        return !replay
    }

    public func send(_ message: String) throws {
        guard keySnapshot() != nil else {
            throw NSError(domain: "ApexNearbyMesh", code: 2, userInfo: [NSLocalizedDescriptionKey: "Start nearby mesh with a shared pairing secret first."])
        }
        guard !session.connectedPeers.isEmpty else {
            throw NSError(domain: "ApexNearbyMesh", code: 3, userInfo: [NSLocalizedDescriptionKey: "No connected peer yet. Connect to a nearby device first."])
        }
        let body = Data(message.utf8)
        guard body.count <= 16_384 else {
            throw NSError(domain: "ApexNearbyMesh", code: 4, userInfo: [NSLocalizedDescriptionKey: "Nearby message exceeds the 16 KiB safety limit."])
        }
        let messageID = UUID().uuidString
        let timestamp = String(Int(Date().timeIntervalSince1970))
        stateLock.lock()
        seenMessageIDs[messageID] = Date().timeIntervalSince1970
        stateLock.unlock()
        let packet = try makePacket(messageID: messageID, origin: localPeer.displayName, timestamp: timestamp, nonce: UUID().uuidString, ttl: 8, hop: 0, payload: body.base64EncodedString())
        try transmit(packet, to: session.connectedPeers)
        DispatchQueue.main.async { self.lastMessage = "Sent authenticated mesh message; waiting for a peer relay." }
    }

    private func makePacket(messageID: String, origin: String, timestamp: String, nonce: String, ttl: Int, hop: Int, payload: String) throws -> [String: String] {
        guard let key = keySnapshot() else {
            throw NSError(domain: "ApexNearbyMesh", code: 5, userInfo: [NSLocalizedDescriptionKey: "Nearby mesh is stopped."])
        }
        let signed = Data("1\n\(messageID)\n\(origin)\n\(timestamp)\n\(nonce)\n\(ttl)\n\(hop)\n\(payload)".utf8)
        let signature = HMAC<SHA256>.authenticationCode(for: signed, using: key)
        return [
            "version": "1",
            "id": messageID,
            "origin": origin,
            "timestamp": timestamp,
            "nonce": nonce,
            "ttl": String(ttl),
            "hop": String(hop),
            "payload": payload,
            "signature": Data(signature).base64EncodedString()
        ]
    }

    private func transmit(_ packet: [String: String], to peers: [MCPeerID]) throws {
        guard !peers.isEmpty else { return }
        let encoded = try JSONSerialization.data(withJSONObject: packet, options: [.sortedKeys])
        try session.send(encoded, toPeers: peers, with: .reliable)
    }

    private func keySnapshot() -> SymmetricKey? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return signingKey
    }

    private func isActive() -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return isRunning
    }

    private func setStatus(_ value: String) {
        DispatchQueue.main.async { self.status = value }
    }

    private func refreshPeerLists() {
        let connected = session.connectedPeers.map(\.displayName).sorted()
        stateLock.lock()
        let nearby = Array(peerIndex.keys).sorted()
        stateLock.unlock()
        DispatchQueue.main.async {
            self.nearbyPeers = nearby
            self.connectedPeers = connected
            guard self.isActive() else {
                self.status = "Stopped"
                return
            }
            self.status = connected.isEmpty ? "Searching nearby devices • carrier not required" : "Nearby mesh connected • \(connected.count) peer(s)"
        }
    }

    private func verify(_ data: Data) -> [String: String]? {
        guard let key = keySnapshot(),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              object["version"] == "1",
              let messageID = object["id"], UUID(uuidString: messageID) != nil,
              let origin = object["origin"], !origin.isEmpty, origin.utf8.count <= 48,
              let timestampText = object["timestamp"],
              let timestamp = TimeInterval(timestampText),
              abs(Date().timeIntervalSince1970 - timestamp) <= 300,
              let nonce = object["nonce"], UUID(uuidString: nonce) != nil,
              let ttlText = object["ttl"], let ttl = Int(ttlText), (0...8).contains(ttl),
              let hopText = object["hop"], let hop = Int(hopText), (0...8).contains(hop),
              let payloadText = object["payload"],
              let payload = Data(base64Encoded: payloadText), payload.count <= 16_384,
              let signatureText = object["signature"],
              let signature = Data(base64Encoded: signatureText) else { return nil }
        let signed = Data("1\n\(messageID)\n\(origin)\n\(timestampText)\n\(nonce)\n\(ttlText)\n\(hopText)\n\(payloadText)".utf8)
        guard HMAC<SHA256>.isValidAuthenticationCode(signature, authenticating: signed, using: key) else { return nil }
        stateLock.lock()
        seenNonces = seenNonces.filter { Date().timeIntervalSince1970 - $0.value <= 300 }
        let replay = seenNonces[nonce] != nil
        if !replay { seenNonces[nonce] = timestamp }
        stateLock.unlock()
        return replay ? nil : object
    }

}

extension ApexNearbyMesh: MCNearbyServiceAdvertiserDelegate {
    public func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
        setStatus("Advertising failed: \(error.localizedDescription)")
    }

    public func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        invitationHandler(validateInvitation(context), session)
    }
}

extension ApexNearbyMesh: MCNearbyServiceBrowserDelegate {
    public func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        setStatus("Nearby discovery failed: \(error.localizedDescription)")
    }

    public func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String : String]?) {
        guard isActive(), info?["protocol"] == "1", info?["role"] == "apex-nearby-node" else { return }
        stateLock.lock()
        peerIndex[peerID.displayName] = peerID
        stateLock.unlock()
        refreshPeerLists()
    }

    public func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        stateLock.lock()
        peerIndex.removeValue(forKey: peerID.displayName)
        stateLock.unlock()
        refreshPeerLists()
    }
}

extension ApexNearbyMesh: MCSessionDelegate {
    public func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        refreshPeerLists()
    }

    public func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        guard let packet = verify(data),
              let messageID = packet["id"],
              let origin = packet["origin"],
              let timestamp = packet["timestamp"],
              let payloadText = packet["payload"],
              let payload = Data(base64Encoded: payloadText),
              let message = String(data: payload, encoding: .utf8),
              let ttl = Int(packet["ttl"] ?? ""),
              let hop = Int(packet["hop"] ?? "") else {
            setStatus("Rejected an unauthenticated, replayed, or malformed peer message.")
            return
        }
        stateLock.lock()
        seenMessageIDs = seenMessageIDs.filter { Date().timeIntervalSince1970 - $0.value <= 300 }
        let duplicate = seenMessageIDs[messageID] != nil
        if !duplicate { seenMessageIDs[messageID] = Date().timeIntervalSince1970 }
        stateLock.unlock()
        guard !duplicate else { return }
        DispatchQueue.main.async { self.lastMessage = "Mesh message from claimed origin \(origin), \(hop) hop(s): \(message)" }
        let targets = session.connectedPeers.filter { $0 != peerID }
        guard ttl > 0, !targets.isEmpty else { return }
        do {
            let forwarded = try makePacket(messageID: messageID, origin: origin, timestamp: timestamp, nonce: UUID().uuidString, ttl: ttl - 1, hop: hop + 1, payload: payloadText)
            try transmit(forwarded, to: targets)
            setStatus("Relayed an authenticated mesh message across \(targets.count) peer link(s).")
        } catch {
            setStatus("Message received; relay attempt failed: \(error.localizedDescription)")
        }
    }

    public func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    public func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    public func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
    public func session(_ session: MCSession, didReceiveCertificate certificate: [Any]?, fromPeer peerID: MCPeerID, certificateHandler: @escaping (Bool) -> Void) {
        certificateHandler(keySnapshot() != nil)
    }
}
