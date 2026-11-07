import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {Document, NodeIO} from '@gltf-transform/core';
import {recognizePhoto} from '../shoot/recognition.mjs';
import {photoPrompt} from '../shoot/prompt.mjs';
import {prepareMesh} from '../mesh.mjs';
// Recognition now preprocesses real pixels; the old literal 'fixture' never reached HTTP.
const photo = await sharp({create:{width:32,height:24,channels:3,background:'#abcabc'}}).jpeg().toBuffer();
const recognized = {clear:true, recognizable:true, name:'仙人掌', materialName:'植物', material:'wood', hardness:.5, lengthCm:35, massKg:1.2, condition:'intact', outwardEnd:'wide', basis:'植物在花盆中'};
const response = () => Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(recognized)}]}]});
for (const transient of ['network', 503, 502]) test(`recognition retries ${transient} before success and calls Gemini only`, async () => {
  const waits=[],urls=[];
  const result=await recognizePhoto({photo,key:'fixture-key',pause:async ms=>waits.push(ms),fetch:async url=>{
    urls.push(url);if(urls.length<3){if(transient==='network')throw new TypeError('private transport');return new Response('',{status:transient});}return response();
  }});
  assert.equal(result.name,'仙人掌');assert.deepEqual(waits,[2000,5000]);assert.equal(urls.length,3);
  assert.ok(urls.every(url=>new URL(url).hostname==='generativelanguage.googleapis.com'));
});
for(const status of [401,403,429,400]) test(`recognition does not retry permanent HTTP ${status}`,async()=>{
  let calls=0;await assert.rejects(recognizePhoto({photo,key:'fixture-key',pause:async()=>assert.fail('must not wait'),fetch:async()=>{calls++;return new Response('',{status});}}));assert.equal(calls,1);
});
test('recognition stops at three temporary failures with a safe classified error',async()=>{
  let calls=0;await assert.rejects(recognizePhoto({photo,key:'fixture-key',pause:async()=>{},fetch:async()=>{calls++;throw Error('secret-url-and-key');}}),{code:'recognition-network',message:'recognition-network'});assert.equal(calls,3);
});
test('replacing the style keeps the no-added-base identity constraints',()=>{
  const p=photoPrompt('仙人掌','新的温柔画风');assert.match(p,/不要添加底座、展台、比例尺/);assert.match(p,/保留原花盆/);assert.match(p,/新的温柔画风/);assert.doesNotMatch(p,/工业黄漆/);
});
test('photo import keeps source world Y upright and uses the actual outward end',async()=>{
  const d=new Document(),b=d.createBuffer();
  const a=d.createAccessor().setType('VEC3').setArray(new Float32Array([-1,0,-1,1,0,-1,0,0,1,0,4,0])).setBuffer(b);
  const ix=d.createAccessor().setType('SCALAR').setArray(new Uint16Array([0,2,1,0,1,3,1,2,3,2,0,3])).setBuffer(b);
  d.getRoot().setDefaultScene(d.createScene().addChild(d.createNode().setMesh(d.createMesh().addPrimitive(d.createPrimitive().setAttribute('POSITION',a).setIndices(ix)))));
  const raw=Buffer.from(await new NodeIO().writeBinary(d));
  for(const outwardEnd of ['wide','narrow']){
    const r=await prepareMesh(raw,{id:'photo',outwardEnd,weakPoint:{radius:.01}},{longSideMeters:.4,massKg:1,preserveUp:true});
    const spans=r.shape.bounds.max.map((v,i)=>v-r.shape.bounds.min[i]);assert.equal(spans.indexOf(Math.max(...spans)),1);
    assert.equal(r.shape.normalization.matrix[5],.1);assert.equal(r.shape.normalization.matrix[1],0);assert.equal(r.shape.normalization.matrix[9],0);
    assert.equal(r.shape.outEnd,outwardEnd==='wide'?-1:1);assert.equal(r.shape.normalization.orientation.method,'photo-upright');
    assert.equal(r.shape.weakPoint.pos[1],outwardEnd==='wide'?-0.2:0.2);assert.ok(r.shape.volume>0);
  }
});

test('photo sources keep their topology and UV seam attributes; oversized sources fail before decimation',async()=>{
  const d=new Document(),b=d.createBuffer(),positions=[],uv=[],indices=[];
  // Disconnected tetrahedra have separate atlas islands at the same positions.
  // A collapse must never join their UV islands. 3,000 tetrahedra = 12K faces.
  for(let i=0;i<3000;i++){
    const k=positions.length/3,x=(i%20)*.02,y=(Math.floor(i/20)%20)*.02,z=Math.floor(i/400)*.02;
    positions.push(x,y,z,x+.01,y,z,x,y+.01,z,x,y,z+.01);
    uv.push(0,0,.1,0,0,.1,.1,.1);indices.push(k,k+2,k+1,k,k+1,k+3,k+1,k+2,k+3,k+2,k,k+3);
  }
  const pos=d.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(b),tex=d.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(b);
  const ix=d.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(b);
  const primitive=d.createPrimitive().setAttribute('POSITION',pos).setAttribute('TEXCOORD_0',tex).setIndices(ix);
  const mesh=d.createMesh().addPrimitive(primitive);d.getRoot().setDefaultScene(d.createScene().addChild(d.createNode().setMesh(mesh)));
  const raw=Buffer.from(await new NodeIO().writeBinary(d)),template={id:'photo',weakPoint:{radius:.01}},standard={longSideMeters:.4,massKg:1,preserveUp:true};
  const prepared=await prepareMesh(raw,template,standard),out=await new NodeIO().readBinary(prepared.bytes),p=out.getRoot().listMeshes()[0].listPrimitives()[0];
  assert.equal(prepared.report.triangles,12000);assert.deepEqual(p.getIndices().getArray(),ix.getArray());
  assert.deepEqual(p.getAttribute('TEXCOORD_0').getArray(),tex.getArray());assert.deepEqual(p.getAttribute('POSITION').getArray(),pos.getArray());
  mesh.addPrimitive(primitive.clone());const oversized=Buffer.from(await new NodeIO().writeBinary(d));
  await assert.rejects(prepareMesh(oversized,template,standard),/above 15000; request a low-poly source/);
});
