import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decisionProtocolBlocks } from '../../electron/bootstrap';
import { decisionFingerprint } from '../../electron/services/latteService';
import { makeBackend, type TestBackend } from './helpers';

describe('agent decision authority',()=>{
  let b:TestBackend; let workId:string; const chatId='ses_decision_agent';
  beforeEach(async()=>{ b=await makeBackend(); const brand=await b.service.createBrand('Brand'); const work=await b.service.createWork(brand.id,'Work'); workId=work.id; const at=new Date().toISOString(); b.repo.insertMember({id:chatId,workId,roleId:'strategist',roleName:'Strategist',initial:'S',runtime:'codex',model:null,accountId:null,sessionId:'',done:false,createdAt:at,updatedAt:at}); });
  afterEach(()=>b.cleanup());

  it('defaults to suggest and is idempotent across retries',async()=>{
    expect(await b.service.getDecisionAuthority(workId)).toBe('suggest');
    const input={statement:'Elegimos café.',rationale:'La evidencia lo respalda.',clientRequestId:'req_decision_1'};
    const first=await b.service.proposeDecisionFromAgent(chatId,'msg_decision_1',input);
    const retry=await b.service.proposeDecisionFromAgent(chatId,'msg_decision_1',input);
    expect(retry?.id).toBe(first?.id); expect((await b.service.listDecisions(workId)).filter(d=>d.status==='pending')).toHaveLength(1);
  });

  it('auto-records only explicit protocol calls and undo archives it',async()=>{
    await b.service.setDecisionAuthority(workId,'auto-record');
    const d=await b.service.proposeDecisionFromAgent(chatId,'msg_decision_2',{statement:'Usar NFC é.',rationale:'Consistencia.',clientRequestId:'req_decision_2'});
    expect(d?.status).toBe('approved'); expect((await b.service.archiveDecision(d!.id)).status).toBe('archived');
  });

  it('off ignores protocol calls, and fingerprints normalize Unicode',async()=>{
    await b.service.setDecisionAuthority(workId,'off');
    expect(await b.service.proposeDecisionFromAgent(chatId,'msg_decision_3',{statement:'No registrar',rationale:'',clientRequestId:'req_decision_3'})).toBeNull();
    expect(decisionFingerprint(' CAFÉ ')).toBe(decisionFingerprint('cafe\u0301'));
  });
});

describe('decision protocol parser',()=>{
  it('accepts only explicit valid JSON blocks',()=>{
    expect(decisionProtocolBlocks('Decidimos algo en prosa')).toEqual([]);
    expect(decisionProtocolBlocks('```latte-decision\n{"statement":"A","rationale":"B","clientRequestId":"req_1"}\n```')).toHaveLength(1);
    expect(decisionProtocolBlocks('```latte-decision\nnot json\n```')).toEqual([]);
  });
});
