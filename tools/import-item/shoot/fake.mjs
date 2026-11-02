import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {readJson, saveJson} from '../state.mjs';

// Deliberately offline: no credentials, network clients or real model submission.
export async function fakeGenerator(directory, {delayMs = 100, fault = null} = {}) {
  const file = path.join(directory, 'fake-ledger.json');
  const ledger = await readJson(file, {calls: [], failedOnce: []});
  return {
    async recognize(template) {
      await pause(delayMs);
      if (fault === 'photo-unclear') throw Object.assign(Error('Fake recognition failure'), {code: 'photo-unclear'});
      return {category: template.category, inSix: true, basis: '本机固定锅样本（假认物）', lengthMeters: Math.max(...template.bounds.max.map((v, i) => v - template.bounds.min[i])), massKg: template.mass, material: template.material, condition: template.condition, sizeLabel: '中'};
    },
    async submit(id) {
      if (fault === 'busy') throw Object.assign(Error('Fake busy: no task created'), {code: 'busy'});
      if (ledger.calls.includes(id)) throw Error('Duplicate fake paid submission');
      ledger.calls.push(id); await saveJson(file, ledger);
      if (fault === 'unknown-submit') throw Error('Fake reply lost after submission');
      return `fake_${id}`;
    },
    async step(key, id) {
      await pause(delayMs);
      const once = `${id}:${key}`;
      const code = ({styled: 'step-failed', model: 'expired', download: 'download', process: 'process'})[key];
      if ((fault === code || (key === 'process' && fault === 'process-unfixable')) && !ledger.failedOnce.includes(once)) {
        ledger.failedOnce.push(once); await saveJson(file, ledger);
        throw Object.assign(Error(`Fake ${fault}`), {code: fault});
      }
    },
    charged: id => ledger.calls.includes(id),
    used: () => ledger.calls.length
  };
}
