import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {sha256} from '../mesh.mjs';
const root=new URL('../../../',import.meta.url),catalog=JSON.parse(await fs.readFile(new URL('data/catalog.json',root))),standards=JSON.parse(await fs.readFile(new URL('data/item-standards.json',root)));
const designs=JSON.parse(await fs.readFile(new URL('data/default-item-designs.json',root))).items;
test('all category dimensions are at most 0.8m; both broom GLBs, hulls and weakpoints share the new uniform scale',async()=>{
 for(const standard of Object.values(standards))assert.ok(standard.longSideMeters<=.8);
 assert.deepEqual(catalog.itemStandards,standards);
 const original=JSON.parse(await fs.readFile(new URL('test/prototype/original-catalog-items.json',root))).find(i=>i.id==='broom');
 for(const id of ['broom','wasteland-broom']){
  const item=catalog.items.find(i=>i.id===id),bytes=await fs.readFile(new URL(item.glb,root)),doc=await new NodeIO().readBinary(bytes),points=[];
  doc.getRoot().getDefaultScene().traverse(node=>{
   const matrix=node.getWorldMatrix();for(const primitive of node.getMesh()?.listPrimitives()??[]){
    const pos=primitive.getAttribute('POSITION'),indices=primitive.getIndices(),v=[];
    for(let k=0;k<(indices?.getCount()??pos.getCount());k++){
     pos.getElement(indices?indices.getScalar(k):k,v);
     points.push([0,1,2].map(j=>matrix[j]*v[0]+matrix[4+j]*v[1]+matrix[8+j]*v[2]+matrix[12+j]));
    }
   }
  });
  assert.ok(points.length>0);
  const bounds={min:[0,1,2].map(i=>Math.min(...points.map(v=>v[i]))),max:[0,1,2].map(i=>Math.max(...points.map(v=>v[i])))};
  assert.ok(Math.abs(Math.max(...bounds.max.map((x,i)=>x-bounds.min[i]))-.8)<1e-6,id);
  for(const key of ['min','max'])for(let i=0;i<3;i++)assert.ok(Math.abs(bounds[key][i]-item.bounds[key][i])<1e-6,`${id} ${key}[${i}] matches actual GLB`);
  assert.ok(item.hull.length<=64);assert.equal(item.mass,designs.find(d=>d.id===id).massKg);assert.equal(item.standardLongSide,.8);assert.equal(sha256(bytes),item.source.normalizedSha256);
  for(const texture of doc.getRoot().listTextures()){const m=await sharp(texture.getImage()).metadata();assert.ok(m.width<=512&&m.height<=512);}
  if(id==='broom'){assert.deepEqual(item.weakPoint.pos,original.weakPoint.pos.map(x=>x*2/3));assert.ok(Math.abs(item.weakPoint.radius-original.weakPoint.radius*2/3)<1e-12);}
 }
});
