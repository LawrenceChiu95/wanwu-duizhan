"""Judge publisher. Node, web and navigation must pass before any release action.

Release commands require --state-dir so a new release cannot overwrite old evidence.
`checks BUILD` runs only the local gates, without contacting the release service.
`publish` waits for the new public build and verifies photo health and quota.
This script does not grant permission to deploy a new candidate.
"""

import json
import os
from pathlib import Path
import re
import runpy
import sys
import subprocess
import shlex
import time
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
QA = None
if len(sys.argv) > 2 and sys.argv[1] == '--state-dir':
    QA = Path(sys.argv[2]).resolve(strict=True)
    del sys.argv[1:3]
PRIOR = Path('/Users/lawrence/Desktop/My Life/Game Building/万物对战/开发归档/魔搭接线/评委版换版-2d8081d')
previous = runpy.run_path(str(PRIOR / 'verify-release.py'))
git = previous['git']
revision = previous['revision']
remote_head = previous['remote_head']
metadata = previous['metadata']
judge = previous['JUDGE']
judge_url = previous['JUDGE_URL']
judge_space = previous['JUDGE_SPACE']
baseline_source = 'ce64f253458d4e71be4f2545a032cde6d38d0aeb'
old = '13d950c663059e5f7b0efccb24c4081f27c556dd'
old_entry = 'assets/index-B-a5oaRG.js'
fallback = {'source': 'cb16254', 'commit': '3b7900fb50a5565fa636c9ba0be28ba893f8b2d5',
            'entry': 'assets/index-B8OQpjSH.js'}
rollback_name = 'rollback-' + old[:7] + '.tar.gz'


def release_checks(build_path):
    # Keep the local Node command identical to CI, including future added test files.
    workflow = (ROOT / '.github/workflows/node-tests.yml').read_text()
    commands = re.findall(r'^\s*- run: (node --test .+)$', workflow, re.MULTILINE)
    assert len(commands) == 1, 'Expected exactly one CI Node test command'
    build = Path(build_path).resolve(strict=True)
    assert (build / 'index.html').is_file()
    checks = [('node', shlex.split(commands[0])), ('web', ['npm', 'test', '--prefix', 'web']),
              ('navigation', ['node', str(ROOT / 'scripts/check-judge-navigation.mjs'), str(build)])]
    for name, command in checks:
        started = time.monotonic()
        result = subprocess.run(['nice', '-n', '20', *command], cwd=ROOT)
        print(json.dumps({'check': name, 'command': shlex.join(command), 'exit': result.returncode,
                          'seconds': round(time.monotonic() - started, 3)}), flush=True)
        result.check_returncode()


def read(name):
    assert QA is not None, 'Release commands require --state-dir with a new evidence directory'
    return json.loads((QA / name).read_text())


def save(name, value):
    assert QA is not None, 'Release commands require --state-dir with a new evidence directory'
    (QA / name).write_text(json.dumps({'at': previous['now'](), **value}, indent=2) + '\n')


def observe():
    return {'platform': previous['platform'](judge_space), **previous['sample'](judge_url)}


def assert_live(entry):
    assert observe() == {'platform': {'status': 'Running', 'sdk': 'docker'}, 'http': 200, 'entry': entry}


def wait_for_live(entry):
    deadline = time.monotonic() + 360
    while time.monotonic() < deadline:
        try:
            status = observe()
        except (OSError, AssertionError, ValueError):
            time.sleep(6)
            continue
        if status == {'platform': {'status': 'Running', 'sdk': 'docker'}, 'http': 200, 'entry': entry}:
            return
        time.sleep(6)
    raise RuntimeError(f'Judge rollout did not serve {entry} within six minutes')


class NoPhotoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PhotoCheckError(RuntimeError):
    def __init__(self, message, gateway_unreachable=False):
        super().__init__(message)
        self.gateway_unreachable = gateway_unreachable


def photo_json(origin, path, method='GET', token=None):
    headers = previous['HEADERS'].copy()
    if token is not None:
        headers['X-Shoot-Session'] = token
    request = Request(origin + path, method=method, data=b'' if method == 'POST' else None, headers=headers)
    try:
        with build_opener(NoPhotoRedirects()).open(request, timeout=8) as response:
            payload = json.load(response)
    except HTTPError as error:
        unreachable = False
        with error:
            if error.code == 503:
                try:
                    result = json.load(error)['error']
                    unreachable = result.get('code') == 'server' and result.get('charged') is False
                except (ValueError, TypeError, KeyError, AttributeError, OSError):
                    pass
        raise PhotoCheckError(f'{origin}{path} returned HTTP {error.code}', unreachable) from None
    except OSError:
        raise PhotoCheckError(f'{origin}{path} is unreachable', gateway_unreachable=True) from None
    except ValueError:
        raise PhotoCheckError(f'{origin}{path} did not return JSON') from None
    if not isinstance(payload, dict):
        raise PhotoCheckError(f'{origin}{path} returned an unexpected JSON value')
    return payload


