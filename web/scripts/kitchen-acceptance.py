"""Browser acceptance of the local kitchen/mesh composition, without calling any API."""
from pathlib import Path
import io
import json
from PIL import Image
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parents[3] / 'offline-acceptance' / 'kitchen-preview'
OUT.mkdir(parents=True, exist_ok=True)
URL = 'http://127.0.0.1:4335/?mine=knife-wired-v9,out,pot-wired-v9,hug,e180&seed=318'

def magenta_pixels(page):
    shot = Image.open(io.BytesIO(page.screenshot())).convert('RGB')
    return sum(1 for r, g, b in shot.get_flattened_data() if r > 160 and b > 160 and g < 130)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors, asset_failures = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: asset_failures.append(response.status) if response.status >= 400 and any(s in response.url for s in ('.glb', '.spz')) else None)
    page.goto(URL, wait_until='networkidle')
    page.locator('#busy').wait_for(state='hidden', timeout=30000)
    assert page.locator('#error').is_hidden()
    assert page.locator('#kitchenPanel').get_attribute('data-ready') == 'true'
    composition = page.evaluate('''() => {
      const stage = window.__top.stage;
      return {sharedRenderer: stage.kitchen.spark.renderer === stage.renderer,
        sameScene: stage.kitchen.mesh.parent.parent === stage.scene,
        depthTest: stage.kitchen.spark.material.depthTest,
        originalBodies: stage.fighters.length,
        graphicsCanvas: stage.renderer.domElement.id};
    }''')
    assert composition['sharedRenderer'] and composition['sameScene'] and composition['depthTest']
    assert composition['originalBodies'] == 2 and composition['graphicsCanvas'] == 'view'
    print('Shared renderer and scene verified', flush=True)
    page.screenshot(path=str(OUT / 'accepted-build.png'))
    page.locator('#kitchenPanel summary').click()
    page.locator('#inspectKitchen').click()
    assert page.evaluate('window.__top.stage.kitchen.inspection')
    page.locator('#kitchenPanel summary').click()
    page.screenshot(path=str(OUT / 'accepted-room.png'))
    page.locator('#kitchenPanel summary').click()
    page.locator('#inspectKitchen').click()
    assert not page.evaluate('window.__top.stage.kitchen.inspection')
    page.locator('#kitchenPanel summary').click()

    # A real opaque sphere crosses the reconstructed floor. Behind-floor visibility is
    # compared with splats disabled, so a two-layer background imitation would fail.
    page.evaluate('''() => {
      const stage = window.__top.stage, probe = stage.fighters[0].core.clone();
      probe.material = probe.material.clone();
      probe.material.map = probe.material.emissiveMap = null;
      probe.material.onBeforeCompile = () => {};
      probe.material.color.setRGB(1, 0, 1);
      probe.material.emissive.setRGB(1, 0, 1);
      probe.material.metalness = 0;
      probe.material.roughness = 1;
      const direction = stage.camera.getWorldDirection(stage.camera.position.clone());
      probe.position.copy(stage.camera.position).addScaledVector(direction, 1);
      probe.scale.setScalar(1.3);
      stage.scene.add(probe);
      window.__kitchenDepthProbe = {probe, direction};
    }''')
    page.wait_for_timeout(500)
    front_pixels = magenta_pixels(page)
    page.screenshot(path=str(OUT / 'depth-front.png'))
    page.evaluate('''() => {
      const stage = window.__top.stage, {probe, direction} = window.__kitchenDepthProbe;
      probe.position.copy(stage.camera.position).addScaledVector(direction, 8);
      probe.scale.setScalar(8 * 1.3);
    }''')
    page.wait_for_timeout(500)
    behind_pixels = magenta_pixels(page)
    page.screenshot(path=str(OUT / 'depth-behind.png'))
    page.evaluate('''() => {
      const kitchen = window.__top.stage.kitchen;
      kitchen.setVisible(false);
      kitchen.originalBackdrop.forEach(object => { object.visible = false; });
    }''')
    page.wait_for_timeout(500)
    without_splats = magenta_pixels(page)
    page.screenshot(path=str(OUT / 'depth-control.png'))
    print({'frontPixels': front_pixels, 'behindPixels': behind_pixels, 'controlPixels': without_splats}, flush=True)
    assert front_pixels > 200, ('front probe invisible', front_pixels)
    assert without_splats > 200, ('control probe invisible', without_splats)
    assert behind_pixels < without_splats * 0.3, ('floor did not occlude mesh', behind_pixels, without_splats)
    page.evaluate('''() => {
      const stage = window.__top.stage, {probe} = window.__kitchenDepthProbe;
      stage.scene.remove(probe); probe.material.dispose();
      delete window.__kitchenDepthProbe; stage.kitchen.setVisible(true);
      window.__top.trackSafe(6);
    }''')
    page.locator('#goBtn').click()
    print('Complete match started', flush=True)
    page.locator('#dashBtn').wait_for(state='visible', timeout=10000)
    page.locator('#dashBtn').click()
    page.locator('#blockBtn').click()
    page.screenshot(path=str(OUT / 'accepted-battle.png'))
    page.locator('#result').wait_for(state='visible', timeout=90000)
    print('Match result observed', flush=True)
    page.screenshot(path=str(OUT / 'accepted-result.png'))
    result_text = page.locator('#result').inner_text()
    overflow = page.evaluate('window.__top.safe()')
    assert not errors, errors
    assert not asset_failures, asset_failures
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')

    desktop = browser.new_page(viewport={'width': 1280, 'height': 900})
    desktop.goto(URL, wait_until='networkidle')
    desktop.locator('#busy').wait_for(state='hidden', timeout=30000)
    assert desktop.locator('#error').is_hidden()
    desktop.screenshot(path=str(OUT / 'accepted-desktop.png'))
    receipt = {'composition': composition, 'depth': {'frontPixels': front_pixels, 'behindFloorPixels': behind_pixels, 'withoutSplatsPixels': without_splats}, 'result': result_text, 'safeOverflow': overflow, 'pageErrors': errors, 'assetFailures': asset_failures, 'mobileWidth': 390, 'desktopWidth': 1280, 'testSimulationSpeed': 6, 'realTimePerformancePassed': False, 'realPhonePerformanceTested': False}
    (OUT / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(receipt, ensure_ascii=True), flush=True)
    browser.close()
