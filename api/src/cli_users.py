"""CLI de administración de usuarios para `admin_users`.

Uso (dentro del contenedor api):
    python -m src.cli_users add Oscar_Accedo OscarOrt --role=operator --name="Óscar Ortiz"
    python -m src.cli_users list
    python -m src.cli_users disable Oscar_Accedo
    python -m src.cli_users enable Oscar_Accedo
    python -m src.cli_users reset-password Oscar_Accedo NuevoPass123

Roles disponibles: admin, operator, viewer.
"""
from __future__ import annotations

import argparse
import sys

from .auth import hash_password
from .db import execute, fetch_all, fetch_one, init_pool


VALID_ROLES = {"admin", "operator", "viewer"}


def cmd_add(args: argparse.Namespace) -> int:
    if args.role not in VALID_ROLES:
        print(f"Rol inválido. Usá uno de: {sorted(VALID_ROLES)}", file=sys.stderr)
        return 2

    existing = fetch_one(
        "SELECT id FROM admin_users WHERE LOWER(username) = LOWER(%s)",
        [args.username],
    )
    if existing:
        print(f"Usuario '{args.username}' ya existe. Usá reset-password para cambiar el pass.")
        return 1

    execute(
        """INSERT INTO admin_users (username, password_hash, full_name, role, is_active)
             VALUES (%s, %s, %s, %s, TRUE)""",
        [args.username, hash_password(args.password), args.name, args.role],
    )
    print(f"✅ Usuario creado: {args.username} ({args.role})")
    return 0


def cmd_list(_: argparse.Namespace) -> int:
    rows = fetch_all(
        """SELECT username, role, is_active, full_name,
                  to_char(last_login_at, 'YYYY-MM-DD HH24:MI') AS last_login
             FROM admin_users
            ORDER BY created_at"""
    )
    if not rows:
        print("(no hay usuarios en admin_users — solo el ADMIN_USER del .env funciona)")
        return 0
    print(f"{'USERNAME':<24} {'ROL':<10} {'ACTIVO':<7} {'ÚLTIMO LOGIN':<18} NOMBRE")
    print("-" * 80)
    for r in rows:
        active = "sí" if r["is_active"] else "NO"
        last = r["last_login"] or "—"
        name = r["full_name"] or ""
        print(f"{r['username']:<24} {r['role']:<10} {active:<7} {last:<18} {name}")
    return 0


def _set_active(username: str, active: bool) -> int:
    res = execute(
        "UPDATE admin_users SET is_active = %s WHERE LOWER(username) = LOWER(%s)",
        [active, username],
    )
    if res == 0:
        print(f"Usuario '{username}' no existe.", file=sys.stderr)
        return 1
    print(f"✅ Usuario '{username}' {'habilitado' if active else 'deshabilitado'}.")
    return 0


def cmd_disable(args: argparse.Namespace) -> int:
    return _set_active(args.username, False)


def cmd_enable(args: argparse.Namespace) -> int:
    return _set_active(args.username, True)


def cmd_reset(args: argparse.Namespace) -> int:
    res = execute(
        "UPDATE admin_users SET password_hash = %s WHERE LOWER(username) = LOWER(%s)",
        [hash_password(args.password), args.username],
    )
    if res == 0:
        print(f"Usuario '{args.username}' no existe.", file=sys.stderr)
        return 1
    print(f"✅ Password de '{args.username}' actualizada.")
    return 0


def cmd_delete(args: argparse.Namespace) -> int:
    res = execute(
        "DELETE FROM admin_users WHERE LOWER(username) = LOWER(%s)",
        [args.username],
    )
    if res == 0:
        print(f"Usuario '{args.username}' no existe.", file=sys.stderr)
        return 1
    print(f"🗑️  Usuario '{args.username}' eliminado.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="cli_users", description="Gestión de admin_users")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("add", help="Crear nuevo usuario")
    a.add_argument("username")
    a.add_argument("password")
    a.add_argument("--role", default="operator", choices=sorted(VALID_ROLES))
    a.add_argument("--name", default=None)
    a.set_defaults(func=cmd_add)

    sub.add_parser("list", help="Listar usuarios").set_defaults(func=cmd_list)

    d = sub.add_parser("disable", help="Deshabilitar usuario")
    d.add_argument("username")
    d.set_defaults(func=cmd_disable)

    e = sub.add_parser("enable", help="Habilitar usuario")
    e.add_argument("username")
    e.set_defaults(func=cmd_enable)

    r = sub.add_parser("reset-password", help="Cambiar password")
    r.add_argument("username")
    r.add_argument("password")
    r.set_defaults(func=cmd_reset)

    rm = sub.add_parser("delete", help="Eliminar usuario")
    rm.add_argument("username")
    rm.set_defaults(func=cmd_delete)

    return p


def main(argv=None) -> int:
    init_pool()
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
