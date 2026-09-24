# dsh-preflight

> **No longer maintained (2026-09).** Since DSH 0.1.7, plugin compatibility is checked on install and startup. This repository is kept as an archive.

English | [中文](README.md)

You install one plugin and DSH won't start. The log scrolls dozens of plugin-load failures, so it looks like everything broke — when the actual cause may be two plugins claiming the same entry id.

`dsh-preflight` is built for exactly that:

- **Before installing**, it fetches the candidate and collides it against your current profile, then tells you whether it will break something.
- **After something breaks**, it reads the DSH logs and boils a screenful of cascading errors down to one root cause.

In both cases it prints the command you should run — but **it never runs it for you**. The tool keeps its hands off, which is what makes it safe to download and parse an unfamiliar plugin's artifact in the first place.

> Safety boundary: it only downloads and unpacks candidate artifacts, then statically parses JSON/YAML and source text. It never installs a plugin, never executes candidate code or install scripts, and never modifies your DSH profile. Network candidates are written to an `mkdtemp` directory and deleted afterwards.

It answers the question "did any implemented rule find a problem" — it is not a proof of safety, and it has no daemon or background auto-repair.

## Requirements

- Windows-first; Node.js 22.19 or newer
- Default DSH install root: `E:\dsh` (override with `--dsh-root` or the `DSH_ROOT` environment variable)
- Default profile: `%USERPROFILE%\.dsh\profiles\web`
- Set `DSH_HOME` to override the `.dsh` root

## Usage

```bash
dsh-preflight check dsh-web-search-pro
```

```bash
dsh-preflight check github:owner/repo#main --profile web
```

```bash
dsh-preflight check "D:\work\my-plugin"
```

```bash
dsh-preflight audit
```

```bash
dsh-preflight diff dsh-web-search-pro --json
```

```bash
dsh-preflight explain
```

```bash
dsh-preflight explain --log "D:\logs\dsh.err.log" --json
```

By default `explain` reads `dsh.err.log`, `dsh.log`, `dsh.restart.log`, and `launch-trace.log` from the DSH install root, taking only the last 2 MiB of each file. Missing or empty logs return INFO rather than failing.

Common options:

- `--profile <name>`: profile name, defaults to `web`
- `--profile-dir <path>`: point at a profile directory directly
- `--dsh-root <path>`: override the DSH install root
- `--dsh-home <path>`: override the `.dsh` root
- `--registry <url>`: override the npm registry
- `--log <path>`: restrict `explain` to a single log file
- `--json`: emit machine-readable JSON
- `--strict`: exit 1 on WARN as well

## Checks

| Finding | Level | Meaning |
|---|---:|---|
| `ENTRY_ID_COLLISION` | BLOCK | The candidate's entry id is already used by an installed bundle |
| `UNRESOLVABLE_AFTER_INSTALL` | BLOCK / UNKNOWN | `insert[].name` still cannot be proven resolvable after install |
| `CONFIG_OVERRIDE_SILENT` | WARN | The profile layer replaces the candidate's config for the same id wholesale |
| `SERVICE_PROVIDER_DUPLICATE` | WARN / UNKNOWN | Duplicate explicit service, or the manifest says too little to tell |
| `MISSING_BUNDLE_MANIFEST` | BLOCK | No readable `dsh.bundle.patch` |
| `ENTRY_MISSING_IN_ARTIFACT` | BLOCK | `main`, `module`, `bin`, or a recursive `exports` target is absent from the artifact |
| `BUILD_APPROVAL_REQUIRED` | INFO | A Git source carries build scripts that need manual approval |
| `VERSION_RANGE_MISMATCH` | WARN | A `@deepseek-ai/*` peer range does not match the local version |
| `UNPINNED_SOURCE` | WARN | The GitHub ref is not a full commit SHA |
| `SENSITIVE_API_SURFACE` | INFO | Static text matched a subprocess, file write, or outbound URL |
| `INSTALL_SCRIPT_PRESENT` | WARN | Lifecycle scripts run at install time |
| `BUNDLES_DEPS_DRIFT` | BLOCK | The profile's bundles and dependencies have drifted from what is on disk |
| `UNMET_PEER` | WARN | A peer of the current profile is missing or mismatched |

## Runtime log patterns

| Finding | Level | Meaning |
|---|---:|---|
| `PORT_ALREADY_IN_USE` | BLOCK | An old process holds the port, the new instance never started, and the plugin errors are downstream symptoms |
| `BUNDLE_UNRESOLVED_AT_BOOT` | BLOCK | A bundle failed to resolve at boot; cross-checked against the profile to spot removal residue |
| `ENTRY_ID_COLLISION_AT_BOOT` | BLOCK | The boot log shows an entry id registered twice or overridden |
| `MODULE_ENTRY_MISSING` | BLOCK | An installed package's internal entry file is not in the published artifact |
| `UNRECOGNIZED_ERROR` | UNKNOWN | The log contains errors that the deterministic rules cannot classify |
| `NO_LOGS_TO_ANALYZE` | INFO | The default or specified logs are missing or empty |
| `NO_RECOGNIZED_RUNTIME_ERROR` | INFO | The logs have content but matched no error line or implemented pattern |

## Exit codes

- `0`: no BLOCK; WARN is allowed by default
- `1`: a BLOCK exists, or a WARN exists under `--strict`
- `2`: bad arguments, or a download, unpack, or profile-read failure

## Verification status

The rules are not equally trustworthy, so here is the honest split.

**Verified against real failures** (reproduced on an isolated test bed plus real archived logs):

- `ENTRY_ID_COLLISION`, `BUNDLES_DEPS_DRIFT`, `ENTRY_MISSING_IN_ARTIFACT`, `UNMET_PEER`
- `PORT_ALREADY_IN_USE`, `ENTRY_ID_COLLISION_AT_BOOT`, `BUNDLE_UNRESOLVED_AT_BOOT`, `MODULE_ENTRY_MISSING`

**Unit-tested only, never yet triggered by a real case**:

- `CONFIG_OVERRIDE_SILENT`, `SERVICE_PROVIDER_DUPLICATE`, `BUILD_APPROVAL_REQUIRED`, `VERSION_RANGE_MISMATCH`, `UNPINNED_SOURCE`, `SENSITIVE_API_SURFACE`, `INSTALL_SCRIPT_PRESENT`, `MISSING_BUNDLE_MANIFEST`, `UNRESOLVABLE_AFTER_INSTALL`

**Known limits**:

- The `explain` patterns are written against the wording of the current DSH version. If DSH rewords its logs, those rules **fail silently** — no error, they simply stop matching.
- This tool reports whether the implemented rules found a problem. It is not a proof of safety and does not replace reading a plugin's source yourself.
- A CLEAR verdict only means these rules did not fire, not that the plugin is fine.

## Implementation boundaries

- npm sources are read via registry metadata and tarball, verifying `sha512` integrity when available.
- GitHub sources use the codeload archive; local sources are read through `realpath`, read-only.
- Tar extraction rejects path traversal and absolute paths, never creates symlinks or hardlinks from the archive, and caps download size, unpacked size, per-file size, and file count.
- YAML `!!js` tags are kept as plain strings and never evaluated.
- Service providers come only from explicit manifest declarations; anything less is reported as UNKNOWN.
- Source scanning is bounded regex matching that lists facts without judging intent.
- Log analysis reads only the tail of each file and never queries ports or processes. Suggested fixes are emitted as command text and never executed.

## Development

```bash
pnpm install
```

```bash
pnpm check
```

```bash
node lib/cli.js --help
```

Licensed under MIT.
