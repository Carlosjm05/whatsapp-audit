from __future__ import annotations

import argparse
import json
import logging
import os
import sys


def _setup_logging() -> None:
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=level,
        stream=sys.stdout,
        format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def cmd_analyze(args: argparse.Namespace) -> int:
    from .analyzer import run_analyze
    result = run_analyze(limit=args.limit)
    print(json.dumps(result, indent=2))
    return 0 if result["failed"] == 0 else 1


def cmd_stats(_: argparse.Namespace) -> int:
    from . import db
    s = db.stats_summary()
    print(json.dumps(s, indent=2))
    return 0


def cmd_kb(_: argparse.Namespace) -> int:
    from .knowledge_base import build_knowledge_base
    summary = build_knowledge_base()
    print(json.dumps(summary, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="analyzer")
    p.add_argument(
        "--mode",
        choices=("analyze", "stats", "kb"),
        default="analyze",
    )
    p.add_argument("--limit", type=int, default=None,
                   help="max leads to process in analyze mode")
    return p


def main(argv=None) -> int:
    _setup_logging()
    args = build_parser().parse_args(argv)
    if args.mode == "analyze":
        return cmd_analyze(args)
    if args.mode == "stats":
        return cmd_stats(args)
    if args.mode == "kb":
        return cmd_kb(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
