---
name: go-development
description: Build, test and format Go modules with the Go toolchain.
---

# Go Development

## Inspect
Read `go.mod`, `go.sum`, any `go.work` and repository instructions. Check `go version` and respect the module's Go version and toolchain directive.

## Develop
Use the repository's existing code-generation commands. Format changed Go files with `gofmt`, run focused `go test` packages, then the required broader tests. Use `go vet` where applicable. Run `go mod tidy` only if dependencies changed, and inspect the resulting module diff.

## Builds
Run `go build` for the intended target. For cross-compilation or CGO, verify target platform and native compiler requirements rather than assuming a successful host build covers them. Keep generated binaries out of commits unless the repository explicitly owns them.

Reference: https://go.dev/doc/
