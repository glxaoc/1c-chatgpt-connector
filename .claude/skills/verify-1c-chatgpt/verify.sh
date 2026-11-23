#!/usr/bin/env bash
# verify-1c-chatgpt: дымовой прогон 1С-коннектора для ChatGPT (Codex) на подложной 1С, без сети и без настоящих баз.
#
#   verify.sh all      # doctor, затем параллельно: тесты репо + MCP-смоук + сборка ZIP, после сборки установка из ZIP
#   verify.sh doctor   # только чтение: node, зависимости, python, powershell, bash
#   verify.sh tests    # только существующие тесты (tests/run-tests.mjs, свободные порты)
#   verify.sh smoke    # только MCP-смоук сервера из рабочего дерева (секунды)
#   verify.sh props    # тесты на правила (tests/props.mjs --quick) и сравнение с редакцией для Claude (tests/differential.mjs)
#   verify.sh pack     # только сборка ZIP во временной копии + проверка архивов и установка Windows/Mac
#
# Доказательства: $VERIFY_OUT/<дата-время>-<sha>/ (по умолчанию C:/Users/xaoc/1c-chatgpt-connector-out/verify-evidence).
# Временная папка прогона удаляется всегда; dist/ и stage/ репозитория не трогаются.
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SKILL_DIR/../../.." && pwd)"
to_win() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }
OUT_ROOT="${VERIFY_OUT:-C:/Users/xaoc/1c-chatgpt-connector-out/verify-evidence}"
PY="${VERIFY_PYTHON:-python}"
SMOKE="$(to_win "$SKILL_DIR/smoke.mjs")"
export VERIFY_PYTHON="$PY"
export VERIFY_BASH="$(to_win "$BASH")"

