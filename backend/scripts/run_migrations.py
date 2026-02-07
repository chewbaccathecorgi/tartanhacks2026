#!/usr/bin/env python3
"""
Run backend migrations (001, 002, 003) using DATABASE_URL from config.
No psql needed. From backend/: python scripts/run_migrations.py
"""
from __future__ import annotations

import os
import sys

_script_dir = os.path.dirname(os.path.abspath(__file__))
_backend = os.path.dirname(_script_dir)
if _backend not in sys.path:
    sys.path.insert(0, _backend)

import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

from app.core.config import get_settings


def main() -> int:
    settings = get_settings()
    migrations_dir = os.path.join(_backend, "migrations")
    order = ["001_init.sql", "002_vectors.sql", "003_constraints.sql"]
    conn = psycopg2.connect(settings.database_url)
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    try:
        for name in order:
            path = os.path.join(migrations_dir, name)
            if not os.path.isfile(path):
                print(f"Skip (not found): {name}", file=sys.stderr)
                continue
            with open(path, "r", encoding="utf-8") as f:
                sql = f.read()
            with conn.cursor() as cur:
                cur.execute(sql)
            print(f"OK: {name}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"FAIL: {e}", file=sys.stderr)
        sys.exit(1)
