# External providers

This package is the server-side boundary for AI questions, meal-photo nutrition drafts, and keyless food search. Production data never comes from frontend preview fixtures. Verification uses only local `httptest` servers and fake credentials; it makes no paid API calls.

## Integration

Call `Migrate(db)` in the application's migrations, then construct one `Service` with `New(Options{DB: db, EncryptionKey: decoded32ByteSecret, ...})`. `Config` and `Usage` follow the database's GORM naming strategy so isolated test schemas work. Settings have one global row; quota counters are atomic per authenticated user and UTC date. The router must authenticate callers and resolve administrator roles from the database. `SaveConfig` and `TestConfig` also enforce their supplied `isAdmin` flag.

Load `foods, err := BundledFoods()` once at startup and supply `Options.FallbackFoods: foods`. Treat a loader/checksum error as a startup error. The returned slice and constructor input are copied so callers cannot mutate the shared catalogue.

`PublicConfig` contains only provider/model/enabled/configured status and the daily request limit. Keys use AES-256-GCM with a random nonce and provider-specific authenticated data. Encryption is required before a key can be saved. An omitted `apiKey` retains the saved key, an empty key deletes it, and switching provider discards the previous provider's key. Keys and images never enter training snapshots. Changing the server encryption secret requires administrators to replace saved provider keys.

The constructor accepts server-owned endpoint overrides and an HTTP client for local tests. Endpoint URLs are never accepted in administrator requests. Redirects are refused, request bodies are bounded, response bodies are capped at 1 MB, extracted text is capped at 16 KB, and no upstream error body or request body is logged or returned. The saved key is redacted if an upstream unexpectedly echoes it in an answer. Calls use a 25-second default timeout, at most four concurrent AI requests, bounded output tokens, and 20 attempts per user/day by default (administrator range: 1–500). Attempts include unsuccessful upstream calls and connection tests; invalid input and missing configuration do not consume quota. There are no automatic paid retries.

`Ask(ctx, userID, question)` sends only the submitted question and a fixed assistant instruction. It does not send the account's snapshot or retain a conversation. `TestConfig(ctx, userID, isAdmin)` asks the saved provider for a brief connection response. Both return `QuestionResult{Answer, Preview:false}`.

`EstimateMeal(ctx, userID, bytes, declaredMIME)` accepts JPEG/PNG up to `MaxImageBytes` (7 MB), 8000 pixels per side and 16 megapixels. It fully decodes and re-encodes the image to remove metadata before sending it; HEIC/WebP require conversion. Provider structured output is still strictly validated on the server: required fields, nonempty text, at most 20 items, positive quantities, and bounded nonnegative finite nutrition values. Nutrition values describe the total for each item's quantity. Estimates return `domain.MealEstimate{Preview:false}` as unsaved drafts. They never add foods, targets, or food-log entries. Unrecognized meals, incomplete output, refusals, and malformed responses are visible errors.

## Protocols verified against official documentation

