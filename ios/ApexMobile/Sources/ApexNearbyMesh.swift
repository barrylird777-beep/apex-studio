import Foundation
import Combine
import CryptoKit
@preconcurrency import MultipeerConnectivity

/// Nearby, carrier-independent app-to-app transport. It does not provide general internet access.
public final class ApexNearbyMesh: NSObject, ObservableObject, @unchecked Sendable {
    public static let serviceType = "apex-fabric"
    private let localPeer: MCPeerID
    private let session: MCSession
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?
    private let stateLock = NSLock()
    private var peerIndex: [String: MCPeerID] = [:]
    private var signingKey: SymmetricKey?

    @Published public private(set) var status = "Stopped"
    @Published public private(set) var nearbyPeers: [String] = []
    @Published public private(set) var connectedPeers: [String] = []
    @Published public private(set) var lastMessage = "No authenticated peer messages yet."

    public init(displayName: String = UIDevice.current.name) {
        localPeer = MCPeerID(displayName: String(displayName.prefix(48)))
        session = MCSession(peer: localPeer, securityIdentity: nil, encryptionPreference: .required)
        super.init()
        session.delegate = self
    }

    deinit {
        advertiser?.stopAdvertisingPeer()
        browser?.stopBrowsingForPeers()
        session.disconnect()
    }

    /// Use the same strong, privately exchanged pairing secret on both devices (16+ UTF-8 bytes).
    /// The secret stays in memory only and authenticates every application message with HMAC-SHA256.
    public func start(pairingSecret: String) throws {
        guard pairingSecret.utf8.count >= 16 else {
            throw NSError(domain: "ApexNearbyMesh", code: 1, userInfo: [NSLocalizedDescriptionKey: "Pairing secret must be at least 16 UTF-8 bytes."])
        }
        signingKey = SymmetricKey(data: Data(pairingSecret.utf8))
        advertiser?.stopAdvertisingPeer()
        browser?.stopBrowsingForPeers()
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
        signingKey = nil
        stateLock.lock()
        peerIndex.removeAll()
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
        guard let peer else {
            setStatus("Peer is no longer discoverable; refresh nearby discovery.")
            return
        }
        browser?.invitePeer(peer, to: session, withContext: Data("apex-fabric-v1".utf8), timeout: 20)
    }

    public func send(_ message: String) throws {
        guard signingKey != nil else {
            throw NSError(domain: "ApexNearbyMesh", code: 2, userInfo: [NSLocalizedDescriptionKey: "Start nearby mesh with a shared pairing secret first."])
        }
        guard !session.connectedPeers.isEmpty else {
            throw NSError(domain: "ApexNearbyMesh", code: 3, userInfo: [NSLocalizedDescriptionKey: "No connected peer yet. Connect to a nearby device first."])
        }
        let body = Data(message.utf8)
        guard body.count <= 16_384 else {
            throw NSError(domain: "ApexNearbyMesh", code: 4, userInfo: [NSLocalizedDescriptionKey: "Nearby message exceeds the 16 KiB safety limit."])
        }
        let key = signingKey!
        let signature = HMAC<SHA256>.authenticationCode(for: body, using: key)
        let packet: [String: String] = [
            "version": "1",
            "payload": body.base64EncodedString(),
            "signature": Data(signature).base64EncodedString()
        ]
        let encoded = try JSONSerialization.data(withJSONObject: packet, options: [.sortedKeys])
        try session.send(encoded, toPeers: session.connectedPeers, with: .reliable)
        DispatchQueue.main.async { self.lastMessage = "Sent authenticated message to \(self.session.connectedPeers.count) peer(s)." }
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
            self.status = connected.isEmpty ? "Searching nearby devices • carrier not required" : "Nearby mesh connected • \(connected.count) peer(s)"
        }
    }

    private func verify(_ data: Data) -> String? {
        guard let key = signingKey,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              object["version"] == "1",
              let payloadText = object["payload"],
              let signatureText = object["signature"],
              let payload = Data(base64Encoded: payloadText),
              let signature = Data(base64Encoded: signatureText),
              HMAC<SHA256>.isValidAuthenticationCode(signature, authenticating: payload, using: key),
              let message = String(data: payload, encoding: .utf8) else { return nil }
        return message
    }
}

extension ApexNearbyMesh: MCNearbyServiceAdvertiserDelegate {
    public func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
        setStatus("Advertising failed: \(error.localizedDescription)")
    }

    public func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        invitationHandler(signingKey != nil && context == Data("apex-fabric-v1".utf8), session)
    }
}

extension ApexNearbyMesh: MCNearbyServiceBrowserDelegate {
    public func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        setStatus("Nearby discovery failed: \(error.localizedDescription)")
    }

    public func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String : String]?) {
        guard info?["protocol"] == "1", info?["role"] == "apex-nearby-node" else { return }
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
        guard let message = verify(data) else {
            setStatus("Rejected an unauthenticated or malformed peer message.")
            return
        }
        DispatchQueue.main.async { self.lastMessage = "From \(peerID.displayName): \(message)" }
    }

    public func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    public func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    public func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
    public func session(_ session: MCSession, didReceiveCertificate certificate: [Any]?, fromPeer peerID: MCPeerID, certificateHandler: @escaping (Bool) -> Void) {
        certificateHandler(signingKey != nil)
    }
}
