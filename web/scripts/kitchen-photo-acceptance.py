"""Check the world-space reference plate and a complete local match."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(__file__).resolve().parents[3] / 'offline-acceptance' / 'kitchen-photo'
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors, requests = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: requests.append(r.url))
    page.goto('http://127.0.0.1:4335/?seed=318', wait_until='networkidle')
    page.locator('#busy').wait_for(state='hidden', timeout=30000)
    before = page.evaluate('''() => {
      const s = __top.stage, p = s.kitchen.photo.plate;
      window.plateSnapshot = () => {
        const point = p.position.clone().addScaledVector(s.camera.up, 5).project(s.camera);
        return {position:p.position.toArray(), projected:point.toArray(), fov:s.camera.fov};
      };
      return {worldSpace:p.parent === s.scene, lazy:s.kitchen.mesh === null, ...plateSnapshot()};
    }''')
    assert before['worldSpace'] and before['lazy'], before
    assert not any('.spz' in url for url in requests), 'Image preview downloaded 3DGS'
    page.evaluate('''() => {
      const s = __top.stage, photo = s.kitchen.photo, original = photo.update.bind(photo);
      window.boundsAudit = {edgeOverflow:0, coreCircleRatio:0, frames:0, playSamples:0, insideSamples:0};
      photo.update = dt => {
        original(dt);
        const a = window.boundsAudit, p = photo.plate, c = s.camera;
        p.updateMatrixWorld(true);
        const normal = p.position.clone().set(0,0,1).applyQuaternion(p.quaternion);
        for (const x of [-1,1]) for (const y of [-1,1]) {
          const ray = p.position.clone().set(x,y,0.5).unproject(c).sub(c.position);
          const t = p.position.clone().sub(c.position).dot(normal) / ray.dot(normal);
          const local = p.worldToLocal(c.position.clone().addScaledVector(ray,t));
          a.edgeOverflow = Math.max(a.edgeOverflow, Math.abs(local.x)-0.5, Math.abs(local.y)-0.5);
        }
        for (const f of s.fighters) {
          const pos = f.center.clone().project(c);
          const dx = (pos.x+1)*s.view.w/2 - s.view.w*0.505;
          const dy = (1-pos.y)*s.view.h/2 - photo.lastTargetY;
          const ratio = Math.hypot(dx,dy)/(s.view.w*0.165);
          if (ratio > a.coreCircleRatio) { a.coreCircleRatio = ratio; a.worst = __top.status().phase; }
          if (__top.status().phase === 'play') { a.playSamples++; if (ratio <= 1) a.insideSamples++; }
          if (f.core.scale.x !== 0.7) throw new Error('Core visual scale must be 0.7');
        }
        a.frames++;
      };
    }''')
    page.screenshot(path=str(out / 'accepted-build.png'))
    page.evaluate('__top.trackSafe(6)')
    page.locator('#goBtn').click()
    page.locator('#dashBtn').wait_for(state='visible')
    page.locator('#dashBtn').click()
    page.locator('#blockBtn').click()
    page.wait_for_function('__top.status().t > 3', timeout=30000)
    during = page.evaluate('plateSnapshot()')
    assert before['position'] == during['position'], 'Plate follows camera rather than staying in world'
    assert abs(before['projected'][1] - during['projected'][1]) > 0.0001 or abs(before['fov'] - during['fov']) > 0.01, 'Camera did not move background'
    page.screenshot(path=str(out / 'accepted-battle.png'))
    page.locator('#result').wait_for(state='visible', timeout=90000)
    safe = page.evaluate('__top.safe()')
    bounds = page.evaluate('boundsAudit')
    assert bounds['edgeOverflow'] < 0.00001, bounds
    # The requested region is the main fighting area, not a new physical wall.
    assert bounds['playSamples'] > 0 and bounds['insideSamples'] / bounds['playSamples'] >= 0.90, bounds
    assert all(value['px'] <= 0 for value in safe.values()), safe
    assert not errors, errors
    page.screenshot(path=str(out / 'accepted-result.png'))
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.screenshot(path=str(out / 'accepted-desktop.png'))
    receipt = {'before':before, 'during':during, 'safe':safe, 'bounds':bounds, 'errors':errors,
               'simulationSpeed':6, 'realPhonePerformanceTested':False,
               'backgroundType':'single world-space image plane, no furniture depth'}
    (out / 'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(receipt))
    browser.close()
