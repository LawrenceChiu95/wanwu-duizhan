from pathlib import Path
from statistics import median
import json, hashlib, gzip

root = Path(__file__).resolve().parents[3]
out = root / 'test/v3-top/v13/attribution-r3'
read = lambda p: json.loads(p.read_text())
summary = read(out / 'summary.json')
manifest = read(out / 'manifest.json')
rows = [json.loads(s) for s in (out / 'rounds.ndjson').read_text().splitlines()]
prior = [json.loads(s) for s in (out.parent / 'results-r3/rounds.ndjson').read_text().splitlines()]
old = [r for r in prior if r['stage'] == 'feel' and r['mode'] == 'B' and r['version'] == 'v12']
current = [r for r in prior if r['stage'] == 'feel' and r['mode'] == 'B' and r['version'] == 'v13']
assert len(rows) == len({(r['variant'], r['fixture'], r['seed']) for r in rows}) == 1500
cur = {(r['fixture'], r['seed']): r for r in current}
by = {g['id']: g for g in summary['summary']}
for ident, rs in [('v12', old), ('v13', current)] + [(v['id'], [r for r in rows if r['variant'] == v['id']]) for v in manifest['variants']]:
    assert len(rs) == 300
    g = by[ident]
    assert g['over40'] == sum(r['duration'] > 40 for r in rs)
    assert g['under20'] == sum(r['duration'] < 20 for r in rs)
    assert g['pacePass'] == sum(bool(r['pacePass']) for r in rs)
    for value, field in [('durationMedian','duration'), ('separationMedian','separationMedian'), ('approachMedian','approachMedian')]:
        assert g[value] == median(r[field] for r in rs), (ident, value)
for variant in ['dash-follow', 'long-block-refund-empty']:
    assert all(r['replaySha256'] == cur[r['fixture'],r['seed']]['replaySha256'] for r in rows if r['variant'] == variant)
    assert all(not any(a['press'] for a in r['actions']) for r in rows if r['variant'] == variant)
for file, digest in manifest['frozen'].items():
    assert hashlib.sha256((root / file).read_bytes()).hexdigest() == digest, file

# The fixed-orientation intervention must reproduce the already archived r2 functional rows.
r2 = {(r['fixture'],r['seed']):r for r in map(json.loads,(out.parent / 'results-r2/rounds.ndjson').read_text().splitlines()) if r['stage'] == 'feel' and r['mode'] == 'B' and r['version'] == 'v13'}
fields = ['winner','reason','duration','first','medianGap','maxGap','hits','pacePass','approachMedian','separationMedian','residual','actions']
matched = 0
for r in rows:
    if r['variant'] == 'no-global-half-turn':
        reference = r2[r['fixture'],r['seed']]
        assert all(r[f] == reference[f] for f in fields), (r['fixture'],r['seed'])
        matched += 1
assert matched == 300
clash = [r for r in rows if r['variant'] == 'no-double-clash']
assert all(all(r[f] == cur[r['fixture'],r['seed']][f] for f in fields) for r in clash)
joint = [json.loads(s) for s in (out / 'joint-rounds.ndjson').read_text().splitlines()]
joint_summary = read(out / 'joint-summary.json')
old_map = {(r['fixture'],r['seed']):r for r in old}
assert len(joint) == len({(r['fixture'],r['seed']) for r in joint}) == 300
assert all(r['duration'] == old_map[r['fixture'],r['seed']]['duration'] for r in joint)
assert joint_summary['over40'] == sum(r['duration'] > 40 for r in joint) == 76
assert joint_summary['normalizedFullShaSameAsLegacy'] == sum(r['normalizedFullShaSameAsLegacy'] for r in joint) == 298
joint_differences = [{'fixture':r['fixture'],'seed':r['seed'],'changedFields':{f:[old_map[r['fixture'],r['seed']][f],r[f]] for f in fields if old_map[r['fixture'],r['seed']][f] != r[f]}} for r in joint if not r['normalizedFullShaSameAsLegacy']]
assert hashlib.sha256((root / 'test/v3-top/v13/attribute-auto-b-joint.mjs').read_bytes()).hexdigest() == joint_summary['toolSha']
assert hashlib.sha256((root / 'test/v3-top/v13/attribute-auto-b.mjs').read_bytes()).hexdigest() == manifest['toolSha']
legacy_proofs = read(out / 'legacy-replay-verification.json')
for proof in legacy_proofs['proofs']:
    packed = (out / proof['file']).read_bytes()
    assert hashlib.sha256(packed).hexdigest() == proof['gzipSha256']
    assert hashlib.sha256(gzip.decompress(packed)).hexdigest() == proof['replaySha256']
receipt = {'legacyCompleteReplaysVerified':len(legacy_proofs['proofs']),'batchToolShaVerified':True,'rows':len(rows),'unique':len(rows),'pythonRecomputedGroups':7,'manualNoopFullShaPairs':600,'clashOffMeasuredFieldsEqual':300,'fixedOrientationMatchesArchivedR2':matched,'fieldsComparedToR2':fields,'jointRows':300,'jointDurationExactlyLegacy':300,'jointFullShaAfterNamedMetadataNormalization':298,'jointDifferences':joint_differences,'frozenSources':manifest['frozen']}
(out / 'independent-audit.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(receipt,ensure_ascii=False))
