'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, CircleDot, Clock3, Code2, CreditCard, ExternalLink, FlaskConical, GitBranch, Globe2, Info, Layers3, Loader2, LockKeyhole, Play, Radio, RotateCcw, ShieldCheck, ShoppingBag, Terminal, X, XCircle, Zap } from 'lucide-react';
import { scenarios, type Scenario } from '@/shared/scenarios';
import type { Payment, TimelineEvent } from '@/server/router';
import { saveSession, storageKey } from '@/shared/session';

const money = (cents:number) => new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(cents/100);
async function api(path:string, data?:unknown):Promise<Payment> {
  const response = await fetch(path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)}),cache:'no-store'});
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Something went wrong. Retry this same payment.');
  return value;
}
function SwitchMark({small=false}:{small?:boolean}) { return <span className={`switch-mark ${small?'small':''}`}><span/><span/></span>; }
function EventIcon({kind}:{kind:string}) {
  if(kind==='success') return <Check size={13}/>;
  if(kind==='wait') return <Clock3 size={13}/>;
  if(kind==='error') return <X size={13}/>;
  if(kind==='route') return <GitBranch size={13}/>;
  return <CircleDot size={13}/>;
}
function ProductArt() {
  return <div className="product-art" aria-label="Illustration of a natural canvas tote bag" role="img">
    <div className="art-grid"/><span className="art-caption">THE EVERYDAY COLLECTION</span><span className="art-number">N° 01</span>
    <svg viewBox="0 0 340 250" aria-hidden="true"><defs><linearGradient id="bag" x1="0" x2="1"><stop stopColor="#d0b994"/><stop offset=".45" stopColor="#f0dfbf"/><stop offset="1" stopColor="#d8c19b"/></linearGradient><filter id="shadow"><feGaussianBlur stdDeviation="7"/></filter></defs><ellipse cx="172" cy="222" rx="82" ry="9" fill="#95846c" opacity=".18" filter="url(#shadow)"/><path d="M133 96V72c0-54 73-54 73 0v24" fill="none" stroke="#aa9473" strokeWidth="12"/><path d="M135 96V72c0-48 69-48 69 0v24" fill="none" stroke="#e7d5b2" strokeWidth="7"/><path d="M101 87l-9 123q75 25 162 0L241 87z" fill="url(#bag)"/><path d="M102 89l10 116M240 89l-9 116" stroke="#bfa780" strokeWidth="2" opacity=".6"/><path d="M108 94h125" stroke="#f7e9d0" strokeWidth="3"/><path d="M119 108v91M223 108v91" stroke="#bdA47e" strokeWidth="1" strokeDasharray="2 3"/><text x="172" y="152" textAnchor="middle" fill="#4f5948" fontFamily="Georgia,serif" fontSize="17" letterSpacing="3">northline</text><path d="M156 165h32" stroke="#6a725a"/><text x="172" y="180" textAnchor="middle" fill="#73785e" fontFamily="sans-serif" fontSize="6" letterSpacing="2">CARRY LESS. LIVE MORE.</text></svg>
    <span className="art-foot">Designed for the everyday.</span><span className="art-star">✳</span>
  </div>;
}

