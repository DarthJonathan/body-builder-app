# PostgreSQL API integration checks

Run from `backend` with `TEST_DATABASE_URL` pointing to a dedicated local test database:

```sh
TEST_DATABASE_URL='postgres://training:training@127.0.0.1:5433/training?sslmode=disable' go test -race ./integration
```

The suite fails when the database setting is absent or PostgreSQL is unavailable. Each test creates a random `bb_integration_*` schema, applies the real migrations, exercises `server.NewRouter` through HTTP, and drops only its own schema during cleanup. It does not truncate or reset the development `training` schema.

The eight prior cases cover public empty accounts and authentication, immutable identity/role, private ownership, paired daily check-in/weight updates, durable CRUD and session history, preserved offline workout stop times, personal template copies, concurrent revision conflicts, retry idempotency, invalid-update rollback, and provider errors. Provider settings and quota assertions use the real PostgreSQL rows, including encrypted key storage and public status without credentials. All configured upstream URLs point to a local HTTP error stub; no paid provider request is made.

Four nutrition cases add authenticated read-only previews with no revision/AI-quota changes, explicit/missing/null/unit/boundary validation, server reproduction of calculation provenance, same-date manual provenance retention, later dated history, private account separation, readable legacy targets, and genuine pinned USDA source/quantity persistence despite unavailable upstream search. All twelve top-level cases passed in the complete `go test -race ./...` run with real PostgreSQL; none skipped. Pure calculator tests in `../domain/nutrition_calculation_test.go` check the common eight Go/TypeScript golden cases, all activity factors, explicit offsets, intermediate rounding, non-finite inputs, impossible allocation, and metadata tampering. Results and browser coverage are recorded in [the verification report](../../docs/LIVE_VERIFICATION.md).

These checks complement provider adapter unit tests and browser E2E tests. They do not verify external provider availability or physical-device behavior.
