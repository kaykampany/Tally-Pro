const API = localStorage.getItem('apiBase') || 'http://localhost:4000';
let TOKEN = localStorage.getItem('token') || null;
let ME = null;
const el = s => document.querySelector(s);
const fmt = new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'});

function setUserbar(){
  const ub = el('#userbar');
  ub.innerHTML = TOKEN && ME ? `
    <span>Signed in as <strong>${ME.name}</strong> <small>(${ME.role})</small></span>
    <button class="ghost" id="logoutBtn">Log out</button>
  ` : `
    <small>API:</small>
    <input id="apiInput" value="${API}" style="width:260px"/>
    <button class="ghost" id="apiSave">Save</button>
  `;
  el('#logoutBtn')?.addEventListener('click', ()=>{ localStorage.removeItem('token'); location.reload(); });
  el('#apiSave')?.addEventListener('click', ()=>{ localStorage.setItem('apiBase', el('#apiInput').value); location.reload(); });
}

async function api(path, opts={}){
  const res = await fetch(`${API}${path}`, { ...opts, headers: { 'Content-Type':'application/json', ...(opts.headers||{}), ...(TOKEN?{'Authorization':'Bearer '+TOKEN}:{}) } });
  if(!res.ok){ throw new Error(`HTTP ${res.status}: ${await res.text()}`); }
  return res.json();
}

function tabButtons(active){
  const tabs = [['dashboard','Dashboard'],['new','New Entry'],['clock','Clock In/Out'],['shifts','Shift Reports'],['reports','Reports']];
  if(ME?.role==='admin') tabs.push(['employees','Employees']);
  return `<nav class="tabs">${tabs.map(([k,l])=>`<button data-tab="${k}" ${active===k?'style="border-color:#3a6bff"':''}>${l}</button>`).join('')}</nav>`;
}

function wireTabs(){
  document.querySelectorAll('nav.tabs button').forEach(b=>{
    b.onclick=()=>{
      const t=b.getAttribute('data-tab');
      if(t==='dashboard') showDashboard();
      if(t==='new') showNewEntry();
      if(t==='clock') showClock();
      if(t==='shifts') showShifts();
      if(t==='reports') showReports('summary');
      if(t==='employees') showEmployees();
    }
  });
}

// ---------- Auth screen ----------
function showAuth(){
  el('#app').innerHTML = `
    <card>
      <h2>Get Started</h2>
      <div class="row">
        <div>
          <h3>Create Company + Admin</h3>
          <label>Company Name</label><input id="regCompany" placeholder="Acme LLC">
          <label>Company Email (required)</label><input id="regCompanyEmail" type="email" placeholder="admin@acme.com">
          <label>Company Phone (optional)</label><input id="regCompanyPhone" placeholder="+1...">
          <label>Your Name</label><input id="regName" placeholder="Alice Admin">
          <label>Email</label><input id="regEmail" type="email" placeholder="you@company.com">
          <label>Password</label><input id="regPass" type="password" placeholder="••••••••">
          <div style="margin-top:12px"><button id="regBtn">Create & Sign In</button></div>
        </div>
        <div>
          <h3>Sign In</h3>
          <label>Email</label><input id="logEmail" type="email" placeholder="you@company.com">
          <label>Password</label><input id="logPass" type="password" placeholder="••••••••">
          <div style="margin-top:12px"><button class="ghost" id="logBtn">Sign In</button></div>
        </div>
      </div>
    </card>
  `;
  el('#regBtn').onclick = async ()=>{
    try{
      const body={
        companyName: el('#regCompany').value.trim(),
        companyEmail: el('#regCompanyEmail').value.trim(),
        companyPhone: el('#regCompanyPhone').value.trim(),
        name: el('#regName').value.trim(),
        email: el('#regEmail').value.trim(),
        password: el('#regPass').value
      };
      const data = await api('/api/auth/register',{method:'POST', body: JSON.stringify(body)});
      localStorage.setItem('token', data.token); TOKEN=data.token; await loadMe(); showDashboard();
    }catch(e){ alert(e.message); }
  };
  el('#logBtn').onclick = async ()=>{
    try{
      const data = await api('/api/auth/login',{method:'POST', body: JSON.stringify({email: el('#logEmail').value.trim(), password: el('#logPass').value})});
      localStorage.setItem('token', data.token); TOKEN=data.token; await loadMe(); showDashboard();
    }catch(e){ alert(e.message); }
  };
}

