import Foundation
import CryptoKit

struct ApexBloomFilter {
    let bitCount: Int
    let hashCount: Int
    let murmurSeed: UInt32
    let bits: Data

    init(values: [String], bitCount: Int = 1024, hashCount: Int = 7, murmurSeed: UInt32 = 0xA5EED123) {
        precondition(bitCount > 0 && hashCount > 0)
        self.bitCount = bitCount
        self.hashCount = hashCount
        self.murmurSeed = murmurSeed

        var storage = Data(repeating: 0, count: (bitCount + 7) / 8)
        for value in values {
            guard let data = value.data(using: .utf8) else { continue }
            let fnv = Self.fnv1a32(data)
            let murmur = Self.murmurHash3(data, seed: murmurSeed)
            for i in 0..<hashCount {
                let index = Int((fnv &+ UInt32(i) &* murmur) % UInt32(bitCount))
                let byteIndex = index >> 3
                let bitIndex = index & 7
                storage[byteIndex] |= UInt8(1 << bitIndex)
            }
        }
        self.bits = storage
    }

    var tag: String {
        SHA256.hash(data: bits).map { String(format: "%02x", $0) }.joined()
    }

    private static func fnv1a32(_ data: Data) -> UInt32 {
        var hash: UInt32 = 0x811C9DC5
        for byte in data {
            hash ^= UInt32(byte)
            hash = hash &* 0x01000193
        }
        return hash
    }

    private static func murmurHash3(_ data: Data, seed: UInt32) -> UInt32 {
        let bytes = [UInt8](data)
        let c1: UInt32 = 0xCC9E2D51
        let c2: UInt32 = 0x1B873593
        var h1 = seed
        var i = 0

        while i + 4 <= bytes.count {
            var k1 = UInt32(bytes[i])
            k1 |= UInt32(bytes[i + 1]) << 8
            k1 |= UInt32(bytes[i + 2]) << 16
            k1 |= UInt32(bytes[i + 3]) << 24
            k1 = k1 &* c1
            k1 = k1.rotatedLeft(by: 15)
            k1 = k1 &* c2
            h1 ^= k1
            h1 = h1.rotatedLeft(by: 13)
            h1 = h1 &* 5 &+ 0xE6546B64
            i += 4
        }

        var tail: UInt32 = 0
        switch bytes.count & 3 {
        case 3: tail ^= UInt32(bytes[i + 2]) << 16; fallthrough
        case 2: tail ^= UInt32(bytes[i + 1]) << 8; fallthrough
        case 1:
            tail ^= UInt32(bytes[i])
            tail = tail &* c1
            tail = tail.rotatedLeft(by: 15)
            tail = tail &* c2
            h1 ^= tail
        default: break
        }

        h1 ^= UInt32(bytes.count)
        h1 ^= h1 >> 16
        h1 = h1 &* 0x85EBCA6B
        h1 ^= h1 >> 13
        h1 = h1 &* 0xC2B2AE35
        h1 ^= h1 >> 16
        return h1
    }
}

private extension UInt32 {
    func rotatedLeft(by amount: UInt32) -> UInt32 {
        (self << amount) | (self >> (32 - amount))
    }
}
