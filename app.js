"use strict";
/* ============ Константы ============ */
const TYPES={
  cash:{label:"Наличные",debt:false,group:"Деньги"},
  debit:{label:"Карта или счёт",debt:false,group:"Деньги"},
  savings:{label:"Накопления",debt:false,group:"Накопления"},
  credit:{label:"Кредитная карта",debt:true,group:"Долги"},
  loan:{label:"Кредит или ипотека",debt:true,group:"Долги"}
};
const CATS={
  expense:["Продукты","Дом и ЖКХ","Транспорт","Авто","Кафе и рестораны","Здоровье","Дети","Одежда","Развлечения","Связь и подписки","Путешествия","Подарки","Прочее"],
  income:["Зарплата","Подработка","Подарки","Проценты","Возврат","Прочее"]
};
const CUR=["₽","$","€","₴","₸","Br","zł","£"];
const FREQ={weekly:"Каждую неделю",monthly:"Каждый месяц",yearly:"Каждый год"};
const KIND_RU={expense:"Расход",income:"Доход",transfer:"Перевод"};

/* ============ Утилиты ============ */
const pad=n=>String(n).padStart(2,"0");
const ds=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const pd=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const today=()=>ds(new Date());
const ym=d=>d.getFullYear()+"-"+pad(d.getMonth()+1);
const shiftMonth=(m,n)=>{const [y,mo]=m.split("-").map(Number);return ym(new Date(y,mo-1+n,1))};
const monthName=(m,short)=>{const [y,mo]=m.split("-").map(Number);return new Date(y,mo-1,1).toLocaleDateString("ru-RU",short?{month:"short"}:{month:"long",year:"numeric"})};
const addDays=(s,n)=>{const d=pd(s);d.setDate(d.getDate()+n);return ds(d)};
function advance(s,freq,anchor){
  const d=pd(s);
  if(freq==="weekly")return addDays(s,7);
  if(freq==="yearly"){const y=d.getFullYear()+1,dim=new Date(y,d.getMonth()+1,0).getDate();return ds(new Date(y,d.getMonth(),Math.min(d.getDate(),dim)))}
  const y=d.getFullYear(),m=d.getMonth()+1,dim=new Date(y,m+1,0).getDate();
  return ds(new Date(y,m,Math.min(anchor||d.getDate(),dim)));
}
const nf=new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2});
const money=v=>nf.format(Math.round(v*100)/100)+" "+S.settings.currency;
const num=v=>{const x=parseFloat(String(v??"").replace(/\s/g,"").replace(",","."));return Number.isFinite(x)?x:0};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const $=s=>document.querySelector(s);
const g=id=>document.getElementById(id);
function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,2800)}
function dayLabel(d){
  if(d===today())return "Сегодня";
  if(d===addDays(today(),-1))return "Вчера";
  return pd(d).toLocaleDateString("ru-RU",{day:"numeric",month:"long",weekday:"short"});
}
const shortDate=d=>pd(d).toLocaleDateString("ru-RU",{day:"numeric",month:"short"});

/* ============ Состояние ============ */
const S={accounts:[],tx:[],recurring:[],goals:[],settings:{currency:"₽",limits:{},cats:null},
  month:ym(new Date()),tab:"home",names:{},uid:null,readOnly:false,err:null,stage:"boot",authMode:"login",
  session:null,members:[],invite:"",loaded:false,q:"",fKind:"all",fAcc:"all",strat:"avalanche",extra:0};
let draft=null,lastAcc=null,hh=null;
const catList=k=>(S.settings.cats&&S.settings.cats[k]&&S.settings.cats[k].length)?S.settings.cats[k]:CATS[k];
const accName=id=>S.accounts.find(a=>a.id===id)?.name||"—";
const who=id=>S.names[id]||"";
const isDebt=a=>!!TYPES[a.type]?.debt;

/* ============ Расчёты ============ */
function balances(){
  const b={};
  S.accounts.forEach(a=>b[a.id]=a.initial||0);
  S.tx.forEach(t=>{
    if(t.kind==="income"){if(t.acc in b)b[t.acc]+=t.amount}
    else if(t.kind==="expense"){if(t.acc in b)b[t.acc]-=t.amount}
    else if(t.kind==="transfer"){if(t.acc in b)b[t.acc]-=t.amount;if(t.to in b)b[t.to]+=t.amount}
  });
  return b;
}
function monthStats(m){
  const r={income:0,expense:0,debtPaid:0,cats:{},people:{}};
  const debt=new Set(S.accounts.filter(isDebt).map(a=>a.id));
  S.tx.forEach(t=>{
    if(!t.date.startsWith(m))return;
    if(t.kind==="income")r.income+=t.amount;
    else if(t.kind==="expense"){r.expense+=t.amount;r.cats[t.cat]=(r.cats[t.cat]||0)+t.amount;r.people[t.by]=(r.people[t.by]||0)+t.amount}
    else if(t.kind==="transfer"&&debt.has(t.to))r.debtPaid+=t.amount;
  });
  return r;
}
function worth(b){
  let assets=0,debts=0,savings=0;
  S.accounts.forEach(a=>{const v=b[a.id]||0;if(isDebt(a))debts+=v;else{assets+=v;if(a.type==="savings")savings+=v}});
  return {assets,debts,savings,net:assets+debts};
}
function netSeries(n){
  const init=S.accounts.reduce((s,a)=>s+(a.initial||0),0);
  const delta={};
  S.tx.forEach(t=>{const m=t.date.slice(0,7);if(t.kind==="income")delta[m]=(delta[m]||0)+t.amount;else if(t.kind==="expense")delta[m]=(delta[m]||0)-t.amount});
  const months=[];for(let i=n-1;i>=0;i--)months.push(shiftMonth(S.month,-i));
  let run=init;Object.keys(delta).forEach(m=>{if(m<months[0])run+=delta[m]});
  return months.map(m=>{run+=delta[m]||0;return {m,v:run}});
}
function upcoming(days){
  const out=[],end=addDays(today(),days),t0=today();
  S.recurring.filter(r=>r.active).forEach(r=>{
    let d=r.next,c=0;
    while(d<=end&&c<40){if(r.end&&d>r.end)break;if(d>=t0)out.push({...r,date:d});d=advance(d,r.freq,r.anchor);c++}
  });
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}
function simDebt(extra,strat){
  const b=balances();
  const ds_=S.accounts.filter(a=>isDebt(a)&&(b[a.id]||0)<-0.005).map(a=>{
    const bal=-b[a.id];return {name:a.name,bal,rate:(a.rate||0)/1200,min:a.payment||Math.max(bal*0.05,1),done:false};
  });
  if(!ds_.length)return null;
  const pool=ds_.reduce((s,d)=>s+d.min,0)+extra;
  let months=0,interest=0;const order=[];
  while(ds_.some(d=>d.bal>0.005)&&months<600){
    months++;
    ds_.forEach(d=>{if(d.bal>0){const i=d.bal*d.rate;d.bal+=i;interest+=i}});
    let avail=pool;
    ds_.forEach(d=>{if(d.bal>0){const p=Math.min(d.min,d.bal,avail);d.bal-=p;avail-=p}});
    const live=ds_.filter(d=>d.bal>0.005).sort(strat==="avalanche"?(a,c)=>c.rate-a.rate:(a,c)=>a.bal-c.bal);
    if(live[0]&&avail>0)live[0].bal-=Math.min(avail,live[0].bal);
    ds_.forEach(d=>{if(d.bal<=0.005&&!d.done){d.done=true;order.push({name:d.name,month:months})}});
  }
  return {months,interest,order,capped:months>=600,pool};
}
function monthsText(n){
  const y=Math.floor(n/12),m=n%12,p=[];
  if(y)p.push(y+" "+(y%10===1&&y!==11?"год":(y%10>=2&&y%10<=4&&(y<10||y>20))?"года":"лет"));
  if(m)p.push(m+" мес.");
  return p.join(" ")||"меньше месяца";
}
function dateAfter(months){const d=new Date();d.setMonth(d.getMonth()+months);return d.toLocaleDateString("ru-RU",{month:"long",year:"numeric"})}

/* ============ Общие части интерфейса ============ */
function sheet(inner){
  $("#overlay").innerHTML=`<div id="shade" data-act="close"></div><div id="sheet" role="dialog" aria-modal="true"><div class="panel">${inner}</div></div>`;
}
function closeSheet(){$("#overlay").innerHTML="";draft=null;render()}
const opts=(sel,list,empty)=>(empty?`<option value="">${esc(empty)}</option>`:"")+list.map(a=>`<option value="${esc(a.id)}" ${a.id===sel?"selected":""}>${esc(a.name)}</option>`).join("");
const seg=(items,cur,act)=>`<div class="seg" role="group">${items.map(([k,l])=>`<button data-act="${act}" data-k="${k}" aria-pressed="${cur===k}">${l}</button>`).join("")}</div>`;
const delta=(cur,prev,badUp)=>{
  if(!(prev>0))return "";
  const p=Math.round((cur-prev)/prev*100);if(p===0)return "";
  const up=p>0,bad=badUp?up:!up;
  return `<span class="delta ${bad?"neg":"pos"}">${up?"▲":"▼"} ${Math.abs(p)}%</span>`;
};

