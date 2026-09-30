# Deployment

No shared deployment is ready. `Dockerfile` and `compose.yaml` are development scaffolds only. The application currently supports local stdio, has no shared HTTP listener or authentication, and must not be exposed on a network.

A future shared deployment requires one canonical checkout, one serialized writer, a persistent runtime volume, TLS termination, authenticated principal configuration with hashed credentials, GitHub App credentials supplied outside Git, readiness/health checks, rate limits, and a verified backup/recovery procedure. Never run independent canonical writable checkouts behind multiple instances.

The real remote capture and evidence paths require a test knowledge repository, participating source repositories, and least-privilege external credentials; none are configured or verified here.
