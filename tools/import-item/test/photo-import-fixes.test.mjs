import test from 'node:test';
import assert from 'node:assert/strict';
import {Document, NodeIO} from '@gltf-transform/core';
import {recognizePhoto} from '../shoot/recognition.mjs';
import {photoPrompt} from '../shoot/prompt.mjs';
import {prepareMesh} from '../mesh.mjs';
const recognized = {clear:true, recognizable:true, name:'仙人掌', materialName:'植物', material:'wood', hardness:.5, lengthCm:35, massKg:1.2, condition:'intact', outwardEnd:'wide', basis:'植物在花盆中'};
const response = () => Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(recognized)}]}]});
for (const transient of ['network', 503, 502]) test(`recognition retries ${transient} before success and calls Gemini only`, async () => {
  const waits=[],urls=[];
  const result=await recognizePhoto({photo:Buffer.from('fixture'),key:'fixture-key',pause:async ms=>waits.push(ms),fetch:async url=>{
    urls.push(url);if(urls.length<3){if(transient==='network')throw new TypeError('private transport');return new Response('',{status:transient});}return response();
  }});
  assert.equal(result.name,'仙人掌');assert.deepEqual(waits,[500,1000]);assert.equal(urls.length,3);
  assert.ok(urls.every(url=>new URL(url).hostname==='generativelanguage.googleapis.com'));
});
for(const status of [401,403,429,400]) test(`recognition does not retry permanent HTTP ${status}`,async()=>{
  let calls=0;await assert.rejects(recognizePhoto({photo:Buffer.from('fixture'),key:'fixture-key',pause:async()=>assert.fail('must not wait'),fetch:async()=>{calls++;return new Response('',{status});}}));assert.equal(calls,1);
});
test('recognition stops at three temporary failures with a safe classified error',async()=>{
  let calls=0;await assert.rejects(recognizePhoto({photo:Buffer.from('fixture'),key:'fixture-key',pause:async()=>{},fetch:async()=>{calls++;throw Error('secret-url-and-key');}}),{code:'recognition-network',message:'recognition-network'});assert.equal(calls,3);
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

test('simplification preserves an interior UV feature that flat geometry cannot describe',async()=>{
  const d=new Document(),b=d.createBuffer(),positions=[],uv=[],indices=[],n=200,qx=.483,qy=.527;
  for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){
    const u=x/n,v=y/n;positions.push(u,v,0);
    uv.push(u+.25*Math.exp(-((u-qx)**2+(v-qy)**2)/.0025),v);
  }
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=y*(n+1)+x;indices.push(i,i+1,i+n+2,i,i+n+2,i+n+1);}
  // Give the otherwise planar test object a nonzero physical volume.
  const tip=positions.length/3;positions.push(.5,.5,-.2);uv.push(.5,.5);
  for(let x=0;x<n;x++)indices.push(tip,x+1,x,tip,n*(n+1)+x,n*(n+1)+x+1);
  for(let y=0;y<n;y++)indices.push(tip,y*(n+1),(y+1)*(n+1),tip,(y+1)*(n+1)+n,y*(n+1)+n);
  const pos=d.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(b),tex=d.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(b);
  const ix=d.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(b);
  d.getRoot().setDefaultScene(d.createScene().addChild(d.createNode().setMesh(d.createMesh().addPrimitive(d.createPrimitive().setAttribute('POSITION',pos).setAttribute('TEXCOORD_0',tex).setIndices(ix)))));
  const raw=Buffer.from(await new NodeIO().writeBinary(d));
  const prepared=await prepareMesh(raw,{id:'photo',weakPoint:{radius:.01}},{longSideMeters:1,massKg:1,preserveUp:true});
  assert.ok(prepared.report.triangles<=15000);assert.ok(prepared.report.triangles<indices.length/3);
  const out=await new NodeIO().readBinary(prepared.bytes),p=out.getRoot().listMeshes()[0].listPrimitives()[0],a=p.getAttribute('POSITION'),t=p.getAttribute('TEXCOORD_0'),ixs=p.getIndices().getArray();
  let centerU;
  for(let i=0;i<ixs.length;i+=3){
    const v=[ixs[i],ixs[i+1],ixs[i+2]],ps=v.map(j=>a.getElement(j,[]));
    if(ps.some(q=>Math.abs(q[2])>1e-7))continue;
    const [[ax,ay],[bx,by],[cx,cy]]=ps,den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-10)continue;
    const wa=((by-cy)*(qx-cx)+(cx-bx)*(qy-cy))/den,wb=((cy-ay)*(qx-cx)+(ax-cx)*(qy-cy))/den,wc=1-wa-wb;
    if(Math.min(wa,wb,wc)<-1e-5)continue;
    centerU=v.map(j=>t.getElement(j,[])[0]).reduce((s,u,k)=>s+u*[wa,wb,wc][k],0);break;
  }
  assert.ok(Number.isFinite(centerU),'center lies in a retained front face');assert.ok(Math.abs(centerU-(qx+.25))<.02,`UV peak moved to ${centerU}`);
});