/* ============ Отрисовка ============ */
function render(){
  const inApp=S.stage==="app";
  document.querySelector("nav.tabs").hidden=!inApp;
  $("#monthnav").style.visibility=(inApp&&["home","tx"].includes(S.tab))?"visible":"hidden";
  $("#fab").hidden=!inApp||S.readOnly||!["home","tx","acc"].includes(S.tab);
  $("#monthlabel").textContent=monthName(S.month);
  document.querySelectorAll("#tabs button").forEach(b=>b.setAttribute("aria-current",b.dataset.tab===S.tab));
  const app=$("#app");
  if(S.stage==="boot"){app.innerHTML=`<div class="card empty">Загружаю…</div>`;return}
  if(S.stage==="auth"){app.innerHTML=vAuth();return}
  if(S.stage==="house"){app.innerHTML=vHouse();return}
  if(S.err){app.innerHTML=`<div class="card empty"><b>Не удалось загрузить данные</b>${esc(S.err)}<div style="margin-top:14px"><button class="btn" data-act="reload">Повторить</button></div></div>`;return}
  if(!S.loaded){app.innerHTML=`<div class="card empty">Загружаю…</div>`;return}
  app.innerHTML=({home:vHome,tx:vTx,acc:vAcc,plan:vPlan,more:vMore}[S.tab])();
}

function vAuth(){
  const reg=S.authMode==="reg";
  return `<form class="card" id="authform" style="margin-top:24px">
    <h1 style="font:600 22px var(--f-display);margin:0 0 4px">${reg?"Регистрация":"Вход"}</h1>
    <p class="note" style="margin:0 0 16px">Семейный бюджет</p>
    <div class="fld"><label for="au-email">Почта</label><input id="au-email" type="email" autocomplete="email" required></div>
    <div class="fld"><label for="au-pass">Пароль (не короче 6 символов)</label><input id="au-pass" type="password" minlength="6" autocomplete="${reg?"new-password":"current-password"}" required></div>
    <button class="btn block" type="submit">${reg?"Создать аккаунт":"Войти"}</button>
    <p style="text-align:center;margin:14px 0 0"><button class="link" type="button" data-act="auth-mode">${reg?"Уже есть аккаунт? Войти":"Нет аккаунта? Зарегистрироваться"}</button></p></form>`;
}
function vHouse(){
  return `<div class="card" style="margin-top:24px">
    <h1 style="font:600 22px var(--f-display);margin:0 0 4px">Ваша семья</h1>
    <p class="note" style="margin:0 0 16px">Один из вас создаёт семью, второй вводит код приглашения.</p>
    <div class="fld"><label for="h-name">Ваше имя</label><input id="h-name" type="text" maxlength="30" autocomplete="given-name"></div>
    <button class="btn block" data-act="h-create">Создать семью</button>
    <h2>или</h2>
    <div class="fld"><label for="h-code">Код приглашения</label><input id="h-code" type="text" autocapitalize="off" autocomplete="off"></div>
    <button class="btn ghost block" data-act="h-join">Присоединиться</button>
    <p style="text-align:center;margin:14px 0 0"><button class="link" data-act="logout">Выйти</button></p></div>`;
}

