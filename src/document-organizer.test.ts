import { describe, expect, it } from 'vitest';
import { filterDocuments, groupByStage, reviewReasons } from './document-organizer';
import type { WorkDocument } from '../shared/contracts';
const doc = (patch: Partial<WorkDocument> = {}): WorkDocument => ({ id:'a',workId:'w',kind:'note',title:'Una campaña con nombre completo',fileName:'oferta.md',status:'draft',funnelStages:[],proposedFunnelStages:[],baseDocumentId:null,baseRevisionId:null,baseFingerprint:null,createdAt:'',updatedAt:'',...patch });
describe('document organizer',()=>{
 it('searches full title and file case-insensitively with intersecting filters',()=>{const d=doc({funnelStages:['conversion']});expect(filterDocuments([d],{query:'NOMBRE COMPLETO',stage:'conversion',status:'draft'})).toEqual([d]);expect(filterDocuments([d],{query:'OFERTA.MD',stage:'all',status:'approved'})).toEqual([]);});
 it('groups multi-stage references once per stage and leaves legacy unclassified',()=>{const d=doc({funnelStages:['discovery','conversion','conversion']});const groups=groupByStage([d,doc({id:'b',funnelStages:undefined})]);expect(groups.discovery).toEqual([d]);expect(groups.conversion).toEqual([d]);expect(groups.unclassified.map(x=>x.id)).toEqual(['b']);expect(groups.discovery[0]).toBe(groups.conversion[0]);});
 it('separates review status from changed dependency',()=>{expect(reviewReasons(doc({status:'review'}),true)).toEqual(['En revisión','Base desactualizada']);expect(reviewReasons(doc({status:'approved'}),true)).toEqual(['Base desactualizada']);expect(reviewReasons(doc(),false)).toEqual([]);});
});
