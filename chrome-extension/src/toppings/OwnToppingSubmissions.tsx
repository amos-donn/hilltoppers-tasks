import { useEffect, useRef, useState } from 'react';
import { toppingRequest } from '../services/toppingsService';
import ToppingIcon from './ToppingIcon';
import { Trash } from '@phosphor-icons/react';

export type Submission = { id:string; name:string; description:string; image:string; imageData?:string; revisionStatus?:string; url:string; icon:string; status:string; hidden:number; heightMode?:'fixed'|'content'; screenCapture?:boolean };
export default function OwnToppingSubmissions({revision,onEdit,onUnpublished}:{revision:string;onEdit:(t:Submission)=>void;onUnpublished:()=>void}) {
  const [items,setItems]=useState<Submission[]>([]);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [unpublishing,setUnpublishing]=useState<string|null>(null);
  const unpublishLock=useRef(false);
  async function unpublish(t:Submission) {
    if(unpublishLock.current || !window.confirm(`Unpublish "${t.name}"? It will be removed from the Topping Bar.`)) return;
    unpublishLock.current=true;
    setUnpublishing(t.id);setError('');
    try {
      await toppingRequest(`/${t.id}`,'DELETE');
      setItems(list=>list.map(item=>item.id===t.id?{...item,hidden:1}:item));
      onUnpublished();
    } catch(e) {
      setError(e instanceof Error?e.message:'Could not unpublish this Topping. Please try again.');
    } finally {
      unpublishLock.current=false;setUnpublishing(null);
    }
  }
  useEffect(()=>{
    let alive=true;
    toppingRequest('/submissions?own=1').then(data=>{if(alive){setItems(data.toppings);setError('');}})
      .catch(()=>{if(alive)setError('Could not load your submissions.');})
      .finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[revision]);
  return <section className="own-submissions" aria-labelledby="own-submissions-title">
    <h2 id="own-submissions-title">Your submissions</h2>
    {error&&<p className="error" role="alert">{error}</p>}
    {loading?<p role="status">Loading…</p>:!items.length?<p>No submissions yet.</p>:
    <div className="own-submissions-list">{items.map(t=><div className="own-submission" key={t.id}>
      <ToppingIcon icon={t.icon}/><a href={t.url} target="_blank" rel="noopener noreferrer">{t.name}</a>
      <span>{t.hidden?'Unpublished':t.revisionStatus==='pending'?'Changes pending review':t.revisionStatus==='rejected'?'Changes not approved':t.status==='pending'?'Pending review':t.status==='approved'?'Published':'Not approved'}</span>{!t.hidden&&<div className="own-submission-actions"><button type="button" className="quiet" disabled={unpublishing!==null} onClick={()=>onEdit(t)}>Edit</button><button type="button" className="quiet own-submission-unpublish" aria-label={`Unpublish ${t.name}`} title="Unpublish" aria-busy={unpublishing===t.id} disabled={unpublishing!==null} onClick={()=>void unpublish(t)}><Trash size={18} aria-hidden="true"/></button></div>}
    </div>)}</div>}
  </section>;
}
