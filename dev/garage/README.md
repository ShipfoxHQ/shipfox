# Local object storage (Garage)

Runner logs are compacted into an S3-compatible object store. For local
development and self-hosting, `compose.yml` bundles [Garage](https://garagehq.deuxfleurs.fr/);
any S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, MinIO, …) works
in production.

| Setting | Value |
| -- | -- |
| Endpoint | `http://localhost:3900` |
| Region | `garage` |
| Bucket | `shipfox-logs` |
| Access key id | `GKc0ffeec0ffeec0ffeec0ffee` |

The secret in `garage.toml` and the access key are **development-only**.
Generate fresh credentials for any shared or production environment, and set the
`LOG_STORAGE_S3_*` variables accordingly (see `libs/api/logs/src/config.ts`).

## Browser reads (later)

The log read path serves compacted objects through presigned URLs fetched
directly by the browser, so the bucket needs CORS configured to allow the
dashboard origin. That is set up with the read path (ENG-443), not here.