/* ---------- Обзор ---------- */
function nwChart(){
  const pts=netSeries(12),W=320,H=110,L=8,R=8,T=14,B=22;
  const vs=pts.map(p=>p.v),mn=Math.min(...vs),mx=Math.max(...vs),span=(mx-mn)||1;
  const x=i=>L+i*(W-L-R)/(pts.length-1),y=v=>T+(1-(v-mn)/span)*(H-T-B);
  const line=pts.map((p,i)=>`${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area=`${x(0)},${H-B} ${line} ${x(pts.length-1)},${H-B}`;
  const last=pts[pts.length-1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Чистый капитал за 12 месяцев">
    <line x1="${L}" x2="${W-R}" y1="${H-B}" y2="${H-B}" stroke="var(--line)"/>
    <polygon points="${area}" fill="var(--accent)" opacity=".12"/>
    <polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${x(pts.length-1)}" cy="${y(last.v)}" r="3.5" fill="var(--accent)"/>
    <text x="${L}" y="${H-6}">${esc(monthName(pts[0].m,true))}</text>
    <text x="${W-R}" y="${H-6}" text-anchor="end">${esc(monthName(last.m,true))}</text>
    <text x="${L}" y="10">${mn!==mx?"макс. ":""}${esc(money(mx))}</text>
    ${mn!==mx?`<text x="${W-R}" y="10" text-anchor="end">мин. ${esc(money(mn))}</text>`:""}
  </svg>`;
}
function vHome(){
  const b=balances(),w=worth(b),st=monthStats(S.month),pv=monthStats(shiftMonth(S.month,-1));
  if(!S.accounts.length)return `<div class="card empty"><b>Начните со счетов</b>Добавьте кошелёк, карту, накопления, кредитную карту или кредит. Остальное считается само.<div style="margin-top:14px"><button class="btn" data-act="add-acc">Добавить счёт</button></div></div>`;
  const left=st.income-st.expense;
  let h=`<section class="card hero">
    <div><div class="lab">Чистый капитал</div><div class="big num ${w.net<0?"neg":""}">${money(w.net)}</div></div>
    <div class="trio">
      <div><div class="lab">Деньги</div><div class="v num">${money(w.assets)}</div></div>
      <div><div class="lab">Накопления</div><div class="v num pos">${money(w.savings)}</div></div>
      <div><div class="lab">Долги</div><div class="v num neg">${money(Math.abs(w.debts))}</div></div>
    </div></section>`;
  h+=`<h2>${esc(monthName(S.month))}</h2><section class="card hero">
    <div class="trio">
      <div><div class="lab">Доходы</div><div class="v num pos">${money(st.income)}</div>${delta(st.income,pv.income,false)}</div>
      <div><div class="lab">Расходы</div><div class="v num neg">${money(st.expense)}</div>${delta(st.expense,pv.expense,true)}</div>
      <div><div class="lab">Осталось</div><div class="v num ${left<0?"neg":""}">${money(left)}</div></div>
    </div>
    ${st.income>0?`<div class="note">Откладывается: <b>${Math.round(left/st.income*100)}%</b> дохода${pv.income>0?` (в прошлом месяце ${Math.round((pv.income-pv.expense)/pv.income*100)}%)`:""}.</div>`:""}
    ${st.debtPaid?`<div class="note">Отправлено на погашение долгов: <span class="num">${money(st.debtPaid)}</span></div>`:""}
    <div class="note">Стрелки показывают изменение к прошлому месяцу.</div>
  </section>`;

  const now=new Date();
  if(S.month===ym(now)){
    const day=now.getDate(),dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    const proj=st.expense/day*dim;
    const lims=S.settings.limits||{},limCats=Object.keys(lims).filter(c=>num(lims[c])>0);
    const L=limCats.reduce((s,c)=>s+num(lims[c]),0),spentL=limCats.reduce((s,c)=>s+(st.cats[c]||0),0);
    const sched=upcoming(dim-day).filter(r=>r.kind==="expense"||(r.kind==="transfer"&&S.accounts.find(a=>a.id===r.to&&isDebt(a)))).reduce((s,r)=>s+r.amount,0);
    h+=`<h2>Прогноз</h2><section class="card">
      <div class="kv"><span>Расходы к концу месяца при текущем темпе</span><b class="num">${money(proj)}</b></div>
      ${sched?`<div class="kv"><span>Запланированные платежи до конца месяца</span><b class="num">${money(sched)}</b></div>`:""}
      ${L?`<div class="kv"><span>Осталось по лимитам</span><b class="num ${L-spentL<0?"neg":""}">${money(L-spentL)}</b></div>
      <div class="kv"><span>Можно тратить в день</span><b class="num ${L-spentL<0?"neg":""}">${money(Math.max(0,(L-spentL)/(dim-day+1)))}</b></div>`:`<div class="note">Задайте лимиты на вкладке «Ещё», и здесь появится «сколько можно тратить в день».</div>`}
    </section>`;
  }

  const cats=Object.entries(st.cats).sort((a,c)=>c[1]-a[1]);
  h+=`<h2>Расходы по категориям</h2>`;
  if(!cats.length)h+=`<div class="card empty"><b>В этом месяце расходов нет</b>Нажмите «+ Операция», чтобы добавить первую.</div>`;
  else{
    const mx=Math.max(...cats.map(c=>c[1]),...Object.values(S.settings.limits||{}).map(Number).filter(Boolean));
    h+=`<div class="card">`+cats.map(([c,v])=>{
      const lim=num(S.settings.limits?.[c]);
      const pct=Math.min(100,(lim?v/lim:v/mx)*100);
      const cls=lim&&v>lim?"over":(lim&&v>lim*.85?"warn":"");
      return `<div class="cat"><div class="h"><span>${esc(c)}${delta(v,pv.cats[c]||0,true)}</span><span class="num">${money(v)}${lim?` <span class="muted">из ${nf.format(lim)}</span>`:""}</span></div><div class="bar ${cls}"><i style="width:${pct}%"></i></div></div>`;
    }).join("")+`</div>`;
  }
  const people=Object.entries(st.people).filter(([id])=>id);
  if(people.length>1||(people.length===1&&S.members.length>1)){
    h+=`<h2>Кто сколько потратил</h2><div class="card">`+people.sort((a,c)=>c[1]-a[1]).map(([id,v])=>
      `<div class="kv"><span>${esc(who(id)||"Без имени")}</span><b class="num">${money(v)}</b></div>`).join("")+`</div>`;
  }

  const ms=[];for(let i=5;i>=0;i--)ms.push(shiftMonth(S.month,-i));
  const data=ms.map(m=>({m,...monthStats(m)}));
  const top=Math.max(1,...data.map(d=>Math.max(d.income,d.expense)));
  h+=`<h2>Доходы и расходы, 6 месяцев</h2><div class="card"><div class="months">`+data.map(d=>
    `<div><div class="cols"><i class="in" style="height:${d.income/top*100}%" title="Доходы ${esc(money(d.income))}"></i><i class="out" style="height:${d.expense/top*100}%" title="Расходы ${esc(money(d.expense))}"></i></div><small>${esc(monthName(d.m,true))}</small></div>`).join("")+
    `</div><div class="legend"><span>Доходы</span><span class="o">Расходы</span></div></div>`;
  h+=`<h2>Чистый капитал, 12 месяцев</h2><div class="card">${nwChart()}<div class="note">Считается по всем операциям, как если бы все счета существовали с начала.</div></div>`;
  return h;
}

/* ---------- Операции ---------- */
function filtered(){
  const q=S.q.trim().toLowerCase();
  let list=S.tx;
  if(!q)list=list.filter(t=>t.date.startsWith(S.month));
  if(S.fKind!=="all")list=list.filter(t=>t.kind===S.fKind);
  if(S.fAcc!=="all")list=list.filter(t=>t.acc===S.fAcc||t.to===S.fAcc);
  if(q)list=list.filter(t=>[t.cat,t.note,accName(t.acc),t.to?accName(t.to):"",who(t.by),String(t.amount)].join(" ").toLowerCase().includes(q));
  return list;
}
function txRow(t){
  const sign=t.kind==="income"?"+":t.kind==="expense"?"−":"";
  const cls=t.kind==="income"?"pos":t.kind==="expense"?"neg":"";
  const dot=t.kind==="income"?"+":t.kind==="expense"?"−":"⇄";
  const title=t.kind==="transfer"?`${accName(t.acc)} → ${accName(t.to)}`:t.cat;
  const sub=[t.kind==="transfer"?"Перевод":accName(t.acc),t.note,who(t.by)].filter(Boolean).join(" · ");
  return `<button class="row" data-act="edit-tx" data-id="${esc(t.id)}"><span class="dot ${t.kind==="expense"?"e":t.kind==="transfer"?"t":""}">${dot}</span>
    <span class="main"><div class="t">${esc(title)}${t.auto?`<span class="tag">авто</span>`:""}</div><div class="s">${esc(sub)}</div></span>
    <span class="amt num ${cls}">${sign}${money(t.amount)}</span></button>`;
}
function txListHtml(){
  const list=filtered();
  if(!list.length)return `<div class="card empty"><b>Ничего не найдено</b>${S.q?"Измените запрос или фильтры.":`В ${esc(monthName(S.month))} операций нет. Добавьте расход, доход или перевод.`}</div>`;
  const inc=list.filter(t=>t.kind==="income").reduce((s,t)=>s+t.amount,0),exp=list.filter(t=>t.kind==="expense").reduce((s,t)=>s+t.amount,0);
  const shown=list.slice(0,300),days={};
  shown.forEach(t=>(days[t.date]??=[]).push(t));
  return `<div class="note" style="margin:4px 0 0">${S.q?"Поиск по всем месяцам. ":""}Операций: ${list.length} · расходы ${esc(money(exp))} · доходы ${esc(money(inc))}</div>`+
    Object.keys(days).sort().reverse().map(d=>`<div class="dayh">${esc(dayLabel(d))}</div><div class="card" style="padding-top:2px;padding-bottom:2px">${days[d].map(txRow).join("")}</div>`).join("")+
    (list.length>300?`<div class="note" style="margin-top:10px">Показаны первые 300. Уточните поиск.</div>`:"");
}
function vTx(){
  return `<div class="filters">
    <input id="q" type="search" placeholder="Поиск: заметка, категория, сумма, имя" value="${esc(S.q)}" style="grid-column:1/-1" aria-label="Поиск">
    <select id="fk" aria-label="Тип"><option value="all">Все типы</option>${Object.entries(KIND_RU).map(([k,l])=>`<option value="${k}" ${S.fKind===k?"selected":""}>${l}</option>`).join("")}</select>
    <select id="fa" aria-label="Счёт"><option value="all">Все счета</option>${opts(S.fAcc,S.accounts)}</select></div>
    <div id="txlist">${txListHtml()}</div>`;
}

/* ---------- Счета ---------- */
function monthsLeft(debt,rate,pay){
  const r=rate/1200;if(!pay||pay<=0)return null;
  if(!r)return Math.ceil(debt/pay);
  const x=1-r*debt/pay;if(x<=0)return null;
  return Math.ceil(-Math.log(x)/Math.log(1+r));
}
function accRow(a,b){
  const v=b[a.id]||0,T=TYPES[a.type]||TYPES.debit;
  let sub=T.label,extra="";
  if(a.type==="credit"){
    const debt=Math.max(0,-v);
    if(a.limit){const used=Math.min(100,debt/a.limit*100);sub+=` · доступно ${money(Math.max(0,a.limit-debt))}`;extra=`<div class="bar ${used>80?"over":used>50?"warn":""}" style="margin-top:6px"><i style="width:${used}%"></i></div>`}
  }
  if(a.rate&&isDebt(a))sub+=` · ${a.rate}%`;
  if(a.payment&&isDebt(a)){sub+=` · платёж ${money(a.payment)}`;const n=v<0?monthsLeft(-v,a.rate||0,a.payment):null;if(n)sub+=` · ещё ~${n} мес.`}
  return `<button class="row" data-act="edit-acc" data-id="${esc(a.id)}"><span class="dot ${isDebt(a)?"e":""}">${esc(a.name.slice(0,1).toUpperCase())}</span>
    <span class="main"><div class="t">${esc(a.name)}</div><div class="s">${esc(sub)}</div>${extra}</span>
    <span class="amt num ${v<0?"neg":""}">${money(v)}</span></button>`;
}
function planner(){
  const a=simDebt(S.extra,S.strat);
  if(!a)return "";
  const base=simDebt(0,S.strat);
  const other=simDebt(S.extra,S.strat==="avalanche"?"snowball":"avalanche");
  let h=`<h2>Погашение долгов</h2><div class="card">
    <div class="two"><div class="fld"><label for="extra">Доплата сверх платежей, ${esc(S.settings.currency)}/мес</label><input id="extra" class="inl" type="number" inputmode="decimal" min="0" step="any" value="${S.extra||""}" placeholder="0"></div>
    <div class="fld"><label for="strat">Метод</label><select id="strat" class="inl"><option value="avalanche" ${S.strat==="avalanche"?"selected":""}>Лавина (сначала дорогие)</option><option value="snowball" ${S.strat==="snowball"?"selected":""}>Снежный ком (сначала мелкие)</option></select></div></div>`;
  if(a.capped)h+=`<div class="note neg">При таких платежах долги не гасятся за 50 лет. Укажите платёж по кредитам или добавьте доплату.</div>`;
  else{
    h+=`<div class="kv"><span>Без доплаты</span><b>${esc(monthsText(base.months))} (${esc(dateAfter(base.months))})</b></div>
    <div class="kv"><span>Переплата процентами</span><b class="num">${money(base.interest)}</b></div>`;
    if(S.extra>0){
      h+=`<div class="kv"><span>С доплатой</span><b class="pos">${esc(monthsText(a.months))} (${esc(dateAfter(a.months))})</b></div>
      <div class="kv"><span>Переплата процентами</span><b class="num">${money(a.interest)}</b></div>
      <div class="kv"><span>Экономия</span><b class="num pos">${money(Math.max(0,base.interest-a.interest))} и ${esc(monthsText(Math.max(0,base.months-a.months)))}</b></div>`;
      if(!other.capped&&Math.abs(other.interest-a.interest)>1)h+=`<div class="note">Другой метод: переплата ${esc(money(other.interest))}, срок ${esc(monthsText(other.months))}.</div>`;
    }
    h+=`<div class="note" style="margin-top:8px">Очерёдность закрытия: ${a.order.map(o=>`${esc(o.name)} (через ${o.month} мес.)`).join(", ")}.</div>`;
  }
  return h+`<div class="note" style="margin-top:8px">Если у долга не указан платёж, берётся 5% остатка в месяц.</div></div>`;
}
function vAcc(){
  const b=balances(),w=worth(b);
  let h=`<section class="card hero"><div class="trio">
    <div><div class="lab">Всего денег</div><div class="v num">${money(w.assets)}</div></div>
    <div><div class="lab">Долги</div><div class="v num neg">${money(Math.abs(w.debts))}</div></div>
    <div><div class="lab">Капитал</div><div class="v num ${w.net<0?"neg":""}">${money(w.net)}</div></div></div></section>`;
  if(!S.accounts.length)h+=`<div class="card empty" style="margin-top:12px"><b>Счетов пока нет</b>Добавьте всё, где лежат деньги или откуда вы должны.</div>`;
  ["Деньги","Накопления","Долги"].forEach(gr=>{
    const items=S.accounts.filter(a=>(TYPES[a.type]||TYPES.debit).group===gr);
    if(items.length)h+=`<h2>${gr}</h2><div class="card" style="padding-top:2px;padding-bottom:2px">${items.map(a=>accRow(a,b)).join("")}</div>`;
  });
  h+=planner();
  if(!S.readOnly)h+=`<div style="margin-top:16px"><button class="btn ghost block" data-act="add-acc">+ Добавить счёт</button></div>`;
  return h;
}

/* ---------- Планы ---------- */
function goalNow(g_,b){return (g_.acc&&(g_.acc in b))?Math.max(0,b[g_.acc]):g_.saved}
function vPlan(){
  const b=balances(),up=upcoming(30);
  let h=`<h2>Ближайшие 30 дней</h2>`;
  if(!up.length)h+=`<div class="card empty"><b>Запланированных платежей нет</b>Добавьте регулярные операции: аренду, кредит, подписки, зарплату.</div>`;
  else{
    const out=up.filter(r=>r.kind==="expense").reduce((s,r)=>s+r.amount,0),inc=up.filter(r=>r.kind==="income").reduce((s,r)=>s+r.amount,0);
    h+=`<div class="card" style="padding-top:2px;padding-bottom:2px">`+up.map(r=>{
      const title=r.kind==="transfer"?`${accName(r.acc)} → ${accName(r.to)}`:r.cat;
      return `<div class="row"><span class="dot ${r.kind==="expense"?"e":r.kind==="transfer"?"t":""}">${r.kind==="income"?"+":r.kind==="expense"?"−":"⇄"}</span><span class="main"><div class="t">${esc(title)}</div><div class="s">${esc(shortDate(r.date))}${r.note?" · "+esc(r.note):""}</div></span><span class="amt num ${r.kind==="income"?"pos":r.kind==="expense"?"neg":""}">${money(r.amount)}</span></div>`}).join("")+`</div>
    <div class="note" style="margin-top:8px">Расходы: ${esc(money(out))} · доходы: ${esc(money(inc))}</div>`;
  }
  h+=`<h2>Регулярные операции</h2><div class="card" style="padding-top:2px;padding-bottom:2px">`;
  h+=S.recurring.length?S.recurring.map(r=>{
    const title=r.kind==="transfer"?`${accName(r.acc)} → ${accName(r.to)}`:r.cat;
    return `<button class="row" data-act="edit-rec" data-id="${esc(r.id)}"><span class="dot ${r.kind==="expense"?"e":r.kind==="transfer"?"t":""}">${r.kind==="income"?"+":r.kind==="expense"?"−":"⇄"}</span><span class="main"><div class="t">${esc(title)}${r.active?"":`<span class="tag">пауза</span>`}</div><div class="s">${esc(FREQ[r.freq])} · следующая ${esc(shortDate(r.next))}</div></span><span class="amt num">${money(r.amount)}</span></button>`}).join(""):`<div class="note" style="padding:12px 0">Пока ничего нет.</div>`;
  h+=`</div>`;
  if(!S.readOnly)h+=`<div style="margin-top:10px"><button class="btn ghost block" data-act="add-rec">+ Регулярная операция</button></div>`;

  h+=`<h2>Цели накоплений</h2>`;
  if(!S.goals.length)h+=`<div class="card empty"><b>Целей пока нет</b>Отпуск, подушка безопасности, ремонт. Привяжите цель к счёту накоплений, и прогресс будет считаться сам.</div>`;
  else h+=`<div class="stack">`+S.goals.map(gl=>{
    const cur=goalNow(gl,b),pct=Math.min(100,cur/gl.target*100);
    let note="";
    if(cur>=gl.target)note=`<span class="pos">Цель достигнута</span>`;
    else if(gl.deadline){
      const days=Math.round((pd(gl.deadline)-pd(today()))/864e5);
      if(days<=0)note=`<span class="neg">Срок прошёл, не хватает ${esc(money(gl.target-cur))}</span>`;
      else note=`До ${esc(shortDate(gl.deadline))}: откладывать ~${esc(money((gl.target-cur)/Math.max(1,Math.ceil(days/30.4))))} в месяц`;
    }
    return `<button class="card" data-act="edit-goal" data-id="${esc(gl.id)}" style="text-align:left;width:100%"><div class="cat" style="border:0;padding:0"><div class="h"><b>${esc(gl.name)}</b><span class="num">${money(cur)} <span class="muted">из ${nf.format(gl.target)}</span></span></div><div class="bar"><i style="width:${pct}%"></i></div><div class="note" style="margin-top:6px">${gl.acc?esc(accName(gl.acc))+" · ":""}${Math.round(pct)}%${note?" · "+note:""}</div></div></button>`;
  }).join("")+`</div>`;
  if(!S.readOnly)h+=`<div style="margin-top:10px"><button class="btn ghost block" data-act="add-goal">+ Цель</button></div>`;
  return h;
}

/* ---------- Ещё ---------- */
function vMore(){
  const st=monthStats(S.month),exp=catList("expense");
  const lims=S.settings.limits||{},all=[...new Set([...exp,...Object.keys(lims)])];
  let h=`<h2>Лимиты на месяц</h2><div class="card">`+all.map(c=>{
    const v=lims[c]||"";
    return `<div class="lim"><div><div>${esc(c)}</div><div class="s muted num" style="font-size:12px">${esc(monthName(S.month,true))}: ${money(st.cats[c]||0)}</div></div><input type="number" inputmode="decimal" min="0" step="any" data-lim="${esc(c)}" value="${esc(v)}" placeholder="без лимита" aria-label="Лимит: ${esc(c)}"></div>`;
  }).join("")+`</div>`;
  h+=`<h2>Валюта</h2><div class="card"><div class="fld" style="margin:0"><label for="cur">Знак валюты</label><select id="cur">${CUR.map(c=>`<option ${c===S.settings.currency?"selected":""}>${c}</option>`).join("")}</select></div></div>`;
  h+=`<div style="margin-top:14px"><button class="btn block" data-act="save-bud" ${S.readOnly?"disabled":""}>Сохранить лимиты и валюту</button></div>`;
  h+=`<h2>Категории</h2><div class="card"><p class="note" style="margin:0 0 10px">Добавляйте свои категории, переименовывайте и убирайте ненужные. При переименовании меняются и прошлые операции.</p><button class="btn ghost block" data-act="edit-cats" ${S.readOnly?"disabled":""}>Изменить категории</button></div>`;
  h+=`<h2>Данные</h2><div class="card stack"><button class="btn ghost block" data-act="export">Скачать операции (CSV)</button><button class="btn ghost block" data-act="import" ${S.readOnly?"disabled":""}>Загрузить операции из CSV</button>
    <div class="note">Таблица открывается в Excel и Google Таблицах. Для загрузки нужны колонки: Дата, Тип, Сумма, Категория, Счёт, Куда, Заметка.</div></div>`;
  h+=`<h2>Семья</h2><div class="card">
    <div class="fld" style="margin-bottom:8px"><label>Код приглашения для второго участника</label><div style="display:flex;gap:8px;align-items:center"><b class="num" style="font-size:20px;letter-spacing:.08em">${esc(S.invite)}</b><button class="link" data-act="copy-code">Скопировать</button></div></div>
    <div class="note" style="margin-bottom:12px">Участники: ${S.members.map(m=>esc(m.display_name||"без имени")).join(", ")||"—"}</div>
    <button class="btn ghost block" data-act="logout">Выйти из аккаунта</button></div>`;
  h+=`<h2>Установка на телефон</h2><div class="card note">
    <p style="margin:0 0 8px"><b>iPhone:</b> откройте сайт в Safari, нажмите «Поделиться», затем «На экран “Домой”».</p>
    <p style="margin:0"><b>Android:</b> откройте в Chrome, меню ⋮, «Установить приложение» или «Добавить на главный экран».</p></div>`;
  return h;
}

/* ============ Формы ============ */
const SPEC={tx:["f",["amount","date","cat","acc","to","note"]],acc:["a",["name","kind","amount","limit","rate","payment","actual"]],
  rec:["r",["amount","cat","acc","to","note","freq","next","end","active"]],goal:["g",["name","target","acc","saved","deadline"]]};
function syncDraft(){
  if(!draft||!SPEC[draft.type])return;
  const [p,keys]=SPEC[draft.type];
  keys.forEach(k=>{const el=g(p+"-"+k);if(el)draft[k]=el.type==="checkbox"?el.checked:el.value});
}
const fldNum=(id,label,val,ph)=>`<div class="fld"><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="decimal" min="0" step="any" value="${esc(val)}" ${ph?`placeholder="${esc(ph)}"`:""}></div>`;

/* --- операция --- */
function openTx(id,kind){
  if(!S.accounts.length){toast("Сначала добавьте счёт");return openAcc()}
  const t=id?S.tx.find(x=>x.id===id):null;
  draft=t?{type:"tx",id,by:t.by,kind:t.kind,amount:String(t.amount),date:t.date,cat:t.cat||"",acc:t.acc,to:t.to||"",note:t.note||"",confirm:false,touched:true}
         :{type:"tx",id:null,kind:kind||"expense",amount:"",date:today(),cat:"",acc:S.accounts.some(a=>a.id===lastAcc)?lastAcc:S.accounts[0].id,to:"",note:"",confirm:false,touched:false};
  txSheet();
}
function recents(kind){
  const seen=new Set(),out=[];
  for(const t of S.tx){
    if(t.kind!==kind)continue;
    const k=[t.cat,t.note,t.amount,t.acc,t.to].join("|");
    if(seen.has(k))continue;seen.add(k);out.push(t);if(out.length>=5)break;
  }
  return out;
}
function txSheet(){
  const d=draft,accs=S.accounts;
  if(d.kind!=="transfer"&&!d.cat)d.cat=catList(d.kind)[0];
  if(d.kind==="transfer"&&(!d.to||d.to===d.acc))d.to=(accs.find(a=>a.id!==d.acc)||{}).id||"";
  const cl=d.kind==="transfer"?[]:[...new Set([...catList(d.kind),d.cat].filter(Boolean))];
  const notes=[...new Set(S.tx.map(t=>t.note).filter(Boolean))].slice(0,80);
  const rc=!d.id?recents(d.kind):[];
  sheet(`${seg([["expense","Расход"],["income","Доход"],["transfer","Перевод"]],d.kind,"kind")}
    ${rc.length?`<div class="chips" aria-label="Недавние">${rc.map(t=>`<button class="chip" data-act="recent" data-id="${esc(t.id)}">${esc(t.note||t.cat||"Перевод")} · ${nf.format(t.amount)}</button>`).join("")}</div>`:""}
    <div class="fld"><label for="f-amount">Сумма, ${esc(S.settings.currency)}</label><input class="amount" id="f-amount" type="number" inputmode="decimal" min="0" step="any" value="${esc(d.amount)}" placeholder="0" autofocus></div>
    ${d.kind==="transfer"?"":`<div class="fld"><label for="f-cat">Категория</label><select id="f-cat">${cl.map(c=>`<option ${c===d.cat?"selected":""}>${esc(c)}</option>`).join("")}</select></div>`}
    <div class="two">
      <div class="fld"><label for="f-acc">${d.kind==="transfer"?"Откуда":"Счёт"}</label><select id="f-acc">${opts(d.acc,accs)}</select></div>
      ${d.kind==="transfer"?`<div class="fld"><label for="f-to">Куда</label><select id="f-to">${opts(d.to,accs.filter(a=>a.id!==d.acc))}</select></div>`
        :`<div class="fld"><label for="f-date">Дата</label><input id="f-date" type="date" value="${esc(d.date)}"></div>`}
    </div>
    ${d.kind==="transfer"?`<div class="fld"><label for="f-date">Дата</label><input id="f-date" type="date" value="${esc(d.date)}"></div>`:""}
    <div class="fld"><label for="f-note">Заметка</label><input id="f-note" type="text" list="notes" value="${esc(d.note)}" placeholder="Необязательно" maxlength="120" autocomplete="off"><datalist id="notes">${notes.map(n=>`<option value="${esc(n)}">`).join("")}</datalist></div>
    ${d.kind==="transfer"?`<p class="note" style="margin:-4px 0 12px">Погашение кредита или карты: выберите «Куда» долговой счёт.</p>`:""}
    <div class="actions">
      ${d.id?`<button class="btn danger" data-act="del-tx">${d.confirm?"Точно удалить?":"Удалить"}</button>`:`<button class="btn ghost" data-act="close">Отмена</button>`}
      <button class="btn" data-act="save-tx">Сохранить</button></div>
    ${d.id?`<p style="text-align:center;margin:12px 0 0"><button class="link" data-act="dup-tx">Дублировать на сегодня</button></p>`:""}`);
}
async function saveTx(){
  syncDraft();const d=draft;
  const amount=num(d.amount);
  if(!(amount>0))return toast("Введите сумму больше нуля");
  if(!d.date)return toast("Укажите дату");
  if(d.kind==="transfer"&&(!d.to||d.to===d.acc))return toast("Выберите два разных счёта");
  const rec={kind:d.kind,amount:Math.round(amount*100)/100,date:d.date,acc:d.acc,note:d.note.trim(),by:d.by||S.uid||""};
  if(d.kind==="transfer")rec.to=d.to;else rec.cat=d.cat;
  try{
    await api.saveTx(d.id,rec);lastAcc=d.acc;
    if(!rec.date.startsWith(S.month))S.month=rec.date.slice(0,7);
    closeSheet();toast("Сохранено");
  }catch(e){toast("Не удалось сохранить: "+(e.message||e.code))}
}
async function delTx(){
  if(!draft.confirm){syncDraft();draft.confirm=true;return txSheet()}
  try{await api.del("transactions",draft.id);closeSheet();toast("Удалено")}catch(e){toast("Не удалось удалить")}
}

/* --- счёт --- */
function openAcc(id){
  const a=id?S.accounts.find(x=>x.id===id):null;
  draft=a?{type:"acc",id,name:a.name,kind:a.type,amount:String(Math.abs(a.initial||0)),neg:(a.initial||0)<0,limit:a.limit||"",rate:a.rate||"",payment:a.payment||"",actual:"",confirm:false}
         :{type:"acc",id:null,name:"",kind:"debit",amount:"",limit:"",rate:"",payment:"",actual:"",confirm:false};
  accSheet();
}
function accSheet(){
  const d=draft,debt=TYPES[d.kind].debt,cur=d.id?(balances()[d.id]||0):0;
  sheet(`<div class="fld"><label for="a-name">Название</label><input id="a-name" type="text" value="${esc(d.name)}" placeholder="Например, Карта Сбер" maxlength="40"></div>
    <div class="fld"><label for="a-kind">Тип</label><select id="a-kind">${Object.entries(TYPES).map(([k,t])=>`<option value="${k}" ${k===d.kind?"selected":""}>${t.label}</option>`).join("")}</select></div>
    ${fldNum("a-amount",d.id?`${debt?"Долг":"Остаток"} на старте, ${esc(S.settings.currency)}`:`${debt?"Сумма долга сейчас":"Остаток сейчас"}, ${esc(S.settings.currency)}`,d.amount,"0")}
    ${d.kind==="credit"?`<div class="two">${fldNum("a-limit","Кредитный лимит",d.limit)}${fldNum("a-rate","Ставка, % годовых",d.rate)}</div>${fldNum("a-payment","Платёж в месяц (необязательно)",d.payment)}`:""}
    ${d.kind==="loan"?`<div class="two">${fldNum("a-payment","Платёж в месяц",d.payment)}${fldNum("a-rate","Ставка, % годовых",d.rate)}</div>`:""}
    ${d.id?`<div class="fld"><label for="a-actual">Сверка: ${debt?"реальный долг":"реальный остаток"} сейчас (сейчас в приложении ${esc(money(debt?-cur:cur))})</label><input id="a-actual" type="number" inputmode="decimal" step="any" value="${esc(d.actual)}" placeholder="Оставьте пустым, если всё сходится"></div>`:""}
    <p class="note" style="margin:0 0 12px">Дальше остаток меняется сам по записанным операциям.</p>
    <div class="actions">
      ${d.id?`<button class="btn danger" data-act="del-acc">${d.confirm?"Точно удалить?":"Удалить"}</button>`:`<button class="btn ghost" data-act="close">Отмена</button>`}
      <button class="btn" data-act="save-acc">Сохранить</button></div>`);
}
async function saveAcc(){
  syncDraft();const d=draft;
  if(!d.name.trim())return toast("Введите название");
  const debt=TYPES[d.kind].debt;
  let initial=debt?-Math.abs(num(d.amount)):num(d.amount);
  if(d.id&&String(d.actual).trim()!==""){
    const a=S.accounts.find(x=>x.id===d.id),cur=balances()[d.id]||0;
    const target=debt?-Math.abs(num(d.actual)):num(d.actual);
    initial=(a.initial||0)+(target-cur);
  }
  const rec={name:d.name.trim(),type:d.kind,initial:Math.round(initial*100)/100};
  if(d.kind==="credit"&&num(d.limit))rec.limit=num(d.limit);
  if((d.kind==="credit"||d.kind==="loan")&&num(d.rate))rec.rate=num(d.rate);
  if((d.kind==="credit"||d.kind==="loan")&&num(d.payment))rec.payment=num(d.payment);
  try{await api.saveAcc(d.id,rec);closeSheet();toast("Сохранено")}
  catch(e){toast("Не удалось сохранить: "+(e.message||e.code))}
}
async function delAcc(){
  if(S.tx.some(t=>t.acc===draft.id||t.to===draft.id)){toast("У счёта есть операции. Сначала удалите или перенесите их");return}
  if(!draft.confirm){syncDraft();draft.confirm=true;return accSheet()}
  try{await api.del("accounts",draft.id);closeSheet();toast("Удалено")}catch(e){toast("Не удалось удалить")}
}

/* --- регулярная операция --- */
function openRec(id){
  if(!S.accounts.length){toast("Сначала добавьте счёт");return openAcc()}
  const r=id?S.recurring.find(x=>x.id===id):null;
  draft=r?{type:"rec",id,kind:r.kind,amount:String(r.amount),cat:r.cat||"",acc:r.acc,to:r.to||"",note:r.note||"",freq:r.freq,next:r.next,end:r.end||"",active:r.active,by:r.by,confirm:false}
         :{type:"rec",id:null,kind:"expense",amount:"",cat:"",acc:S.accounts[0].id,to:"",note:"",freq:"monthly",next:today(),end:"",active:true,confirm:false};
  recSheet();
}
function recSheet(){
  const d=draft,accs=S.accounts;
  if(d.kind!=="transfer"&&!d.cat)d.cat=catList(d.kind)[0];
  if(d.kind==="transfer"&&(!d.to||d.to===d.acc))d.to=(accs.find(a=>a.id!==d.acc)||{}).id||"";
  const cl=d.kind==="transfer"?[]:[...new Set([...catList(d.kind),d.cat].filter(Boolean))];
  sheet(`${seg([["expense","Расход"],["income","Доход"],["transfer","Перевод"]],d.kind,"rkind")}
    ${fldNum("r-amount",`Сумма, ${esc(S.settings.currency)}`,d.amount,"0")}
    ${d.kind==="transfer"?"":`<div class="fld"><label for="r-cat">Категория</label><select id="r-cat">${cl.map(c=>`<option ${c===d.cat?"selected":""}>${esc(c)}</option>`).join("")}</select></div>`}
    <div class="two"><div class="fld"><label for="r-acc">${d.kind==="transfer"?"Откуда":"Счёт"}</label><select id="r-acc">${opts(d.acc,accs)}</select></div>
    ${d.kind==="transfer"?`<div class="fld"><label for="r-to">Куда</label><select id="r-to">${opts(d.to,accs.filter(a=>a.id!==d.acc))}</select></div>`:`<div class="fld"><label for="r-freq">Повтор</label><select id="r-freq">${Object.entries(FREQ).map(([k,l])=>`<option value="${k}" ${k===d.freq?"selected":""}>${l}</option>`).join("")}</select></div>`}</div>
    ${d.kind==="transfer"?`<div class="fld"><label for="r-freq">Повтор</label><select id="r-freq">${Object.entries(FREQ).map(([k,l])=>`<option value="${k}" ${k===d.freq?"selected":""}>${l}</option>`).join("")}</select></div>`:""}
    <div class="two"><div class="fld"><label for="r-next">Ближайшая дата</label><input id="r-next" type="date" value="${esc(d.next)}"></div>
    <div class="fld"><label for="r-end">Закончить (необязательно)</label><input id="r-end" type="date" value="${esc(d.end)}"></div></div>
    <div class="fld"><label for="r-note">Заметка</label><input id="r-note" type="text" value="${esc(d.note)}" placeholder="Например, аренда" maxlength="120"></div>
    ${d.id?`<label class="chk"><input id="r-active" type="checkbox" ${d.active?"checked":""}> Включена</label>`:""}
    <p class="note" style="margin:0 0 12px">Операция добавляется сама в нужную дату. Если дата сегодняшняя или прошедшая, она добавится сразу.</p>
    <div class="actions">
      ${d.id?`<button class="btn danger" data-act="del-rec">${d.confirm?"Точно удалить?":"Удалить"}</button>`:`<button class="btn ghost" data-act="close">Отмена</button>`}
      <button class="btn" data-act="save-rec">Сохранить</button></div>`);
}
async function saveRec(){
  syncDraft();const d=draft;
  const amount=num(d.amount);
  if(!(amount>0))return toast("Введите сумму больше нуля");
  if(!d.next)return toast("Укажите ближайшую дату");
  if(d.kind==="transfer"&&(!d.to||d.to===d.acc))return toast("Выберите два разных счёта");
  const rec={kind:d.kind,amount:Math.round(amount*100)/100,acc:d.acc,note:d.note.trim(),freq:d.freq,next:d.next,end:d.end||"",active:d.id?d.active:true,by:d.by||S.uid||""};
  if(d.kind==="transfer")rec.to=d.to;else rec.cat=d.cat;
  try{await api.saveRec(d.id,rec);closeSheet();toast("Сохранено")}catch(e){toast("Не удалось сохранить: "+(e.message||e.code))}
}
async function delRec(){
  if(!draft.confirm){syncDraft();draft.confirm=true;return recSheet()}
  try{await api.del("recurring",draft.id);closeSheet();toast("Удалено")}catch(e){toast("Не удалось удалить")}
}

/* --- цель --- */
function openGoal(id){
  const x=id?S.goals.find(v=>v.id===id):null;
  draft=x?{type:"goal",id,name:x.name,target:String(x.target),acc:x.acc||"",saved:String(x.saved||""),deadline:x.deadline||"",confirm:false}
         :{type:"goal",id:null,name:"",target:"",acc:"",saved:"",deadline:"",confirm:false};
  goalSheet();
}
function goalSheet(){
  const d=draft,sav=S.accounts.filter(a=>!isDebt(a));
  sheet(`<div class="fld"><label for="g-name">Название</label><input id="g-name" type="text" value="${esc(d.name)}" placeholder="Например, Отпуск" maxlength="40"></div>
    ${fldNum("g-target",`Сколько нужно, ${esc(S.settings.currency)}`,d.target)}
    <div class="fld"><label for="g-acc">Счёт для накоплений</label><select id="g-acc" data-act="goal-acc">${opts(d.acc,sav,"Без счёта (вношу вручную)")}</select></div>
    ${d.acc?`<p class="note" style="margin:-4px 0 12px">Прогресс равен остатку на этом счёте.</p>`:fldNum("g-saved",`Накоплено сейчас, ${esc(S.settings.currency)}`,d.saved,"0")}
    <div class="fld"><label for="g-deadline">Срок (необязательно)</label><input id="g-deadline" type="date" value="${esc(d.deadline)}"></div>
    <div class="actions">
      ${d.id?`<button class="btn danger" data-act="del-goal">${d.confirm?"Точно удалить?":"Удалить"}</button>`:`<button class="btn ghost" data-act="close">Отмена</button>`}
      <button class="btn" data-act="save-goal">Сохранить</button></div>`);
}
async function saveGoal(){
  syncDraft();const d=draft;
  if(!d.name.trim())return toast("Введите название");
  if(!(num(d.target)>0))return toast("Укажите сумму цели");
  try{await api.saveGoal(d.id,{name:d.name.trim(),target:num(d.target),acc:d.acc,saved:d.acc?0:num(d.saved),deadline:d.deadline});closeSheet();toast("Сохранено")}
  catch(e){toast("Не удалось сохранить: "+(e.message||e.code))}
}
async function delGoal(){
  if(!draft.confirm){syncDraft();draft.confirm=true;return goalSheet()}
  try{await api.del("goals",draft.id);closeSheet();toast("Удалено")}catch(e){toast("Не удалось удалить")}
}

/* --- категории --- */
function openCats(){
  const mk=k=>catList(k).map(n=>({o:n,n,del:false}));
  draft={type:"cats",kind:"expense",items:{expense:mk("expense"),income:mk("income")}};
  catsSheet();
}
function readCats(){
  document.querySelectorAll("[data-ci]").forEach(i=>{const it=draft.items[draft.kind][Number(i.dataset.ci)];if(it)it.n=i.value})
}
function catsSheet(){
  const d=draft,list=d.items[d.kind];
  sheet(`${seg([["expense","Расходы"],["income","Доходы"]],d.kind,"ckind")}
    ${list.map((it,i)=>`<div class="crow ${it.del?"del":""}"><input data-ci="${i}" value="${esc(it.n)}" maxlength="30" aria-label="Категория"><button class="btn ghost sm" data-act="cat-del" data-i="${i}">${it.del?"Вернуть":"Убрать"}</button></div>`).join("")}
    <button class="link" data-act="cat-add">+ Добавить категорию</button>
    <p class="note" style="margin:8px 0 12px">Убранная категория пропадает из списка выбора. Старые операции с ней остаются.</p>
    <div class="actions"><button class="btn ghost" data-act="close">Отмена</button><button class="btn" data-act="save-cats">Сохранить</button></div>`);
}
async function saveCats(){
  readCats();
  const out={},renames=[];
  for(const k of ["expense","income"]){
    const names=[];
    draft.items[k].forEach(it=>{
      const n=it.n.trim();if(it.del||!n)return;
      if(!names.includes(n))names.push(n);
      if(it.o&&n!==it.o)renames.push([k,it.o,n]);
    });
    out[k]=names.length?names:CATS[k];
  }
  try{
    const limits={...(S.settings.limits||{})};
    for(const [k,o,n] of renames){
      await api.renameCat(k,o,n);
      if(k==="expense"&&limits[o]!=null){limits[n]=limits[o];delete limits[o]}
    }
    await api.saveSettings({...S.settings,limits,cats:out});
    closeSheet();toast("Категории сохранены");
  }catch(e){toast("Не удалось сохранить: "+(e.message||e.code))}
}

/* --- CSV --- */
function csvCell(v){const s=String(v??"");return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function exportCsv(){
  const rows=[["Дата","Тип","Сумма","Категория","Счёт","Куда","Заметка","Кто"]];
  S.tx.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>rows.push([t.date,KIND_RU[t.kind],String(t.amount).replace(".",","),t.cat,accName(t.acc),t.to?accName(t.to):"",t.note,who(t.by)]));
  const csv="﻿"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="budget-"+today()+".csv";document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);toast("Файл скачан");
}
function parseCsv(text){
  text=text.replace(/^﻿/,"");
  const first=text.split(/\r?\n/)[0]||"";
  const delim=[";","\t",","].map(d=>[d,first.split(d).length]).sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],cell="",q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else q=false}else cell+=c}
    else if(c==='"')q=true;
    else if(c===delim){row.push(cell);cell=""}
    else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(cell);cell="";if(row.some(x=>x.trim()))rows.push(row);row=[]}
    else cell+=c;
  }
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  return rows;
}
function parseDate(s){
  s=String(s).trim();let m;
  if((m=s.match(/^(\d{4})-(\d{2})-(\d{2})/)))return `${m[1]}-${m[2]}-${m[3]}`;
  if((m=s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/)))return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return "";
}
async function onImportFile(file){
  try{
    const rows=parseCsv(await file.text());
    if(rows.length<2)return toast("В файле нет данных");
    const head=rows[0].map(h=>h.trim().toLowerCase());
    const col=(...names)=>head.findIndex(h=>names.includes(h));
    const ix={date:col("дата","date"),kind:col("тип","type","kind"),amount:col("сумма","amount"),cat:col("категория","category"),acc:col("счёт","счет","account"),to:col("куда","to"),note:col("заметка","note","описание","комментарий")};
    if(ix.date<0||ix.amount<0||ix.acc<0)return toast("Нужны колонки: Дата, Сумма, Счёт");
    const kinds={"расход":"expense","expense":"expense","доход":"income","income":"income","перевод":"transfer","transfer":"transfer"};
    const items=[];let bad=0;
    rows.slice(1).forEach(r=>{
      const date=parseDate(r[ix.date]||""),raw=num(r[ix.amount]),acc=(r[ix.acc]||"").trim();
      if(!date||!raw||!acc){bad++;return}
      let kind=ix.kind>=0?kinds[(r[ix.kind]||"").trim().toLowerCase()]:(raw<0?"expense":"income");
      if(!kind){bad++;return}
      const to=ix.to>=0?(r[ix.to]||"").trim():"";
      if(kind==="transfer"&&!to){bad++;return}
      items.push({date,kind,amount:Math.abs(raw),acc,to,cat:ix.cat>=0?(r[ix.cat]||"").trim():"",note:ix.note>=0?(r[ix.note]||"").trim():""});
    });
    if(!items.length)return toast("Не нашёл ни одной подходящей строки");
    const known=new Set(S.accounts.map(a=>a.name.toLowerCase()));
    const need=[...new Set(items.flatMap(i=>[i.acc,i.to]).filter(Boolean))].filter(n=>!known.has(n.toLowerCase()));
    draft={type:"import",items,need,bad};
    sheet(`<h1 style="font:600 18px var(--f-display);margin:0 0 10px">Загрузка операций</h1>
      <p style="margin:0 0 8px">Найдено операций: <b>${items.length}</b>${bad?`, пропущено строк с ошибками: ${bad}`:""}.</p>
      ${need.length?`<p class="note" style="margin:0 0 8px">Будут созданы счета с нулевым стартовым остатком: ${need.map(esc).join(", ")}. Потом сверьте остатки в карточке счёта.</p>`:""}
      <p class="note" style="margin:0 0 12px">Повторная загрузка того же файла создаст дубли.</p>
      <div class="actions"><button class="btn ghost" data-act="close">Отмена</button><button class="btn" data-act="do-import">Загрузить</button></div>`);
  }catch(e){toast("Не удалось прочитать файл")}
}
async function doImport(){
  const {items,need}=draft;
  try{
    if(need.length){
      const {error}=await sb.from("accounts").insert(need.map(n=>({household_id:hh,name:n,type:"debit",initial:0})));
      if(error)throw error;
      await loadAll();
    }
    const idOf={};S.accounts.forEach(a=>idOf[a.name.toLowerCase()]=a.id);
    const rows=items.map(i=>({household_id:hh,kind:i.kind,amount:i.amount,date:i.date,cat:i.kind==="transfer"?null:(i.cat||catList(i.kind)[catList(i.kind).length-1]),acc_id:idOf[i.acc.toLowerCase()],to_id:i.to?idOf[i.to.toLowerCase()]:null,note:i.note,by_user:S.uid}));
    for(let k=0;k<rows.length;k+=500){const {error}=await sb.from("transactions").insert(rows.slice(k,k+500));if(error)throw error}
    await loadAll();closeSheet();toast("Загружено: "+rows.length);
  }catch(e){toast("Ошибка загрузки: "+(e.message||e.code))}
}

