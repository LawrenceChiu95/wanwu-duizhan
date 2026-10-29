import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Document, NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {runCli} from '../cli.mjs';
import {prepareMesh, validateGlb, sha256} from '../mesh.mjs';
import {timestamps, readJson, saveJson, withLock} from '../state.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const base = JSON.parse(await fs.readFile(path.join(ROOT, 'data/catalog.json'), 'utf8'));
const originalIds = ['scissors','lamp','broom','pot','slipper','pillow','pan-lux3d','lamp-lux3d'];
const originals = base.items.filter(i => originalIds.includes(i.id));
const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwu-import-test-'));
// Isolated files contain only synthetic images/geometry and fake credentials.
// Kept until the OS temp directory is cleared, including on failure for diagnosis.
const image = await sharp({create:{width:1024,height:768,channels:3,background:'#d6a533'}}).png().toBuffer();
async function fixture() {
 const doc = new Document(), buffer = doc.createBuffer();
 const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0, 2,0,0, 0,1,0, 0,0,1, 999,999,999])).setBuffer(buffer);
 const uv = doc.createAccessor().setType('VEC2').setArray(new Float32Array([0,0, 1,0, 0,1, 1,1, 0,0])).setBuffer(buffer);
 const ix = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0,2,1,0,1,3,0,3,2,1,2,3])).setBuffer(buffer);
 const tex = doc.createTexture().setImage(image).setMimeType('image/png');
 const mat = doc.createMaterial('PBR test').setBaseColorTexture(tex).setMetallicFactor(.35).setRoughnessFactor(.7);
 const primitive = doc.createPrimitive().setAttribute('POSITION',pos).setAttribute('TEXCOORD_0',uv).setIndices(ix).setMaterial(mat);
 const node = doc.createNode().setMesh(doc.createMesh().addPrimitive(primitive)).setTranslation([10,-5,3]).setScale([2,3,4]);
 const scene = doc.createScene().addChild(node); doc.getRoot().setDefaultScene(scene);
 return Buffer.from(await new NodeIO().writeBinary(doc));
}
const model = await fixture();
async function sandbox() {
 const root = await fs.mkdtemp(path.join(testRoot,'case-'));
 await fs.mkdir(path.join(root,'data'));
 await saveJson(path.join(root,'data/catalog.json'),{...base,items:structuredClone(originals)});
 const glb = path.join(root,'input.glb'), photo = path.join(root,'photo.png');
 await fs.writeFile(glb,model);await fs.writeFile(photo,image);
 return {root,glb,photo,state: async id => {const runs=await fs.readdir(path.join(root,'.aholo','runs'));return path.join(root,'.aholo','runs',runs.includes(id)?id:runs.find(n=>n.startsWith('photo-')),'state.json');},catalog:() => readJson(path.join(root,'data/catalog.json'))};
}
const args = (s,id='test-pot',mode='photo') => [mode,`--${mode}`,s[mode==='photo'?'photo':'glb'],'--category','pot','--id',id,'--name','测试锅'];
function gateway(options={}) {
 const calls=[];let failed=false,waiting=false,rejected=false;
 const fetch = async (url, request) => {
  const u=new URL(url),route=u.pathname;
  const headers=new Headers(request.headers);
  calls.push({url,request});
  const reply = d => Response.json({c:0,d});
  assert.equal(request.redirect,'error');
  if (u.origin==='https://api.aholo.ai') {
   assert.equal(headers.get('Authorization'),'fake-key-never-persist');
   if(route.endsWith('/asset/v1/token'))return Response.json({ousToken:'fake-upload-token',globalDomain:'https://upload.example',blockSize:options.blocks?64:1000000});
   if(route.endsWith('/task/create')) {
    if(options.unknownCreate)throw Error('fake transport lost create reply with fake-key-never-persist');
    const payload=JSON.parse(request.body);
    if(route.includes('img-to-3d')&&options.rejectMeshOnce&&!rejected){rejected=true;return Response.json({c:'GENERATION_CONCURRENCY_LIMIT_EXCEEDED',d:null});}
    if(route.includes('multimodal-to-image')){assert.equal(payload.img,'https://photo.example/upload.png');assert.ok(payload.prompt.includes('锅'));return reply('image-id');}
    assert.deepEqual(payload,{img:'https://photo.example/styled.png',version:'G1-Turbo',faceCount:100000,enablePbr:true,outputFormat:['zip','glb'],aiPredictSize:false});return reply('mesh-id');
   }
   if(route.endsWith('/task/get')) {
    const isImage=u.searchParams.get('taskid')==='image-id';
    if(options.pollNetworkFailure && !waiting){waiting=true;throw Error('interrupted poll');}
    if(options.failedTask)return reply({status:4});
    if(options.pendingOnce&&!waiting){waiting=true;return reply({status:1});}
    return reply({status:3,outputs:isImage?[{content:'https://photo.example/styled.png'}]:[{content:'https://result.example/other.zip'},{content:'https://result.example/model.glb?signature=private-url'}]});
   }
  } else {
   assert.equal(headers.has('Authorization'),false,'generation key must never reach storage');
   if(u.origin==='https://upload.example') {
    assert.equal(headers.get('ous-token-v2'),'fake-upload-token');
    if(route.endsWith('/init')){assert.equal(request.method,'POST');assert.equal(request.body,undefined);assert.ok(u.searchParams.has('md5'));return reply({taskId:123,deduplicated:false});}
    if(route.endsWith('/single/upload')||route.endsWith('/part')){assert.ok(request.body instanceof FormData);assert.ok((await request.body.get('file').arrayBuffer()).byteLength>0);if(route.endsWith('/part'))assert.ok(Number(request.body.get('block'))>=1);return reply({taskId:123});}
    if(route.endsWith('/status'))return reply({status:5,url:'https://photo.example/upload.png'});
   }
   if(u.origin==='https://result.example'){
    assert.equal(headers.has('ous-token-v2'),false);
    if(options.expired)return new Response('private-url fake-key-never-persist',{status:403});
    if(options.downloadFailure&&!failed){failed=true;throw Error('download interruption');}
    return new Response(model);
   }
  }
  throw Error(`Unexpected fake route ${route}`);
 };
 return {fetch,calls,creates:()=>calls.filter(c=>new URL(c.url).pathname.endsWith('/task/create')).length,downloads:()=>calls.filter(c=>new URL(c.url).origin==='https://result.example').length};
}
const run = (s,argv,g,extra={}) => runCli(argv,{repoRoot:s.root,env:{AHOLO_API_KEY:'fake-key-never-persist'},fetch:g?.fetch,pause:async()=>{},log:()=>{},...extra});

