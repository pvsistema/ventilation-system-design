#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  ПВ-Система — установка ПОЛНОГО резервного зеркала на VPS Beget (Ubuntu 22/24)
#
#  Запуск (от root, на чистом VPS):
#     bash /opt/pvs/mirror-server/deploy/install.sh ДОМЕН EMAIL
#  пример:
#     bash /opt/pvs/mirror-server/deploy/install.sh reserv.pv-sistema.ru admin@pv-sistema.ru
#
#  Что делает: PostgreSQL + база pvs, Python-окружение, Node.js и сборка сайта,
#  служба systemd pvs-mirror, nginx, бесплатный SSL Let's Encrypt.
# ═══════════════════════════════════════════════════════════════════════════
set -e
DOMAIN="$1"
EMAIL="$2"
APP=/opt/pvs
MS=$APP/mirror-server

if [ -z "$DOMAIN" ]; then
  echo "Укажите домен: bash install.sh reserv.example.ru admin@example.ru"; exit 1
fi
if [ "$(id -u)" != "0" ]; then echo "Запускайте от root"; exit 1; fi
if [ ! -f "$MS/server.py" ]; then echo "Программа должна лежать в $APP (git clone ... $APP)"; exit 1; fi

echo "== 1/7 Системные пакеты =="
apt-get update -y
apt-get install -y python3 python3-venv python3-pip postgresql nginx certbot python3-certbot-nginx git curl
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "== 2/7 База данных PostgreSQL =="
if [ ! -f "$MS/.env" ]; then
  DBPASS=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)
  sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='pvs'" | grep -q 1 \
    || sudo -u postgres psql -c "CREATE USER pvs WITH PASSWORD '$DBPASS';"
  sudo -u postgres psql -c "ALTER USER pvs WITH PASSWORD '$DBPASS';"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='pvs'" | grep -q 1 \
    || sudo -u postgres psql -c "CREATE DATABASE pvs OWNER pvs;"
  cp "$MS/env.example" "$MS/.env"
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://pvs:$DBPASS@127.0.0.1:5432/pvs|" "$MS/.env"
  chmod 600 "$MS/.env"
  echo ">>> Создан $MS/.env — ОБЯЗАТЕЛЬНО впишите ADMIN_PASSWORD и OFFLINE_KEY_PRIVATE"
fi

echo "== 3/7 Python-окружение =="
python3 -m venv "$MS/.venv"
"$MS/.venv/bin/pip" install --upgrade pip
"$MS/.venv/bin/pip" install -r "$MS/requirements.txt"

echo "== 4/7 Таблицы базы =="
"$MS/.venv/bin/python" "$MS/init_db.py"

echo "== 5/7 Сборка сайта =="
bash "$MS/build_site.sh"

echo "== 6/7 Служба pvs-mirror =="
id pvs >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin pvs
mkdir -p "$MS/storage"
chown -R pvs:pvs "$MS/storage" "$MS/.env"
cp "$MS/deploy/pvs-mirror.service" /etc/systemd/system/pvs-mirror.service
systemctl daemon-reload
systemctl enable --now pvs-mirror
systemctl restart pvs-mirror

echo "== 7/7 nginx + SSL =="
sed "s|__DOMAIN__|$DOMAIN|g; s|__ROOT__|$APP/dist|g" "$MS/deploy/nginx.conf" \
  > /etc/nginx/sites-available/pvs-mirror
ln -sf /etc/nginx/sites-available/pvs-mirror /etc/nginx/sites-enabled/pvs-mirror
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
if [ -n "$EMAIL" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect \
    || echo ">>> SSL не выпущен: проверьте, что DNS домена указывает на этот сервер, и повторите: certbot --nginx -d $DOMAIN"
fi

echo
echo "═══════════════════════════════════════════════════════════════"
echo " Готово. Проверка:  https://$DOMAIN/health"
echo " Программа:         https://$DOMAIN/"
echo " Админ-панель:      https://$DOMAIN/admin"
echo " Далее: заполнить $MS/.env и выполнить"
echo "   $MS/.venv/bin/python $MS/sync_from_cloud.py && systemctl restart pvs-mirror"
echo "═══════════════════════════════════════════════════════════════"
