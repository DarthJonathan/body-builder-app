# BodyBuilder for iPhone

This dependency-free Swift/WKWebView app opens **https://bodybuilder.lucasgrey.dev**. The frontend, Go API, account sign-in and private device sync are the same as the PWA. A native bridge adds read-only Apple Health access. Deploy the updated frontend and backend images before using the wrapper.

## Install from Xcode

1. Open `BodyBuilder.xcodeproj` in Xcode.
2. Select the BodyBuilder target → Signing & Capabilities. Select your Apple development team and a bundle identifier provisioned for HealthKit. The checked-in default is `com.bodybuilder.personal`; no team or signing credentials are committed.
3. Connect a real iPhone, select it as the run destination, and build/run. This project targets iOS 16.4 and later. Enable Developer Mode on the device if Xcode requires it.
4. Sign in. Open Progress → Change and answer the goal questions. In the energy step, agree to private summary sync, then press **Connect Apple Health**. Review the targets and press **Create Goal Plan** to save. Account Information → Apple Health → **Sync Apple Health** refreshes the summary separately; it does not silently rewrite targets.

`Config.xcconfig` contains the deployed host; the HTTPS URL and WKAppBoundDomains derive from it. Preserve the `https:/$()/…` xcconfig spelling: an unescaped `//` starts a comment. Only that HTTPS origin can invoke the native bridge. External links open in Safari. The app contains no backend/provider credentials. The wrapper uses [WebKit app-bound domains](https://webkit.org/blog/10882/app-bound-domains/) for its injected bridge.

## Energy policy

- Read permission is requested only for resting (`basalEnergyBurned`) and active energy. No HealthKit data is written.
- HealthKit daily cumulative statistics combine sources. The app does not add per-source totals, add workouts again, or multiply resting-plus-active expenditure by an activity factor.
- Only the last 14 completed local calendar days are considered. At least seven days must contain both energy values and at least 90% resting-energy interval coverage. Overlapping sample intervals are merged; 23/25-hour daylight-saving days are handled explicitly. Missing active energy is not interpreted as zero.
- The server also requires a recent sync and recent history. Empty data, denied/revoked access, incomplete days and unsupported values leave the equation estimate available. HealthKit does not reveal whether absent read results mean denied permission or missing samples.
- Only daily totals, coverage, timezone, sync time and source names are sent to the private account after an explicit save/sync action. Raw samples stay on the device. Removing the saved summary leaves the original provenance of historical goals/targets intact. Revoke read access in Apple Health's app permissions.
- Resting energy and maintenance are device estimates, not laboratory measurements of BMR. The PWA can use a recent summary already saved to the account, but it cannot directly read HealthKit.

## Local verification

```sh
swift test --package-path native/ios --scratch-path /private/tmp/bodybuilder-health-tests
xcodebuild -project native/ios/BodyBuilder.xcodeproj -target BodyBuilder \
  -configuration Debug -sdk iphonesimulator -arch arm64 \
  SYMROOT=/private/tmp/bodybuilder-ios/products OBJROOT=/private/tmp/bodybuilder-ios/objects \
  CODE_SIGNING_ALLOWED=NO build
```

Run these from the repository root. Pure Swift tests cover coverage unions, missing versus zero energy, interval boundaries, and daylight saving. Browser tests use a synthetic native bridge for consent, energy calculations, fallback and removal; Go tests verify validation, private persistence and provenance. An unsigned SDK build confirms compilation; it does not prove permission prompts or real HealthKit reads. Those still require the signed real-device check above. App Store/TestFlight distribution and background sync are not configured.
