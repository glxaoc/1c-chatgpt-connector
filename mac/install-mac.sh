#!/bin/bash
# Установка 1С-коннектора в настольное приложение ChatGPT (раздел Codex) на Mac.
# Запуск: закрыть ChatGPT (Cmd+Q), открыть «Терминал», набрать bash и пробел, перетащить этот файл в окно, нажать Enter.
# Что делает: копирует папку в ~/1c-connector, спрашивает адрес, логин и пароль 1С,
# дописывает блок one-c-odata в ~/.codex/config.toml (первая копия прежнего файла: config.toml.bak-1c) и проверяет связь.

umask 077
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${ONEC_DEST:-$HOME/1c-connector}"
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
CONFIG="$CODEX_DIR/config.toml"
BEGIN="# >>> 1c-connector (создано install-mac.sh)"
END="# <<< 1c-connector"

echo ""
echo "=== Установка 1С-коннектора для ChatGPT на Mac ==="
echo ""

# 1. Node.js
NODE=""
for p in "$ONEC_NODE" /usr/local/bin/node /opt/homebrew/bin/node "$(command -v node 2>/dev/null)"; do
  if [ -n "$p" ] && [ -x "$p" ]; then NODE="$p"; break; fi
done
if [ -z "$NODE" ]; then
  echo "Не нашёл Node.js. Скачайте установщик LTS с https://nodejs.org (файл .pkg), установите и запустите этот скрипт снова."
  exit 1
fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if [ -z "$MAJOR" ] || [ "$MAJOR" -lt 18 ]; then
  echo "Нужен Node.js 18 или новее, сейчас: $("$NODE" -v 2>/dev/null). Поставьте свежий с https://nodejs.org и запустите скрипт снова."
  exit 1
fi
echo "Node.js найден: $NODE ($("$NODE" -v))"

# 2. Конфиг: если подключение уже прописано не этим скриптом, не трогаем
mkdir -p "$CODEX_DIR" || exit 1
touch "$CONFIG" || exit 1
if ! grep -qF "$BEGIN" "$CONFIG" && grep -q '^\[mcp_servers\.one-c-odata' "$CONFIG"; then
  echo "В $CONFIG уже есть подключение one-c-odata, добавленное не этим скриптом."
  echo "Чтобы не испортить настройки, скрипт остановился. Напишите автору коннектора: https://t.me/Ioann_d"
  exit 1
fi

# 3. Копируем программу
if [ "$SRC" != "$DEST" ]; then
  mkdir -p "$DEST" || exit 1
  cp -R "$SRC/." "$DEST/" || { echo "Не удалось скопировать файлы в $DEST"; exit 1; }
fi
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
echo "Программа лежит в $DEST"
echo ""

# 4. Спрашиваем данные
toml() { "$NODE" -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }
yes_answer() { case "$1" in y*|Y*|д*|Д*) return 0 ;; *) return 1 ;; esac; }
unescape_path() { # тильда и экранирование при перетаскивании файла в Терминал
  local s="$1"
  s="$(printf '%s' "$s" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^'\(.*\)'\$/\1/" -e 's/\\\(.\)/\1/g')"
  case "$s" in "~"/*) s="$HOME/${s#\~/}" ;; esac
  printf '%s' "$s"
}
ENV_LINES=""
add() { ENV_LINES="$ENV_LINES$1 = $(toml "$2")"$'\n'; }

URL=""
while [ -z "$URL" ]; do printf "Адрес OData от программиста: "; read -r URL; done
printf "Логин 1С: "; read -r LOGIN
printf "Пароль 1С (символы не видны, это нормально): "; read -rs PASS; echo ""
add ODATA_URL "$URL"
add ODATA_USERNAME "$LOGIN"
add ODATA_PASSWORD "$PASS"

echo ""
printf "1С пускает только адреса из белого списка и нужно ходить через ваш сервер? (да/нет) [нет]: "; read -r USE_SSH
if yes_answer "$USE_SSH"; then
  printf "IP сервера (если порт не 22, через двоеточие): "; read -r SSH_H
  printf "Логин на сервере: "; read -r SSH_U
  printf "Вход на сервер по ключу? (да/нет) [нет]: "; read -r BY_KEY
  SSH_P=""; SSH_K=""
  if yes_answer "$BY_KEY"; then
    while [ -z "$SSH_K" ]; do
      printf "Путь к приватному ключу, обычно ~/.ssh/id_ed25519 или ~/.ssh/id_rsa: "; read -r RAW
      SSH_K="$(unescape_path "$RAW")"
      if [ -n "$SSH_K" ] && [ ! -r "$SSH_K" ]; then echo "Файл не найден: $SSH_K"; SSH_K=""; fi
    done
    printf "Пароль от ключа (пусто, если его нет): "; read -rs SSH_P; echo ""
  else
    printf "Пароль на сервере: "; read -rs SSH_P; echo ""
  fi
  add SSH_HOST "$SSH_H"
  add SSH_USER "$SSH_U"
  [ -n "$SSH_P" ] && add SSH_PASSWORD "$SSH_P"
  [ -n "$SSH_K" ] && add SSH_KEY_PATH "$SSH_K"
fi

# 5. Пишем config.toml
[ -e "$CONFIG.bak-1c" ] || cp "$CONFIG" "$CONFIG.bak-1c"
TMP="$CONFIG.tmp-1c"
awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1;next} $0==e{skip=0;next} !skip' "$CONFIG" > "$TMP" || exit 1
{
  if [ -s "$TMP" ] && [ -n "$(tail -c1 "$TMP")" ]; then echo ""; fi
  echo "$BEGIN"
  echo "[mcp_servers.one-c-odata]"
  echo "command = $(toml "$NODE")"
  echo "args = [$(toml "$DEST/server/index.js")]"
  echo "startup_timeout_sec = 30"
  echo "tool_timeout_sec = 120"
  echo 'default_tools_approval_mode = "writes"'
  echo ""
  echo "[mcp_servers.one-c-odata.env]"
  printf "%s" "$ENV_LINES"
  echo "$END"
} >> "$TMP"
mv "$TMP" "$CONFIG" && chmod 600 "$CONFIG"
echo ""
echo "Настройки записаны в $CONFIG"

# 6. Проверка: читаем то, что записали, и стучимся в 1С
echo ""
echo "Проверяю связь с 1С..."
echo ""
(cd "$DEST" && "$NODE" check.mjs "$CONFIG")
echo ""
echo "Дальше: откройте ChatGPT, перейдите в раздел Codex, начните новую задачу и напишите: проверь связь с 1С"
echo "В обычном чате ChatGPT коннектор не виден."