async function saveBud(){
  const limits={};
  document.querySelectorAll("[data-lim]").forEach(i=>{const v=num(i.value);if(v>0)limits[i.dataset.lim]=v});
  try{await api.saveSettings({...S.settings,currency:$("#cur").value,limits});toast("Сохранено")}catch(e){toast("Не удалось сохранить")}
}

/* ============ События ============ */
document.addEventListener("click",e=>{
  const tab=e.target.closest("[data-tab]");
  if(tab){S.tab=tab.dataset.tab;render();scrollTo(0,0);return}
  const el=e.target.closest("[data-act]");if(!el)return;
  const a=el.dataset.act,id=el.dataset.id;
  const rw=fn=>{if(!S.readOnly)fn()};
  switch(a){
    case "prev":S.month=shiftMonth(S.month,-1);render();break;
    case "next":S.month=shiftMonth(S.month,1);render();break;
    case "add-tx":openTx();break;
    case "edit-tx":rw(()=>openTx(id));break;
    case "add-acc":openAcc();break;
    case "edit-acc":rw(()=>openAcc(id));break;
    case "add-rec":openRec();break;
    case "edit-rec":rw(()=>openRec(id));break;
    case "add-goal":openGoal();break;
    case "edit-goal":rw(()=>openGoal(id));break;
    case "edit-cats":openCats();break;
    case "close":closeSheet();break;
    case "kind":syncDraft();draft.kind=el.dataset.k;draft.cat="";txSheet();break;
    case "rkind":syncDraft();draft.kind=el.dataset.k;draft.cat="";recSheet();break;
    case "ckind":readCats();draft.kind=el.dataset.k;catsSheet();break;
    case "cat-add":readCats();draft.items[draft.kind].push({o:null,n:"",del:false});catsSheet();break;
    case "cat-del":{readCats();const it=draft.items[draft.kind][Number(el.dataset.i)];if(it){if(it.o===null)draft.items[draft.kind].splice(Number(el.dataset.i),1);else it.del=!it.del}catsSheet();break}
    case "recent":{syncDraft();const t=S.tx.find(x=>x.id===id);if(t){Object.assign(draft,{amount:String(t.amount),cat:t.cat||"",acc:t.acc,to:t.to||"",note:t.note||"",touched:true});txSheet()}break}
    case "dup-tx":syncDraft();draft.id=null;draft.by="";draft.date=today();draft.confirm=false;txSheet();break;
    case "save-tx":saveTx();break;
    case "del-tx":delTx();break;
    case "save-acc":saveAcc();break;
    case "del-acc":delAcc();break;
    case "save-rec":saveRec();break;
    case "del-rec":delRec();break;
    case "save-goal":saveGoal();break;
    case "del-goal":delGoal();break;
    case "save-cats":saveCats();break;
    case "save-bud":saveBud();break;
    case "export":exportCsv();break;
    case "import":g("imp-file").click();break;
    case "do-import":doImport();break;
    case "auth-mode":S.authMode=S.authMode==="reg"?"login":"reg";render();break;
    case "h-create":houseCreate();break;
    case "h-join":houseJoin();break;
    case "logout":logout();break;
    case "reload":S.err=null;loadAll();break;
    case "copy-code":navigator.clipboard?.writeText(S.invite).then(()=>toast("Скопировано"),()=>toast(S.invite));break;
  }
});
document.addEventListener("change",e=>{
  const t=e.target,i=t.id;
  if(i==="a-kind"){syncDraft();accSheet()}
  else if(i==="f-acc"&&draft?.kind==="transfer"){syncDraft();txSheet()}
  else if(i==="r-acc"&&draft?.kind==="transfer"){syncDraft();recSheet()}
  else if(i==="g-acc"){syncDraft();goalSheet()}
  else if(i==="f-cat"&&draft)draft.touched=true;
  else if(i==="f-note"&&draft&&draft.type==="tx"&&!draft.touched&&draft.kind!=="transfer"){
    const n=t.value.trim().toLowerCase();
    const m=n&&S.tx.find(x=>x.kind===draft.kind&&(x.note||"").toLowerCase()===n);
    const sel=g("f-cat");
    if(m&&sel&&[...sel.options].some(o=>o.value===m.cat))sel.value=m.cat;
  }
  else if(i==="fk"){S.fKind=t.value;render()}
  else if(i==="fa"){S.fAcc=t.value;render()}
  else if(i==="extra"){S.extra=Math.max(0,num(t.value));render()}
  else if(i==="strat"){S.strat=t.value;render()}
  else if(i==="imp-file"){const f=t.files[0];t.value="";if(f)onImportFile(f)}
});
document.addEventListener("input",e=>{
  if(e.target.id==="q"){S.q=e.target.value;g("txlist").innerHTML=txListHtml()}
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&draft)closeSheet()});