test('offline CLI needs no key: PBR/UV survive, used geometry is centered at category size, originals untouched',async()=>{
 const s=await sandbox(),before=await s.catalog();
 const result=await run(s,args(s,'offline','glb'),null,{env:{},fetch:()=>{throw Error('offline called network');}});
 assert.ok(Math.abs(result.longSideMeters-.38)<1e-8);assert.equal(result.triangles,4);assert.ok(result.hullPoints>=4&&result.hullPoints<=64);
 assert.deepEqual(result.textureSizes,[[512,384]]);
 const catalog=await s.catalog();assert.deepEqual(catalog.items.slice(0,8),before.items);
 const item=catalog.items.at(-1);assert.deepEqual(item.stats,before.items.find(i=>i.id==='pot').stats);assert.equal(item.templateId,'pot');assert.equal(item.comparisonBase,undefined);
 for(let k=0;k<3;k++)assert.ok(Math.abs(item.bounds.min[k]+item.bounds.max[k])<1e-8);
 const bytes=await fs.readFile(path.join(s.root,item.glb));assert.equal(sha256(bytes),item.source.normalizedSha256);
 const doc=await new NodeIO().readBinary(bytes),p=doc.getRoot().listMeshes()[0].listPrimitives()[0];
 assert.ok(p.getAttribute('TEXCOORD_0'));assert.equal(p.getMaterial().getMetallicFactor(),.35);assert.equal(p.getMaterial().getRoughnessFactor(),.7);
 const state=await readJson(await s.state('offline'));assert.equal(Object.keys(state.timestamps).length,8);assert.ok(state.timestamps.inventory_ready);assert.ok(Object.entries(state.timestamps).filter(([k])=>k!=='inventory_ready').every(([,v])=>v===null));
 const again=await run(s,args(s,'offline','glb'),null,{env:{}});assert.equal(again.alreadyImported,true);assert.deepEqual(await s.catalog(),catalog);
});

