(function (root) {
  'use strict';
  const iso = d => d.toISOString().slice(0, 10);
  function shiftDate(value, view, step) {
    const date = new Date(value + 'T00:00:00Z');
    if (view === 'month') {
      const day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + step);
      const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(); date.setUTCDate(Math.min(day, last));
    } else date.setUTCDate(date.getUTCDate() + step * (view === 'week' ? 7 : 1));
    return iso(date);
  }
  function scheduleOperation(entity, draft) {
    if (!draft.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) throw Error('タイトルと日付を入力してください。');
    const oldStatus = entity?.frontmatter?.status;
    if (['doing', 'done'].includes(oldStatus) || entity?.archived) throw Error('実行中・完了・アーカイブ済みTaskはTask画面で編集してください。');
    const fields = {title: draft.title.trim(), action_date: draft.date};
    if (draft.timed) {
      if (!/^\d\d:\d\d$/.test(draft.start) || !/^\d\d:\d\d$/.test(draft.end) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.endDate)) throw Error('開始と終了を入力してください。');
      fields.scheduled_start = draft.date + 'T' + draft.start + ':00+09:00';
      fields.scheduled_end = draft.endDate + 'T' + draft.end + ':00+09:00';
      if (!(Date.parse(fields.scheduled_end) > Date.parse(fields.scheduled_start))) throw Error('終了は開始より後にしてください。');
      fields.status = 'scheduled';
    } else {
      fields.scheduled_start = ''; fields.scheduled_end = '';
      fields.status = oldStatus && oldStatus !== 'scheduled' ? oldStatus : 'next';
    }
    return entity ? {action: 'update', kind: 'tasks', id: entity.id, base_hash: entity.content_hash, fields} : {action: 'create', kind: 'tasks', fields, body: ''};
  }
  function layoutTimed(events, day) {
    const midnight=Date.parse(day+'T00:00:00+09:00');
    const rows=events.map((event,index)=>({index,top:Math.max(0,(Date.parse(event.start)-midnight)/60000),height:Math.min(1440,(Date.parse(event.end)-midnight)/60000)-Math.max(0,(Date.parse(event.start)-midnight)/60000)}));
    const sorted=[...rows].sort((a,b)=>a.top-b.top||a.height-b.height);let group=[],edge=-Infinity;
    const finish=()=>{const ends=[];for(const row of group){let lane=ends.findIndex(end=>end<=row.top);if(lane<0)lane=ends.length;ends[lane]=row.top+row.height;row.lane=lane;}for(const row of group)row.columns=ends.length;group=[];};
    for(const row of sorted){if(group.length&&row.top>=edge){finish();edge=-Infinity;}group.push(row);edge=Math.max(edge,row.top+row.height);}finish();return rows;
  }
  function moveInterval(interval, mode, minutes) {
    const delta=Math.round(minutes/5)*300000, first=Date.parse(interval.start)+(mode==='end'?0:delta),last=Date.parse(interval.end)+(mode==='start'?0:delta);
    if(!Number.isFinite(first)||!Number.isFinite(last)||last<=first)throw Error('終了は開始より後にしてください。');
    return {start:new Date(first).toISOString(),end:new Date(last).toISOString()};
  }
  function intervalOperation(entity,target,interval) {
    if(!(Date.parse(interval.end)>Date.parse(interval.start)))throw Error('終了は開始より後にしてください。');
    if(target==='actual'){
      if(entity.archived||entity.frontmatter.status!=='done')throw Error('完了したTaskの実績だけ調整できます。');
      return {action:'correct_work_session',kind:'tasks',id:entity.id,base_hash:entity.content_hash,work_started_at:interval.start,work_ended_at:interval.end};
    }
    if(target!=='planned')throw Error('編集対象を確認してください。');
    const local=value=>new Date(Date.parse(value)+9*3600000).toISOString().slice(0,16),first=local(interval.start),last=local(interval.end);
    return scheduleOperation(entity,{title:entity.frontmatter.title,date:first.slice(0,10),timed:true,start:first.slice(11),endDate:last.slice(0,10),end:last.slice(11)});
  }
  function ensureFreshInterval(current, original){if(current.content_hash!==original.content_hash)throw Error('予定・実績が別の操作で変更されました。再読込してから移動してください。');}
  const api = {shiftDate, scheduleOperation, layoutTimed, moveInterval, intervalOperation, ensureFreshInterval};
  if (typeof module !== 'undefined') module.exports = api;
  root.LocalCalendar = api;
  if (!root.document) return;
  document.addEventListener('DOMContentLoaded', () => {
    if (location.pathname !== '/calendar') return;
    document.body.classList.add('local-calendar-route');
    const section = document.createElement('section'); section.id = 'local-calendar-screen'; section.className = 'panel local-calendar';
    const el = (tag, text, parent = section) => { const e = document.createElement(tag); if (text) e.textContent = text; parent.append(e); return e; };
    el('h1', 'カレンダー');
    el('p', '日本時間（JST）／予定・実績・期限を区別して表示します。ローカルTaskの表示です。既存の外部同期設定は変更しません。');
    const controls = el('div', '', section); controls.className = 'calendar-controls';
    const button = (text, handler, parent = controls) => { const b = el('button', text, parent); b.type = 'button'; b.addEventListener('click', handler); return b; };
    const view = el('select', '', controls); view.setAttribute('aria-label', '表示期間');
    for (const [value, label] of [['day','日'],['week','週'],['month','月']]) { const o = el('option', label, view); o.value = value; } view.value = root.innerWidth<=850?'day':'week';
    const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0,10);
    const date = el('input', '', controls); date.type = 'date'; date.value = today(); date.setAttribute('aria-label', '表示日');
    button('前へ', () => {date.value = shiftDate(date.value,view.value,-1); load();});
    button('今日', () => {date.value=today();load();});
    button('次へ', () => {date.value = shiftDate(date.value,view.value,1); load();});
    button('再読込', () => load());
    button('予定を追加', () => edit(null,date.value));
    const legend = el('p', '予定（時刻指定） / 行動日（終日） / 実績（記録） / 期限'); legend.className = 'calendar-legend';
    const message = el('p'); message.className='calendar-status';message.setAttribute('role','status');
    const viewport=el('div');viewport.className='calendar-viewport';const grid = el('div','',viewport); grid.className='calendar-grid';
    const accessible=el('details');accessible.className='calendar-accessible-list';el('summary','予定・実績の一覧と時間調整（短い枠も操作できます）',accessible);const list=el('div','',accessible);
    const dialog = el('dialog'); const form = el('form','',dialog); const dialogTitle=el('h2','予定の追加・変更',form);
    const field = (label,type) => {const wrap=el('label',label,form); const input=el('input','',wrap);input.type=type;return input;};
    const title=field('タイトル','text');title.required=true;
    const startDate=field('開始日 / 行動日（JST）','date');startDate.required=true;
    const timed=field('時刻指定','checkbox');
    const startTime=field('開始時刻（JST）','time'); const endDate=field('終了日（JST）','date'); const endTime=field('終了時刻（JST）','time');
    const error=el('p','',form);error.setAttribute('role','alert');
    const preview=el('pre','',form); preview.className='calendar-preview'; preview.hidden=true;
    const save=el('button','変更内容を確認',form);save.type='submit';
    const apply=button('確認して保存',()=>commit(),form);apply.hidden=true;
    const cancel=button('キャンセル',()=>{if(!applying){editVersion++;pending=null;dialog.close();}},form);
    let snapshot=null, editing=null, pending=null, applying=false, uncertain=false, generation=0, editingTarget='planned', opening=false, recovery=false, previewing=false, editVersion=0;
    let editControls=new Map(),savedOutcome=null,editingDay=null;
    const editKey=(id,target,day)=>JSON.stringify([id,target,day]);
    const request=async(path,body) => {const response=await fetch(path,{method:body?'POST':'GET',headers:{[document.querySelector('meta[name="mutation-marker"]')?.content||'X-GTD-Web']:'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Error(value.error?.message||value.message||'保存・読み込みに失敗しました。');return value;};
    function syncTimed(){startTime.disabled=endDate.disabled=endTime.disabled=!timed.checked;}
    timed.addEventListener('change',syncTimed);
    dialog.addEventListener('cancel',event=>{if(applying){event.preventDefault();return;}editVersion++;pending=null;});
    form.addEventListener('input',()=>{editVersion++;pending=null;apply.hidden=true;preview.hidden=true;save.disabled=false;});
    async function edit(entity, day, target='planned', interval=null) {
      if(applying||uncertain||opening||recovery||dialog.open)return;opening=true;editingTarget=target;editingDay=day;savedOutcome=null;dialogTitle.textContent=target==='actual'?'実績の時間を調整（JST）':'予定の追加・変更（JST）';
      editVersion++;error.textContent='';pending=null;preview.hidden=true;apply.hidden=true;save.disabled=false;
      try {
        editing=entity ? await request('/api/v1/entities/tasks/'+encodeURIComponent(entity.id)) : null;
        if(interval)ensureFreshInterval(editing,entity);
        const fm=editing?.frontmatter||{};title.value=fm.title||'';
        const jstInput=value=>value ? new Date(Date.parse(value)+9*3600000).toISOString().slice(0,16) : '';
        const first=jstInput(interval?.start||(target==='actual'?fm.work_started_at:fm.scheduled_start)),last=jstInput(interval?.end||(target==='actual'?fm.work_ended_at:fm.scheduled_end));
        title.disabled=timed.disabled=target==='actual';
        startDate.value=first.slice(0,10)||fm.action_date||day;timed.checked=Boolean(first&&last);
        startTime.value=first.slice(11)||'09:00';endDate.value=last.slice(0,10)||startDate.value;endTime.value=last.slice(11)||'10:00';syncTimed();dialog.showModal();title.focus();
      } catch(e){message.textContent=e.message;}finally{opening=false;}
    }
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(applying||uncertain||recovery||previewing)return;
      const version=editVersion;previewing=true;save.disabled=true;error.textContent='';
      try {
        const operation=editingTarget==='actual'?intervalOperation(editing,'actual',{start:startDate.value+'T'+startTime.value+':00+09:00',end:endDate.value+'T'+endTime.value+':00+09:00'}):scheduleOperation(editing,{title:title.value,date:startDate.value,timed:timed.checked,start:startTime.value,endDate:endDate.value,end:endTime.value});
        const proposal=await request('/api/v1/mutations/preview',operation);if(version!==editVersion||!dialog.open)return;pending=proposal;
        preview.textContent='次の変更を確認してください。\n'+JSON.stringify(pending.diff||{before:pending.before,after:pending.proposed},null,2);
        preview.hidden=false;apply.hidden=false;
      }catch(e){if(version===editVersion)error.textContent=e.message;}finally{previewing=false;save.disabled=applying||uncertain||recovery;}
    });
    async function commit(){
      if(!pending||applying||uncertain)return;
      applying=true;apply.disabled=save.disabled=cancel.disabled=true;error.textContent='';
      const {preview_hash,...payload}=pending;
      const focusTarget={id:editing?.id,target:editingTarget,day:editingDay};
      try {
        const saved=await request('/api/v1/mutations/apply',{preview:payload,preview_hash});pending=null;
        savedOutcome={...focusTarget,id:focusTarget.id||saved.id,text:(focusTarget.target==='actual'?'実績':'予定')+'を保存しました。',focusPending:true};
        dialog.close();await load();
      }
      catch(e){uncertain=true;pending=null;apply.hidden=true;save.disabled=true;error.textContent='保存結果を確認できません。重複保存を防ぐため再送しません。再読込して予定を確認してください。 '+e.message;}
      finally{applying=false;apply.disabled=cancel.disabled=false;if(!uncertain)save.disabled=false;}
    }
    async function load(){
      const token=++generation;message.textContent='読み込み中…';
      try {
        const [projection, fresh]=await Promise.all([request('/api/v1/calendar?view='+view.value+'&date='+date.value),request('/api/v1/snapshot')]);if(token!==generation)return;
        snapshot=fresh;recovery=Boolean(projection.mutation_state?.recovery_required||fresh.mutation_state?.recovery_required);if(uncertain){uncertain=false;save.disabled=false;}grid.replaceChildren();grid.dataset.view=view.value;editControls=new Map();
        list.replaceChildren();const timeView=view.value!=='month';grid.classList.toggle('calendar-axis',timeView);
        if(timeView){grid.style.setProperty('--calendar-days',projection.days.length);const ruler=el('div','',grid);ruler.className='calendar-ruler';for(let hour=0;hour<=24;hour++){const label=el('span',String(hour).padStart(2,'0')+':00',ruler);label.style.top=hour*60+'px';}}
        const headers=[],untimedRegions=[];
        for(const day of projection.days){
          const cell=el('section','',grid);cell.className='calendar-day';
          const header=el('div','',cell);header.className='calendar-day-header';headers.push(header);
          const heading=el('h2',day.date+' ('+['日','月','火','水','木','金','土'][new Date(day.date+'T00:00:00Z').getUTCDay()]+')',header);heading.className='calendar-date';button('＋ 予定',()=>edit(null,day.date),header);
          const untimedCount=day.events.filter(item=>item.all_day).length;
          const untimedHeading=el('h3','時刻なし '+untimedCount+'件',header);untimedHeading.className='calendar-all-day-heading';untimedHeading.id='calendar-untimed-'+day.date;
          const allDay=el('div','',header);allDay.className='calendar-all-day';allDay.setAttribute('role','region');allDay.setAttribute('aria-labelledby',untimedHeading.id);if(untimedCount)allDay.tabIndex=0;else el('p','時刻なしの項目はありません',allDay);
          const untimedHint=el('p','この欄をスクロールして続きを確認（下の一覧でも確認できます）',header);untimedHint.className='calendar-all-day-hint';untimedHint.hidden=true;untimedRegions.push({region:allDay,hint:untimedHint});
          const track=timeView?el('div','',cell):cell;if(timeView){track.className='calendar-time-column outlook-time-grid';track.dataset.day=day.date;}
          const timedItems=day.events.filter(item=>!item.all_day),layouts=layoutTimed(timedItems,day.date);let timedIndex=0;
          for(const item of day.events){
            const parent=item.all_day?allDay:track,layout=item.all_day?null:layouts[timedIndex++];let row;
            if(item.external&&root.IntegrationRenderers?.[item.provider_id]){row=root.IntegrationRenderers[item.provider_id].render(item,parent,day.date,view.value);root.IntegrationRenderers[item.provider_id].render(item,list,day.date,'month');}
            else {
              row=el('article','',parent);row.className='calendar-event calendar-'+item.kind;
              const labels={planned:'予定',actual:'実績',action:'行動日',deadline:'期限',external:'外部予定'},clock=value=>new Date(Date.parse(value)+9*3600000).toISOString().slice(11,16);
              const time=item.all_day?'':clock(item.start)+'–'+(item.end.slice(0,10)!==day.date?'24:00':clock(item.end));
              el('span',labels[item.kind]+' '+time+' '+item.title+(item.provisional?'（計測中）':''),row);
              const link=el('a',item.title,row);link.href='/clarify?id='+encodeURIComponent(item.id);
              const entity=(snapshot.entities||[]).find(e=>e.id===item.id),target=item.kind==='actual'?'actual':'planned';
              const editable=entity&&!item.archived&&(target==='actual'?item.status==='done'&& !item.provisional:['planned','action','deadline'].includes(item.kind)&&!['doing','done'].includes(item.status));
              const listed=el('div','',list);listed.className='calendar-listed-event';el('span',day.date+' '+labels[item.kind]+' '+time+' '+item.title,listed);const detailLink=el('a','Task詳細',listed);detailLink.href=link.href;
              if(editable){const controls={id:entity.id,target,day:day.date,listed:button(target==='actual'?'実績調整':'予定変更',()=>edit(entity,day.date,target),listed)};const change=button(target==='actual'?'実績調整':'予定変更',()=>edit(entity,day.date,target),row);change.className='calendar-edit';controls.card=change;editControls.set(editKey(entity.id,target,day.date),controls);if(timeView&&!item.all_day)attachIntervalHandles(row,item,entity,target,day.date);}
            }
            if(row&&timeView&&layout){row.classList.add('calendar-axis-event');row.style.top=layout.top+'px';row.style.height=layout.height+'px';row.style.left='calc(100% * '+layout.lane+' / '+layout.columns+')';row.style.width='calc(100% / '+layout.columns+' - 2px)';row.style.right='auto';row.title=item.title+' '+item.start+' → '+item.end;}
          }
        }
        for(const {region,hint} of untimedRegions)hint.hidden=!(region.scrollHeight>region.clientHeight);
        if(timeView){const headerHeight=Math.max(90,...headers.map(header=>header.scrollHeight));grid.style.setProperty('--calendar-header-height',headerHeight+'px');}
        message.textContent=projection.mutation_state?.recovery_required?'復旧待ちです。状態画面を確認してください。':'予定は青、実績は緑、期限は赤で表示します。';
        if(savedOutcome){
          message.textContent=savedOutcome.text+(recovery?' 復旧待ちです。状態画面を確認してください。':'');
          if(savedOutcome.focusPending){
            const controls=editControls.get(editKey(savedOutcome.id,savedOutcome.target,savedOutcome.day))||[...editControls.values()].find(value=>value.id===savedOutcome.id&&value.target===savedOutcome.target);
            (recovery?date:accessible.open?controls?.listed||date:controls?.card||date).focus();savedOutcome.focusPending=false;
          }
        }
        return true;
      }catch(e){if(token===generation){message.textContent=savedOutcome?savedOutcome.text+' 表示を再取得できません。再読込して確認してください。 '+e.message:e.message;if(savedOutcome?.focusPending){date.focus();savedOutcome.focusPending=false;}return false;}}
    }
    function attachIntervalHandles(card,item,entity,target,day){
      const fm=entity.frontmatter,initial={start:target==='actual'?fm.work_started_at:fm.scheduled_start,end:target==='actual'?fm.work_ended_at:fm.scheduled_end};
      for(const mode of ['move','start','end']){
        const handle=button(mode==='move'?'↕':mode==='start'?'開始':'終了',()=>{},card);handle.className='calendar-handle calendar-handle-'+mode;handle.setAttribute('aria-label',(target==='actual'?'実績':'予定')+(mode==='move'?'を移動':mode==='start'?'の開始を調整':'の終了を調整'));
        let origin=null,active=false,next=null,pointer=null;
        const clear=()=>{card.classList.remove('calendar-dragging');origin=null;active=false;next=null;pointer=null;document.removeEventListener('keydown',escape);};
        const escape=event=>{if(event.key==='Escape')clear();};
        handle.addEventListener('pointerdown',event=>{if(applying||uncertain||opening||recovery||dialog.open)return;origin={x:event.clientX,y:event.clientY,minute:event.clientY-card.parentElement.getBoundingClientRect().top};pointer=event.pointerId;handle.setPointerCapture(pointer);document.addEventListener('keydown',escape);});
        handle.addEventListener('pointermove',event=>{if(!origin||event.pointerId!==pointer)return;if(!active&&Math.hypot(event.clientX-origin.x,event.clientY-origin.y)<8)return;active=true;card.classList.add('calendar-dragging');const track=document.elementFromPoint(event.clientX,event.clientY)?.closest('.calendar-time-column');next=null;if(!track)return;const days=(Date.parse(track.dataset.day+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000;try{next=moveInterval(initial,mode,event.clientY-track.getBoundingClientRect().top-origin.minute+days*1440);message.textContent=(target==='actual'?'実績':'予定')+'の変更案: '+next.start+' → '+next.end+'（離すと確認画面）';}catch(e){message.textContent=e.message;}});
        handle.addEventListener('pointerup',()=>{const proposed=active&&next;clear();if(proposed)void edit(entity,day,target,proposed);});handle.addEventListener('pointercancel',clear);handle.addEventListener('lostpointercapture',clear);
      }
    }
    let swipe=null;
    viewport.addEventListener('touchstart',event=>{if(view.value!=='day'||event.target.closest('button,a,input,dialog'))return;const point=event.touches[0];swipe={x:point.clientX,y:point.clientY};},{passive:true});
    viewport.addEventListener('touchend',event=>{if(!swipe)return;const point=event.changedTouches[0],dx=point.clientX-swipe.x,dy=point.clientY-swipe.y;swipe=null;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*2){date.value=shiftDate(date.value,'day',dx<0?1:-1);void load();}},{passive:true});
    viewport.addEventListener('touchcancel',()=>{swipe=null;},{passive:true});
    section.addEventListener('outlook-import-updated',load);
    date.addEventListener('change',load);view.addEventListener('change',load);
    (document.querySelector('main')||document.body).append(section);load();
  });
})(typeof globalThis === 'undefined' ? this : globalThis);
