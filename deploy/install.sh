#!/usr/bin/env bash
# Lunar server installer — jalankan sebagai root di VPS
set -e

echo "==> 1/5 Cek Node.js"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> 2/5 Pasang file"
mkdir -p /opt/lunar-server
cp -r "$(dirname "$0")/.."/* /opt/lunar-server/ 2>/dev/null || true
cd /opt/lunar-server

echo "==> 3/5 Pasang systemd"
cp deploy/lunar.service /etc/systemd/system/lunar.service
systemctl daemon-reload
systemctl enable lunar
systemctl restart lunar

echo "==> 4/5 Nginx (opsional)"
if command -v nginx >/dev/null 2>&1; then
  cp deploy/nginx.conf /etc/nginx/sites-available/lunar
  ln -sf /etc/nginx/sites-available/lunar /etc/nginx/sites-enabled/lunar
  nginx -t && systemctl reload nginx
else
  echo "   (nginx belum ada — skip, server tetap jalan di :3000)"
fi

echo "==> 5/5 Cek"
sleep 3
curl -s http://127.0.0.1:3000/health || echo "gagal cek health"
echo
echo "SELESAI. Log: journalctl -u lunar -f   /   cat /var/log/lunar.log"
