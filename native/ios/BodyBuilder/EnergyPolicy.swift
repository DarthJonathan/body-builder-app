import Foundation

/// Merge intervals before measuring coverage, so overlapping sources cannot
/// turn a partial day into a complete day. No raw samples leave the device.
enum EnergyPolicy {
    static func coveredHours(_ intervals: [DateInterval], within day: DateInterval) -> Double {
        let clipped = intervals.compactMap { interval -> DateInterval? in
            let start = max(interval.start, day.start), end = min(interval.end, day.end)
            return end > start ? DateInterval(start: start, end: end) : nil
        }.sorted { $0.start < $1.start }
        var end = day.start, seconds: TimeInterval = 0
        for interval in clipped {
            let start = max(end, interval.start)
            if interval.end > start { seconds += interval.end.timeIntervalSince(start) }
            end = max(end, interval.end)
        }
        return seconds / 3600
    }

    static func qualifies(resting: Double?, active: Double?, coverage: Double, hours: Double) -> Bool {
        guard let resting, let active else { return false }
        return resting.isFinite && active.isFinite && resting >= 300 && resting <= 5000
            && active >= 0 && active <= 8000 && hours >= 23 && hours <= 25
            && coverage >= hours * 0.9 && coverage <= hours + 0.01
    }
}
