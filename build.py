"""Собирает ZIP «1С-коннектор для приложения ChatGPT (Codex)» из этого репозитория.

Запуск из корня репозитория после `npm install`:
    python build.py
Результат: dist/1c-connector-for-chatgpt.zip
В архив входят только файлы из репозитория и node_modules без нативных модулей и тестов.
Настройки пользователя и пароли в архив не попадают: установщик сохраняет их в профиль Windows."""
import os
import shutil
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = HERE
STAGE = os.path.join(HERE, 'stage', '1c-connector-for-chatgpt')
OUT = os.path.join(HERE, 'dist', '1c-connector-for-chatgpt.zip')

if not os.path.isdir(os.path.join(REPO, 'node_modules')):
    raise SystemExit('Сначала выполните npm install в корне репозитория.')

shutil.rmtree(os.path.join(HERE, 'stage'), ignore_errors=True)
os.makedirs(os.path.join(STAGE, 'app', 'server'))
os.makedirs(os.path.join(STAGE, 'installer'))

for name in ('INSTALL.bat', 'README.txt'):
    shutil.copy(os.path.join(HERE, name), STAGE)
for name in ('install.ps1', 'UNINSTALL.bat'):
    shutil.copy(os.path.join(HERE, 'installer', name), os.path.join(STAGE, 'installer'))
for name in ('launcher.js', 'settings.js', 'selftest.js'):
    shutil.copy(os.path.join(HERE, 'app', name), os.path.join(STAGE, 'app'))
shutil.copy(os.path.join(REPO, 'server', 'index.js'), os.path.join(STAGE, 'app', 'server', 'index.js'))
shutil.copy(os.path.join(REPO, 'package.json'), os.path.join(STAGE, 'app', 'package.json'))
shutil.copytree(os.path.join(REPO, 'node_modules'), os.path.join(STAGE, 'app', 'node_modules'))

# ssh2 работает на чистом JS, собранные под одну ОС нативные модули не нужны
for d in ('cpu-features', 'nan', os.path.join('ssh2', 'lib', 'protocol', 'crypto', 'build')):
    shutil.rmtree(os.path.join(STAGE, 'app', 'node_modules', d), ignore_errors=True)
for root, dirs, _ in os.walk(os.path.join(STAGE, 'app', 'node_modules')):
    for d in list(dirs):
        if d in ('test', 'tests', '__tests__'):
            shutil.rmtree(os.path.join(root, d), ignore_errors=True)
            dirs.remove(d)

# PowerShell 5.1 читает кириллицу без BOM в системной кодировке, поэтому добавляем BOM и приводим переводы строк к Windows
BOM = b'\xef\xbb\xbf'
for rel in ('installer/install.ps1', 'README.txt'):
    p = os.path.join(STAGE, *rel.split('/'))
    data = open(p, 'rb').read().replace(b'\r\n', b'\n')
    if not data.startswith(BOM):
        data = BOM + data
    open(p, 'wb').write(data.replace(b'\n', b'\r\n'))
for rel in ('INSTALL.bat', 'installer/UNINSTALL.bat'):
    p = os.path.join(STAGE, *rel.split('/'))
    open(p, 'wb').write(open(p, 'rb').read().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
if os.path.exists(OUT):
    os.remove(OUT)
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, _, files in os.walk(STAGE):
        for f in files:
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, os.path.dirname(STAGE)).replace(os.sep, '/'))
print(OUT, round(os.path.getsize(OUT) / 1e6, 1), 'МБ')
