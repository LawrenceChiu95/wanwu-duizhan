"""Targeted regression after the central-camera framing correction."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(__file__).resolve().parents[3] / 'offline-acceptance' / 'kitchen-preview'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':390, 'height':844})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:4335/?mine=knife-wired-v9,out,pot-wired-v9,hug,e180&seed=318', wait_until='networkidle')
    page.locator('#busy').wait_for(state='hidden', timeout=30000)
    page.screenshot(path=str(out/'final-build.png'))
    page.evaluate('window.__top.trackSafe(6)')
    page.locator('#goBtn').click()
    page.locator('#dashBtn').wait_for(state='visible')
    page.locator('#dashBtn').click()
    page.locator('#blockBtn').click()
    page.screenshot(path=str(out/'final-battle.png'))
    page.locator('#result').wait_for(state='visible', timeout=90000)
    safe = page.evaluate('window.__top.safe()')
    print(json.dumps({'safe':safe, 'errors':errors}), flush=True)
    assert not errors, errors
    assert all(value['px'] <= 0 for value in safe.values()), safe
    page.screenshot(path=str(out/'final-result.png'))
    receipt = {'safeOverflow':safe, 'pageErrors':errors, 'testSimulationSpeed':6, 'realTimePerformancePassed':False}
    (out/'framing-receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    browser.close()