export default function Home() {
  const [scenario,setScenario] = useState<Scenario>('delayed_success');
  const [payment,setPayment] = useState<Payment|null>(null);
  const [busy,setBusy] = useState(false);
  const [ready,setReady] = useState(false);
  const [error,setError] = useState('');
  const [storageWarning,setStorageWarning] = useState(false);
  const [docs,setDocs] = useState(false);
  const [inspector,setInspector] = useState(false);
  const order = useRef('');
  const working = useRef(false);
  const pollCount = useRef(0);
  const currentScenario = scenarios[scenario];
  const status = payment?.status ?? 'ready';
  const pending = status==='pending';
  const paid = status==='succeeded';
  const declined = status==='declined';
  const stateLabel = paid?'Payment successful':pending?'Awaiting confirmation':declined?'Card declined':status==='created'?'Ready to route':'Ready to explore';

  useEffect(()=>{
    let alive=true;
    async function restore() {
      try {
        const raw=localStorage.getItem(storageKey);
        if(raw) {
          const saved=JSON.parse(raw);
          if(saved.scenario in scenarios && typeof saved.order_id==='string') {
            order.current=saved.order_id; setScenario(saved.scenario);
            if(saved.id) { const p=await api(`/api/payments/${saved.id}`); if(alive) setPayment(p); }
          }
        }
      } catch { if(alive) setError('Could not restore the previous payment. Retry to recover the same order.'); }
      finally { if(!order.current) order.current=crypto.randomUUID(); if(alive) setReady(true); }
    }
    void restore(); return ()=>{alive=false;};
  },[]);
  const persist = useCallback((value:unknown)=>{
    if(!saveSession(value)) setStorageWarning(true);
  },[]);
  const remember = useCallback((p:Payment)=>{
    persist({id:p.id,order_id:p.order_id,scenario:p.scenario});
    setPayment(p);
  },[persist]);
  const operate = useCallback(async(action='pay')=>{
    if(working.current || !ready) return;
    working.current=true; setBusy(true); setError('');
    try {
      persist({id:payment?.id,order_id:order.current,scenario});
      let p=payment;
      if(!p) { p=await api('/api/payments',{order_id:order.current,scenario}); remember(p); }
      const count=scenario==='concurrent_retry' && action!=='webhook-demo'?8:1;
      await Promise.all(Array.from({length:count},()=>api(`/api/payments/${p!.id}/${action}`,{})));
      remember(await api(`/api/payments/${p.id}`));
      pollCount.current=0;
    } catch(e) {setError(e instanceof Error?e.message:'Connection interrupted. Retry the same order.');}
    finally {working.current=false;setBusy(false);}
  },[payment,ready,remember,scenario,persist]);

  useEffect(()=>{
    if(!pending || busy || !payment || scenario==='unresolved_timeout' || pollCount.current>=15 || error) return;
    const timer=setTimeout(async()=>{
      if(working.current) return;
      working.current=true; pollCount.current++;
      try {
        const action=scenario==='duplicate_webhook'?'webhook-demo':'reconcile';
        remember(await api(`/api/payments/${payment.id}/${action}`,{}));
      } catch(e) {setError(e instanceof Error?e.message:'Status check interrupted.');}
      finally {working.current=false;}
    },1200);
    return ()=>clearTimeout(timer);
  },[pending,busy,payment,scenario,remember,error]);

  function reset(nextScenario=scenario) {
    if(busy) return;
    order.current=crypto.randomUUID(); setPayment(null); setScenario(nextScenario);setError('');pollCount.current=0;
    persist({order_id:order.current,scenario:nextScenario});
  }
  const atlas=payment?.attempts.find(a=>a.provider==='atlas');
  const beacon=payment?.attempts.find(a=>a.provider==='beacon');
  const showEvent=(e:TimelineEvent,i:number)=><li key={e.id} className={`timeline-event ${e.kind}`}><span className="event-dot"><EventIcon kind={e.kind}/></span><div><div className="event-top"><strong>{e.title}</strong><span>{String(i+1).padStart(2,'0')}</span></div><p>{e.detail}</p></div></li>;

  return <div className="app-shell">
    <aside className="sidebar">
      <a href="/" className="brand"><SwitchMark/><span>switchboard<span className="brand-period">.</span></span></a>
      <div className="workspace-label">THE PAYMENT WORKSPACE</div>
      <nav aria-label="Main navigation"><a href="#playground" className="nav-item active"><FlaskConical size={18}/>Playground<span>01</span></a><button className="nav-item" onClick={()=>setDocs(true)}><Layers3 size={18}/>Under the hood<ArrowUpRight size={14}/></button><a className="nav-item" href="https://github.com/SHIVASAI234/payment-router-demo" target="_blank" rel="noreferrer"><Code2 size={18}/>Source code<ArrowUpRight size={14}/></a></nav>
      <div className="sidebar-note"><span className="note-symbol"><ShieldCheck size={22}/></span><h3>Resilience, without<br/>the double charge.</h3><p>A little playground for a very important problem.</p><div className="note-line"/></div>
      <div className="sidebar-bottom"><span className="sandbox-dot"/><div>Sandbox environment<small>Nothing here moves real money.</small></div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace<span>/</span><strong>Payment playground</strong></div><div className="topbar-right"><span className="simulation-badge"><span/>SIMULATION ONLY</span><a href="https://github.com/SHIVASAI234/payment-router-demo" target="_blank" rel="noreferrer" className="source-link">View project<ArrowUpRight size={14}/></a><span className="avatar">S<span/></span></div></header>
      <main id="playground">
        <section className="page-heading"><div><div className="eyebrow"><span/>PAYMENT ORCHESTRATION, MADE VISIBLE</div><h1>One payment. <em>The right route.</em></h1><p>Break a provider. Race a retry. See what happens next.</p></div><button onClick={()=>setDocs(true)} className="how-button"><Info size={15}/>How it works<ArrowUpRight size={14}/></button></section>
        <div className="instruction-bar"><FlaskConical size={17}/><p><strong>This is a working sandbox.</strong> Pick a scenario, make a simulated payment, and follow every decision.</p><span>No login. No real charges.</span></div>

        <div className="workspace-grid">
          <section className="checkout-panel panel">
            <div className="panel-heading"><div><span className="step-number">01</span><h2>The checkout</h2></div><span className="mini-label">CUSTOMER VIEW</span></div>
            <div className="checkout-body"><div className="merchant-name"><span className="merchant-symbol">n.</span><div><strong>NORTHLINE</strong><small>Goods for the everyday</small></div><LockKeyhole size={15}/></div><ProductArt/>
              <div className="product-title"><div><h3>The Everyday Tote</h3><p>Natural canvas / One size</p></div><span>× 1</span></div>
              <div className="price-lines"><div><span>Subtotal</span><span>€49.99</span></div><div><span>Shipping</span><span className="free-shipping">On us</span></div><div className="total-row"><strong>Total due</strong><strong>€49.99<span>EUR</span></strong></div></div>
              <div className="simulation-card"><CreditCard size={22}/><div><strong>Demo payment method</strong><span>Simulated card ···· 4242</span></div><span className="test-tag">TEST</span></div>
              <button className={`pay-button ${paid?'is-paid':''} ${declined?'is-declined':''}`} disabled={!ready||busy||paid||declined} onClick={()=>void operate(pending?'reconcile':'pay')}>
                {busy?<Loader2 size={17} className="spin"/>:paid?<CheckCircle2 size={18}/>:pending?<Clock3 size={17}/>:declined?<XCircle size={17}/>:<LockKeyhole size={16}/>}
                {busy?'Routing your payment…':paid?'Payment complete':pending?'Check payment status':declined?'Payment declined':'Pay €49.99'}{!paid&&!busy&&!declined&&<ArrowRight size={16}/>}
              </button>
              <p className="checkout-disclaimer"><ShieldCheck size={12}/>100% simulated. Zero real money.</p>
              {storageWarning&&<div className="pending-note">Browser storage is unavailable. Payments still work, but keep this tab open: refresh cannot restore this order.</div>}
              {error&&<div className="error-box" role="alert">{error}<button onClick={()=>void operate('retry')}>Retry same order<ArrowRight size={12}/></button></div>}
              {payment&&<div className={`payment-status ${status}`} role="status"><span/>{stateLabel}{paid&&<strong>{money(payment.amount_cents)}</strong>}</div>}
            </div>
            <div className="checkout-footer"><SwitchMark small/><span>Orchestrated by <strong>switchboard.</strong></span></div>
          </section>

          <div className="merchant-column">
            <section className="scenario-panel panel"><div className="panel-heading"><div><span className="step-number">02</span><h2>Set the conditions</h2></div><span className="mini-label">YOU’RE IN CONTROL</span></div>
              <div className="scenario-content"><div className="scenario-select-wrap"><label htmlFor="scenario">Payment scenario</label><div className="select-shell"><FlaskConical size={17}/><select id="scenario" value={scenario} disabled={busy||!ready||!!payment} onChange={e=>reset(e.target.value as Scenario)}>{Object.entries(scenarios).map(([key,s])=><option value={key} key={key}>{s.name}</option>)}</select><ChevronDown size={16}/></div></div><div className="scenario-description"><span className="scenario-tag">{currentScenario.tag}</span><p>{currentScenario.description}</p></div><div className="expected-outcome"><span><ArrowUpRight size={14}/>Expected outcome</span><strong>{currentScenario.outcome}</strong></div>{payment&&<div className="experiment-actions"><button onClick={()=>reset()} disabled={busy}><RotateCcw size={13}/>New experiment</button><span>{pending?'New experiment creates a separate order.':'Choose another scenario on a fresh order.'}</span></div>}</div>
            </section>

            <section className="route-panel panel"><div className="route-heading"><h2><GitBranch size={16}/>The route, in real time</h2><span className={`route-state ${status}`}><span/>{paid?'CONFIRMED':pending?'RECONCILING':declined?'STOPPED':'READY'}</span></div><div className="route-visual"><div className={`route-node router-node ${payment?'engaged':''}`}><SwitchMark/><strong>Switchboard</strong><small>Routing engine</small></div><div className={`route-connectors ${beacon?'backup-active':''}`}><span/><span/><ArrowRight size={13}/><ArrowRight size={13}/></div><div className="provider-nodes"><div className={`provider-node ${atlas?.status==='succeeded'?'provider-success':atlas?.status==='pending'?'provider-pending':atlas?.status==='declined'?'provider-declined':atlas?'provider-muted':''}`}><span className="provider-logo atlas">A</span><div><strong>Atlas <span>PRIMARY</span></strong><small>{atlas?atlas.status==='not_sent'?'Unavailable · not sent':atlas.status==='no_charge'?'Terminal · no charge':atlas.status==='succeeded'?'Charge confirmed':atlas.status==='pending'?'Outcome unknown':atlas.status==='declined'?'Card declined':'Prepared':'First-choice provider'}</small></div>{atlas?.status==='succeeded'?<CheckCircle2 size={16}/>:atlas?.status==='pending'?<Clock3 size={16}/>:<span className="provider-dot"/>}</div><div className={`provider-node ${beacon?.status==='succeeded'?'provider-success':''}`}><span className="provider-logo beacon">b</span><div><strong>Beacon <span>BACKUP</span></strong><small>{beacon?.status==='succeeded'?'Charge confirmed':pending?'Blocked until safe':'Standby · safe failover only'}</small></div>{beacon?.status==='succeeded'?<CheckCircle2 size={16}/>:<span className="provider-dot"/>}</div></div></div><div className="route-safety"><ShieldCheck size={14}/><span>A timeout is not a decline. An unknown outcome is not permission to retry elsewhere.</span></div></section>

            <section className="timeline-panel panel"><div className="panel-heading"><div><span className="step-number">03</span><h2>Follow the decisions</h2></div><span className="timeline-live"><Radio size={12}/>{pending?'LIVE':'MERCHANT TIMELINE'}</span></div><div className="timeline-content"><div className="ledger-strip"><div><span>Successful charges</span><strong className={payment?.charges.length===1?'good-number':''}>{payment?.charges.length??0}<small>/ 1 expected</small></strong></div><div><span>Provider attempts</span><strong>{payment?.attempts.length??0}<small>persisted</small></strong></div><div><span>Payment state</span><strong className="state-word">{paid?'Paid':pending?'Pending':declined?'Declined':'Not started'}</strong></div></div>
              {payment?<ol className="timeline" aria-label="Merchant decision timeline" aria-live="polite">{payment.events.map(showEvent)}</ol>:<div className="timeline-empty"><div className="empty-track"><span/><span/><span/></div><h3>Your payment’s story starts here.</h3><p>Hit <strong>Pay €49.99</strong> to watch the router make its first move.<br/>Every attempt. Every decision. Nothing hidden.</p></div>}
              {pending&&<div className="pending-note"><Clock3 size={16}/><span>{scenario==='unresolved_timeout'?'This outcome remains unknown. Retry as often as you like; Beacon stays blocked.':'Waiting on the original provider. Status checks do not create new charges.'}</span></div>}
              {payment&&<div className="timeline-actions"><button onClick={()=>void operate('retry')} disabled={busy}><ArrowLeftRight size={13}/>{scenario==='concurrent_retry'?'Send 8 concurrent retries':'Retry same payment'}</button><button onClick={()=>void operate('webhook-demo')} disabled={busy}><Zap size={13}/>Replay webhook ×2</button><button onClick={()=>setInspector(!inspector)} aria-expanded={inspector}><Terminal size={13}/>{inspector?'Hide':'Inspect'} data</button></div>}
              {inspector&&payment&&<div className="data-inspector"><div><span>ORDER ID</span><code>{payment.order_id}</code></div><div><span>PAYMENT INTENT</span><code>{payment.id}</code></div><div><span>PROCESSED WEBHOOK EVENTS</span><code>{payment.webhook_count}</code></div>{payment.attempts.map(a=><div key={a.id}><span>{a.provider.toUpperCase()} IDEMPOTENCY KEY</span><code>{a.idempotency_key}</code></div>)}<div><span>INDEPENDENT SIMULATOR LEDGER</span><code>{JSON.stringify(payment.charges,null,2)}</code></div></div>}
            </div></section>
          </div>
        </div>
        <footer className="page-footer"><span>Built for the edge cases. Designed for clarity.</span><div><span>Next.js</span><i/>TypeScript<i/>PostgreSQL<span className="footer-version">v1.0</span></div></footer>
      </main>
    </div>
    {docs&&<div className="modal-backdrop" onClick={()=>setDocs(false)}><section className="docs-modal" role="dialog" aria-modal="true" aria-labelledby="docs-title" onClick={e=>e.stopPropagation()}><button className="modal-close" aria-label="Close explanation" onClick={()=>setDocs(false)}><X size={20}/></button><div className="eyebrow">UNDER THE HOOD</div><h2 id="docs-title">Resilience is knowing<br/>when <em>not</em> to retry.</h2><p>Switchboard routes a fixed €49.99 order through two fictional providers. All routing decisions run on the server and persist in PostgreSQL.</p><ol><li><strong>One order, one intent.</strong><span>A unique database constraint and stable provider keys make retries the same payment—not another charge.</span></li><li><strong>Unknown means wait.</strong><span>A timeout could hide a successful charge. The router checks the original provider and keeps the backup blocked until it knows the truth.</span></li><li><strong>Evidence before failover.</strong><span>Beacon is eligible only if Atlas was never sent the request or confirms a terminal no-charge result. Card declines stop the demo payment.</span></li><li><strong>Count the real simulated charges.</strong><span>The independent simulator ledger makes duplicate charges visible. Duplicate signed webhooks and concurrent retries still resolve to one charge.</span></li></ol><div className="docs-foot"><Info size={16}/><span>Delayed outcomes resolve when checked after 4–6 seconds. The unresolved scenario stays pending. No payment SDKs or real card data are used.</span></div><a className="docs-source" href="https://github.com/SHIVASAI234/payment-router-demo" target="_blank" rel="noreferrer">Explore the code and safety tests<ExternalLink size={15}/></a></section></div>}
  </div>;
}