test('photo dispatch uses fake upload/image/model/download, exactly two paid creates and eight timestamps',async()=>{
 const s=await sandbox(),g=gateway({pendingOnce:true}),logs=[];
 const result=await run(s,args(s),g,{log:s=>logs.push(s)});assert.equal(g.creates(),2);assert.equal(g.downloads(),1);
 const state=await readJson(await s.state('test-pot'));assert.ok(Object.values(state.timestamps).every(v=>!Number.isNaN(Date.parse(v))));
 const publicFiles=JSON.stringify(await s.catalog())+logs.join('');const privateState=JSON.stringify(state);
 for(const secret of ['fake-key-never-persist','fake-upload-token'])assert.ok(!publicFiles.includes(secret)&&!privateState.includes(secret));
 assert.ok(!publicFiles.includes('signature=private-url'));assert.equal(result.triangles,4);
 const before=g.calls.length;assert.equal((await run(s,args(s),g,{env:{}})).alreadyImported,true);assert.equal(g.calls.length,before);
 const renamed=args(s);renamed[renamed.indexOf('--name')+1]='改好名字的锅';await run(s,renamed,g,{env:{}});assert.equal((await s.catalog()).items.at(-1).name,'改好名字的锅');assert.equal(g.calls.length,before);
 const newId=args(s,'renamed-pot');await run(s,newId,g,{env:{}});assert.equal(g.calls.length,before);assert.equal((await s.catalog()).items.at(-1).id,'renamed-pot');
});

test('large-photo block uploads use query init, sequential multipart chunks, and the same pipeline',async()=>{
 const s=await sandbox(),g=gateway({blocks:true});await run(s,args(s),g);
 const chunks=g.calls.filter(c=>new URL(c.url).pathname.endsWith('/part'));
 assert.equal(chunks.length,Math.ceil(image.length/64));
 assert.deepEqual(chunks.map(c=>Number(c.request.body.get('block'))),Array.from({length:chunks.length},(_,i)=>i+1));assert.equal(g.creates(),2);
});

test('unknown creation persists pending; rerun makes no network request and never creates again',async()=>{
 const s=await sandbox(),g=gateway({unknownCreate:true});
 await assert.rejects(run(s,args(s),g),/Network request failed/);assert.equal(g.creates(),1);
 const state=await readJson(await s.state('test-pot'));assert.equal(state.pending,'multimodal-to-image');
 const before=g.calls.length;await assert.rejects(run(s,args(s),g),/Unconfirmed/);assert.equal(g.calls.length,before);assert.equal((await s.catalog()).items.length,8);
});

test('interrupted poll resumes existing image task; download failure retries download without more creation',async()=>{
 const s=await sandbox(),g=gateway({pollNetworkFailure:true,downloadFailure:true});
 await assert.rejects(run(s,args(s),g),/Network request failed/);assert.equal(g.creates(),1);
 await assert.rejects(run(s,args(s),g),/Network request failed/);assert.equal(g.creates(),2);assert.equal(g.downloads(),1);
 await run(s,args(s),g);assert.equal(g.creates(),2);assert.equal(g.downloads(),2);
});

test('failed tasks and expired results stop explicitly; rerunning never regenerates',async()=>{
 for(const settings of [{failedTask:true},{expired:true}]) {
  const s=await sandbox(),g=gateway(settings);
  await assert.rejects(run(s,args(s),g),settings.expired?/HTTP 403/:/task failed/);
  const count=g.creates();await assert.rejects(run(s,args(s),g));assert.equal(g.creates(),count);
  assert.equal((await s.catalog()).items.length,8);
 }
});

