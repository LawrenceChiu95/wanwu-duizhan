"""Keep UV/PBR maps while simplifying Wren's normalized Lux3D sources.
Requires Pillow and pinned gltfpack CLI; generated GLBs need no meshopt decoder.
"""
import io, json, struct, subprocess, hashlib
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data/models'
REPORT = ROOT / 'test/prototype/mobile-assets.json'
receipts = []
for name in ('pan', 'lamp'):
    source = ROOT / f'data/lux3d/{name}-lux3d-pbr.glb'
    data = source.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20+size])
    if any(m.get('alphaMode','OPAQUE') != 'OPAQUE' for m in doc['materials']):
        raise RuntimeError('This JPEG recipe requires opaque source materials')
    binary = bytearray(data[28+size:])
    images = []
    for image in doc['images']:
        view = doc['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        original = Image.open(io.BytesIO(binary[start:start+view['byteLength']]))
        pic = original.convert('RGB')
        pic.thumbnail((1024,1024), Image.Resampling.LANCZOS)
        encoded = io.BytesIO(); pic.save(encoded, format='JPEG', quality=92, optimize=True)
        raw = encoded.getvalue()
        binary.extend(b'\0' * (-len(binary) % 4))
        image['bufferView'] = len(doc['bufferViews'])
        image['mimeType'] = 'image/jpeg'
        doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(raw)})
        binary.extend(raw)
        images.append({'sourceSize':original.size,'outputSize':pic.size,'bytes':len(raw)})
    binary.extend(b'\0' * (-len(binary) % 4)); doc['buffers'][0]['byteLength'] = len(binary)
    js = json.dumps(doc,separators=(',',':')).encode();js += b' ' * (-len(js)%4)
    temp = OUT / f'{name}-lux3d-textures.glb'
    temp.write_bytes(struct.pack('<5I',0x46546c67,2,28+len(js)+len(binary),len(js),0x4e4f534a)+js+struct.pack('<2I',len(binary),0x004e4942)+binary)
    output = OUT / f'{name}-lux3d-mobile.glb'
    subprocess.run(['npm','exec','--yes','--package=gltfpack@1.3.0','--','gltfpack','-i',str(temp),'-o',str(output),'-si','0.14','-kn','-r',str(ROOT / f'test/prototype/{name}-mobile-report.json')],check=True,cwd=ROOT)
    subprocess.run(['ls','-l',str(temp)],check=True)
    subprocess.run(['trash',str(temp)],check=True)
    result = output.read_bytes()
    if len(result)>3_000_000: raise RuntimeError(f'{name} exceeds 3 MB: {len(result)}')
    receipts.append({'item':name,'input':str(source.relative_to(ROOT)),'inputSha256':hashlib.sha256(data).hexdigest(),'output':str(output.relative_to(ROOT)),'sha256':hashlib.sha256(result).hexdigest(),'bytes':len(result),'images':images,'triangleRatio':0.14,'gltfpack':'1.3.0','textureJpegQuality':92})
REPORT.write_text(json.dumps(receipts,ensure_ascii=False,indent=2)+'\n')
print(REPORT.read_text())
