// Rebuild normalized GLBs and <=64-point convex envelopes from the licensed sources.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import R from '@dimforge/rapier3d-compat';
await R.init();
const root = new URL('../', import.meta.url);
const specs = [
 ['scissors','剪刀','RRyFBBtM2K','Zsky','metal',0.20,'sharp',110,14,3],
 ['lamp','台灯','0_FDq_UjWHp','involuntary tsetse','plastic',0.45,'neutral',130,12,4],
 ['broom','扫把','bzCi_ZLQPN4','Poly by Google','wood',1.20,'rod',115,13,3],
 ['pot','锅','jAUb3FoCN7','Quaternius','metal',0.38,'neutral',150,12,6],
 ['slipper','拖鞋','2wR1M99UwP','J-Toastie','rubber',0.28,'neutral',120,10,3],
 ['pillow','枕头','f60emm1Xkas','Poly by Google','cloth',0.60,'soft',140,11,2]
];
const materials = {
 metal:{density:2700,restitution:0.75,hardness:1.2},
 wood:{density:650,restitution:0.65,hardness:0.9},
 cloth:{density:60,restitution:0.45,hardness:0.5},
 plastic:{density:950,restitution:0.65,hardness:0.8},
 rubber:{density:400,restitution:0.9,hardness:0.65}
};
// Column-major matrices, glTF convention.
function multiply(a,b){const c=Array(16).fill(0);for(let col=0;col<4;col++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)c[col*4+row]+=a[k*4+row]*b[col*4+k];return c;}
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function matrix(n){if(n.matrix)return n.matrix;const [x,y,z,w]=n.rotation??[0,0,0,1],[sx,sy,sz]=n.scale??[1,1,1],[tx,ty,tz]=n.translation??[0,0,0];return [(1-2*y*y-2*z*z)*sx,(2*x*y+2*w*z)*sx,(2*x*z-2*w*y)*sx,0,(2*x*y-2*w*z)*sy,(1-2*x*x-2*z*z)*sy,(2*y*z+2*w*x)*sy,0,(2*x*z+2*w*y)*sz,(2*y*z-2*w*x)*sz,(1-2*x*x-2*y*y)*sz,0,tx,ty,tz,1];}
const transform=(m,p)=>[0,1,2].map(r=>m[r]*p[0]+m[r+4]*p[1]+m[r+8]*p[2]+m[r+12]);
function readGlb(buf){const len=buf.readUInt32LE(12);const g=JSON.parse(buf.subarray(20,20+len));const bin=buf.subarray(28+len);return {g,bin};}
function writeGlb(g,bin){let j=Buffer.from(JSON.stringify(g));j=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,32)]);const h=Buffer.alloc(20);h.writeUInt32LE(0x46546c67);h.writeUInt32LE(2,4);h.writeUInt32LE(28+j.length+bin.length,8);h.writeUInt32LE(j.length,12);h.writeUInt32LE(0x4e4f534a,16);const b=Buffer.alloc(8);b.writeUInt32LE(bin.length);b.writeUInt32LE(0x004e4942,4);return Buffer.concat([h,j,b,bin]);}
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const items=[];
for(const [id,name,sourceId,author,material,length,tag,hp,attack,defense] of specs){
 const raw=await fs.readFile(new URL(`data/source-models/${id}.glb`,root));const {g,bin}=readGlb(raw);
 if(id==='slipper')g.scenes[g.scene??0].nodes=[0]; // Keep the right slipper only, not the pair.
 const vertices=[];
 function walk(ni,parent){const n=g.nodes[ni],m=multiply(parent,matrix(n));if(n.mesh!==undefined)for(const p of g.meshes[n.mesh].primitives){const a=g.accessors[p.attributes.POSITION],v=g.bufferViews[a.bufferView];if(a.componentType!==5126||a.type!=='VEC3'||a.sparse)throw Error('Unsupported POSITION');for(let i=0;i<a.count;i++){const off=(v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??12);vertices.push(transform(m,[0,4,8].map(k=>bin.readFloatLE(off+k))));}}for(const ch of n.children??[])walk(ch,m);}
 for(const n of g.scenes[g.scene??0].nodes)walk(n,identity());
 const lo=[0,1,2].map(k=>Math.min(...vertices.map(v=>v[k]))),hi=[0,1,2].map(k=>Math.max(...vertices.map(v=>v[k]))),span=hi.map((v,k)=>v-lo[k]),center=hi.map((v,k)=>(v+lo[k])/2),s=length/Math.max(...span);
 // Long implements point along +Z; preserve lamp's upright presentation.
 const axis=span.indexOf(Math.max(...span));let orient=identity();
 if(id==='broom'||id==='scissors'){if(axis===1)orient=[1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1];if(axis===0)orient=[0,0,1,0,0,1,0,0,-1,0,0,0,0,0,0,1];}
 const normalize=identity();normalize[0]=normalize[5]=normalize[10]=s;normalize[12]=-center[0]*s;normalize[13]=-center[1]*s;normalize[14]=-center[2]*s;
 const m=multiply(orient,normalize),points=vertices.map(v=>transform(m,v));
 const selected=new Map();
 // 26 support directions form a compact envelope preserving extremities, not a box.
 for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){if(!x&&!y&&!z)continue;let best=points[0],score=-Infinity;for(const p of points){const q=p[0]*x+p[1]*y+p[2]*z;if(q>score){best=p;score=q;}}selected.set(best.join(','),best);}
 const hull=[...selected.values()].map(p=>p.map(v=>+v.toFixed(7)));
 const world=new R.World({x:0,y:0,z:0});const desc=R.ColliderDesc.convexHull(new Float32Array(hull.flat()));if(!desc)throw Error(`${id} hull failed`);const c=world.createCollider(desc.setDensity(materials[material].density));const volume=c.volume(),mass=c.mass();world.free();
 const node=g.nodes.length;g.nodes.push({name:'prototype_meters_centered',matrix:m,children:g.scenes[g.scene??0].nodes});g.scenes[g.scene??0].nodes=[node];
 const normalized=writeGlb(g,bin);await fs.writeFile(new URL(`data/models/${id}.glb`,root),normalized);
 const bounds={min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))};
 const weak=points.reduce((best,p)=>p[0]>best[0]?p:best,points[0]);
 items.push({id,name,glb:`data/models/${id}.glb`,scale:1,material,tag,hull,bounds,weakPoint:{pos:weak.map(v=>+v.toFixed(7)),radius:Math.max(0.035,length*0.13)},stats:{hp,attack,defense},volume,mass,source:{url:`https://poly.pizza/m/${sourceId}`,author,license:id==='pot'?'CC0-1.0':'CC-BY-3.0',sourceSha256:hash(raw),normalizedSha256:hash(normalized)},normalization:{sourceBounds:{min:lo,max:hi},matrix:m,sourceVertices:vertices.length}});
 console.log(id,'dimensions',bounds.max.map((v,k)=>(v-bounds.min[k]).toFixed(3)).join('x'),'hull',hull.length,'mass',mass.toFixed(3));
}
const catalog={version:1,units:'meters, kilograms, seconds; radians; +Y up, +Z forward',materials,matchups:{sharp:{soft:1.5},soft:{rod:1.5},rod:{sharp:1.5}},arena:{radius:3.2,zoneStartRadius:2.7,zoneEndRadius:0.5,zoneShrinkStart:8,zoneShrinkEnd:45,zoneDamagePerSecond:7,attraction:0.28,thrust:0.75,recoilSpeed:1.0,speedLimit:3.0,linearDamping:0.12,angularDamping:0.35,contactCooldown:0.55,impulseToDamage:1.2,maxDuration:60,dt:1/60,base:{halfExtents:[0.12,0.06,0.12],density:300},mounts:{core:[0,0,0],front:[0,0,0.23],top:[0,0.17,0],side:[0.23,0,0]}},items};
await fs.writeFile(new URL('data/catalog.json',root),JSON.stringify(catalog,null,2)+'\n');