function mutateGlb(json) {
 const original=validateGlb(model);json(original);
 const sourceLength=model.readUInt32LE(12),text=Buffer.from(JSON.stringify(original));
 const padded=Buffer.alloc(Math.ceil(text.length/4)*4,0x20);text.copy(padded);
 const chunks=model.subarray(20+sourceLength),header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(20+padded.length+chunks.length,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);
 return Buffer.concat([header,padded,chunks]);
}
test('invalid GLB, external resources and unsupported animated inputs fail before catalog writes',async()=>{
 const s=await sandbox(),before=await s.catalog();
 for(const bad of [Buffer.from('not a GLB'),mutateGlb(j=>j.images[0].uri='https://untrusted.example/steal'),mutateGlb(j=>j.buffers[0].uri='../outside.bin'),mutateGlb(j=>j.animations=[{}]),mutateGlb(j=>j.meshes[0].primitives[0].mode=1)]){
  await fs.writeFile(s.glb,bad);await assert.rejects(run(s,args(s,'bad','glb'),null,{env:{}}));assert.deepEqual(await s.catalog(),before);
 }
});

test('existing IDs, changed run inputs and occupied locks cannot overwrite assets or start paid work',async()=>{
 const s=await sandbox(),g=gateway();
 await assert.rejects(run(s,args(s,'pot','glb'),g),/already exists/);assert.equal(g.calls.length,0);
 await run(s,args(s,'first','glb'),null,{env:{}});
 const changed=args(s,'first','glb');changed[changed.indexOf('--name')+1]='另一个名字';await assert.rejects(run(s,changed,g),/input changed/);assert.equal(g.calls.length,0);
 const folder=path.join(s.root,'.aholo','runs','locked');await fs.mkdir(folder,{recursive:true});await fs.mkdir(path.join(folder,'lock'));
 await assert.rejects(run(s,[...args(s,'locked'),'--run','locked'],g),/Lock already exists/);assert.equal(g.calls.length,0);
});

test('exclusive catalog lock rejects another writer while held and releases after failure',async()=>{
 const s=await sandbox(),lock=path.join(s.root,'exclusive-lock');
 await assert.rejects(withLock(lock,async()=>{await assert.rejects(withLock(lock,async()=>{}),/Lock already exists/);throw Error('interrupted writer');}),/interrupted writer/);
 await withLock(lock,async()=>assert.ok(true));
});

