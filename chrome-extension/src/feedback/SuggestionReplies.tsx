import { useEffect, useRef, useState } from 'react';
import { Trash, ArrowFatUp, ArrowFatDown } from '@phosphor-icons/react';
import { suggestionRequest } from '../services/publicSuggestionsService';

type Reply={id:string;message:string;author:string;createdAt:number;canDelete:boolean;upvotes?:number;downvotes?:number;myVote?:number};
export default function SuggestionReplies({id,uid,onAccount,onCountChange}:{id:string;uid:string|null;onAccount:()=>void;onCountChange:(delta:number)=>void}) {
  const [items,setItems]=useState<Reply[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [author,setAuthor]=useState<string|null>(null),[message,setMessage]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const alive=useRef(true),lock=useRef(false),requestId=useRef(crypto.randomUUID());
  async function load(next?:string) {
    setLoading(true);setError('');
    try {
      const data=await suggestionRequest(`/${id}/replies${next?'?cursor='+encodeURIComponent(next):''}`);
      if(!alive.current)return;
      setItems(old=>(next?[...old,...data.replies.filter((r:Reply)=>!old.some(t=>t.id===r.id))]:data.replies).sort((a:Reply,b:Reply)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id)));
      setCursor(data.cursor);setAuthor(data.author);
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not load replies.');}
    finally{if(alive.current)setLoading(false);}
  }
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[id]);
  async function send(event:React.FormEvent) {
    event.preventDefault();if(lock.current||!message.trim()||!author)return;
    lock.current=true;setBusy(true);setError('');
    try {
      const reply:Reply=await suggestionRequest(`/${id}/replies`,{message,requestId:requestId.current});
      if(!alive.current)return;
      setItems(old=>[...old.filter(r=>r.id!==reply.id),reply]);setMessage('');requestId.current=crypto.randomUUID();onCountChange(1);
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not send reply.');}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  async function vote(reply:Reply,value:number) {
    if(!uid){onAccount();return;}
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try{const data=await suggestionRequest(`/${id}/replies/${reply.id}/vote`,{value:reply.myVote===value?0:value});if(alive.current)setItems(old=>old.map(r=>r.id===reply.id?{...r,...data}:r));}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not save your vote.');}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  async function remove(reply:Reply) {
    if(lock.current||!window.confirm('Delete this reply?'))return;
    lock.current=true;setBusy(true);setError('');
    try{await suggestionRequest(`/${id}/replies/${reply.id}`,undefined,'DELETE');if(alive.current){setItems(old=>old.filter(r=>r.id!==reply.id));onCountChange(-1);}}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not delete reply.');}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  return <section className="suggestion-replies" aria-label="Replies">
    {items.map(reply=><div className="suggestion-reply" key={reply.id}>
      <div className="public-suggestion-byline"><span>{reply.author}</span><span aria-hidden="true">·</span><time dateTime={new Date(reply.createdAt).toISOString()}>{new Date(reply.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</time></div>
      <p>{reply.message}</p>
      <div className="suggestion-footer">
        <div className="suggestion-votes" data-vote={reply.myVote||0}>
          <button type="button" aria-label={`Upvote reply by ${reply.author}`} aria-pressed={reply.myVote===1} disabled={busy||loading} onClick={()=>void vote(reply,1)}><ArrowFatUp weight={reply.myVote===1?'fill':'regular'} aria-hidden="true"/></button>
          <span className="suggestion-score" aria-live="polite" aria-label={`Score: ${(reply.upvotes||0)-(reply.downvotes||0)}`}>{(reply.upvotes||0)-(reply.downvotes||0)}</span>
          <button type="button" aria-label={`Downvote reply by ${reply.author}`} aria-pressed={reply.myVote===-1} disabled={busy||loading} onClick={()=>void vote(reply,-1)}><ArrowFatDown weight={reply.myVote===-1?'fill':'regular'} aria-hidden="true"/></button>
        </div>
      {reply.canDelete&&<button type="button" className="suggestion-delete" disabled={busy} onClick={()=>void remove(reply)} aria-label={`Delete reply by ${reply.author}`}><Trash aria-hidden="true"/>Delete</button>}
      </div>
    </div>)}
    {loading&&<p role="status">Loading…</p>}
    {error&&<p className="feedback__error" role="alert">{error} <button type="button" className="feedback__secondary" disabled={busy||loading} onClick={()=>void load()}>Retry</button></p>}
    {cursor&&<button type="button" className="feedback__secondary" disabled={loading||busy} onClick={()=>void load(cursor)}>Load more replies</button>}
    {!loading&&(author?<form className="reply-form" onSubmit={send}>
      <textarea aria-label="Your reply" placeholder="Write a reply…" rows={2} maxLength={2000} value={message} disabled={busy} onChange={e=>{setMessage(e.target.value);requestId.current=crypto.randomUUID();}}/>
      <div><span>Replying as <strong>{author}</strong></span><button type="submit" className="feedback__primary" disabled={busy||!message.trim()}>{busy?'Sending…':'Reply'}</button></div>
    </form>:<button type="button" className="feedback__secondary" onClick={onAccount}>{uid?'Verify your school email to reply':'Sign in to reply'}</button>)}
  </section>;
}
