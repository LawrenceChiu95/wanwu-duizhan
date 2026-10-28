// 左右偏不偏：同一批装法对，左右各打一次（a|b 和 b|a）、同种子；公平的话左边赢约 50%。
// Usage: nice -n 20 node test/v3-top/sides.mjs [pairs=120] [auto|manual]（manual＝两边都是电脑的冲/挡）
import {simulateV3} from '../../sim/v3.js';
import {LOADOUTS, FOE} from './loadouts.mjs';
import {random} from '../../sim/math.js';
const n=Number(process.argv[2]??120), kind=process.argv[3]??'manual', foe=process.argv[4]==='foe';
const manual=kind==='manual'?{sides:['ai','ai']}:null, pick=random(777);
let left=0,right=0,draw=0,sameLoadout=0,games=0;const rows=[];
for(let g=0;g<n;g++){
 const a=LOADOUTS[Math.floor(pick()*LOADOUTS.length)],b=foe?FOE:LOADOUTS[Math.floor(pick()*LOADOUTS.length)],seed=1000+g;
 const w1=(await simulateV3({fighters:[a,b],mode:'A',seed,manual})).meta.winner,w2=(await simulateV3({fighters:[b,a],mode:'A',seed,manual})).meta.winner;
 for(const w of [w1,w2]){games++;if(w===0)left++;else if(w===1)right++;else draw++;}
 if(w1!==null&&w2!==null&&w1!==w2)sameLoadout++;
 rows.push([w1,w2]);
}
const z=(left-right)/Math.sqrt(left+right);
console.log(JSON.stringify({kind,foe,pairs:n,games,left,right,draw,leftShare:+(left/(left+right)).toFixed(3),z:+z.toFixed(2),sameLoadoutWinsBothWays:sameLoadout}));
