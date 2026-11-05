"""Extract the checked-in official Topps checklist; fail on unrecognised rows."""
import collections
import hashlib
import json
import pathlib
import re
import pdfplumber

root = pathlib.Path(__file__).resolve().parents[1]
source = root / 'catalog/topps-premier-league-2026-27.pdf'
clubs = ['Arsenal', 'Aston Villa', 'AFC Bournemouth', 'Brentford', 'Brighton & Hove Albion', 'Chelsea', 'Coventry City', 'Crystal Palace', 'Everton', 'Fulham', 'Hull City', 'Ipswich Town', 'Leeds United', 'Liverpool FC', 'Manchester City', 'Manchester United', 'Newcastle United', 'Nottingham Forest', 'Sunderland', 'Tottenham Hotspur']
club_pattern = '|'.join(re.escape(c) for c in sorted(clubs, key=len, reverse=True))
row_pattern = re.compile(r'^(\d+|[A-Za-z0-9]+(?:-[A-Za-z0-9]+| \d+)) (.+?) (' + club_pattern + r')( Rookie)?(?: (\d{4}/\d{2}))?$')
person_pattern = re.compile(r'^(.+?) (' + club_pattern + r')$')
cards, dual_people, dual_ids = [], [], []
section = None
with pdfplumber.open(source) as pdf:
    for page_number, page in enumerate(pdf.pages, 1):
        for line in page.extract_text().splitlines():
            if line.startswith(('Checklists provided', 'product at the time')):
                continue
            if re.fullmatch(r'DA-[A-Z]+', line):
                if not dual_ids or dual_ids[-1] != line:
                    dual_ids.append(line)
                continue
            line = line.replace('GOLDEN BOOT Year Won', 'GOLDEN BOOT')
            match = row_pattern.fullmatch(line)
            if section == 'Dual Autographs' and (person := person_pattern.fullmatch(line)):
                dual_people.append((person[1], person[2], page_number))
            elif match:
                cards.append(dict(number=match[1], player=match[2], club=match[3], variant=section, rookie=bool(match[4]), sourcePage=page_number))
            elif re.fullmatch(r'[A-Z0-9 /&-]+', line):
                section = line.title()
            else:
                raise ValueError(f'Unrecognised page {page_number}: {line}')
assert len(dual_people) == 2 * len(dual_ids) == 20
for index, number in enumerate(dual_ids):
    pair = dual_people[index * 2:index * 2 + 2]
    cards.append(dict(number=number, player=' / '.join(p[0] for p in pair), club=' / '.join(dict.fromkeys(p[1] for p in pair)), variant='Dual Autographs', rookie=False, sourcePage=pair[0][2]))
keys = [(c['variant'], c['number']) for c in cards]
assert len(keys) == len(set(keys)), [k for k,n in collections.Counter(keys).items() if n > 1]
base = [int(c['number']) for c in cards if c['variant'] in ('Base', 'Future Stars')]
assert sorted(base) == list(range(1,301))
catalogue = dict(season='2026/27', collection='Topps Flagship Premier League', sourceUrl='https://cdn.shopify.com/s/files/1/0739/2015/1805/files/26_27_Topps_Flagship_Premier_League_Checklist_2.pdf?v=1784890627', sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), retrievedOn='2026-09-08', cards=cards)
(root / 'catalog/topps-premier-league-2026-27.json').write_text(json.dumps(catalogue, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(dict(total=len(cards), sections=collections.Counter(c['variant'] for c in cards)), indent=2))

