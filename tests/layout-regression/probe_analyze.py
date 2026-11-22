#!/usr/bin/env python3
"""Phân tích JSON đầu dò dàn trang: python3 analyze.py <dir> [--detail]"""
import json, sys, glob, os, re, statistics as st
from collections import defaultdict

D = sys.argv[1]
DETAIL = '--detail' in sys.argv
issues = defaultdict(list)
stats = defaultdict(int)

def inter(a, b):
    x0 = max(a[0], b[0]); y0 = max(a[1], b[1]); x1 = min(a[0]+a[2], b[0]+b[2]); y1 = min(a[1]+a[3], b[1]+b[3])
    return max(0, x1-x0) * max(0, y1-y0)

for f in sorted(glob.glob(os.path.join(D, '*.json'))):
    book = os.path.basename(f).rsplit('_', 1)[0]
    try: r = json.load(open(f))
    except Exception: continue
    for pg, o in r.get('pages', {}).items():
        key = f'{book} p{pg}'
        stats['pages'] += 1
        if 'err' in o: issues['ERROR'].append((key, o['err'][:120])); continue
        if o.get('scanned'): stats['scanned'] += 1; continue
        pr = o.get('probe')
        if not pr: stats['noprobe'] += 1; continue
        stats['probed'] += 1
        W, H = pr['W'], pr['H']
        plans = pr['plans']
        if pr.get('overflow'): issues['OVERFLOW'].append((key, pr['overflow']))
        # cỡ chữ thân bài
        body = [p for p in plans if p['ol'] >= 3 and not p['cap'] and p['al'] in ('justify', 'left') and not p['bold']]
        if body:
            sz = defaultdict(list)
            for p in body: sz[round(p['os'])].append(p)
            for k, ps in sz.items():
                sc = [p['s']/p['os'] for p in ps]
                if min(sc) < 0.80: issues['SHRINK<0.80'].append((key, f"os={k} min={min(sc):.2f} '{min(ps,key=lambda p:p['s']/p['os'])['t'][:40]}'"))
                if len(ps) >= 2 and max(sc) - min(sc) > 0.06:
                    issues['SIZE_SPREAD'].append((key, f"os={k} {min(sc):.2f}..{max(sc):.2f}"))
                lhs = [p['lh'] for p in ps]
                if len(ps) >= 2 and max(lhs) - min(lhs) > 0.1: issues['LINEH_SPREAD'].append((key, f"os={k} lh {min(lhs)}..{max(lhs)}"))
        for p in plans:
            if p['split']: issues['WORD_SPLIT'].append((key, f"'{p['t'][:40]}' w={p['w']} s={p['s']} n={p['split']}"))
            if p['al'] == 'justify' and len(p['fills']) >= 2:
                bad = [x for x in p['fills'][:-1] if x < 0.70]
                if bad and p['w'] > 8*p['s']: issues['LOOSE_JUSTIFY'].append((key, f"'{p['t'][:40]}' fills={min(bad):.2f} x{len(bad)}"))
            # mảnh trôi nổi: khối 1 dòng ngắn, bắt đầu chữ thường (phần còn lại của câu)
            if p['ol'] == 1 and p['words'] <= 4 and re.match(r'^[a-z]', p['t']) and not p['bold']:
                issues['FRAGMENT'].append((key, f"'{p['t'][:40]}'"))
            if p['x'] < -2 or p['y'] < -2 or p['x']+p['w'] > W+2 or p['y']+p['h'] > H+2:
                issues['OFFPAGE'].append((key, f"'{p['t'][:30]}'"))
            if p['s'] < 0.6*p['os'] and p['ol'] <= 2:
                issues['SHRINK_SMALL<0.6'].append((key, f"'{p['t'][:40]}' {p['s']}/{p['os']}"))
        boxes = [(p['x'], p['y'], p['w'], p['h'], p['t'], p['s']) for p in plans]
        for i in range(len(boxes)):
            for j in range(i+1, len(boxes)):
                a, b = boxes[i], boxes[j]
                ov = inter(a, b)
                if ov > 0.25*min(a[5], b[5])**2 and ov > 0.05*min(a[2]*a[3], b[2]*b[3]):
                    issues['OVERLAP'].append((key, f"'{a[4][:25]}' x '{b[4][:25]}' {ov}"))
            for k in pr.get('kept', []):
                kb = (k['x'], k['y'], k['w'], k['h'])
                ov = inter(boxes[i], kb)
                if ov > 0.3*k['s']**2 and ov > 0.15*kb[2]*kb[3]:
                    issues['OVERLAP_KEPT'].append((key, f"'{boxes[i][4][:25]}' x kept '{k['t'][:15]}'"))

print(dict(stats))
for k in sorted(issues, key=lambda k: -len(issues[k])):
    v = issues[k]
    pages = sorted(set(x[0] for x in v))
    print(f"\n== {k}: {len(v)} ({len(pages)} pages)")
    for x in (v if DETAIL else v[:12]): print('  ', x[0], '|', x[1])
