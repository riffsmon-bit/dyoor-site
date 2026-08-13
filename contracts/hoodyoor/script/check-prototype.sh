#!/usr/bin/env bash
set -euo pipefail

forge fmt --check
forge test --offline -vv
forge build --sizes
