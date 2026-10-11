import XCTest
@testable import HealthCore
final class EnergyPolicyTests: XCTestCase {
 func testOverlapCannotFakeFullDay() {
  let day = DateInterval(start: Date(timeIntervalSince1970: 0), duration: 24 * 3600)
  let intervals = [DateInterval(start: day.start, duration: 10 * 3600), DateInterval(start: day.start, duration: 10 * 3600)]
  let coverage = EnergyPolicy.coveredHours(intervals, within: day)
  XCTAssertEqual(coverage, 10)
  XCTAssertFalse(EnergyPolicy.qualifies(resting: 1600, active: 300, coverage: coverage, hours: 24))
 }
 func testIntervalsClipAtDayBoundariesAndMerge() {
  let day = DateInterval(start: Date(timeIntervalSince1970: 0), duration: 24 * 3600)
  let intervals = [DateInterval(start: day.start.addingTimeInterval(-3600), duration: 13 * 3600), DateInterval(start: day.start.addingTimeInterval(11 * 3600), duration: 15 * 3600)]
  XCTAssertEqual(EnergyPolicy.coveredHours(intervals, within: day), 24)
 }
 func testMissingEnergyIsNotZero() {
  XCTAssertFalse(EnergyPolicy.qualifies(resting: 1600, active: nil, coverage: 24, hours: 24))
  XCTAssertFalse(EnergyPolicy.qualifies(resting: nil, active: 200, coverage: 24, hours: 24))
  XCTAssertTrue(EnergyPolicy.qualifies(resting: 1600, active: 0, coverage: 24, hours: 24))
 }
 func testDaylightSavingAndCoverageThreshold() {
  XCTAssertTrue(EnergyPolicy.qualifies(resting: 1600, active: 300, coverage: 23, hours: 23))
  XCTAssertTrue(EnergyPolicy.qualifies(resting: 1600, active: 300, coverage: 22.5, hours: 25))
  XCTAssertFalse(EnergyPolicy.qualifies(resting: 1600, active: 300, coverage: 22.4, hours: 25))
  XCTAssertFalse(EnergyPolicy.qualifies(resting: .infinity, active: 300, coverage: 24, hours: 24))
 }
}