// ---------- Dashboard ----------
function showDashboard(){
  el('#app').innerHTML = `
    ${tabButtons('dashboard')}
    <div class="kpi">
      <div class="box"><h3>Total In</h3><div id="kIn">—</div></div>
      <div class="box"><h3>Total Out</h3><div id="kOut">—</div></div>
      <div class="box"><h3>Profit</h3><div id="kProfit">—</div></div>
      <div class="box"><h3>Holdings</h3><div id="kHold">—</div></div>
    </div>
    <card>
      <div class="row">
        <div><label>Start</label><input id="sumStart" type="date"></div>
        <div><label>End</label><input id="sumEnd" type="date"></div>
        <div><label>Period</label><select id="sumPeriod"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
        <div style="align-self:flex-end"><button id="sumRun">Run</button></div>
      </div>
      <div id="bucketTable"></div>
    </card>
  `;
  wireTabs();
  el('#sumRun').onclick = runSummary;
}
async function runSummary(){
  const start = el('#sumStart').value || '1900-01-01';
  const end = el('#sumEnd').value || '2999-12-31';
  const period = el('#sumPeriod').value;
  const r = await api(`/api/reports/summary?start=${start}&end=${end}&period=${period}`);
  el('#kIn').textContent = fmt.format(r.totals.in||0);
  el('#kOut').textContent = fmt.format(r.totals.out||0);
  el('#kProfit').textContent = fmt.format((r.totals.in||0)-(r.totals.out||0));
  el('#kHold').textContent = fmt.format(r.holdings||0);
  const cols = period==='weekly' ? ['week_start','in','out','profit'] : period==='monthly' ? ['month','in','out','profit','extra'] : ['date','in','out','profit'];
  const th = `<tr>${cols.map(c=>`<th>${c.toUpperCase().replace('_',' ')}</th>`).join('')}</tr>`;
  const tr = r.buckets.map(row=>`<tr>${cols.map(c=>`<td>${typeof row[c]==='number'?fmt.format(row[c]):(row[c]??'')}</td>`).join('')}</tr>`).join('');
  el('#bucketTable').innerHTML = `<table>${th}${tr}</table>`;
}

// ---------- New Entry ----------
function showNewEntry(){
  const today = new Date().toISOString().slice(0,10);
  el('#app').innerHTML = `
    ${tabButtons('new')}
    <card>
      <div class="row">
        <div><label>Type</label><select id="eType"><option>IN</option><option>OUT</option></select></div>
        <div><label>Amount</label><input id="eAmount" type="number" step="0.01" min="0"></div>
        <div><label>Date</label><input id="eDate" type="date" value="${today}"></div>
      </div>
      <div class="row">
        <div><label>Category</label><input id="eCat" placeholder="Sales, Supplies..."></div>
        <div><label>Description</label><input id="eDesc" placeholder="Optional note"></div>
      </div>
      <div style="margin-top:12px"><button id="eSave">Save Entry</button></div>
    </card>
  `;
  wireTabs();
  el('#eSave').onclick = async ()=>{
    try{
      const body = { type: el('#eType').value, amount: el('#eAmount').value, date: el('#eDate').value, category: el('#eCat').value, description: el('#eDesc').value };
      await api('/api/entries', {method:'POST', body: JSON.stringify(body)});
      alert('Saved');
      showDashboard();
    }catch(e){ alert(e.message); }
  }
}

// ---------- Clock ----------
function showClock(){
  el('#app').innerHTML = `
    ${tabButtons('clock')}
    <card>
      <h3>Shift</h3>
      <div style="display:flex; gap:8px;">
        <button id="clkIn">Clock In</button>
        <button class="ghost" id="clkOut">Clock Out</button>
      </div>
      <p class="muted">Company email/phone can be notified when employees clock in (backend integration).</p>
    </card>
  `;
  wireTabs();
  el('#clkIn').onclick = async ()=>{ try{ await api('/api/shifts/clock-in',{method:'POST'}); alert('Clocked in'); }catch(e){ alert(e.message);} };
  el('#clkOut').onclick = async ()=>{ try{ await api('/api/shifts/clock-out',{method:'POST'}); alert('Clocked out'); }catch(e){ alert(e.message);} };
}

