import { useState } from 'react';
import type { WorkDocument, DocumentStatus, FunnelStage } from '../shared/contracts';
import { api } from './browser-api';
import { STAGES, STAGE_LABEL, STATUS_LABEL } from './document-organizer';
// Drafts survive document, work and Settings navigation without silently saving metadata.
const drafts=new Map<string,{title:string;status:DocumentStatus;funnelStages:FunnelStage[]}>();
export const hasMetadataDrafts=()=>drafts.size>0;
export function DocumentMetadata({document,onChanged,onError,onDirtyChange}:{document:WorkDocument;onChanged:()=>Promise<void>;onError:(text:string)=>void;onDirtyChange:(dirty:boolean)=>void}) {
 const [draft,setDraft]=useState(()=>drafts.get(document.id)??{title:document.title,status:document.status,funnelStages:document.funnelStages??[]});
 const [busy,setBusy]=useState(false);
 const dirty=drafts.has(document.id);
 const change=(next:typeof draft)=>{setDraft(next);drafts.set(document.id,next);onDirtyChange(true);};
 const save=async()=>{setBusy(true);try{await api.updateDocument(document.id,draft);drafts.delete(document.id);onDirtyChange(false);await onChanged();}catch(e){onError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 return <details className="document-metadata"><summary>Organización del documento {dirty?'· Sin guardar':''}</summary><div className="metadata-fields"><label>Título del documento<input aria-label="Título del documento" maxLength={120} value={draft.title} disabled={busy} onChange={e=>change({...draft,title:e.target.value})}/></label><label>Estado del documento<select aria-label="Estado del documento" value={draft.status} disabled={busy} onChange={e=>change({...draft,status:e.target.value as DocumentStatus})}>{Object.entries(STATUS_LABEL).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div><fieldset disabled={busy}><legend>Etapas del embudo</legend>{STAGES.map(stage=><label key={stage}><input type="checkbox" checked={draft.funnelStages.includes(stage)} onChange={e=>change({...draft,funnelStages:e.target.checked?[...draft.funnelStages,stage]:draft.funnelStages.filter(s=>s!==stage)})}/>{STAGE_LABEL[stage]}</label>)}</fieldset><div className="metadata-save"><small>Sin etapas = Sin clasificar. No cambia el archivo ni su contenido.</small><button disabled={!dirty||busy||!draft.title.trim()} onClick={()=>void save()}>Guardar organización</button></div></details>;
}
