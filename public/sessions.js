const $=s=>document.querySelector(s); let me;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,o={}){const r=await fetch(url,o),d=r.status===204?{}:await r.json();if(r.status===401){location.href='/';throw Error('Your session expired. Please log in again.');}if(!r.ok)throw Error(d.error||'Request failed.');return d;}
const dt=v=>new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v));
function status(value){return `<span class="status-badge status-${esc(value)}">${esc(value)}</span>`;}
async function load(){
  $('#sessions').setAttribute('aria-busy','true'); $('#notifications').setAttribute('aria-busy','true');
  try{
    const[u,s,n,m,results]=await Promise.all([api('/api/auth/me'),api('/api/study-sessions'),api('/api/notifications'),api('/api/match-requests'),api('/api/matches')]); me=u.user;
    $('#sessions').innerHTML=s.sessions.map(x=>`<article class="session"><div class="session-top"><h3>${esc(x.title)}</h3>${status(x.status)}</div><p>${esc(x.description||'No description provided.')}</p><p><strong>Date and time</strong><br><time datetime="${esc(x.scheduledStart)}">${dt(x.scheduledStart)}</time> – <time datetime="${esc(x.scheduledEnd)}">${dt(x.scheduledEnd)}</time></p><p><strong>Participants</strong><br>${x.participants.map(p=>esc(p.displayName)).join(', ')}</p>${x.creatorUserId===me.id&&x.status==='scheduled'?`<button class="danger" data-cancel="${x.id}">Cancel session</button>`:''}</article>`).join('');
    $('#session-empty').hidden=!!s.sessions.length;
    $('#notifications').innerHTML=n.notifications.map(x=>`<article class="notification ${x.readAt?'':'unread'}"><div><b>${esc(x.title)}</b>${x.readAt?'':'<span class="sr-only">Unread notification.</span><span class="unread-label">New</span>'}</div><p>${esc(x.message)}</p><time datetime="${esc(x.createdAt)}">${dt(x.createdAt)}</time>${x.readAt?'':`<button data-read="${x.id}">Mark as read</button>`}</article>`).join('');
    $('#notification-empty').hidden=!!n.notifications.length; $('#read-all').disabled=!n.notifications.some(x=>!x.readAt);
    const matched=new Set(m.matches.flatMap(x=>[x.userOneId,x.userTwoId]).filter(x=>x!==me.id)); const names=new Map(results.matches.map(x=>[x.user.id,x.user.displayName]));
    $('[name=participants]').innerHTML=[...matched].map(id=>`<option value="${esc(id)}">${esc(names.get(id)||'Study buddy')}</option>`).join('');
    ui.notice($('#notice'));
  }catch(e){ui.notice($('#notice'),ui.apiError(e));}
  finally{$('#sessions').setAttribute('aria-busy','false');$('#notifications').setAttribute('aria-busy','false');}
}
$('#show-form').onclick=()=>{const d=$('#create-dialog');d.showModal();d.querySelector('input').focus();};
$('#close-form').onclick=()=>$('#create-dialog').close();
$('#create-dialog').addEventListener('click',e=>{if(e.target===$('#create-dialog'))$('#create-dialog').close();});
$('#session-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),button=e.submitter,start=new Date(f.get('start')),end=new Date(f.get('end'));if(!(end>start)){ui.notice($('#notice'),'End time must be after the start time.');e.target.end.focus();return;}ui.busy(button,true,'Creating…');try{await api('/api/study-sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:f.get('title'),description:f.get('description')||null,scheduledStart:start.toISOString(),scheduledEnd:end.toISOString(),participantUserIds:f.getAll('participants')})});$('#create-dialog').close();e.target.reset();ui.notice($('#notice'),'Study session created.','success');await load();}catch(x){ui.notice($('#notice'),ui.apiError(x));}finally{ui.busy(button,false);}};
$('#sessions').onclick=async e=>{const button=e.target.closest('[data-cancel]');if(!button)return;if(!confirm('Cancel this study session? Participants will be notified.'))return;ui.busy(button,true,'Cancelling…');try{await api(`/api/study-sessions/${button.dataset.cancel}/cancel`,{method:'POST'});ui.notice($('#notice'),'Study session cancelled.','success');await load();}catch(x){ui.notice($('#notice'),ui.apiError(x));ui.busy(button,false);}};
$('#notifications').onclick=async e=>{const button=e.target.closest('[data-read]');if(!button)return;ui.busy(button,true,'Marking…');try{await api(`/api/notifications/${button.dataset.read}/read`,{method:'POST'});await load();}catch(x){ui.notice($('#notice'),ui.apiError(x));ui.busy(button,false);}};
$('#read-all').onclick=async()=>{const b=$('#read-all');ui.busy(b,true,'Marking…');try{await api('/api/notifications/read-all',{method:'POST'});await load();}catch(x){ui.notice($('#notice'),ui.apiError(x));}finally{ui.busy(b,false);}};
$('#logout').onclick=async()=>{await fetch('/api/auth/logout',{method:'POST'});location.href='/';}; load();
