// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ApexNetworkFabric",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "ApexNetworkFabric", targets: ["ApexNetworkFabric"])
    ],
    targets: [
        .target(
            name: "ApexNetworkFabric",
            path: "Sources/ApexNetworkFabric"
        )
    ]
)
