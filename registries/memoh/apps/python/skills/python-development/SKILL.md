---
name: python-development
description: Develop Python projects using uv, Ruff and pytest.
---

# Python Development

## Respect the project
Inspect `pyproject.toml`, `uv.lock`, requirements files, Python version constraints and repository instructions. Work in a project virtual environment. The App provides Python, uv, Ruff and pytest as a fallback; prefer project-pinned versions when present.

## Install and verify
For a uv project, run `uv sync --locked` and use `uv run pytest`, `uv run ruff check` and `uv run ruff format --check`. For a requirements project, create `.venv` with `uv venv`, then `uv pip install -r requirements.txt`. Avoid modifying the shared interpreter or using system pip.

## Tests
Run the relevant tests after changes and report actual failures. Do not replace application dependencies with tools from the App's private development environment. Use `uv run` so tests import the project's dependencies.

References: https://docs.astral.sh/uv/ ; https://docs.astral.sh/ruff/ ; https://docs.pytest.org/
