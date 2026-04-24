from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import time


log = logging.getLogger("analyzer.main")
_shutdown = False


def _setup_logging() -> None:
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=level,
        stream=sys.stdout,
        format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def _install_signal_handlers() -> None:
    """SIGTERM/SIGINT → marca shutdown limpio para el daemon."""
    def _handler(signum, _frame):
        global _shutdown
        log.info("Señal %s recibida, terminando ciclo actual...", signum)
        _shutdown = True
    try:
        signal.signal(signal.SIGTERM, _handler)
        signal.signal(signal.SIGINT, _handler)
    except (ValueError, AttributeError):
        # En algunos entornos (tests) signal no es instalable.
        pass


def cmd_analyze(args: argparse.Namespace) -> int:
    from .analyzer import run_analyze
    result = run_analyze(limit=args.limit)
    print(json.dumps(result, indent=2))
    # run_analyze devuelve "fallidos" (clave en español). Aceptamos
    # "failed" también por retrocompat con callers antiguos.
    fails = result.get("fallidos", result.get("failed", 0))
    return 0 if fails == 0 else 1


def cmd_daemon(args: argparse.Namespace) -> int:
    """Loop infinito: cada N segundos busca leads pendientes y los analiza.

    Es lo que corre como servicio (CMD del Dockerfile). Permite que el
    botón "Re-analizar" del dashboard funcione sin invocar nada manual:
    la API marca el lead como pending, el daemon lo levanta en la
    próxima vuelta.

    Defaults conservadores: poll cada 30s, batch de 10 leads.
    """
    from .analyzer import run_analyze
    poll = max(5, int(args.poll or 30))          # mínimo 5s para no martillar la DB
    batch = max(1, int(args.batch or 10))

    log.info("Daemon arrancado: poll=%ss · batch=%s", poll, batch)
    log.info("Esperando leads pendientes (analysis_status='pending')...")

    consecutive_idle = 0
    while not _shutdown:
        try:
            result = run_analyze(limit=batch)
            ok = result.get("ok", 0)
            fails = result.get("fallidos", result.get("failed", 0))
            if ok > 0 or fails > 0:
                log.info("Ciclo: ok=%s · fallidos=%s · costo=$%.4f",
                         ok, fails, result.get("costo_total_usd", 0.0))
                consecutive_idle = 0
            else:
                consecutive_idle += 1
                # Solo loguear "sin pendientes" cada 10 ciclos para no spamear.
                if consecutive_idle % 10 == 1:
                    log.info("Sin leads pendientes (ciclos idle: %s)", consecutive_idle)
        except Exception as e:
            log.exception("Error en ciclo del daemon: %s", e)
            # No abortar — el daemon debe ser resiliente. Sleep extra
            # para no quemar API quotas si el error es persistente.
            time.sleep(min(60, poll * 2))
            continue

        # Sleep en pasos cortos para responder rápido a señales.
        for _ in range(poll):
            if _shutdown:
                break
            time.sleep(1)

    log.info("Daemon terminado limpiamente.")
    return 0


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
        choices=("analyze", "daemon", "stats", "kb"),
        default="analyze",
    )
    p.add_argument("--limit", type=int, default=None,
                   help="max leads to process in analyze mode")
    p.add_argument("--poll", type=int, default=None,
                   help="(daemon) segundos entre polls a la DB (default 30)")
    p.add_argument("--batch", type=int, default=None,
                   help="(daemon) máximo de leads a procesar por ciclo (default 10)")
    return p


def main(argv=None) -> int:
    _setup_logging()
    _install_signal_handlers()
    args = build_parser().parse_args(argv)
    try:
        if args.mode == "analyze":
            return cmd_analyze(args)
        if args.mode == "daemon":
            return cmd_daemon(args)
        if args.mode == "stats":
            return cmd_stats(args)
        if args.mode == "kb":
            return cmd_kb(args)
        return 2
    finally:
        # Cerrar el pool de DB al salir — evita warnings de leak en logs
        # de Postgres cuando el container muere por SIGTERM.
        from . import db as _db
        try:
            _db.close_pool()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
