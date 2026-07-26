from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .generator import generate
from .protocol import SETTINGS_VERSION, GenerateRequest, ProtocolError


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, help="read a versioned request from JSON")
    parser.add_argument(
        "--mode",
        choices=("mountain-climber", "mountain-climber-ex"),
        help="mode when --request is not used",
    )
    parser.add_argument("--seed", type=int, help="seed when --request is not used")
    parser.add_argument("--race", action="store_true")
    parser.add_argument("--output", type=Path, help="write result JSON instead of stdout")
    return parser.parse_args()


def request_from_args(args: argparse.Namespace) -> GenerateRequest:
    if args.request:
        if args.mode is not None or args.seed is not None or args.race:
            raise ProtocolError("--request cannot be combined with mode, seed, or race")
        value: Any = json.loads(args.request.read_text(encoding="utf-8"))
    else:
        if args.mode is None or args.seed is None:
            raise ProtocolError("--mode and --seed are required without --request")
        value = {
            "schemaVersion": 1,
            "mode": args.mode,
            "seed": args.seed,
            "race": args.race,
            "settingsVersion": SETTINGS_VERSION,
        }
    return GenerateRequest.from_dict(value)


def main() -> int:
    try:
        args = parse_args()
        result = generate(request_from_args(args))
    except (OSError, ValueError, ProtocolError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    output = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
