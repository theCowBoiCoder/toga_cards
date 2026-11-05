#!/bin/sh
set -eu
[ "$#" -eq 0 ] || exit 2
exec /usr/bin/python3 /usr/local/lib/toga-cards/server.py receive
