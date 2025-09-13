
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const morgan = require('morgan');
const Database = require('better-sqlite3');
const fs = require('fs');

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const DB_PATH = process.env.DB_PATH || './tally.db';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync('./schema.sql','utf-8'));

function signToken(payload){ return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' }); }
function auth(role=null){
  return (req,res,next)=>{
    const h=req.headers.authorization||''; const t=h.startsWith('Bearer ')?h.slice(7):null;
    if(!t) return res.status(401).json({error:'Missing token'});
    try{
      const d=jwt.verify(t, JWT_SECRET); req.user=d;
      if(role && d.role!==role) return res.status(403).json({error:'Forbidden'});
      next();
    }catch(e){ return res.status(401).json({error:'Invalid token'});}
  }
}

const stmts = {
  insertCompany: db.prepare('INSERT INTO companies(name,email,phone) VALUES(?,?,?)'),
  getCompanyByName: db.prepare('SELECT * FROM companies WHERE name=?'),
  insertUser: db.prepare('INSERT INTO users(company_id,name,email,password_hash,role) VALUES(?,?,?,?,?)'),
  getUserByEmail: db.prepare('SELECT * FROM users WHERE email=?'),
  getUserById: db.prepare('SELECT id,company_id,name,email,role,created_at FROM users WHERE id=?'),
  listUsersByCompany: db.prepare('SELECT id,name,email,role,created_at FROM users WHERE company_id=? ORDER BY created_at DESC'),
  insertEntry: db.prepare('INSERT INTO entries(company_id,user_id,type,amount,category,description,date_iso) VALUES(?,?,?,?,?,?,?)'),
  listEntriesByCompanyAndDate: db.prepare(`SELECT e.*, u.name AS user_name FROM entries e JOIN users u ON e.user_id=u.id
    WHERE e.company_id=? AND date_iso BETWEEN ? AND ? ORDER BY date_iso DESC, e.created_at DESC`),
  allEntriesByRange: db.prepare(`SELECT date_iso,type,amount FROM entries WHERE company_id=? AND date_iso BETWEEN ? AND ? ORDER BY date_iso ASC, created_at ASC`),
  sumByTypeAndDateRange: db.prepare('SELECT type, SUM(amount) as total FROM entries WHERE company_id=? AND date_iso BETWEEN ? AND ? GROUP BY type'),
  // shifts & traffic
  insertShift: db.prepare('INSERT INTO shifts(company_id,user_id,clock_in) VALUES(?,?,?)'),
  closeShift: db.prepare('UPDATE shifts SET clock_out=? WHERE id=? AND company_id=?'),
  getOpenShiftForUser: db.prepare('SELECT * FROM shifts WHERE company_id=? AND user_id=? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1'),
  listShiftsByRange: db.prepare(`SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON s.user_id=u.id
    WHERE s.company_id=? AND date(s.clock_in) BETWEEN ? AND ? ORDER BY s.clock_in DESC`),
  trafficByDay: db.prepare(`SELECT date(s.clock_in) as day, COUNT(*) as shifts,
     SUM(CASE WHEN s.clock_out IS NOT NULL THEN (julianday(s.clock_out)-julianday(s.clock_in))*24 ELSE 0 END) as hours
     FROM shifts s WHERE s.company_id=? AND date(s.clock_in) BETWEEN ? AND ? GROUP BY day ORDER BY day ASC`),
  // extras
  upsertExtra: db.prepare('INSERT INTO extra_expenditures(company_id,date_iso,amount,description) VALUES(?,?,?,?)'),
  listExtrasByRange: db.prepare('SELECT * FROM extra_expenditures WHERE company_id=? AND date_iso BETWEEN ? AND ? ORDER BY date_iso ASC'),
  totalExtrasByMonth: db.prepare(`SELECT substr(date_iso,1,7) as month, SUM(amount) as total_extra
    FROM extra_expenditures WHERE company_id=? AND date_iso BETWEEN ? AND ? GROUP BY month`),
};

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/', (_,res)=>res.json({ok:true, service:'tally-pro'}));

// Register: requires companyEmail; phone optional
app.post('/api/auth/register', (req,res)=>{
  const {companyName, companyEmail, companyPhone, name, email, password} = req.body||{};
  if(!companyName || !companyEmail || !name || !email || !password)
    return res.status(400).json({error:'companyName, companyEmail, name, email, password required'});
  const existingUser = stmts.getUserByEmail.get(email.toLowerCase());
  if(existingUser) return res.status(400).json({error:'Email already in use'});
  let companyId;
  const existingCompany = stmts.getCompanyByName.get(companyName);
  if(existingCompany){ companyId = existingCompany.id; }
  else { const info = stmts.insertCompany.run(companyName, companyEmail.toLowerCase(), companyPhone||null); companyId = info.lastInsertRowid; }
  const hash = bcrypt.hashSync(password,10);
  const info = stmts.insertUser.run(companyId, name, email.toLowerCase(), hash, 'admin');
  const token = signToken({userId: info.lastInsertRowid, companyId, role:'admin', email: email.toLowerCase(), name});
  res.json({token});
});

app.post('/api/auth/login', (req,res)=>{
  const {email,password}=req.body||{};
  if(!email || !password) return res.status(400).json({error:'email, password required'});
  const u = stmts.getUserByEmail.get(email.toLowerCase());
  if(!u) return res.status(401).json({error:'Invalid credentials'});
  if(!bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({error:'Invalid credentials'});
  const token = signToken({userId: u.id, companyId: u.company_id, role: u.role, email: u.email, name: u.name});
  res.json({token});
});

app.get('/api/me', auth(), (req,res)=>{
  const me = stmts.getUserById.get(req.user.userId);
  res.json(me);
});

// Users (admin)
app.post('/api/users', auth('admin'), (req,res)=>{
  const {name,email,password} = req.body||{};
  if(!name || !email || !password) return res.status(400).json({error:'name, email, password required'});
  const exist = stmts.getUserByEmail.get(email.toLowerCase());
  if(exist) return res.status(400).json({error:'Email already in use'});
  const hash = bcrypt.hashSync(password,10);
  const info = stmts.insertUser.run(req.user.companyId, name, email.toLowerCase(), hash, 'employee');
  res.status(201).json({id: info.lastInsertRowid});
});
app.get('/api/users', auth('admin'), (req,res)=>{
  res.json(stmts.listUsersByCompany.all(req.user.companyId));
});

// Entries
app.post('/api/entries', auth(), (req,res)=>{
  let {type,amount,date,category,description} = req.body||{};
  if(!type || !amount || !date) return res.status(400).json({error:'type, amount, date required'});
  type = String(type).toUpperCase();
  if(!['IN','OUT'].includes(type)) return res.status(400).json({error:'type must be IN or OUT'});
  const info = stmts.insertEntry.run(req.user.companyId, req.user.userId, type, Number(amount), category||null, description||null, String(date).slice(0,10));
  res.status(201).json({id: info.lastInsertRowid});
});
app.get('/api/entries', auth(), (req,res)=>{
  const {start,end} = req.query;
  const s = (start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
  res.json(stmts.listEntriesByCompanyAndDate.all(req.user.companyId, s, e));
});

// Reports helpers
function groupByDay(entries){
  const m=new Map();
  for(const e of entries){
    const k=e.date_iso;
    const v=m.get(k)||{in:0,out:0};
    if(e.type==='IN') v.in+=e.amount; else v.out+=e.amount;
    m.set(k,v);
  }
  return Array.from(m.entries()).map(([date,v])=>({date,in:v.in,out:v.out,profit:v.in-v.out}));
}
function startOfWeek(d){
  const dt=new Date(d+'T00:00:00Z'); const day=(dt.getUTCDay()+6)%7; dt.setUTCDate(dt.getUTCDate()-day);
  return dt.toISOString().slice(0,10);
}
function groupByWeek(entries){
  const m=new Map();
  for(const e of entries){
    const k=startOfWeek(e.date_iso);
    const v=m.get(k)||{in:0,out:0};
    if(e.type==='IN') v.in+=e.amount; else v.out+=e.amount;
    m.set(k,v);
  }
  return Array.from(m.entries()).map(([week_start,v])=>({week_start,in:v.in,out:v.out,profit:v.in-v.out})).sort((a,b)=>a.week_start.localeCompare(b.week_start));
}
function groupByMonth(entries){
  const m=new Map();
  for(const e of entries){
    const k=e.date_iso.slice(0,7);
    const v=m.get(k)||{in:0,out:0};
    if(e.type==='IN') v.in+=e.amount; else v.out+=e.amount;
    m.set(k,v);
  }
  return Array.from(m.entries()).map(([month,v])=>({month,in:v.in,out:v.out,profit:v.in-v.out})).sort((a,b)=>a.month.localeCompare(b.month));
}

// Summary + extras
app.get('/api/reports/summary', auth(), (req,res)=>{
  const {start,end,period}=req.query;
  const s=(start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
  const entries = stmts.allEntriesByRange.all(req.user.companyId, s, e);
  const totalRows = stmts.sumByTypeAndDateRange.all(req.user.companyId, s, e);
  const totals = {in:0,out:0}; for(const r of totalRows){ totals[r.type.toLowerCase()] = r.total || 0; }
  let holdings = totals.in - totals.out;
  let buckets;
  if(period==='weekly') buckets = groupByWeek(entries);
  else if(period==='monthly'){
    buckets = groupByMonth(entries);
    const extras = stmts.totalExtrasByMonth.all(req.user.companyId, s, e);
    const map = new Map(extras.map(x=>[x.month, x.total_extra||0]));
    buckets = buckets.map(b => ({...b, extra: (map.get(b.month)||0), profit: (b.profit||0) - (map.get(b.month)||0)}));
    const totalExtra = extras.reduce((a,b)=>a+(b.total_extra||0),0);
    holdings -= totalExtra;
  } else buckets = groupByDay(entries);
  res.json({start:s,end:e, totals, holdings, buckets});
});

// Employee & category reports
app.get('/api/reports/by-employee', auth(), (req,res)=>{
  const {start,end} = req.query;
  const s=(start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
  const rows = db.prepare(`
    SELECT u.name AS employee_name,
           SUM(CASE WHEN e.type='IN' THEN e.amount ELSE 0 END) total_in,
           SUM(CASE WHEN e.type='OUT' THEN e.amount ELSE 0 END) total_out
    FROM entries e JOIN users u ON e.user_id=u.id
    WHERE e.company_id=? AND e.date_iso BETWEEN ? AND ?
    GROUP BY u.id, u.name ORDER BY employee_name ASC
  `).all(req.user.companyId, s, e);
  const totals = rows.reduce((a,r)=>({in:a.in+(r.total_in||0), out:a.out+(r.total_out||0)}), {in:0,out:0});
  res.json({start:s,end:e, totals, rows});
});

app.get('/api/reports/by-category', auth(), (req,res)=>{
  const {start,end} = req.query;
  const s=(start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
  const rows = db.prepare(`
    SELECT IFNULL(e.category,'Uncategorized') category,
           SUM(CASE WHEN e.type='IN' THEN e.amount ELSE 0 END) total_in,
           SUM(CASE WHEN e.type='OUT' THEN e.amount ELSE 0 END) total_out
    FROM entries e
    WHERE e.company_id=? AND e.date_iso BETWEEN ? AND ?
    GROUP BY category ORDER BY category ASC
  `).all(req.user.companyId, s, e);
  const totals = rows.reduce((a,r)=>({in:a.in+(r.total_in||0), out:a.out+(r.total_out||0)}), {in:0,out:0});
  res.json({start:s,end:e, totals, rows});
});

// Shifts & traffic
app.post('/api/shifts/clock-in', auth(), (req,res)=>{
  const open = stmts.getOpenShiftForUser.get(req.user.companyId, req.user.userId);
  if(open) return res.status(400).json({error:'Already clocked in'});
  const now = new Date().toISOString();
  const info = stmts.insertShift.run(req.user.companyId, req.user.userId, now);
  console.log(`[notify] ${req.user.name} clocked in at ${now}`);
  res.status(201).json({id: info.lastInsertRowid, clock_in: now});
});
app.post('/api/shifts/clock-out', auth(), (req,res)=>{
  const open = stmts.getOpenShiftForUser.get(req.user.companyId, req.user.userId);
  if(!open) return res.status(400).json({error:'No open shift'});
  const now = new Date().toISOString();
  stmts.closeShift.run(now, open.id, req.user.companyId);
  res.json({id: open.id, clock_out: now});
});
app.get('/api/shifts', auth(), (req,res)=>{
  const {start,end} = req.query; const s=(start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
  res.json(stmts.listShiftsByRange.all(req.user.companyId, s, e));
});
app.get('/api/reports/traffic', auth(), (req,res)=>{
  const {start,end} = req.query; const s=(start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
  res.json({start:s,end:e, rows: stmts.trafficByDay.all(req.user.companyId, s, e)});
});

// Extras
app.post('/api/extras', auth('admin'), (req,res)=>{
  const {date, amount, description} = req.body||{};
  if(!date || !(Number(amount)>=0)) return res.status(400).json({error:'date and amount required'});
  const info = stmts.upsertExtra.run(req.user.companyId, String(date).slice(0,10), Number(amount), description||null);
  res.status(201).json({id: info.lastInsertRowid});
});
app.get('/api/extras', auth(), (req,res)=>{
  const {start,end} = req.query; const s=(start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
  res.json(stmts.listExtrasByRange.all(req.user.companyId, s, e));
});

app.listen(PORT, ()=>console.log(`tally-pro running http://localhost:${PORT}`));
