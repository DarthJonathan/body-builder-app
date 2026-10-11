import Foundation
import HealthKit

final class HealthReader {
    private let store = HKHealthStore()
    private let resultsQueue = DispatchQueue(label: "BodyBuilder.health-results")

    func read(completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard HKHealthStore.isHealthDataAvailable(),
              let basal = HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned),
              let active = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) else {
            completion(.success(["message": "Apple Health is unavailable on this device. Use the equation estimate."]))
            return
        }
        // Read only. Successful completion does not establish read permission.
        store.requestAuthorization(toShare: [], read: [basal, active]) { success, error in
            if let error { completion(.failure(error)); return }
            guard success else {
                completion(.success(["message": "Apple Health authorization could not be completed. Use the equation estimate."]))
                return
            }
            self.readCompletedDays(basal: basal, active: active, completion: completion)
        }
    }

    private func readCompletedDays(basal: HKQuantityType, active: HKQuantityType, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        let now = Date(), calendar = Calendar.current
        let end = calendar.startOfDay(for: now)
        guard let start = calendar.date(byAdding: .day, value: -14, to: end) else { return }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let group = DispatchGroup()
        var basalStats: HKStatisticsCollection?, activeStats: HKStatisticsCollection?
        var basalSamples: [HKQuantitySample] = [], failure: Error?
        for type in [basal, active] {
            group.enter()
            // HealthKit combines sources; never sum per-source results ourselves.
            let query = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: predicate,
                options: .cumulativeSum, anchorDate: start, intervalComponents: DateComponents(day: 1))
            query.initialResultsHandler = { query, collection, error in
                self.resultsQueue.async {
                    if let error { failure = error }
                    if type == basal { basalStats = collection } else { activeStats = collection }
                    self.store.stop(query)
                    group.leave()
                }
            }
            store.execute(query)
        }
        group.enter()
        let samplesQuery = HKSampleQuery(sampleType: basal, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
            self.resultsQueue.async {
                if let error { failure = error }
                basalSamples = samples as? [HKQuantitySample] ?? []
                group.leave()
            }
        }
        store.execute(samplesQuery)
        group.notify(queue: resultsQueue) {
            if let failure { completion(.failure(failure)); return }
            let format = DateFormatter(); format.calendar = calendar; format.timeZone = calendar.timeZone
            format.locale = Locale(identifier: "en_US_POSIX"); format.dateFormat = "yyyy-MM-dd"
            var days: [[String: Any]] = [], sources = Set<String>()
            let intervals = basalSamples.map { DateInterval(start: $0.startDate, end: $0.endDate) }
            for sample in basalSamples { sources.insert(sample.sourceRevision.source.name) }
            for offset in 0..<14 {
                guard let dayStart = calendar.date(byAdding: .day, value: offset, to: start),
                      let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) else { continue }
                let day = DateInterval(start: dayStart, end: dayEnd)
                let resting = basalStats?.statistics(for: dayStart)?.sumQuantity()?.doubleValue(for: .kilocalorie())
                let activity = activeStats?.statistics(for: dayStart)?.sumQuantity()?.doubleValue(for: .kilocalorie())
                let coverage = EnergyPolicy.coveredHours(intervals, within: day)
                let hours = day.duration / 3600
                guard EnergyPolicy.qualifies(resting: resting, active: activity, coverage: coverage, hours: hours) else { continue }
                for source in activeStats?.statistics(for: dayStart)?.sources ?? [] { sources.insert(source.name) }
                days.append(["date": format.string(from: dayStart), "restingCalories": resting!, "activeCalories": activity!, "coverageHours": coverage, "dayHours": hours])
            }
            guard days.count >= 7, !sources.isEmpty else {
                // Denied read permission and missing samples cannot be distinguished.
                completion(.success(["message": "Fewer than seven complete energy days are available. Check Apple Health permissions and device history. Keep the equation estimate for now."]))
                return
            }
            completion(.success(["energy": ["source": "apple-health", "syncedAt": ISO8601DateFormatter().string(from: now),
                "timezone": calendar.timeZone.identifier, "sources": Array(sources).sorted(), "days": days]]))
        }
    }
}
