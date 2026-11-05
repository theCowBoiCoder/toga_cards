"""Run admin development commands with Linux-native dependency volumes."""
from pathlib import Path
import subprocess,sys
root=Path(__file__).resolve().parent.parent
command=['docker','run','--rm','--mount','type=bind,source='+str(root/'admin')+',target=/app/admin','--mount','type=volume,source=toga_cards_admin_vendor,target=/app/admin/vendor','--mount','type=volume,source=toga_cards_composer_cache,target=/tmp/composer-cache','-e','COMPOSER_CACHE_DIR=/tmp/composer-cache','toga-cards-php-tools',*sys.argv[1:]]
raise SystemExit(subprocess.call(command))
