# Linux container workflow

This Compose setup provides a Linux-first development server, a bounded set of
non-browser checks, and a production build. It uses the repository's checked-in
core kit and fixtures. It is not a substitute for the normal product workflow,
browser tests, platform qualification, or final acceptance.

## Requirements and pinned tools

- Docker Engine with Compose v2
- Linux/arm64 or Linux/amd64; the image is pinned by the multi-platform digest
  `node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df`
- `packageManager` pins pnpm 11.25.0; the image install uses the existing
  `pnpm-lock.yaml` with `pnpm install --frozen-lockfile`
- Registry access is needed the first time to pull the official Node image and
  install the lockfile dependencies during image build

The first qualification is native Linux/arm64. Hosted Linux/amd64 should be
verified separately before claiming both platforms. Compose selects the
platform matching the Docker daemon; do not infer cross-platform equivalence.

## Build and run

Use the task-specific Compose project name in every command so only its named
containers and volumes are selected:

```sh
docker compose -p tachiko-sheet-container -f docker-compose.yml config --quiet
docker compose -p tachiko-sheet-container -f docker-compose.yml build
docker compose -p tachiko-sheet-container -f docker-compose.yml up --build dev
```

The Vite server is published only on host loopback at
`http://127.0.0.1:5173`. The app source is copied into the image rather than
mounting the whole checkout; rebuild the image after source edits. Dependency,
generated-example, and production-output data use only this Compose project's
named volumes. The container runs as the non-root `node` user with a read-only
root filesystem, bounded temporary storage, dropped Linux capabilities,
`no-new-privileges`, and per-service CPU, memory, and PID limits.

The daemon used for initial qualification has 3 GiB available. Run the check and
build jobs one at a time, and stop the dev service before running them; do not
start all resource-limited services concurrently.

## Bounded check and build jobs

```sh
docker compose -p tachiko-sheet-container -f docker-compose.yml run --rm --no-deps check
docker compose -p tachiko-sheet-container -f docker-compose.yml run --rm --no-deps build
```

`check` runs, in order:

1. `pnpm typecheck`
2. `pnpm verify:core-kit` — verifies the checked-in producer pin and artifact
   inventory; this is not a product acceptance result
3. `pnpm test` — runs the seed harness only

`build` runs the repository's existing `pnpm build` command: it materializes
the checked-in examples, runs Vite's production build, and checks the resulting
`dist`. The named `dist` volume retains the output. For a fresh build, Vite
clears the destination before writing. The existing materializer regenerates
the ignored `public/examples` volume from the tracked source fixtures.

To qualify a fresh volume bootstrap followed by reuse, reset only this project's
volumes, then run the jobs twice in sequence:

```sh
docker compose -p tachiko-sheet-container -f docker-compose.yml down --volumes
docker compose -p tachiko-sheet-container -f docker-compose.yml run --rm --no-deps check
docker compose -p tachiko-sheet-container -f docker-compose.yml run --rm --no-deps build
docker compose -p tachiko-sheet-container -f docker-compose.yml run --rm --no-deps check
docker compose -p tachiko-sheet-container -f docker-compose.yml run --rm --no-deps build
```

The first run creates task-owned volumes from the image's pre-created,
`node`-owned destinations. Later runs reuse those same volumes. If package
dependencies change, rebuild the image and remove only this project's named
volumes with the command above before the next check/build cycle; an old
`node_modules` volume must not mask the rebuilt image's dependency tree.

To copy the built output into a local folder without mounting the checkout into
the container:

```sh
mkdir -p container-output/dist
docker compose -p tachiko-sheet-container -f docker-compose.yml run --rm --no-deps build \
  sh -lc 'tar -C /workspace/dist -cf - .' > /tmp/tachiko-sheet-dist.tar
tar -xf /tmp/tachiko-sheet-dist.tar -C container-output/dist
rm -f /tmp/tachiko-sheet-dist.tar
```

## Scope and limits

This container workflow deliberately does not run `pnpm test:unit`, J4 browser
composition, Playwright, product acceptance, or the full CI suite. Those suites
launch browsers and require a separately qualified Linux browser runner. This
scope exclusion does not waive normal repository CI, required review, or later
acceptance.

The container checks/build do not qualify Rust/Work behavior, native/macOS
applications or signing, #49 desktop support, #60 manual/IME/accessibility,
deployment or release, or #1 final acceptance. No database, provider service,
credentials, or network kit fetch is part of this setup.

## Isolation and cleanup

The `.dockerignore` filters the image build context, not Docker bind mounts. The
Compose services therefore use image-copied source and never bind-mount the
whole checkout. `check` and `build` have no runtime network. No service is
privileged, mounts the host Docker socket, or receives local credentials.

From the repository root, test credential-path exclusions without using or
exposing real credentials by building this probe in a temporary context. It
copies the candidate `.dockerignore`,
creates root and nested sentinel paths, and fails if any path reaches the image:

```sh
(
  set -eu
  tmp="$(mktemp -d)"
  tag="tachiko-sheet-ignore-probe:$(basename "$tmp")"
  trap 'docker image rm "$tag" >/dev/null 2>&1 || true; rm -rf -- "$tmp"' EXIT
  cp .dockerignore "$tmp/.dockerignore"
  mkdir -p "$tmp/.docker" "$tmp/nested/.docker"
  for name in .npmrc .netrc .git-credentials; do
    printf '%s\n' 'SENTINEL_ONLY_NOT_A_CREDENTIAL' > "$tmp/$name"
    printf '%s\n' 'SENTINEL_ONLY_NOT_A_CREDENTIAL' > "$tmp/nested/$name"
  done
  printf '%s\n' 'SENTINEL_ONLY_NOT_A_CREDENTIAL' > "$tmp/.docker/sentinel"
  printf '%s\n' 'SENTINEL_ONLY_NOT_A_CREDENTIAL' > "$tmp/nested/.docker/sentinel"
  cat > "$tmp/Dockerfile.ignore-probe" <<'EOF'
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
COPY . /probe
RUN for path in .npmrc .netrc .git-credentials .docker/sentinel \
    nested/.npmrc nested/.netrc nested/.git-credentials nested/.docker/sentinel; do \
      test ! -e "/probe/$path" || { echo "Ignored sentinel leaked: $path" >&2; exit 1; }; \
    done
EOF
  docker build -f "$tmp/Dockerfile.ignore-probe" -t "$tag" "$tmp"
)
```

The temporary context keeps sentinel files out of the checkout, and its
contents are not credentials. The trap removes only the uniquely tagged probe
image and temporary directory. Do not weaken ignore rules based on the probe.

Volumes are scoped by the project name `tachiko-sheet-container`; avoid running
the dev server concurrently with the check/build jobs on the small daemon. To
stop this project and remove only its named volumes after copying any desired
build output:

```sh
docker compose -p tachiko-sheet-container -f docker-compose.yml down --volumes
```

Do not use global Docker prune or daemon reset commands. Those can delete or
interrupt unrelated projects. After check/build, verify that only the intended
tooling files appear as changes in the checkout and that tracked fixture and
core-kit hashes remain unchanged.
