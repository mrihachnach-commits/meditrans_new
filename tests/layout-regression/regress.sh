#!/bin/bash
# usage: regress.sh <srcroot> <outdir>   — chạy toàn bộ bộ trang hồi quy với mã nguồn ở <srcroot>
SRC=$1; OUT=$2; mkdir -p $OUT
CASES="nb.pdf:1,2,3,4 nb.pdf:5,6,7 nb.pdf:8,9 bk.pdf:1,2,3,4,5 atlas.pdf:5,12,40,42 atlas.pdf:100,150,200 taf.pdf:17,27 ctvi.pdf:220 ctvi.pdf:12,35 ctvi.pdf:44,48,56 ctvi.pdf:57,68,73 ctvi.pdf:103,108,136 chandoan.pdf:25 abl.pdf:92,213 par.pdf:137 abd.pdf:73"
for c in $CASES; do
  pdf=${c%%:*}; pages=${c##*:}; tag=$(echo ${pdf%.pdf}_$pages | tr ',' '-')
  sed "s#/tmp/v77/#$SRC/#g" /tmp/ct96/e2e7.ts > /tmp/ct96/e2e7_reg.ts
  (cd $SRC && npx esbuild /tmp/ct96/e2e7_reg.ts --bundle --outfile=/tmp/ct96/e2e7r.js --log-level=error)
  echo '<html><head><meta charset="utf-8"></head><body><script src="e2e7r.js"></script></body></html>' > /tmp/ct96/e2e7r.html
  timeout 175 node /tmp/cdp/run4.mjs "http://127.0.0.1:8796/e2e7r.html?pdf=$pdf&pages=$pages" > $OUT/$tag.out 2>&1
  python3 - "$OUT" "$tag" "${pdf%.pdf}" <<'PY'
import json,base64,sys
out,tag,pre=sys.argv[1:4]
t=open(f'{out}/{tag}.out').read()
try:
  i=t.index('ROOT TEXT:'); r=json.loads(json.loads(t[i+10:].strip()).split('|||')[0])
except Exception as e:
  print(tag,'FAILED',t[-300:]); sys.exit()
if r.get('err'): print(tag,'ERR',r['err'][:300])
for p,bl in r['blocks'].items():
  json.dump(bl,open(f'{out}/{pre}_p{p}.json','w'),ensure_ascii=False,indent=0)
for k in list(r):
  if k.startswith('p') and isinstance(r[k],dict) and 'img' in r[k]:
    open(f'{out}/{pre}_{k}.jpg','wb').write(base64.b64decode(r[k]['img'].split(',')[1]))
    json.dump({'ov':r[k].get('ov')},open(f'{out}/{pre}_{k}.meta','w'))
print(tag,'ok')
PY
  rm -rf /tmp/cdp/prof*
done
