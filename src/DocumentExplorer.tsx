import { useEffect, useState } from 'react';
import { FileText, Plus, RefreshCw, Search } from 'lucide-react';
import type { DocumentState, DocumentStatus, FunnelStage, WorkDocument } from '../shared/contracts';
import { api } from './browser-api';
import { filterDocuments, groupByStage, reviewReasons, STAGES, STAGE_LABEL, STATUS_LABEL } from './document-organizer';
export function DocumentExplorer({documents,workId,selectedId,onSelect,onCreate,busy}: {documents:WorkDocument[];workId:string;selectedId:string|null;onSelect:(id:string)=>void;onCreate:()=>void;busy:boolean}) {
 const [view,setView]=useState<'list'|'funnel'|'review'>('list');
 const [query,setQuery]=useState(''),[stage,setStage]=useState<FunnelStage|'all'|'unclassified'>('all'),[status,setStatus]=useState<DocumentStatus|'all'>('all');
 const [states,setStates]=useState<Record<string,DocumentState>>({}),[errors,setErrors]=useState<string[]>([]),[refresh,setRefresh]=useState(0),[checking,setChecking]=useState(true);
 const ids=documents.map(d=>d.id).join('|');
 useEffect(()=>{setQuery('');setStage('all');setStatus('all');},[workId]);
 useEffect(()=>{
  let stopped=false,inFlight=false;
  setChecking(true);
  const tick=async()=>{if(stopped||inFlight||document.hidden)return;inFlight=true;setChecking(true);
   const next:Record<string,DocumentState>={};const failed:string[]=[];
   // Batches cap disk reads at six, while the cycle itself cannot overlap.
   for(let i=0;i<documents.length&&!stopped;i+=6){const batch=documents.slice(i,i+6);const results=await Promise.allSettled(batch.map(d=>api.documentState(d.id)));results.forEach((r,j)=>{if(r.status==='fulfilled')next[batch[j].id]=r.value;else failed.push(batch[j].id);});}
   if(!stopped){setStates(next);setErrors(failed);setChecking(false);}inFlight=false;
  };
  void tick();const timer=setInterval(()=>void tick(),5000);const focus=()=>void tick();window.addEventListener('focus',focus);
  return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',focus);};
 },[workId,ids,refresh]);
 const filtered=filterDocuments(documents,{query,stage,status});
 const reviewCount=documents.filter(d=>reviewReasons(d,states[d.id]?.baseOutdated??false).length).length;
 const visible=view==='review'?filtered.filter(d=>reviewReasons(d,states[d.id]?.baseOutdated??false).length):filtered;
 const groups=groupByStage(visible);
 const card=(d:WorkDocument)=><button key={d.id} data-document-id={d.id} disabled={busy} className={'explorer-card'+(selectedId===d.id?' selected':'')} onClick={()=>onSelect(d.id)} aria-label={'Abrir documento: '+d.title}><FileText size={15}/><span><strong>{d.title}</strong><small>{STATUS_LABEL[d.status]} · {d.fileName}</small>{reviewReasons(d,states[d.id]?.baseOutdated??false).map(reason=><em key={reason}>{reason}</em>)}{errors.includes(d.id)&&<em>No se pudo verificar la base</em>}</span></button>;
 return <section className="document-explorer" aria-label="Explorador de documentos">
  <header className="explorer-heading"><div><span className="eyebrow">ESPACIO DE CAMPAÑA</span><h2>Documentos <small>{documents.length}</small></h2></div><button onClick={onCreate} disabled={busy}><Plus size={14}/>Documento</button></header>
  <div className="explorer-views" role="tablist" aria-label="Vista de documentos">{([['list','Lista'],['funnel','Embudo'],['review',`Revisión (${reviewCount})`]] as const).map(([key,label])=><button key={key} role="tab" aria-selected={view===key} onClick={()=>setView(key)}>{label}</button>)}</div>
  <div className="explorer-filters"><label className="explorer-search"><Search size={15}/><input aria-label="Buscar documentos" placeholder="Buscar por título o archivo" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="Filtrar por etapa" value={stage} onChange={e=>setStage(e.target.value as typeof stage)}><option value="all">Todas las etapas</option>{[...STAGES,'unclassified' as const].map(s=><option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select><select aria-label="Filtrar por estado" value={status} onChange={e=>setStatus(e.target.value as typeof status)}><option value="all">Todos los estados</option>{Object.entries(STATUS_LABEL).map(([s,label])=><option key={s} value={s}>{label}</option>)}</select></div>
  {errors.length>0&&<div role="alert" className="explorer-warning">No se pudo verificar {errors.length} documento(s). La cola puede estar incompleta.<button onClick={()=>setRefresh(n=>n+1)}>Reintentar</button></div>}
  <div className="explorer-body" role="tabpanel" aria-label={view==='funnel'?'Embudo de campaña':view==='review'?'Documentos para revisar':'Lista de documentos'}>
   {view==='funnel'?<><p className="explorer-hint">Un documento puede participar en varias etapas: siempre es el mismo archivo.</p><div className="funnel-stages">{STAGES.map((s,i)=><section className={'funnel-stage funnel-stage-'+i} key={s} data-stage={s} aria-label={STAGE_LABEL[s]}><h3><span>{String(i+1).padStart(2,'0')} / {STAGE_LABEL[s]}</span><small>{groups[s].length}</small></h3><div className="explorer-cards">{groups[s].map(card)}</div>{!groups[s].length&&<p className="stage-empty">Sin documentos en esta etapa</p>}</section>)}</div><section className="funnel-unclassified"><h3>Sin clasificar <small>{groups.unclassified.length}</small></h3><div className="explorer-cards">{groups.unclassified.map(card)}</div>{!groups.unclassified.length&&<p className="stage-empty">Todos tienen una etapa asignada.</p>}</section></>:<div className="explorer-cards">{visible.map(card)}{!visible.length&&<p className="stage-empty">{view==='review'?(checking?'Verificando documentos…':'Sin documentos para revisar con estos filtros.'):'No hay documentos que coincidan.'}</p>}</div>}
  </div><footer className="explorer-footer"><span>{checking?'Verificando bases…':view==='review'?'Revisar una base no aprueba el documento.':'Clasificación virtual · no mueve archivos'}</span><button aria-label="Actualizar revisión" onClick={()=>setRefresh(n=>n+1)} disabled={checking}><RefreshCw size={12}/>Actualizar</button></footer>
 </section>;
}
