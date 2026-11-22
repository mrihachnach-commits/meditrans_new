#!/bin/bash
# sweep.sh <outdir> [books...]
OUT=$1; shift; mkdir -p $OUT
BOOKS=${@:-$(ls /tmp/ct96/bk | sed 's/.pdf$//')}
for b in $BOOKS; do
  N=$(python3 -c "import pypdf,sys;print(len(pypdf.PdfReader('/tmp/ct96/bk/$b.pdf').pages))" 2>/dev/null || echo 100)
  PAGES=$(python3 -c "
N=$N;s=sorted(set([p for p in [1,2,3,4,5,6,8,10,12,15]+[int(N*f) for f in (.12,.2,.28,.35,.42,.5,.58,.65,.72,.8,.88,.95)]+[N-1,N] if 1<=p<=N]));print(' '.join(','.join(map(str,s[i:i+5])) for i in range(0,len(s),5)))")
  i=0
  for chunk in $PAGES; do
    i=$((i+1))
    /tmp/ct96/run8.sh bk/$b.pdf $chunk $OUT/${b}_$i.json 2>&1 | tail -1 | sed "s/^/$b $chunk: /"
  done
done
