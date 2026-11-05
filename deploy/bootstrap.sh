#!/usr/bin/env bash
# One-time setup, run by an administrator. Does not start the application or import data.
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
[[ $# -eq 1 ]] || { echo "Usage: sudo bash deploy/bootstrap.sh /path/to/toga-cards-deploy.pub" >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo "This workflow builds amd64 images; configure an ARM build before using this host." >&2; exit 1; }
for binary in docker nginx python3 ssh-keygen sudo visudo; do command -v "$binary" >/dev/null; done
python3 - <<'PY'
import re,subprocess
v=subprocess.check_output(['docker','compose','version','--short'],text=True)
n=tuple(map(int,re.search(r'(\d+)\.(\d+)',v).groups()))
assert n>=(2,30),'Docker Compose 2.30+ is required for literal secret handling'
PY
nginx -t
ssh-keygen -l -f "$1" >/dev/null
read -r key_type key_data _ < "$1"
[[ $key_type == ssh-ed25519 && $key_data =~ ^[A-Za-z0-9+/=]+$ ]]
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -d -m 0700 /etc/toga-cards /var/lib/toga-cards /var/lib/toga-cards/backups
install -d -m 0755 /usr/local/lib/toga-cards
install -o root -g root -m 0755 "$source_dir/server.py" /usr/local/lib/toga-cards/server.py
install -o root -g root -m 0755 "$source_dir/receive.sh" /usr/local/sbin/toga-cards-receive
install -o root -g root -m 0600 "$source_dir/compose.production.yaml" /etc/toga-cards/compose.yaml
if [[ ! -f /etc/toga-cards/runtime.env ]]; then install -m 0600 "$source_dir/runtime.env.example" /etc/toga-cards/runtime.env; fi
if ! id toga-cards-deploy >/dev/null 2>&1; then
  useradd --home-dir /home/toga-cards-deploy --create-home --shell /bin/bash toga-cards-deploy
fi
[[ $(getent passwd toga-cards-deploy | cut -d: -f6) == /home/toga-cards-deploy ]]
chown root:root /home/toga-cards-deploy
chmod 0755 /home/toga-cards-deploy
install -d -o root -g root -m 0755 /home/toga-cards-deploy/.ssh
printf 'restrict,command="sudo -n /usr/local/sbin/toga-cards-receive" %s %s toga-cards-deployment\n' "$key_type" "$key_data" > /home/toga-cards-deploy/.ssh/authorized_keys
chown root:root /home/toga-cards-deploy/.ssh/authorized_keys
chmod 0644 /home/toga-cards-deploy/.ssh/authorized_keys
sudo_file=$(mktemp)
trap 'rm -f "$sudo_file"' EXIT
printf '%s\n' 'toga-cards-deploy ALL=(root) NOPASSWD: /usr/local/sbin/toga-cards-receive' > "$sudo_file"
visudo -cf "$sudo_file"
install -o root -g root -m 0440 "$sudo_file" /etc/sudoers.d/toga-cards-deploy
docker volume create toga_cards_production_data >/dev/null
install -d -m 0755 /var/www/letsencrypt /etc/nginx/snippets
install -m 0644 "$source_dir/nginx/toga-cards-proxy.conf" /etc/nginx/snippets/toga-cards-proxy.conf
if [[ ! -e /etc/nginx/sites-available/togacards.co.uk ]]; then
  install -m 0644 "$source_dir/nginx/togacards.http.conf" /etc/nginx/sites-available/togacards.co.uk
fi
if [[ ! -e /etc/nginx/sites-enabled/togacards.co.uk ]]; then
  ln -s /etc/nginx/sites-available/togacards.co.uk /etc/nginx/sites-enabled/togacards.co.uk
fi
nginx -t
systemctl reload nginx
printf '%s\n' 'Receiver installed; inventory has NOT been imported and the application has NOT been started.' 'Finish DNS/TLS setup, import the private cutover bundle, then enable GitHub deployment.'
