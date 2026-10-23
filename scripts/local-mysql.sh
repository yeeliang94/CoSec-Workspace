#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
ROOT="$PWD/.local"
case "${1:-start}" in
start)
 if [ -f "$ROOT/mysql.pid" ] && kill -0 "$(cat "$ROOT/mysql.pid")" 2>/dev/null; then echo 'Local MySQL is already running.'; exit 0; fi
 if [ ! -x "$ROOT/mysql/bin/mysqld" ]; then echo 'Standalone MySQL not found. See docs/LOCAL_SETUP.md.'; exit 1; fi
 "$ROOT/mysql/bin/mysqld" --no-defaults --basedir="$ROOT/mysql" --datadir="$ROOT/mysql-data" --bind-address=127.0.0.1 --port=3307 --socket="$ROOT/mysql.sock" --pid-file="$ROOT/mysql.pid" --log-error="$ROOT/mysql.log" --mysqlx=OFF --daemonize
 echo 'Local MySQL started at 127.0.0.1:3307.'
 ;;
stop)
 if [ -f "$ROOT/mysql.pid" ]; then kill -TERM "$(cat "$ROOT/mysql.pid")"; echo 'Local MySQL shutdown requested.'; else echo 'Local MySQL is not running.'; fi
 ;;
*) echo 'Usage: sh scripts/local-mysql.sh start|stop'; exit 1;;
esac