- [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision) and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses API, `input_text`/`input_image` content, `text.format` JSON schema, `store:false`, and bearer authentication. The adapter extracts response output text and handles incomplete/refused responses.
- [Anthropic image inputs](https://platform.claude.com/docs/en/build-with-claude/vision), [Messages API](https://platform.claude.com/docs/en/api/messages/create), and [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs): Messages API with base64 image content, `x-api-key`, version `2023-06-01`, and `output_config.format` JSON schema. Structured output support depends on the administrator's selected model.
- [OpenRouter chat API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion) and [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs): bearer authentication, `image_url` content, `response_format` JSON schema, and `provider.require_parameters:true` for schema-compatible routing. The selected model must support the requested vision/schema capability.
- [Open Food Facts API overview](https://openfoodfacts.github.io/openfoodfacts-server/api/) and [API reference examples](https://openfoodfacts.github.io/openfoodfacts-server/api/ref-cheatsheet/): read access is keyless; supply a meaningful app/contact `User-Agent`. The v2/v3 product API does not expose free-text search. Keyword search therefore uses the documented legacy `/cgi/search.pl` endpoint pending a supported replacement.

## Food search and attribution

`SearchFoods(ctx, query)` first searches the bundled USDA catalogue. All query words must match prefixes of description words, so `banana` finds `Bananas, raw` while `rice` does not match `licorice`. Short ingredient descriptions and earlier exact words rank first; results are capped at 20. Original descriptions, preparation states, and nutrition are preserved. Matching local searches make no upstream request, consume no AI quota, and remain available during Open Food Facts outages or rate limits. Matching uses words and prefixes, without synonyms, semantic search, or inferred household/volume portions.

Only queries with no local match reach the keyless Open Food Facts keyword API. Identical in-flight requests are coalesced, up to 100 normalized online queries are cached for five minutes, and uncached upstream requests are limited to ten per rolling minute in this server process. Local and cached searches do not consume that allowance. Additional applications sharing an IP can still exhaust the upstream's separate allowance.

Only products with a safe barcode, a name, and all four calories/protein/carbs/fat values are returned. Complete values for the labelled serving take priority; otherwise complete per-100g values are used with `serving:"100 g"`. Missing, null, nonnumeric, negative, or implausible nutrients are omitted rather than fabricated as zero. Genuine numeric zero remains valid. Product IDs use `off:<barcode>`. The source retains Open Food Facts, its ODbL attribution, and the original product URL. Crowd-sourced nutrition still requires the user's review before logging.

`FallbackFoods` retains its constructor name for compatibility and supplies the genuine local catalogue searched first. It rejects unattributed data and preview sources and never relabels USDA records as Open Food Facts. An unmatched query with an online outage or rate limit returns a typed error. The application can additionally search the authenticated user's saved foods and accept manual entries without invoking AI.

## Pinned USDA reference data

The [official download page](https://fdc.nal.usda.gov/download-datasets/) publishes the final **SR Legacy April 2018 CSV** release. The bundle contains all **7,793** records with complete source kcal/protein/carbs/fat values; none were skipped. This is a historical reference dataset, including preparation-specific foods and some prepared/product descriptions, rather than a current packaged-food catalogue. Source food publication dates in the FDC archive are `2019-04-01`; the dataset release remains April 2018.

The importer reads `food.csv`, `food_nutrient.csv`, and `nutrient.csv` directly from the [pinned official archive](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip). It requires unique FDC IDs, valid descriptions, and explicit finite nonnegative values for Energy `1008` (`KCAL`), Protein `1003` (`G`), Carbohydrate by difference `1005` (`G`), and Total lipid `1004` (`G`). USDA's [field definitions](https://fdc.nal.usda.gov/docs/Download_Field_Descriptions_Oct2020.pdf) specify nutrient amounts per 100 g. Bounds are 0–1000 kcal and 0–100 g per macro. Missing values are excluded; explicit source zeros are retained. Calories are preserved from the source and are not recalculated from macros. FDC IDs use `usda:<id>`, and every serving is `100 g`.

FoodData Central data are public domain under [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/), as stated in the [USDA API guide](https://fdc.nal.usda.gov/api-guide/). Each result's source names USDA, the release, FDC ID, license, and official archive URL. For example, `usda:173944` is `Bananas, raw`: 89 kcal, 1.09 g protein, 22.84 g carbs, and 0.33 g fat per 100 g. The current archive downloaded successfully during verification on 2026-10-10. The former `/food-details/173944/nutrients` link returned HTTP 404, so sources deliberately link to the verified archive while retaining the record's FDC ID.

The JSON bundle and adjacent manifest live under `data/`. The manifest records the nutrient definitions, release, license/source links, record/skipped counts, original ZIP size, and ZIP/member/catalogue SHA-256 values. The embedded loader validates the pinned manifest, catalogue hash, count, units, IDs, and attribution before returning data.

- Source ZIP: **6,074,592 bytes**, SHA-256 `b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0`.
- Normalized catalogue SHA-256: `8bd98ec521817eed325107db87f057fc2c6ecdd0da6a21cb1f94253c70b37ffb`.

Reproduce from the repository root with Python 3.10+ and no third-party packages or USDA API key:

```sh
python3 scripts/import_usda_foods.py --self-test
python3 scripts/import_usda_foods.py
```

The second command downloads the exact pinned official archive, verifies its checksum before parsing, and writes deterministic JSON/manifest output. To reuse the archive downloaded during implementation and compare without writing:

```sh
python3 scripts/import_usda_foods.py --archive /tmp/bodybuilder-usda-sr-legacy-2018-04.zip --check
```

Without `--archive`, `--check` downloads the pinned archive into a temporary directory. No timestamps are generated, so repeated imports compare byte for byte. A future source/version update requires an explicit archive/manifest/embedded hash update and review; there is no runtime auto-update.

## Verification

Run `go test ./providers` and `go test -race ./providers` from `backend`. These tests check real HTTP payloads and credentials against local servers for all three providers, encryption and public serialization, rotation/tampering, administrator restrictions, persisted-store quota behavior, image decoding and sanitation, draft validation, timeout/size/redirect limits, and Open Food Facts query/cache/rate behavior. USDA tests verify all 7,793 complete records, known source values/zeros, per100g units, original record IDs, pinned checksums/licensing, immutable copies, common ingredient coverage, distinct raw/cooked foods, zero upstream/AI usage for local matches, and availability after online failures/rate limits. Real PostgreSQL/router integration tests additionally verify migrations, ciphertext persistence, global public status, account authorization, and quota durability. No external provider has been called with a real key during local verification.