test('checked-in knife, pot, broom meet mobile budgets, original baselines and PBR contract',async()=>{
 for(const id of ['wasteland-knife','wasteland-pot','wasteland-broom']){
  const item=base.items.find(i=>i.id===id);assert.ok(item,id);
  const bytes=await fs.readFile(path.join(ROOT,item.glb));assert.equal(sha256(bytes),item.source.normalizedSha256);validateGlb(bytes);
  const doc=await new NodeIO().readBinary(bytes);let count=0;
  for(const mesh of doc.getRoot().listMeshes())for(const p of mesh.listPrimitives()){count+=(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3;assert.ok(p.getAttribute('TEXCOORD_0'));assert.ok(p.getMaterial()?.getBaseColorTexture());}
  assert.ok(count>=10000&&count<=15000);assert.equal(count,item.source.preparation.triangles);
  assert.ok(item.hull.length>=4&&item.hull.length<=64);assert.ok(item.volume>0);assert.equal(item.mass,base.itemStandards[item.category].massKg);
  for(const texture of doc.getRoot().listTextures()){const meta=await sharp(texture.getImage()).metadata();assert.ok(meta.width<=512&&meta.height<=512);}
 }
});

// Width checks use rendered positions in world coordinates, independent of normalization metadata.
async function endWidths(bytes) {
 const doc=await new NodeIO().readBinary(bytes),points=[];
 for(const node of doc.getRoot().listNodes())for(const p of node.getMesh()?.listPrimitives()??[]){const a=p.getAttribute('POSITION'),m=node.getWorldMatrix();for(const i of new Set(p.getIndices().getArray())){const v=a.getElement(i,[]);points.push([0,1,2].map(k=>m[k]*v[0]+m[k+4]*v[1]+m[k+8]*v[2]+m[k+12]));}}
 const min=Math.min(...points.map(p=>p[2])),max=Math.max(...points.map(p=>p[2]));
 return [-1,1].map(sign=>{const end=points.filter(p=>sign<0?p[2]<=min+(max-min)*.1:p[2]>=max-(max-min)*.1);return Math.max(...[0,1].map(k=>Math.max(...end.map(p=>p[k]))-Math.min(...end.map(p=>p[k]))));});
}
test('orientation follows category for either source sign; checked-in pot/broom heads and weak points face out',async()=>{
 for(const rotate of [false,true])for(const category of ['pot','broom','scissors']){
  const doc=await new NodeIO().readBinary(model);if(rotate)doc.getRoot().listNodes()[0].setRotation([0,1,0,0]);
  const raw=Buffer.from(await new NodeIO().writeBinary(doc)),template=originals.find(i=>i.id===category);
  const result=await prepareMesh(raw,template,base.itemStandards[category]),[minus,plus]=await endWidths(result.bytes);
  assert.ok(category==='scissors'?plus<minus:plus>minus,`${category} source reversed=${rotate}`);
  assert.ok(Math.abs(result.shape.weakPoint.pos[2]-result.shape.bounds.max[2])<1e-8);
 }
 for(const id of ['wasteland-pot','wasteland-broom','wasteland-knife']){
  const item=base.items.find(i=>i.id===id),[minus,plus]=await endWidths(await fs.readFile(path.join(ROOT,item.glb)));
  assert.ok(item.category==='scissors'?plus<minus:plus>minus,id);
  assert.ok(Math.abs(item.weakPoint.pos[2]-item.bounds.max[2])<1e-8);
 }
});
test('changing only name and ID after paid work starts resumes the same default run',async()=>{
 const s=await sandbox(),g=gateway({pollNetworkFailure:true});await assert.rejects(run(s,args(s),g),/Network request failed/);
 const file=await s.state('test-pot'),before=await readJson(file);assert.equal(before.tasks['multimodal-to-image'],'image-id');
 const changed=args(s,'corrected-id');changed[changed.indexOf('--name')+1]='改名后的锅';await run(s,changed,g);
 assert.equal(g.creates(),2);assert.equal((await fs.readdir(path.join(s.root,'.aholo','runs'))).length,1);
 const item=(await s.catalog()).items.at(-1);assert.equal(item.id,'corrected-id');assert.equal(item.name,'改名后的锅');
 const state=await readJson(file);assert.equal(state.tasks['multimodal-to-image'],'image-id');assert.equal(state.tasks['img-to-3d'],'mesh-id');
});
test('explicit concurrency rejection exposes its code; clearing only confirmed pending preserves paid image task',async()=>{
 const s=await sandbox(),g=gateway({rejectMeshOnce:true});await assert.rejects(run(s,args(s),g),/GENERATION_CONCURRENCY_LIMIT_EXCEEDED/);
 const file=await s.state('test-pot'),state=await readJson(file);assert.equal(state.pending,'img-to-3d');assert.equal(state.tasks['multimodal-to-image'],'image-id');
 const count=g.calls.length;await assert.rejects(run(s,args(s),g),/Unconfirmed/);assert.equal(g.calls.length,count);
 // Operator has verified in task history that the rejected mesh task was not created.
 delete state.pending;await saveJson(file,state);await run(s,args(s),g);
 assert.equal(g.calls.filter(c=>c.url.includes('/multimodal-to-image/task/create')).length,1);
 assert.equal(g.calls.filter(c=>c.url.includes('/img-to-3d/task/create')).length,2);
 assert.equal((await readJson(file)).tasks['multimodal-to-image'],'image-id');
});

test('an explicitly selected pre-review photo run may change name/ID without repeating its paid image task',async()=>{
 const s=await sandbox(),g=gateway({pollNetworkFailure:true});await assert.rejects(run(s,args(s),g),/Network request failed/);
 const file=await s.state('test-pot'),state=await readJson(file);state.input={...state.input,id:'test-pot',name:'旧名字'};await saveJson(file,state);
 const oldFolder=path.join(s.root,'.aholo','runs','legacy-run');await fs.rename(path.dirname(file),oldFolder);
 const changed=[...args(s,'corrected-id'),'--run','legacy-run'];changed[changed.indexOf('--name')+1]='更正名字';await run(s,changed,g);
 assert.equal(g.creates(),2);assert.equal(g.calls.filter(c=>c.url.includes('/multimodal-to-image/task/create')).length,1);
 const final=await readJson(path.join(oldFolder,'state.json'));assert.equal(final.input.id,undefined);assert.equal(final.input.name,undefined);assert.equal(final.tasks['multimodal-to-image'],'image-id');
});
