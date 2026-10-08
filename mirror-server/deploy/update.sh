#!/bin/bash
# Обновление зеркала до свежей версии из GitHub (от root):
#   bash /opt/pvs/mirror-server/deploy/update.sh
set -e
cd /opt/pvs
git pull --ff-only
MS=/opt/pvs/mirror-server
"$MS/.venv/bin/pip" install -q -r "$MS/requirements.txt"
"$MS/.venv/bin/python" "$MS/init_db.py"
bash "$MS/build_site.sh"
systemctl restart pvs-mirror
echo "Зеркало обновлено."
