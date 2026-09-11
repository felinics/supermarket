---
name: rust-development
description: Build, test, format and lint Rust projects using Cargo, rustfmt and Clippy.
---

# Rust Development

## Inspect the project
Read `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` and repository instructions. Respect the declared toolchain. Check `rustc --version`, `cargo --version` and `rustup show`. The App provides a compiler, standard library, Cargo, rustfmt, Clippy and native build tools.

## Develop
For an existing project, run `cargo check --locked`, targeted `cargo test --locked`, `cargo fmt --check` and `cargo clippy --locked --all-targets` as appropriate. For a new project, use `cargo new` only in the requested directory. Preserve Cargo.lock for applications.

## Native dependencies
A working compiler is not proof every crate's native library exists. Diagnose missing `pkg-config` libraries or linker errors from the actual build. Add only the required library; do not disable TLS or remove tests to make compilation succeed.

## Installation ownership
The App manages Rust under its workspace dependency directory. Use App updates for the baseline toolchain. Project-specific toolchains and targets can be added deliberately through rustup. Do not run `rustup self uninstall` to remove the App.

Reference: https://doc.rust-lang.org/book/ ; https://rust-lang.github.io/rustup/
