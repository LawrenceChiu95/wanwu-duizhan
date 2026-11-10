"""Exercise the local terminal skin, equipment previews and existing match controls."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(__file__).resolve().parents[3] / 'offline-acceptance' / 'terminal-ui-b'
out.mkdir(exist_ok=True, parents=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:4335/?mine=knife-wired-v9,out,pot-wired-v9,out,e180&seed=318', wait_until='networkidle')
    page.locator('#busy').wait_for(state='hidden', timeout=30000)
    assert page.locator('.module-thumb').evaluate_all('(imgs)=>imgs.every(i=>!i.hidden&&i.complete&&i.naturalWidth===256)')
    sources = page.locator('.module-thumb').evaluate_all('(imgs)=>imgs.map(i=>({id:i.dataset.modelId,path:i.dataset.modelPath}))')
    assert [s['id'] for s in sources] == ['knife-wired-v9', 'pot-wired-v9'], sources
    assert all(s['path'] == f"data/models/generated/{s['id']}.glb" for s in sources), sources
    assert 'cream.png' in page.locator('[data-spread="e180"]').evaluate('(e)=>getComputedStyle(e).borderImageSource')
    assert 'frame.png' in page.locator('.slot').first.evaluate('(e)=>getComputedStyle(e).borderImageSource')
    for width, height in [(320, 740), (390, 844), (1280, 900)]:
        page.set_viewport_size({'width': width, 'height': height})
        page.screenshot(path=str(out / f'assembly-{width}.png'))
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        button = page.locator('#goBtn').bounding_box()
        assert button['y'] >= 0 and button['y'] + button['height'] <= height
    page.set_viewport_size({'width': 390, 'height': 844})
    page.locator('[data-pick="0"]').click()
    page.locator('#sheet').wait_for(state='visible')
    page.screenshot(path=str(out / 'selection.png'))
    original_thumb = page.locator('.module-thumb').first.get_attribute('src')
    page.locator('#sheetGrid button').filter(has_text='枕头').click()
    page.wait_for_function('''() => {const img=document.querySelector('.module-thumb');return img.dataset.modelId==='pillow'&&!img.hidden&&img.complete&&__top.stage.fighters[0].parts[0].item==='pillow';}''')
    assert page.locator('.module-thumb').first.get_attribute('src') != original_thumb
    page.locator('[data-pick="0"]').click()
    page.locator('#sheetGrid button').filter(has_text='改装厨刀').click()
    page.wait_for_function('''() => document.querySelector('.module-thumb').dataset.modelId==='knife-wired-v9'&&__top.stage.fighters[0].parts[0].item==='knife-wired-v9' ''')
    page.locator('[data-spread="e90"]').click()
    assert page.locator('[data-spread="e90"]').get_attribute('aria-checked') == 'true'
    page.locator('[data-spread="e180"]').click()
    page.locator('.slot').first.locator('[data-orient="hug"]').click()
    assert page.locator('.slot').first.locator('[data-orient="hug"]').get_attribute('aria-checked') == 'true'
    page.locator('.slot').first.locator('[data-orient="out"]').click()
    page.evaluate('__top.trackSafe(6)')
    page.locator('#goBtn').click()
    page.locator('#dashBtn').wait_for(state='visible')
    page.locator('#dashBtn').click()
    page.locator('#blockBtn').click()
    page.wait_for_function('__top.status().t>3', timeout=30000)
    page.screenshot(path=str(out / 'battle.png'))
    page.locator('#muteBtn').click()
    page.locator('#muteBtn').click()
    page.locator('#result').wait_for(state='visible', timeout=90000)
    safe = page.evaluate('__top.safe()')
    page.screenshot(path=str(out / 'result.png'))
    assert not errors, errors
    page.locator('#againBtn').click()
    page.locator('#build').wait_for(state='visible')
    assert page.locator('.module-thumb').evaluate_all('(imgs)=>imgs.every(i=>!i.hidden&&i.complete)')
    receipt = {'errors': errors, 'safe': safe, 'sources': sources, 'modelSwitchVerified': True, 'formationSkinAndToggle': True, 'widths': [320, 390, 1280],
               'thumbnailsLoaded': True, 'pickerAndOrientation': True,
               'manualButtonsAndMute': True, 'returnedToBuild': True, 'testSpeed': 6,
               'realPhonePerformanceTested': False}
    (out / 'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(receipt))
    browser.close()