/* ============ Данные (Supabase) ============ */
const CFG=window.APP_CONFIG||{};
const sb=(window.supabase&&CFG.key&&!CFG.key.startsWith("ВСТАВЬТЕ"))?window.supabase.createClient(CFG.url,CFG.key,{auth:{persistSession:true,autoRefreshToken:true}}):null;
const nn=v=>v==null?undefined:Number(v);
const mapAcc=r=>({id:r.id,name:r.name,type:r.type,initial:Number(r.initial),limit:nn(r.credit_limit),rate:nn(r.rate),payment:nn(r.payment)});
const mapTx=r=>({id:r.id,kind:r.kind,amount:Number(r.amount),date:r.date,cat:r.cat||"",acc:r.acc_id,to:r.to_id||"",note:r.note||"",by:r.by_user||"",auto:!!r.recurring_id});
const mapRec=r=>({id:r.id,kind:r.kind,amount:Number(r.amount),cat:r.cat||"",acc:r.acc_id,to:r.to_id||"",note:r.note||"",freq:r.freq,anchor:r.anchor_day,next:r.next_date,end:r.end_date||"",active:r.active,by:r.by_user||""});
const mapGoal=r=>({id:r.id,name:r.name,target:Number(r.target),saved:Number(r.saved||0),acc:r.acc_id||"",deadline:r.deadline||""});
const ruErr=e=>{
  const m=(e&&e.message)||String(e);
  if(/Invalid login/i.test(m))return "Неверная почта или пароль";
  if(/already registered/i.test(m))return "Такой аккаунт уже есть. Нажмите «Войти»";
  if(/Email not confirmed/i.test(m))return "Подтвердите почту по письму и войдите снова";
  if(/code_not_found/.test(m))return "Код не найден. Проверьте и введите ещё раз";
  if(/already_member/.test(m))return "Вы уже состоите в семье";
  if(/family_full/.test(m))return "В семье уже максимум участников";
  if(/relation .*recurring|relation .*goals|schema cache/i.test(m))return "В базе нет новых таблиц. Выполните файл migration_v2.sql в Supabase (SQL Editor).";
  return m;
};
const api={
  async saveAcc(id,r){
    const row={household_id:hh,name:r.name,type:r.type,initial:r.initial,credit_limit:r.limit??null,rate:r.rate??null,payment:r.payment??null};
    if(id)row.id=id;
    const {error}=await sb.from("accounts").upsert(row);if(error)throw error;await loadAll();
  },
  async saveTx(id,r){
    const row={household_id:hh,kind:r.kind,amount:r.amount,date:r.date,cat:r.cat||null,acc_id:r.acc,to_id:r.to||null,note:r.note||"",by_user:r.by||S.uid};
    if(id)row.id=id;
    const {error}=await sb.from("transactions").upsert(row);if(error)throw error;await loadAll();
  },
  async saveRec(id,r){
    const row={household_id:hh,kind:r.kind,amount:r.amount,cat:r.cat||null,acc_id:r.acc,to_id:r.to||null,note:r.note||"",freq:r.freq,anchor_day:pd(r.next).getDate(),next_date:r.next,end_date:r.end||null,active:r.active,by_user:r.by||S.uid};
    if(id)row.id=id;
    const {error}=await sb.from("recurring").upsert(row);if(error)throw error;
    await runRecurring();await loadAll();
  },
  async saveGoal(id,r){
    const row={household_id:hh,name:r.name,target:r.target,saved:r.saved,acc_id:r.acc||null,deadline:r.deadline||null};
    if(id)row.id=id;
    const {error}=await sb.from("goals").upsert(row);if(error)throw error;await loadAll();
  },
  async del(table,id){const {error}=await sb.from(table).delete().eq("id",id);if(error)throw error;await loadAll()},
  async saveSettings(s){const {error}=await sb.from("households").update({settings:s}).eq("id",hh);if(error)throw error;await loadAll()},
  async renameCat(kind,o,n){
    let r=await sb.from("transactions").update({cat:n}).eq("household_id",hh).eq("kind",kind).eq("cat",o);if(r.error)throw r.error;
    r=await sb.from("recurring").update({cat:n}).eq("household_id",hh).eq("kind",kind).eq("cat",o);if(r.error)throw r.error;
  }
};
async function runRecurring(){
  const {data,error}=await sb.rpc("run_recurring",{p_today:today()});
  if(error)return 0;
  return Number(data)||0;
}
async function fetchAll(table,col,asc){
  let out=[],from=0;
  for(;;){
    const {data,error}=await sb.from(table).select("*").order(col,{ascending:asc}).range(from,from+999);
    if(error)throw error;out=out.concat(data);if(data.length<1000)break;from+=1000;
  }
  return out;
}
async function loadAll(){
  try{
    const [a,t,r,gl,h,m]=await Promise.all([
      fetchAll("accounts","name",true),fetchAll("transactions","date",false),
      fetchAll("recurring","next_date",true),fetchAll("goals","created_at",true),
      sb.from("households").select("invite_code,settings").eq("id",hh).single(),
      sb.from("members").select("user_id,display_name")]);
    if(h.error)throw h.error;if(m.error)throw m.error;
    S.accounts=a.map(mapAcc);S.tx=t.map(mapTx);S.recurring=r.map(mapRec);S.goals=gl.map(mapGoal);S.invite=h.data.invite_code;
    const st=h.data.settings||{};S.settings={currency:st.currency||"₽",limits:st.limits||{},cats:st.cats||null};
    S.members=m.data;S.names={};m.data.forEach(x=>{if(x.display_name)S.names[x.user_id]=x.display_name});
    S.err=null;S.loaded=true;
  }catch(e){
    if(!S.loaded)S.err=ruErr(e);else toast("Нет связи, данные могут быть неактуальны");
  }
  const typing=S.tab==="more"&&document.activeElement?.matches("input,select");
  const searching=S.tab==="tx"&&document.activeElement?.id==="q";
  if(!draft&&!typing&&!searching)render();
}
let rt=null,tmr=null;
function subscribe(){
  if(rt)sb.removeChannel(rt);
  const bump=()=>{clearTimeout(tmr);tmr=setTimeout(loadAll,300)};
  rt=sb.channel("hh-"+hh);
  [["accounts",`household_id=eq.${hh}`],["transactions",`household_id=eq.${hh}`],["recurring",`household_id=eq.${hh}`],["goals",`household_id=eq.${hh}`],["households",`id=eq.${hh}`],["members",`household_id=eq.${hh}`]]
    .forEach(([table,filter])=>rt.on("postgres_changes",{event:"*",schema:"public",table,filter},bump));
  rt.subscribe();
}
async function route(){
  if(!S.session){S.stage="auth";return render()}
  S.uid=S.session.user.id;
  const {data:m,error}=await sb.from("members").select("household_id").eq("user_id",S.uid).maybeSingle();
  if(error){S.stage="app";S.err=ruErr(error);return render()}
  if(!m){S.stage="house";return render()}
  hh=m.household_id;S.stage="app";S.loaded=false;render();
  await runRecurring();
  await loadAll();subscribe();
}
async function houseCreate(){
  const name=$("#h-name").value.trim();if(!name)return toast("Введите ваше имя");
  const {error}=await sb.rpc("create_household",{p_name:name});
  if(error)return toast(ruErr(error));route();
}
async function houseJoin(){
  const name=$("#h-name").value.trim(),code=$("#h-code").value.trim();
  if(!name)return toast("Введите ваше имя");if(!code)return toast("Введите код приглашения");
  const {error}=await sb.rpc("join_household",{p_code:code,p_name:name});
  if(error)return toast(ruErr(error));route();
}
async function logout(){
  await sb.auth.signOut();
  if(rt){sb.removeChannel(rt);rt=null}
  Object.assign(S,{accounts:[],tx:[],recurring:[],goals:[],members:[],session:null,uid:null,loaded:false,err:null,tab:"home"});hh=null;
  S.stage="auth";S.authMode="login";render();
}
document.addEventListener("submit",async e=>{
  if(e.target.id!=="authform")return;
  e.preventDefault();
  const email=$("#au-email").value.trim(),password=$("#au-pass").value,reg=S.authMode==="reg";
  const r=reg?await sb.auth.signUp({email,password}):await sb.auth.signInWithPassword({email,password});
  if(r.error)return toast(ruErr(r.error));
  if(!r.data.session)return toast("Подтвердите почту по письму, затем войдите");
  S.session=r.data.session;route();
});
document.addEventListener("visibilitychange",async()=>{
  if(document.hidden||S.stage!=="app"||!hh)return;
  await runRecurring();loadAll();
});

async function start(){
  render();
  if(!sb){
    S.stage="app";S.err=window.supabase?"В файле config.js не указан ключ Supabase (anon key).":"Не загрузилась библиотека Supabase. Проверьте интернет.";
    return render();
  }
  const {data}=await sb.auth.getSession();
  S.session=data.session;
  await route();
}
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
start();
