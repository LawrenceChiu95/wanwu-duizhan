# Subset the display font (Smiley Sans 得意黑, SIL OFL 1.1) to the characters the page can show.
# Usage: python3 scripts/font-subset.py <SmileySans-Oblique.ttf>   (run from web/; needs fonttools)
# Source: https://github.com/atelier-anchor/smiley-sans/releases (v2.0.1). Re-run after changing UI text.
import glob, subprocess, sys
text = ''.join(open(f, encoding='utf-8').read() for f in ['index.html', *glob.glob('src/*.js')])
text += '0123456789 :：，。·×%/-+!?！？「」（）()ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
keep = sorted({c for c in text if 0x20 <= ord(c) < 0x7f or '　' <= c <= '鿿' or '＀' <= c <= '￯'})
open('/tmp/font-subset-chars.txt', 'w', encoding='utf-8').write(''.join(keep))
subprocess.run([sys.executable, '-m', 'fontTools.subset', sys.argv[1], '--text-file=/tmp/font-subset-chars.txt', '--flavor=woff',
                "--layout-features=*", "--name-IDs=*", "--name-languages=*", '--output-file=src/fonts/smiley-sans-sub.woff'], check=True)
print(len(keep), 'characters')