WORK=""
cleanup() {
  [ -n "$WORK" ] && [ -d "$WORK" ] || return 0
  # node_modules в копии для сборки: junction на репо. Сначала снять ссылку (os.rmdir не трогает содержимое), потом удалять папку
  if [ -e "$WORK/mirror/node_modules" ]; then
    "$PY" -I -c 'import os,sys; os.rmdir(sys.argv[1]) if os.path.isdir(sys.argv[1]) else os.remove(sys.argv[1])' "$(to_win "$WORK/mirror/node_modules")"
  fi
  if [ -e "$WORK/mirror/node_modules" ]; then echo "cleanup: ссылка node_modules не снята, $WORK оставлен"; return 1; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

new_run() {
  local stamp sha
  stamp="$(date +%Y%m%d-%H%M%S)"; sha="$(git -C "$REPO" rev-parse --short HEAD)"
  RUN="$(to_win "$OUT_ROOT")/$stamp-$sha"; mkdir -p "$RUN"
  {
    echo "branch=$(git -C "$REPO" branch --show-current) sha=$sha node=$(node -v)"
    echo "dirty_files:"; git -C "$REPO" status --short | head -50
  } > "$RUN/meta.txt"
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/verify-1c-chatgpt.XXXXXX")"
}

cmd_doctor() {
  local bad=0
  node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' && echo "node $(node -v)" || { echo "FAIL: нужен Node.js 18+"; bad=1; }
  (cd "$REPO" && npm ls --depth=0 >/dev/null 2>&1) && echo "node_modules: совпадает с package.json" || { echo "FAIL: зависимости не установлены или устарели, выполните npm ci в $REPO"; bad=1; }
  "$PY" --version >/dev/null 2>&1 && echo "$("$PY" --version)" || { echo "FAIL: нет python (нужен для build.py)"; bad=1; }
  if [ -n "${WINDIR:-}" ]; then
    [ -x "$(cygpath -u "${SYSTEMROOT:-C:/Windows}")/System32/WindowsPowerShell/v1.0/powershell.exe" ] && echo "powershell 5.1 есть" || { echo "FAIL: нет powershell.exe (установщик Windows)"; bad=1; }
  fi
  echo "bash: $VERIFY_BASH"
  [ $bad -eq 0 ] && echo "DOCTOR OK" || { echo "DOCTOR FAILED"; return 1; }
}

run_tests() { # $1 = лог
  (cd "$REPO" && node tests/run-tests.mjs) > "$1" 2>&1
}

build_mirror() { # копия рабочего дерева для build.py: dist/ и stage/ репо не трогаем
  local m="$WORK/mirror" t0=$SECONDS
  mkdir -p "$m"
  cp -R "$REPO/INSTALL.bat" "$REPO/README.txt" "$REPO/build.py" "$REPO/package.json" "$REPO/installer" "$REPO/app" "$REPO/server" "$REPO/mac" "$m/"
  if [ -n "${WINDIR:-}" ]; then
    "$PY" -I -c 'import _winapi,sys; _winapi.CreateJunction(sys.argv[1], sys.argv[2])' "$(cygpath -w "$REPO/node_modules")" "$(cygpath -w "$m/node_modules")" || return 1
  else ln -s "$REPO/node_modules" "$m/node_modules"; fi
  (cd "$m" && "$PY" -I build.py) > "$1" 2>&1 || return 1
  echo "build: $((SECONDS - t0)) с" >> "$1"
}

summary_tests() { # печатает итог тестов, код 0/1
  local line; line="$(grep -a 'ИТОГО:' "$1" | tail -1)"
  echo "tests: ${line:-нет строки ИТОГО, см. $1}"
  grep -a '^✘' "$1" | head -10
  [ -n "$line" ] && echo "$line" | grep -q ' 0 упало'
}

cmd_tests() { new_run; local rc=0; run_tests "$RUN/tests.log" || rc=1; summary_tests "$RUN/tests.log" || rc=1; echo "доказательства: $RUN"; return $rc; }

# Тесты на правила (fast-check, короткий режим) и сравнение с редакцией для Claude (соседний репозиторий 1c-connector
# или DIFF_OTHER_REPO). Если соседа нет, сравнение пишет «пропущено», это видно в итоге.
run_props() { # $1 = папка доказательств; печатает итог, код 0/1
  local rc=0
  (cd "$REPO" && node tests/props.mjs --quick) > "$1/props.log" 2>&1 || rc=1
  (cd "$REPO" && node tests/differential.mjs) > "$1/differential.log" 2>&1 || rc=1
  # сравнение без второй редакции ничего не доказывает: «пропущено» считаем провалом, если не разрешили явно
  if grep -aq '^СРАВНЕНИЕ: пропущено' "$1/differential.log" && [ "${DIFF_ALLOW_SKIP:-}" != 1 ]; then
    echo "FAIL: сравнение редакций пропущено, второй репозиторий не найден. Задайте DIFF_OTHER_REPO=<путь к 1c-connector> (или DIFF_ALLOW_SKIP=1)"; rc=1
  fi
  grep -a -h '^✘' -A4 "$1/props.log" "$1/differential.log"
  grep -a '^Сравнение:' "$1/differential.log" | tail -1
  echo "props: $(grep -a '^СВОЙСТВА:' "$1/props.log" | tail -1); $(grep -a '^СРАВНЕНИЕ:' "$1/differential.log" | tail -1)"
  return $rc
}
cmd_props() { new_run; local rc=0; run_props "$RUN" || rc=1; echo "доказательства: $RUN"; return $rc; }
cmd_smoke() { new_run; node "$SMOKE" mcp --out "$RUN"; local rc=$?; echo "доказательства: $RUN"; return $rc; }
cmd_pack() {
  new_run; local rc=0
  build_mirror "$RUN/build.log" || { echo "FAIL: build.py упал"; tail -5 "$RUN/build.log"; return 1; }
  node "$SMOKE" pack --dist "$(to_win "$WORK/mirror/dist")" --work "$(to_win "$WORK/pack")" --out "$RUN" || rc=1
  echo "доказательства: $RUN"; return $rc
}

cmd_all() {
  local t0=$SECONDS rc=0 bt_pid tests_pid props_pid
  cmd_doctor || return 1
  new_run
  run_tests "$RUN/tests.log" & tests_pid=$!
  run_props "$RUN" > "$RUN/props.summary" 2>&1 & props_pid=$!
  build_mirror "$RUN/build.log" & bt_pid=$!
  node "$SMOKE" mcp --out "$RUN" > "$RUN/smoke-mcp.log" 2>&1 || rc=1
  tail -1 "$RUN/smoke-mcp.log"; grep -a '^FAIL' "$RUN/smoke-mcp.log"
  if wait "$bt_pid"; then
    tail -2 "$RUN/build.log" | tail -1
    node "$SMOKE" pack --dist "$(to_win "$WORK/mirror/dist")" --work "$(to_win "$WORK/pack")" --out "$RUN" > "$RUN/smoke-pack.log" 2>&1 || rc=1
    tail -1 "$RUN/smoke-pack.log"; grep -a '^FAIL' "$RUN/smoke-pack.log"
  else
    echo "FAIL: build.py упал"; tail -5 "$RUN/build.log"; rc=1
  fi
  wait "$tests_pid"
  summary_tests "$RUN/tests.log" || rc=1
  wait "$props_pid" || rc=1
  cat "$RUN/props.summary"
  echo "доказательства: $RUN"
  echo "ALL: $((SECONDS - t0)) с, rc=$rc"
  echo "ALL: $((SECONDS - t0)) с, rc=$rc" >> "$RUN/meta.txt"
  return $rc
}

case "${1:-all}" in
  all|doctor|tests|smoke|pack|props) "cmd_${1:-all}" ;;
  *) echo "usage: $0 {all|doctor|tests|smoke|pack|props}"; exit 2 ;;
esac