// ---------- Shifts ----------
function drawBars(canvas, labels, values){
  const ctx = canvas.getContext('2d'); const w=canvas.width, h=canvas.height;
  ctx.clearRect(0,0,w,h);
  const max = Math.max(1, ...values); const pad=30, bw=Math.max(8,(w-pad*2)/Math.max(labels.length,1)-6);
  ctx.strokeStyle='#9fb4ff'; ctx.beginPath(); ctx.moveTo(pad,pad); ctx.lineTo(pad,h-pad); ctx.lineTo(w-pad,h-pad); ctx.stroke();
  values.forEach((v,i)=>{ const x=pad+10+i*(bw+6); const bh=(v/max)*(h-pad*2-10); ctx.fillStyle=`hsl(${(i*47)%360} 70% 55%)`; ctx.fillRect(x,(h-pad)-bh,bw,bh); });
  ctx.fillStyle='#e8eef9'; ctx.font='11px system-ui'; labels.forEach((lab,i)=>{ const x=pad+10+i*(bw+6)+bw/2; ctx.save(); ctx.translate(x,h-pad+12); ctx.rotate(-Math.PI/4); ctx.textAlign='left'; ctx.fillText(lab,0,0); ctx.restore(); });
}
function showShifts(){
  el('#app').innerHTML = `
    ${tabButtons('shifts')}
    <card>
      <div class="row">
        <div><label>Start</label><input id="sStart" type="date"></div>
        <div><label>End</label><input id="sEnd" type="date"></div>
        <div style="align-self:flex-end"><button id="sRun">Run</button></div>
      </div>
      <div class="kpi" style="margin-top:8px">
        <div class="box"><h3>Total Shifts</h3><div id="kShifts">—</div></div>
        <div class="box"><h3>Total Hours</h3><div id="kHours">—</div></div>
      </div>
      <div class="row" style="margin-top:8px">
        <div style="flex:2">
          <h3>Shifts</h3>
          <div id="sTable"></div>
        </div>
        <div style="flex:1">
          <h3>Busy by Day</h3>
          <canvas id="busy" width="420" height="260" style="background:#0a1428;border:1px solid #213;border-radius:12px"></canvas>
        </div>
      </div>
    </card>
  `;
  wireTabs();
  el('#sRun').onclick = async ()=>{
    const start = el('#sStart').value || '1900-01-01';
    const end = el('#sEnd').value || '2999-12-31';
    const rows = await api(`/api/shifts?start=${start}&end=${end}`);
    let totalH=0;
    const th = `<tr><th>Employee</th><th>Clock In</th><th>Clock Out</th><th>Hours</th></tr>`;
    const tr = rows.map(r=>{
      const ci=new Date(r.clock_in), co=r.clock_out?new Date(r.clock_out):null;
      const hrs = co?((co-ci)/36e5):0; totalH+=hrs;
      return `<tr><td>${r.user_name}</td><td>${ci.toLocaleString()}</td><td>${co?co.toLocaleString():''}</td><td>${hrs.toFixed(2)}</td></tr>`;
    }).join('');
    el('#sTable').innerHTML = `<table>${th}${tr}</table>`;
    el('#kShifts').textContent = rows.length;
    el('#kHours').textContent = totalH.toFixed(2);
    const traffic = await api(`/api/reports/traffic?start=${start}&end=${end}`);
    drawBars(el('#busy'), traffic.rows.map(x=>x.day), traffic.rows.map(x=>Number(x.shifts)));
  };
}

