# so sánh 2 lượt hồi quy: cấu trúc khối + độ khác ảnh
import json,sys,glob,os
from PIL import Image, ImageChops, ImageStat
a,b=sys.argv[1],sys.argv[2]
for f in sorted(glob.glob(f'{b}/*.json')):
  n=os.path.basename(f); fa=f'{a}/{n}'
  if not os.path.exists(fa): print(n,'NEW'); continue
  A=[(x[0][:40],x[5],x[3],x[4],x[8]) for x in json.load(open(fa))]
  B=[(x[0][:40],x[5],x[3],x[4],x[8]) for x in json.load(open(f))]
  sa,sb=set(A),set(B)
  if sa!=sb:
    print(f'--- {n}: {len(A)} -> {len(B)} blocks')
    for x in A:
      if x not in sb: print('   -',x)
    for x in B:
      if x not in sa: print('   +',x)
for f in sorted(glob.glob(f'{b}/*.jpg')):
  n=os.path.basename(f); fa=f'{a}/{n}'
  if not os.path.exists(fa): continue
  ia,ib=Image.open(fa).convert('L'),Image.open(f).convert('L')
  if ia.size!=ib.size: print(n,'size differs'); continue
  d=ImageChops.difference(ia,ib).point(lambda v:255 if v>40 else 0)
  frac=ImageStat.Stat(d).mean[0]/255
  ma=json.load(open(fa.replace('.jpg','.meta')))['ov']; mb=json.load(open(f.replace('.jpg','.meta')))['ov']
  print(f'{n}: diff {frac*100:.2f}%  overflow {ma}->{mb}')
