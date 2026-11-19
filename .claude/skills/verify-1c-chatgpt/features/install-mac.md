# Установка Mac

Человек распаковывает `1c-connector-for-chatgpt-mac.zip`, в «Терминале» запускает `bash install-mac.sh`,
отвечает на вопросы. Скрипт копирует папку в `~/1c-connector`, дописывает блок между маркерами
`# >>> 1c-connector …` и `# <<< 1c-connector` в `~/.codex/config.toml` (пароли прямо в `env`, файл 600) и
вызывает `check.mjs`, который читает этот блок и делает `check_connection`.

## Driving it

smoke `pack`: `bash -c 'cd <папка> && ONEC_DEST="$(pwd)" exec bash ./install-mac.sh'` с ответами в stdin,
`CODEX_HOME` и `ONEC_NODE` из стенда; два запуска подряд, после второго ровно один блок.

## Gotchas

- Запуск идёт из папки распаковки, поэтому копирование `cp -R` не проверяется (иначе плюс 20 с).
- Git Bash показывает Temp как `/tmp`, поэтому путь для `ONEC_DEST` берётся из `pwd` самого bash.
- `xattr` на Windows нет, ошибка подавлена в самом скрипте.