// ---------- Reports (with extras on monthly) ----------
function downloadCSV(filename, rows){
  const esc=v=>{ if(v==null) return ''; const s=String(v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  const csv = rows.map(r=>r.map(esc).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

function drawPie(canvas, values, labels){
  const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h);
  const total = values.reduce((a,b)=>a+b,0); const cx=w/2, cy=h/2, r=Math.min(cx,cy)-10; let start=0;
  const colors = labels.map((_,i)=>`hsl(${(i*57)%360} 70% 55%)`);
  labels.forEach((lab,i)=>{
    const val=values[i]; const ang = total>0?(val/total)*Math.PI*2:0;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,start,start+ang); ctx.closePath(); ctx.fillStyle=colors[i]; ctx.fill(); start+=ang;
  });
  ctx.font='12px system-ui'; const lx=w-160, ly=10;
  labels.forEach((lab,i)=>{ ctx.fillStyle=colors[i]; ctx.fillRect(lx,ly+i*18,12,12); ctx.fillStyle='#e8eef9'; const pct=total>0?((values[i]/total)*100).toFixed(1):'0.0'; ctx.fillText(`${lab} (${pct}%)`, lx+16, ly+10+i*18); });
}

function showReports(view='summary'){
  el('#app').innerHTML = `
    ${tabButtons('reports')}
    <card>
      <nav class="tabs" style="margin-top:0">
        <button data-rv="summary" ${view==='summary'?'style="border-color:#3a6bff"':''}>Summary</button>
        <button data-rv="employee" ${view==='employee'?'style="border-color:#3a6bff"':''}>By Employee</button>
        <button data-rv="category" ${view==='category'?'style="border-color:#3a6bff"':''}>By Category</button>
      </nav>
      <div class="row">
        <div><label>Start</label><input id="rStart" type="date"></div>
        <div><label>End</label><input id="rEnd" type="date"></div>
        <div id="periodWrap"><label>Period</label><select id="rPeriod"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
        <div style="align-self:flex-end;display:flex;gap:8px"><button id="rRun">Run</button><button class="ghost" id="rDownload">Download CSV</button></div>
      </div>
      <div class="kpi" style="margin-top:8px">
        <div class="box"><h3>Total In</h3><div id="repIn">—</div></div>
        <div class="box"><h3>Total Out</h3><div id="repOut">—</div></div>
        <div class="box"><h3>Profit</h3><div id="repProfit">—</div></div>
        <div class="box"><h3>Holdings</h3><div id="repHold">—</div></div>
      </div>
      <div class="row" style="margin-top:8px">
        <div style="flex:2"><div id="repTable"></div></div>
        <div style="flex:1"><canvas id="repPie" width="420" height="260" style="background:#0a1428;border:1px solid #213;border-radius:12px"></canvas></div>
      </div>
    </card>
  `;
  wireTabs();
  document.querySelectorAll('nav.tabs [data-rv]').forEach(b=>b.onclick=()=>showReports(b.getAttribute('data-rv')));
  el('#periodWrap').style.display = (view==='summary')?'block':'none';

  el('#rRun').onclick = async ()=>{
    const start=el('#rStart').value||'1900-01-01'; const end=el('#rEnd').value||'2999-12-31';
    const canvas = el('#repPie');
    if(view==='summary'){
      const period=el('#rPeriod').value;
      const r = await api(`/api/reports/summary?start=${start}&end=${end}&period=${period}`);
      el('#repIn').textContent=fmt.format(r.totals.in||0);
      el('#repOut').textContent=fmt.format(r.totals.out||0);
      el('#repProfit').textContent=fmt.format((r.totals.in||0)-(r.totals.out||0));
      el('#repHold').textContent=fmt.format(r.holdings||0);
      const cols = period==='weekly'?['week_start','in','out','profit']:(period==='monthly'?['month','in','out','profit','extra']:['date','in','out','profit']);
      const th = `<tr>${cols.map(c=>`<th>${c.toUpperCase()}</th>`).join('')}</tr>`;
      const tr = r.buckets.map(row=>`<tr>${cols.map(c=>`<td>${typeof row[c]==='number'?fmt.format(row[c]):(row[c]??'')}</td>`).join('')}</tr>`).join('');
      el('#repTable').innerHTML = `<table>${th}${tr}</table>`;
      drawPie(canvas, [r.totals.in||0, r.totals.out||0], ['IN','OUT']);
      const csvRows=[cols]; r.buckets.forEach(row=>csvRows.push(cols.map(c=>row[c])));
      el('#rDownload').onclick = ()=>downloadCSV(`summary_${period}_${start}_to_${end}.csv`, csvRows);
    }
    if(view==='employee'){
      const r = await api(`/api/reports/by-employee?start=${start}&end=${end}`);
      el('#repIn').textContent=fmt.format(r.totals.in||0);
      el('#repOut').textContent=fmt.format(r.totals.out||0);
      el('#repProfit').textContent=fmt.format((r.totals.in||0)-(r.totals.out||0));
      el('#repHold').textContent=fmt.format((r.totals.in||0)-(r.totals.out||0));
      const cols=['employee_name','total_in','total_out','profit'];
      const th = `<tr>${cols.map(c=>`<th>${c.toUpperCase()}</th>`).join('')}</tr>`;
      const tr = r.rows.map(row=>`<tr><td>${row.employee_name}</td><td>${fmt.format(row.total_in||0)}</td><td>${fmt.format(row.total_out||0)}</td><td>${fmt.format((row.total_in||0)-(row.total_out||0))}</td></tr>`).join('');
      el('#repTable').innerHTML = `<table>${th}${tr}</table>`;
      drawPie(canvas, r.rows.map(x=>Math.max(0,(x.total_in||0)-(x.total_out||0))), r.rows.map(x=>x.employee_name));
      const csvRows=[['Employee','Total In','Total Out','Profit']]; r.rows.forEach(row=>csvRows.push([row.employee_name,row.total_in||0,row.total_out||0,(row.total_in||0)-(row.total_out||0)]));
      el('#rDownload').onclick = ()=>downloadCSV(`by_employee_${start}_to_${end}.csv`, csvRows);
    }
    if(view==='category'){
      const r = await api(`/api/reports/by-category?start=${start}&end=${end}`);
      el('#repIn').textContent=fmt.format(r.totals.in||0);
      el('#repOut').textContent=fmt.format(r.totals.out||0);
      el('#repProfit').textContent=fmt.format((r.totals.in||0)-(r.totals.out||0));
      el('#repHold').textContent=fmt.format((r.totals.in||0)-(r.totals.out||0));
      const cols=['category','total_in','total_out','profit'];
      const th = `<tr>${cols.map(c=>`<th>${c.toUpperCase()}</th>`).join('')}</tr>`;
      const tr = r.rows.map(row=>`<tr><td>${row.category}</td><td>${fmt.format(row.total_in||0)}</td><td>${fmt.format(row.total_out||0)}</td><td>${fmt.format((row.total_in||0)-(row.total_out||0))}</td></tr>`).join('');
      el('#repTable').innerHTML = `<table>${th}${tr}</table>`;
      drawPie(canvas, r.rows.map(x=>Math.max(0,(x.total_in||0))), r.rows.map(x=>x.category));
      const csvRows=[['Category','Total In','Total Out','Profit']]; r.rows.forEach(row=>csvRows.push([row.category,row.total_in||0,row.total_out||0,(row.total_in||0)-(row.total_out||0)]));
      el('#rDownload').onclick = ()=>downloadCSV(`by_category_${start}_to_${end}.csv`, csvRows);
    }
  };
}

// ---------- Employees (admin) ----------
async function listEmployees(){
  const rows = await api('/api/users');
  const th = `<tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr>`;
  const tr = rows.map(r=>`<tr><td>${r.name}</td><td>${r.email}</td><td>${r.role}</td><td>${new Date(r.created_at).toLocaleDateString()}</td></tr>`).join('');
  el('#uTable').innerHTML = `<table>${th}${tr}</table>`;
}
function showEmployees(){
  el('#app').innerHTML = `
    ${tabButtons('employees')}
    <card>
      <h3>Add Employee</h3>
      <div class="row">
        <div><label>Name</label><input id="uName" placeholder="Bob"></div>
        <div><label>Email</label><input id="uEmail" type="email" placeholder="bob@acme.com"></div>
        <div><label>Password</label><input id="uPass" type="password" placeholder="Temp password"></div>
      </div>
      <div style="margin-top:12px"><button id="uCreate">Create</button></div>
    </card>
    <card>
      <h3>All Employees</h3>
      <div id="uTable"></div>
    </card>
  `;
  wireTabs();
  el('#uCreate').onclick = async ()=>{
    try{ await api('/api/users',{method:'POST', body: JSON.stringify({name:el('#uName').value, email:el('#uEmail').value, password:el('#uPass').value})}); alert('Employee added'); listEmployees(); }catch(e){ alert(e.message); }
  };
  listEmployees();
}

// ---------- bootstrap ----------
async function loadMe(){ try{ ME = await api('/api/me'); }catch{ ME=null; } }
setUserbar();
(async()=>{
  if(!TOKEN){ showAuth(); return; }
  await loadMe();
  if(!ME){ showAuth(); return; }
  showDashboard();
})();