def photo_health(origin):
    health = photo_json(origin, '/api/shoot/health')
    proxy = health.get('recognitionProxy')
    if (health.get('status') != 'ok' or health.get('provider') != 'real'
            or not isinstance(proxy, dict) or proxy.get('reachable') is not True):
        raise PhotoCheckError(f'{origin}/api/shoot/health did not report a healthy real photo backend')


def public_photo_quota():
    photo_health(judge_url)
    session = photo_json(judge_url, '/api/shoot/session', method='POST')
    token = session.get('token')
    if not isinstance(token, str) or re.fullmatch(r'[a-f0-9-]{36}\.[a-f0-9]{64}', token) is None:
        raise PhotoCheckError('Public photo session did not return a valid session token')
    quota = photo_json(judge_url, '/api/shoot/quota', token=token)
    recognition = quota.get('recognition')
    if quota.get('provider') != 'real' or not isinstance(recognition, dict):
        raise PhotoCheckError('Public photo quota did not describe the real generation and recognition allowances')
    for allowance in (quota, recognition):
        remaining, limit = allowance.get('remaining'), allowance.get('limit')
        if type(remaining) is not int or type(limit) is not int or not 0 <= remaining <= limit:
            raise PhotoCheckError('Public photo quota returned an invalid allowance')
    return {'generationRemaining': quota['remaining'], 'recognitionRemaining': recognition['remaining']}


def verify_public_photo(recover):
    # Raft #万物对战:b88b2fec msg=75fc9f4c. The deployed gateway can lose frpc
    # during a frontend swap. Confirm the local backend is alive before signalling frpc.
    try:
        return {'reconnected': False, **public_photo_quota()}
    except PhotoCheckError as error:
        if not recover or not error.gateway_unreachable:
            raise
        gateway = photo_json(judge_url, '/_health')
        if gateway != {'service': 'wanwu-studio', 'role': 'transport-only'}:
            raise
        photo_health('http://127.0.0.1:4331')

    service = f'gui/{os.getuid()}/com.lawrence.wanwu-frpc'
    print('Public photo gateway lost its tunnel. Reconnecting the existing frpc service once.', flush=True)
    subprocess.run(['launchctl', 'kill', 'SIGTERM', service], check=True, timeout=10)
    # Give KeepAlive and the proxy registration time to complete.
    deadline = time.monotonic() + 30
    while True:
        try:
            return {'reconnected': True, **public_photo_quota()}
        except PhotoCheckError as error:
            if not error.gateway_unreachable or time.monotonic() >= deadline:
                raise PhotoCheckError(f'Public photo check still failed after reconnecting frpc: {error}') from None
            time.sleep(2)


def deploy(commit, entry):
    status = observe()
    if status['platform']['status'] == 'Running' and status['entry'] != entry:
        return {'commit': commit, 'trigger': 'deploy', **previous['platform'](judge_space, deploy=True)}
    return {'commit': commit, 'trigger': 'push', **status}


def preflight():
    assert revision(judge) == remote_head(judge) == old
    assert not git(judge, 'status', '--porcelain')
    assert_live(old_entry)
    files = previous['tree'](judge, old)
    results = previous['public_files'](judge_url, previous['committed_web'](files))
    assert all(row['match'] for row in results), [row['path'] for row in results if not row['match']]
    services = previous['services']()
    assert QA is not None, 'preflight requires --state-dir'
    rollback = QA / rollback_name
    rollback.write_bytes(git(judge, 'archive', '--format=tar.gz', old))
    # Retain the previous approved escape hatch as well as this release's immediate rollback.
    fallback_files = previous['tree'](judge, fallback['commit'])
    assert 'web/' + fallback['entry'] in fallback_files
    (QA / 'fallback-cb16254.tar.gz').write_bytes(git(judge, 'archive', '--format=tar.gz', fallback['commit']))
    save('judge-baseline-preflight.json',
         {'source': baseline_source, 'commit': old, 'entry': old_entry, 'fallback': fallback,
          'files': files, 'public': results, 'processes': services['processes']})
    print(f'Judge baseline {old[:7]}: {len(results)} public files, 4331 and gateway healthy.')


