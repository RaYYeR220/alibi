#!/usr/bin/env bash
# Regenerates the pydantic case models from the TypeScript schema export.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
uv run --project "$here" datamodel-codegen \
  --input "$here/../packages/canon/dist/case.schema.json" \
  --input-file-type jsonschema \
  --output "$here/alibi_casegen/models.py" \
  --output-model-type pydantic_v2.BaseModel \
  --class-name Case \
  --use-annotated --use-standard-collections --use-union-operator \
  --target-python-version 3.11 \
  --disable-timestamp
