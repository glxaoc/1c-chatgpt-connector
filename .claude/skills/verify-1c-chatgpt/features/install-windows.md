# Установка Windows

Человек скачивает `1c-connector-for-chatgpt.zip` с GitHub, распаковывает, запускает `INSTALL.bat`, вводит адрес,
логин и пароль 1С. Установщик копирует программу в `%LOCALAPPDATA%\1c-connector`, шифрует пароли DPAPI в
`%APPDATA%\1c-connector\settings.xml`, дописывает блок `[mcp_servers.one-c-odata]` в `~/.codex/config.toml`
и проверяет связь. ChatGPT запускает `node launcher.js`, тот расшифровывает настройки и стартует сервер.

## Sub-features

- `zip`: состав архива, BOM и CRLF у `install.ps1`, `.bat` с CRLF.
- `install`: `-InstallDir`, `-SettingsDir`, `-ConfigToml`, `-ODataUrl …` (автоматический режим).
- `config`: один блок, чужие строки целы, `default_tools_approval_mode = "writes"`, копия `config.toml.bak-1c`.
- `launch`: `command`, `args`, `env` из `config.toml`; `ONEC_SETTINGS` для нестандартной папки настроек.
- `uninstall`: `-Uninstall -Yes` убирает блок, папку программы и `settings.xml`.

## Driving it

smoke `pack`: распаковка ZIP питоном, `powershell.exe -File installer\install.ps1 …` с окружением стенда,
затем MCP-клиент по `config.toml`, затем удаление. Логи: `install-windows.log`, `uninstall-windows.log`,
`config-windows.toml`.

## Gotchas

- Интерактивный путь (Read-Host, winget) не проверяется.
- DPAPI привязан к учётной записи Windows: `settings.xml` из прогона не расшифруется под другим пользователем,
  это нормально.
