export const add=(a,b)=>a.map((x,i)=>x+b[i]);
export const sub=(a,b)=>a.map((x,i)=>x-b[i]);
export const scale=(a,s)=>a.map(x=>x*s);
export const length=a=>Math.hypot(...a);
export const vec=a=>({x:a[0],y:a[1],z:a[2]});
export const arr=v=>[v.x,v.y,v.z];
export const quat=q=>({x:q[0],y:q[1],z:q[2],w:q[3]});
export const qarr=q=>[q.x,q.y,q.z,q.w];
export function euler([x,y,z]){const c1=Math.cos(x/2),c2=Math.cos(y/2),c3=Math.cos(z/2),s1=Math.sin(x/2),s2=Math.sin(y/2),s3=Math.sin(z/2);return [s1*c2*c3+c1*s2*s3,c1*s2*c3-s1*c2*s3,c1*c2*s3+s1*s2*c3,c1*c2*c3-s1*s2*s3];}
export function rotate(q,v){const [x,y,z,w]=q,[a,b,c]=v,tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];}
export const inverseRotate=(q,v)=>rotate([-q[0],-q[1],-q[2],q[3]],v);
export function random(seed){let x=seed>>>0;return()=>{x=(x+0x6d2b79f5)>>>0;let t=Math.imul(x^(x>>>15),1|x);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;};}
