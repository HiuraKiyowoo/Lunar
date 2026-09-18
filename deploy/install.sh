#!/usr/bin/env bash
#
# Lunar — pemasang di VPS baru.
#
# Setelah selesai, memindahkan server cukup:
#
#     git clone https://github.com/HiuraKiyowoo/Lunar.git
#     cd Lunar
#     sudo bash deploy/install.sh
#
# Semua yang dibutuhkan dipasang di sini: Node, Chromium untuk jalur pemutar,
# layanan systemd, dan (kalau ada) nginx.
#
set -e

# ---- domain & port: ubah di sini kalau pindah alamat ----------------------
DOMAIN="${DOMAIN:-api-lunar.zone.id}"
PORT="${PORT:-3000}"
# ---------------------------------------------------------------------------

DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Pemasangan Lunar"
echo "    folder : $DIR"
echo "    domain : $DOMAIN"
echo "    port   : $PORT"
echo

echo "==> 1/6 Node.js"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> 2/6 Dependensi Node"
cd "$DIR"
# playwright sengaja bukan dependensi wajib; pemasangannya diurus di langkah 3
npm install --omit=optional --no-audit --no-fund 2>/dev/null || true

echo "==> 3/6 Chromium untuk jalur pemutar (engine=play)"
# Jalur HLS membuka halaman pemutar dengan Chromium sungguhan, jadi peramban
# ini WAJIB ada. Tanpa ini /stream?engine=play menjawab "ready": false dan
# aplikasi jatuh ke jalur lama yang tanda tangannya cepat tua.
if ! command -v node >/dev/null 2>&1; then
  echo "    (node belum ada — dilewati)"
else
  npm install playwright@1.63.0 --no-audit --no-fund 2>&1 | tail -2 || true
  if npx playwright install --with-deps chromium 2>&1 | tail -3; then
    echo "    Chromium OK"
  else
    echo "    PERINGATAN: Chromium gagal dipasang."
    echo "    Jalur pemutar tidak akan jalan sampai ini berhasil."
  fi
fi

echo "==> 4/6 Layanan systemd"
# Ganti domain di berkas layanan kalau bukan bawaan.
sed "s/^Environment=PORT=.*/Environment=PORT=$PORT/" deploy/lunar.service \
  > /etc/systemd/system/lunar.service
systemctl daemon-reload
systemctl enable lunar
systemctl restart lunar

echo "==> 5/6 Nginx (opsional)"
if command -v nginx >/dev/null 2>&1; then
  sed "s/lunar\.zone\.id/$DOMAIN/g" deploy/nginx.conf > /etc/nginx/sites-available/lunar
  ln -sf /etc/nginx/sites-available/lunar /etc/nginx/sites-enabled/lunar
  nginx -t && systemctl reload nginx
else
  echo "    (nginx belum ada — server tetap jalan di :$PORT)"
fi

echo "==> 6/6 Pemeriksaan"
sleep 5
echo "--- /health ---"
curl -s "http://127.0.0.1:$PORT/health" || echo "gagal menghubungi server"
echo
echo "--- /health bagian play (harus ready:true) ---"
curl -s "http://127.0.0.1:$PORT/health" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d.get('play',{}),indent=2))" \
  2>/dev/null || echo "(tak bisa dibaca)"
echo
echo "SELESAI."
echo "  Log    : journalctl -u lunar -f   atau   /var/log/lunar.log"
echo "  Uji    : curl 'http://127.0.0.1:$PORT/stream?tmdb=550&type=movie&engine=play'"
echo "  HTTPS  : certbot --nginx -d $DOMAIN"
