
const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const morgan = require('morgan');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const DB_PATH = process.env.DB_PATH || './tally.db';

// Initialize database
const db = new sqlite3.Database(DB_PATH);

// Helper functions for database operations
function dbRun(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve({ lastInsertRowid: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Initialize database schema
db.serialize(() => {
  // Enable WAL mode
  db.run('PRAGMA journal_mode = WAL');
  
  // Read and execute schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  } else {
    console.log('schema.sql not found, using default schema');
    // Create basic tables if schema.sql doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'employee',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies (id)
      );
      
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('IN', 'OUT')),
        amount REAL NOT NULL,
        category TEXT,
        description TEXT,
        date_iso TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
      );
      
      CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        clock_in TEXT NOT NULL,
        clock_out TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
      );
      
      CREATE TABLE IF NOT EXISTS extra_expenditures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        date_iso TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies (id)
      );
    `);
  }
});

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

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/', (_,res)=>res.json({ok:true, service:'tally-pro'}));

// Register: requires companyEmail; phone optional
app.post('/api/auth/register', async (req,res)=>{
  try {
    const {companyName, companyEmail, companyPhone, name, email, password} = req.body||{};
    if(!companyName || !companyEmail || !name || !email || !password)
      return res.status(400).json({error:'companyName, companyEmail, name, email, password required'});
    
    const existingUser = await dbGet('SELECT * FROM users WHERE email=?', [email.toLowerCase()]);
    if(existingUser) return res.status(400).json({error:'Email already in use'});
    
    let companyId;
    const existingCompany = await dbGet('SELECT * FROM companies WHERE name=?', [companyName]);
    if(existingCompany){ 
      companyId = existingCompany.id; 
    } else { 
      const info = await dbRun('INSERT INTO companies(name,email,phone) VALUES(?,?,?)', [companyName, companyEmail.toLowerCase(), companyPhone||null]);
      companyId = info.lastInsertRowid; 
    }
    
    const hash = bcrypt.hashSync(password,10);
    const info = await dbRun('INSERT INTO users(company_id,name,email,password_hash,role) VALUES(?,?,?,?,?)', [companyId, name, email.toLowerCase(), hash, 'admin']);
    const token = signToken({userId: info.lastInsertRowid, companyId, role:'admin', email: email.toLowerCase(), name});
    res.json({token});
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

app.post('/api/auth/login', async (req,res)=>{
  try {
    const {email,password}=req.body||{};
    if(!email || !password) return res.status(400).json({error:'email, password required'});
    const u = await dbGet('SELECT * FROM users WHERE email=?', [email.toLowerCase()]);
    if(!u) return res.status(401).json({error:'Invalid credentials'});
    if(!bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({error:'Invalid credentials'});
    const token = signToken({userId: u.id, companyId: u.company_id, role: u.role, email: u.email, name: u.name});
    res.json({token});
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

app.get('/api/me', auth(), async (req,res)=>{
  try {
    const me = await dbGet('SELECT id,company_id,name,email,role,created_at FROM users WHERE id=?', [req.user.userId]);
    res.json(me);
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

// Users (admin)
app.post('/api/users', auth('admin'), async (req,res)=>{
  try {
    const {name,email,password} = req.body||{};
    if(!name || !email || !password) return res.status(400).json({error:'name, email, password required'});
    const exist = await dbGet('SELECT * FROM users WHERE email=?', [email.toLowerCase()]);
    if(exist) return res.status(400).json({error:'Email already in use'});
    const hash = bcrypt.hashSync(password,10);
    const info = await dbRun('INSERT INTO users(company_id,name,email,password_hash,role) VALUES(?,?,?,?,?)', [req.user.companyId, name, email.toLowerCase(), hash, 'employee']);
    res.status(201).json({id: info.lastInsertRowid});
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

app.get('/api/users', auth('admin'), async (req,res)=>{
  try {
    const users = await dbAll('SELECT id,name,email,role,created_at FROM users WHERE company_id=? ORDER BY created_at DESC', [req.user.companyId]);
    res.json(users);
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

// Entries
app.post('/api/entries', auth(), async (req,res)=>{
  try {
    let {type,amount,date,category,description} = req.body||{};
    if(!type || !amount || !date) return res.status(400).json({error:'type, amount, date required'});
    type = String(type).toUpperCase();
    if(!['IN','OUT'].includes(type)) return res.status(400).json({error:'type must be IN or OUT'});
    const info = await dbRun('INSERT INTO entries(company_id,user_id,type,amount,category,description,date_iso) VALUES(?,?,?,?,?,?,?)', 
      [req.user.companyId, req.user.userId, type, Number(amount), category||null, description||null, String(date).slice(0,10)]);
    res.status(201).json({id: info.lastInsertRowid});
  } catch (error) {
    console.error('Create entry error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

app.get('/api/entries', auth(), async (req,res)=>{
  try {
    const {start,end} = req.query;
    const s = (start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
    const entries = await dbAll(`SELECT e.*, u.name AS user_name FROM entries e JOIN users u ON e.user_id=u.id
      WHERE e.company_id=? AND date_iso BETWEEN ? AND ? ORDER BY date_iso DESC, e.created_at DESC`, [req.user.companyId, s, e]);
    res.json(entries);
  } catch (error) {
    console.error('List entries error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
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
app.get('/api/reports/summary', auth(), async (req,res)=>{
  try {
    const {start,end,period}=req.query;
    const s=(start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
    const entries = await dbAll('SELECT date_iso,type,amount FROM entries WHERE company_id=? AND date_iso BETWEEN ? AND ? ORDER BY date_iso ASC, created_at ASC', [req.user.companyId, s, e]);
    
    const totalRows = await dbAll('SELECT type, SUM(amount) as total FROM entries WHERE company_id=? AND date_iso BETWEEN ? AND ? GROUP BY type', [req.user.companyId, s, e]);
    const totals = {in:0,out:0}; for(const r of totalRows){ totals[r.type.toLowerCase()] = r.total || 0; }
    let holdings = totals.in - totals.out;
    
    let buckets;
    if(period==='weekly') buckets = groupByWeek(entries);
    else if(period==='monthly'){
      buckets = groupByMonth(entries);
      const extras = await dbAll('SELECT substr(date_iso,1,7) as month, SUM(amount) as total_extra FROM extra_expenditures WHERE company_id=? AND date_iso BETWEEN ? AND ? GROUP BY month', [req.user.companyId, s, e]);
      const map = new Map(extras.map(x=>[x.month, x.total_extra||0]));
      buckets = buckets.map(b => ({...b, extra: (map.get(b.month)||0), profit: (b.profit||0) - (map.get(b.month)||0)}));
      const totalExtra = extras.reduce((a,b)=>a+(b.total_extra||0),0);
      holdings -= totalExtra;
    } else buckets = groupByDay(entries);
    
    res.json({start:s,end:e, totals, holdings, buckets});
  } catch (error) {
    console.error('Summary error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

// Employee & category reports
app.get('/api/reports/by-employee', auth(), async (req,res)=>{
  try {
    const {start,end} = req.query;
    const s=(start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
    const rows = await dbAll(`
      SELECT u.name AS employee_name,
             SUM(CASE WHEN e.type='IN' THEN e.amount ELSE 0 END) total_in,
             SUM(CASE WHEN e.type='OUT' THEN e.amount ELSE 0 END) total_out
      FROM entries e JOIN users u ON e.user_id=u.id
      WHERE e.company_id=? AND e.date_iso BETWEEN ? AND ?
      GROUP BY u.id, u.name ORDER BY employee_name ASC
    `, [req.user.companyId, s, e]);
    
    const totals = rows.reduce((a,r)=>({in:a.in+(r.total_in||0), out:a.out+(r.total_out||0)}), {in:0,out:0});
    res.json({start:s,end:e, totals, rows});
  } catch (error) {
    console.error('Employee report error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

app.get('/api/reports/by-category', auth(), async (req,res)=>{
  try {
    const {start,end} = req.query;
    const s=(start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
    const rows = await dbAll(`
      SELECT IFNULL(e.category,'Uncategorized') category,
             SUM(CASE WHEN e.type='IN' THEN e.amount ELSE 0 END) total_in,
             SUM(CASE WHEN e.type='OUT' THEN e.amount ELSE 0 END) total_out
      FROM entries e
      WHERE e.company_id=? AND e.date_iso BETWEEN ? AND ?
      GROUP BY category ORDER BY category ASC
    `, [req.user.companyId, s, e]);
    
    const totals = rows.reduce((a,r)=>({in:a.in+(r.total_in||0), out:a.out+(r.total_out||0)}), {in:0,out:0});
    res.json({start:s,end:e, totals, rows});
  } catch (error) {
    console.error('Category report error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

// Shifts & traffic
app.post('/api/shifts/clock-in', auth(), async (req,res)=>{
  try {
    const open = await dbGet('SELECT * FROM shifts WHERE company_id=? AND user_id=? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1', [req.user.companyId, req.user.userId]);
    if (open) return res.status(400).json({error:'Already clocked in'});
    
    const now = new Date().toISOString();
    const info = await dbRun('INSERT INTO shifts(company_id,user_id,clock_in) VALUES(?,?,?)', [req.user.companyId, req.user.userId, now]);
    console.log(`[notify] ${req.user.name} clocked in at ${now}`);
    res.status(201).json({id: info.lastInsertRowid, clock_in: now});
  } catch (error) {
    console.error('Clock in error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

app.post('/api/shifts/clock-out', auth(), async (req,res)=>{
  try {
    const open = await dbGet('SELECT * FROM shifts WHERE company_id=? AND user_id=? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1', [req.user.companyId, req.user.userId]);
    if (!open) return res.status(400).json({error:'No open shift'});
    
    const now = new Date().toISOString();
    await dbRun('UPDATE shifts SET clock_out=? WHERE id=? AND company_id=?', [now, open.id, req.user.companyId]);
    res.json({id: open.id, clock_out: now});
  } catch (error) {
    console.error('Clock out error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

app.get('/api/shifts', auth(), async (req,res)=>{
  try {
    const {start,end} = req.query; 
    const s=(start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
    const shifts = await dbAll(`SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON s.user_id=u.id
      WHERE s.company_id=? AND date(s.clock_in) BETWEEN ? AND ? ORDER BY s.clock_in DESC`, [req.user.companyId, s, e]);
    res.json(shifts);
  } catch (error) {
    console.error('List shifts error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

app.get('/api/reports/traffic', auth(), async (req,res)=>{
  try {
    const {start,end} = req.query; 
    const s=(start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
    const rows = await dbAll(`SELECT date(s.clock_in) as day, COUNT(*) as shifts,
       SUM(CASE WHEN s.clock_out IS NOT NULL THEN (julianday(s.clock_out)-julianday(s.clock_in))*24 ELSE 0 END) as hours
       FROM shifts s WHERE s.company_id=? AND date(s.clock_in) BETWEEN ? AND ? GROUP BY day ORDER BY day ASC`, [req.user.companyId, s, e]);
    res.json({start:s,end:e, rows});
  } catch (error) {
    console.error('Traffic report error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

// Extras
app.post('/api/extras', auth('admin'), async (req,res)=>{
  try {
    const {date, amount, description} = req.body||{};
    if(!date || !(Number(amount)>=0)) return res.status(400).json({error:'date and amount required'});
    const info = await dbRun('INSERT INTO extra_expenditures(company_id,date_iso,amount,description) VALUES(?,?,?,?)', 
      [req.user.companyId, String(date).slice(0,10), Number(amount), description||null]);
    res.status(201).json({id: info.lastInsertRowid});
  } catch (error) {
    console.error('Create extra error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

app.get('/api/extras', auth(), async (req,res)=>{
  try {
    const {start,end} = req.query; 
    const s=(start||'1900-01-01').slice(0,10), e=(end||'2999-12-31').slice(0,10);
    const extras = await dbAll('SELECT * FROM extra_expenditures WHERE company_id=? AND date_iso BETWEEN ? AND ? ORDER BY date_iso ASC', [req.user.companyId, s, e]);
    res.json(extras);
  } catch (error) {
    console.error('List extras error:', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

app.listen(PORT, ()=>console.log(`tally-pro running http://localhost:${PORT}`));

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) console.error(err.message);
    console.log('Database connection closed.');
    process.exit(0);
  });
});
