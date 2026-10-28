import {simulateV3} from '../../../sim/v3.js';
import {fixtures,options} from './experiment.mjs';
import {measure} from './measure.mjs';
const out=[];
for(const f of fixtures)for(const condition of ['timing','mash','idle']){
 const {row}=await measure(()=>simulateV3(options(f,1,condition)));
 out.push({fixture:f.id,condition,...row});
}
for(const f of fixtures){const o=options(f,1);o.fighters=[f.definition,f.definition];const {row}=await measure(()=>simulateV3(o));out.push({fixture:f.id,condition:'same',...row});}
console.log(JSON.stringify(out,null,2));
