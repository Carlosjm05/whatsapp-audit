"""Instancia compartida de Limiter para slowapi.

Vive aquí para evitar circular imports (auth.py y main.py la usan).
"""
from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