def prepare(source, build_path):
    git(previous['SOURCE'], 'merge-base', '--is-ancestor', baseline_source, source)
    build = Path(build_path).resolve(strict=True)
    index = (build / 'index.html').read_bytes()
    entry = re.search(rb'assets/index-[\w-]+\.js', index).group().decode()
    files = {path.relative_to(build).as_posix(): metadata(path.read_bytes())
             for path in build.rglob('*') if path.is_file()}
    assert entry in files and entry != old_entry
    assert files['assets/bgm-CDABqijo.mp3'] == read('judge-baseline-preflight.json')['files']['web/assets/bgm-CDABqijo.mp3']
    save('judge-candidate-manifest.json', {'source': source, 'build': str(build), 'entry': entry, 'files': files})


def publish():
    candidate = read('judge-candidate-manifest.json')
    # Must pass before checking or mutating the release checkout, and before any push.
    release_checks(candidate['build'])
    manifest = candidate['files']
    baseline = read('judge-baseline-preflight.json')
    rollback_tree = baseline['files']
    gateway = read('judge-candidate-gateway.json')
    assert gateway['checked'] == len(manifest) and not gateway['mismatches']
    assert baseline['commit'] == old and (QA / rollback_name).is_file()
    assert revision(judge) == remote_head(judge) == old
    assert not git(judge, 'status', '--porcelain')
    assert_live(old_entry)
    previous['services']()
    build = Path(candidate['build'])
    old_web = previous['committed_web'](rollback_tree)
    removed = sorted(old_web.keys() - manifest.keys())
    for path, expected in manifest.items():
        assert metadata((build / path).read_bytes()) == expected, path
    if removed:
        git(judge, 'rm', '--', *('web/' + path for path in removed))
    for path, expected in manifest.items():
        if old_web.get(path) == expected:
            continue
        target = judge / 'web' / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((build / path).read_bytes())
    git(judge, 'add', '-A', '--', 'web')
    git(judge, *previous['IDENTITY'], 'commit', '-m',
        f"Deploy reviewed judge candidate ({candidate['source'][:7]})")
    release = revision(judge)
    expected = {name: info for name, info in rollback_tree.items() if not name.startswith('web/')}
    expected.update({'web/' + path: info for path, info in manifest.items()})
    assert previous['tree'](judge, release) == expected
    assert not git(judge, 'status', '--porcelain')
    assert remote_head(judge) == old
    save('judge-candidate-commit.json', {'commit': release, 'source': candidate['source'], 'previous': old})
    git(judge, 'push', 'origin', release + ':refs/heads/master')
    assert remote_head(judge) == release
    save('judge-candidate-deploy.json', deploy(release, candidate['entry']))
    print(f"Judge release pushed: {release[:7]} / {candidate['entry']}", flush=True)
    wait_for_live(candidate['entry'])
    verify(recover_photo=True)


def verify(restore=False, recover_photo=False):
    if restore:
        commit = read('judge-restored.json')['commit']
        entry = old_entry
        files = previous['committed_web'](read('judge-baseline-preflight.json')['files'])
    else:
        commit = read('judge-candidate-commit.json')['commit']
        candidate = read('judge-candidate-manifest.json')
        entry = candidate['entry']
        files = candidate['files']
    assert remote_head(judge) == commit
    assert_live(entry)
    public = previous['public_files'](judge_url, files)
    mismatches = [row['path'] for row in public if not row['match']]
    assert not mismatches, mismatches
    photo = verify_public_photo(recover_photo)
    services = previous['services']()
    same_processes = services['processes'] == read('judge-baseline-preflight.json')['processes']
    save('judge-restored-public.json' if restore else 'judge-public.json',
         {'commit': commit, 'entry': entry, 'processesUnchanged': same_processes, 'files': public, 'photo': photo})
    print(f"Judge {commit[:7]} running, {len(public)} public files match, photo backend healthy. "
          f"New session quota: {photo['generationRemaining']} generation, {photo['recognitionRemaining']} recognition.")


def rollback():
    release = read('judge-candidate-commit.json')['commit']
    assert revision(judge) == remote_head(judge) == release
    assert revision(judge, release + '^') == old
    assert not git(judge, 'status', '--porcelain')
    git(judge, *previous['IDENTITY'], 'revert', '--no-edit', release)
    commit = revision(judge)
    assert revision(judge, 'HEAD^{tree}') == revision(judge, old + '^{tree}')
    git(judge, 'push', 'origin', commit + ':refs/heads/master')
    assert remote_head(judge) == commit
    save('judge-restored.json', deploy(commit, old_entry))
    print(f'Rollback pushed: {commit[:7]}, matches {old[:7]}.')


if __name__ == '__main__':
    commands = {'checks': release_checks, 'preflight': preflight, 'prepare': prepare, 'publish': publish, 'observe': lambda: print(json.dumps(observe())),
                'verify': verify, 'rollback': rollback, 'verify-rollback': lambda: verify(restore=True)}
    commands[sys.argv[1]](*sys.argv[2:])
