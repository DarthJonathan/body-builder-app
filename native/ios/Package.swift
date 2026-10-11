// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "BodyBuilderHealthPolicy", products: [.library(name: "HealthCore", targets: ["HealthCore"])], targets: [
 .target(name: "HealthCore", path: "BodyBuilder", exclude: ["AppDelegate.swift", "HealthReader.swift", "Info.plist", "BodyBuilder.entitlements"], sources: ["EnergyPolicy.swift"]),
 .testTarget(name: "HealthCoreTests", dependencies: ["HealthCore"], path: "HealthCoreTests")
])
