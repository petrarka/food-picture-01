# food-picture-01

A single striking food picture rendered from pure math: a gourmet cheeseburger,
three-quarter view, lit like a studio product shot. Warm key light from upper
right, soft fill, rim light with Fresnel edge glints, contact shadow and a
directional cast shadow on a cream backdrop.

Everything is an analytic ray/primitive intersection (ellipsoids and cylinders),
sampled 2×2 per pixel and written out as a hand-assembled PNG (zlib + CRC32).

## What it is

- **Procedural glossy burger render** — no image assets, no 3D libraries.
- **Stdlib-only** — `node:zlib`, `node:fs`, `node:path`.
- **Deterministic** — every random value comes from a hash of the pixel
  coordinate, so two runs produce byte-identical output.
- **1024×1024, ≤ 1 MiB PNG** — the final image is ~632 KiB.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Writes `out/entry.png`.

## Requirements

- Node 22+ (uses native TypeScript type stripping).
- No network access, no third-party packages.
- Output is a 1024×1024 truecolour PNG, ≤ 1 MiB.