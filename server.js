const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// File upload setup
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads'),
  filename: (req, file, cb) => cb(null, 'resume' + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// --- Database Setup (PostgreSQL / Supabase) ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      platform TEXT DEFAULT '',
      portal_url TEXT DEFAULT '',
      status TEXT DEFAULT 'WISHLIST',
      salary_range TEXT DEFAULT '',
      location TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      applied_date TEXT DEFAULT '',
      interview_date TEXT DEFAULT '',
      follow_up_date TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS prep_topics (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL,
      topic TEXT NOT NULL,
      difficulty TEXT DEFAULT 'MEDIUM',
      status TEXT DEFAULT 'TODO',
      notes TEXT DEFAULT '',
      resource_url TEXT DEFAULT ''
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_log (
      id SERIAL PRIMARY KEY,
      date TEXT DEFAULT CURRENT_DATE::TEXT,
      applications_sent INTEGER DEFAULT 0,
      problems_solved INTEGER DEFAULT 0,
      notes TEXT DEFAULT ''
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      full_name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      linkedin_url TEXT DEFAULT '',
      github_url TEXT DEFAULT '',
      portfolio_url TEXT DEFAULT '',
      current_role TEXT DEFAULT '',
      experience_years TEXT DEFAULT '',
      skills TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      resume_path TEXT DEFAULT ''
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      smtp_host TEXT DEFAULT 'smtp.gmail.com',
      smtp_port INTEGER DEFAULT 587,
      smtp_user TEXT DEFAULT '',
      smtp_pass TEXT DEFAULT '',
      from_name TEXT DEFAULT ''
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cover_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      subject TEXT DEFAULT '',
      body TEXT DEFAULT ''
    )
  `);

  // Init single-row tables
  await pool.query(`INSERT INTO profile (id, full_name) VALUES (1, '') ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO email_config (id, smtp_host) VALUES (1, 'smtp.gmail.com') ON CONFLICT (id) DO NOTHING`);

  // Seed prep topics if empty
  const count = await pool.query('SELECT COUNT(*) as c FROM prep_topics');
  if (parseInt(count.rows[0].c) === 0) {
    const topics = [
      ['DSA', 'Arrays & Hashing', 'EASY', 'https://leetcode.com/tag/array/'],
      ['DSA', 'Two Pointers', 'EASY', 'https://leetcode.com/tag/two-pointers/'],
      ['DSA', 'Sliding Window', 'MEDIUM', 'https://leetcode.com/tag/sliding-window/'],
      ['DSA', 'Stack', 'MEDIUM', 'https://leetcode.com/tag/stack/'],
      ['DSA', 'Binary Search', 'MEDIUM', 'https://leetcode.com/tag/binary-search/'],
      ['DSA', 'Linked List', 'MEDIUM', 'https://leetcode.com/tag/linked-list/'],
      ['DSA', 'Trees (BFS/DFS)', 'MEDIUM', 'https://leetcode.com/tag/tree/'],
      ['DSA', 'Graphs (BFS/DFS/Topo)', 'HARD', 'https://leetcode.com/tag/graph/'],
      ['DSA', 'Dynamic Programming', 'HARD', 'https://leetcode.com/tag/dynamic-programming/'],
      ['DSA', 'Backtracking', 'HARD', 'https://leetcode.com/tag/backtracking/'],
      ['DSA', 'Tries', 'HARD', 'https://leetcode.com/tag/trie/'],
      ['DSA', 'Heap / Priority Queue', 'MEDIUM', 'https://leetcode.com/tag/heap-priority-queue/'],
      ['System Design', 'URL Shortener', 'MEDIUM', ''],
      ['System Design', 'Rate Limiter', 'MEDIUM', ''],
      ['System Design', 'Chat System (WhatsApp)', 'HARD', ''],
      ['System Design', 'Video Streaming (Netflix/YouTube)', 'HARD', ''],
      ['System Design', 'Notification Service', 'MEDIUM', ''],
      ['System Design', 'Distributed Cache (Redis)', 'HARD', ''],
      ['System Design', 'Search Autocomplete', 'HARD', ''],
      ['System Design', 'Payment System', 'HARD', ''],
      ['Java/Spring', 'Spring Boot Internals', 'MEDIUM', ''],
      ['Java/Spring', 'JPA & Hibernate N+1', 'MEDIUM', ''],
      ['Java/Spring', 'Microservices Patterns', 'HARD', ''],
      ['Java/Spring', 'Java Concurrency', 'HARD', ''],
      ['Java/Spring', 'Spring Security + JWT', 'MEDIUM', ''],
      ['Java/Spring', 'REST API Best Practices', 'EASY', ''],
      ['Frontend', 'Angular Lifecycle & Change Detection', 'MEDIUM', ''],
      ['Frontend', 'RxJS Operators', 'MEDIUM', ''],
      ['Frontend', 'React Hooks & State Mgmt', 'MEDIUM', ''],
      ['Behavioral', 'Tell me about yourself', 'EASY', ''],
      ['Behavioral', 'Biggest challenge / conflict', 'EASY', ''],
      ['Behavioral', 'Why this company?', 'EASY', ''],
      ['Behavioral', 'Leadership / ownership story', 'EASY', ''],
    ];
    for (const t of topics) {
      await pool.query('INSERT INTO prep_topics (category, topic, difficulty, resource_url) VALUES ($1,$2,$3,$4)', t);
    }
  }

  // Seed default cover letter template
  const tplCount = await pool.query('SELECT COUNT(*) as c FROM cover_templates');
  if (parseInt(tplCount.rows[0].c) === 0) {
    await pool.query(
      'INSERT INTO cover_templates (name, subject, body) VALUES ($1, $2, $3)',
      [
        'Default Application',
        'Application for {role} at {company}',
        `Hi {company} Team,

I am writing to express my interest in the {role} position. With {experience_years} years of experience in {skills}, I believe I can contribute meaningfully to your team.

{summary}

I would welcome the opportunity to discuss how my background aligns with your needs.

Best regards,
{full_name}
{email} | {phone}
{linkedin_url}`
      ]
    );
  }

  console.log('Database initialized');
}

// --- API Routes ---

// Applications CRUD
app.get('/api/applications', async (req, res) => {
  const result = await pool.query('SELECT * FROM applications ORDER BY updated_at DESC');
  res.json(result.rows);
});

app.post('/api/applications', async (req, res) => {
  const { company, role, platform, portal_url, status, salary_range, location, notes, applied_date, interview_date, follow_up_date } = req.body;
  const result = await pool.query(
    `INSERT INTO applications (company, role, platform, portal_url, status, salary_range, location, notes, applied_date, interview_date, follow_up_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [company, role, platform || '', portal_url || '', status || 'WISHLIST', salary_range || '', location || '', notes || '', applied_date || '', interview_date || '', follow_up_date || '']
  );
  res.json({ id: result.rows[0].id });
});

app.put('/api/applications/:id', async (req, res) => {
  const { company, role, platform, portal_url, status, salary_range, location, notes, applied_date, interview_date, follow_up_date } = req.body;
  await pool.query(
    `UPDATE applications SET company=$1, role=$2, platform=$3, portal_url=$4, status=$5, salary_range=$6, location=$7, notes=$8, applied_date=$9, interview_date=$10, follow_up_date=$11, updated_at=NOW() WHERE id=$12`,
    [company, role, platform || '', portal_url || '', status || 'WISHLIST', salary_range || '', location || '', notes || '', applied_date || '', interview_date || '', follow_up_date || '', req.params.id]
  );
  res.json({ ok: true });
});

app.delete('/api/applications/:id', async (req, res) => {
  await pool.query('DELETE FROM applications WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// Prep topics
app.get('/api/prep', async (req, res) => {
  const result = await pool.query('SELECT * FROM prep_topics ORDER BY category, difficulty');
  res.json(result.rows);
});

app.put('/api/prep/:id', async (req, res) => {
  const { status, notes } = req.body;
  await pool.query('UPDATE prep_topics SET status=$1, notes=$2 WHERE id=$3', [status, notes || '', req.params.id]);
  res.json({ ok: true });
});

app.post('/api/prep', async (req, res) => {
  const { category, topic, difficulty, resource_url } = req.body;
  const result = await pool.query(
    'INSERT INTO prep_topics (category, topic, difficulty, resource_url) VALUES ($1,$2,$3,$4) RETURNING id',
    [category, topic, difficulty || 'MEDIUM', resource_url || '']
  );
  res.json({ id: result.rows[0].id });
});

// Stats
app.get('/api/stats', async (req, res) => {
  const apps = await pool.query('SELECT status, COUNT(*) as count FROM applications GROUP BY status');
  const prepStats = await pool.query('SELECT status, COUNT(*) as count FROM prep_topics GROUP BY status');
  const total = await pool.query('SELECT COUNT(*) as c FROM applications');
  const today = new Date().toISOString().split('T')[0];
  const followUps = await pool.query(
    `SELECT * FROM applications WHERE follow_up_date <= $1 AND status IN ('APPLIED','SCREENING','INTERVIEW') ORDER BY follow_up_date`,
    [today]
  );
  res.json({ applicationsByStatus: apps.rows, prepByStatus: prepStats.rows, totalApplications: parseInt(total.rows[0].c), followUps: followUps.rows });
});

// Profile
app.get('/api/profile', async (req, res) => {
  const result = await pool.query('SELECT * FROM profile WHERE id=1');
  res.json(result.rows[0]);
});

app.put('/api/profile', async (req, res) => {
  const { full_name, email, phone, linkedin_url, github_url, portfolio_url, current_role, experience_years, skills, summary } = req.body;
  await pool.query(
    `UPDATE profile SET full_name=$1, email=$2, phone=$3, linkedin_url=$4, github_url=$5, portfolio_url=$6, current_role=$7, experience_years=$8, skills=$9, summary=$10 WHERE id=1`,
    [full_name || '', email || '', phone || '', linkedin_url || '', github_url || '', portfolio_url || '', current_role || '', experience_years || '', skills || '', summary || '']
  );
  res.json({ ok: true });
});

// Resume upload
app.post('/api/resume', upload.single('resume'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  await pool.query('UPDATE profile SET resume_path=$1 WHERE id=1', [req.file.filename]);
  res.json({ ok: true, filename: req.file.filename });
});

app.get('/api/resume-info', async (req, res) => {
  const result = await pool.query('SELECT resume_path FROM profile WHERE id=1');
  const p = result.rows[0];
  if (p && p.resume_path) {
    const fullPath = path.join(__dirname, 'uploads', p.resume_path);
    const exists = fs.existsSync(fullPath);
    res.json({ exists, filename: p.resume_path });
  } else {
    res.json({ exists: false, filename: null });
  }
});

// Email config
app.get('/api/email-config', async (req, res) => {
  const result = await pool.query('SELECT * FROM email_config WHERE id=1');
  const cfg = { ...result.rows[0] };
  if (cfg.smtp_pass) cfg.smtp_pass = '********';
  res.json(cfg);
});

app.put('/api/email-config', async (req, res) => {
  const { smtp_host, smtp_port, smtp_user, smtp_pass, from_name } = req.body;
  if (smtp_pass && smtp_pass !== '********') {
    await pool.query(
      'UPDATE email_config SET smtp_host=$1, smtp_port=$2, smtp_user=$3, smtp_pass=$4, from_name=$5 WHERE id=1',
      [smtp_host || 'smtp.gmail.com', smtp_port || 587, smtp_user || '', smtp_pass, from_name || '']
    );
  } else {
    await pool.query(
      'UPDATE email_config SET smtp_host=$1, smtp_port=$2, smtp_user=$3, from_name=$4 WHERE id=1',
      [smtp_host || 'smtp.gmail.com', smtp_port || 587, smtp_user || '', from_name || '']
    );
  }
  res.json({ ok: true });
});

// Send email application
app.post('/api/send-email', async (req, res) => {
  try {
    const { to, subject, body, attachResume } = req.body;
    const cfgResult = await pool.query('SELECT * FROM email_config WHERE id=1');
    const cfg = cfgResult.rows[0];
    if (!cfg.smtp_user || !cfg.smtp_pass) return res.status(400).json({ error: 'Email not configured. Go to Settings > Email Config.' });

    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host,
      port: cfg.smtp_port,
      secure: cfg.smtp_port === 465,
      auth: { user: cfg.smtp_user, pass: cfg.smtp_pass }
    });

    const mailOpts = {
      from: cfg.from_name ? `"${cfg.from_name}" <${cfg.smtp_user}>` : cfg.smtp_user,
      to, subject, text: body
    };

    if (attachResume) {
      const profileResult = await pool.query('SELECT resume_path FROM profile WHERE id=1');
      const profile = profileResult.rows[0];
      if (profile && profile.resume_path) {
        const resumePath = path.join(__dirname, 'uploads', profile.resume_path);
        if (fs.existsSync(resumePath)) {
          mailOpts.attachments = [{ filename: profile.resume_path, path: resumePath }];
        }
      }
    }

    await transporter.sendMail(mailOpts);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cover letter templates
app.get('/api/templates', async (req, res) => {
  const result = await pool.query('SELECT * FROM cover_templates');
  res.json(result.rows);
});

app.post('/api/templates', async (req, res) => {
  const { name, subject, body } = req.body;
  const result = await pool.query(
    'INSERT INTO cover_templates (name, subject, body) VALUES ($1,$2,$3) RETURNING id',
    [name, subject || '', body || '']
  );
  res.json({ id: result.rows[0].id });
});

app.put('/api/templates/:id', async (req, res) => {
  const { name, subject, body } = req.body;
  await pool.query(
    'UPDATE cover_templates SET name=$1, subject=$2, body=$3 WHERE id=$4',
    [name, subject || '', body || '', req.params.id]
  );
  res.json({ ok: true });
});

app.delete('/api/templates/:id', async (req, res) => {
  await pool.query('DELETE FROM cover_templates WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// Generate cover letter from template
app.post('/api/generate-cover', async (req, res) => {
  const { template_id, company, role } = req.body;
  const tplResult = await pool.query('SELECT * FROM cover_templates WHERE id=$1', [template_id]);
  if (tplResult.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
  const tpl = tplResult.rows[0];
  const profileResult = await pool.query('SELECT * FROM profile WHERE id=1');
  const profile = profileResult.rows[0];

  const replace = (str) => {
    return str
      .replace(/\{company\}/g, company || '')
      .replace(/\{role\}/g, role || '')
      .replace(/\{full_name\}/g, profile.full_name || '')
      .replace(/\{email\}/g, profile.email || '')
      .replace(/\{phone\}/g, profile.phone || '')
      .replace(/\{linkedin_url\}/g, profile.linkedin_url || '')
      .replace(/\{github_url\}/g, profile.github_url || '')
      .replace(/\{current_role\}/g, profile.current_role || '')
      .replace(/\{experience_years\}/g, profile.experience_years || '')
      .replace(/\{skills\}/g, profile.skills || '')
      .replace(/\{summary\}/g, profile.summary || '');
  };

  res.json({ subject: replace(tpl.subject), body: replace(tpl.body) });
});

// Data export/import (backup)
app.get('/api/export', async (req, res) => {
  const applications = await pool.query('SELECT * FROM applications');
  const prep = await pool.query('SELECT * FROM prep_topics');
  const profile = await pool.query('SELECT * FROM profile WHERE id=1');
  const templates = await pool.query('SELECT * FROM cover_templates');
  const data = {
    applications: applications.rows,
    prep_topics: prep.rows,
    profile: profile.rows[0],
    cover_templates: templates.rows,
    exported_at: new Date().toISOString()
  };
  res.setHeader('Content-Disposition', 'attachment; filename=jobhunt-backup.json');
  res.json(data);
});

app.post('/api/import', async (req, res) => {
  try {
    const data = req.body;
    if (data.applications) {
      await pool.query('DELETE FROM applications');
      for (const a of data.applications) {
        await pool.query(
          `INSERT INTO applications (company, role, platform, portal_url, status, salary_range, location, notes, applied_date, interview_date, follow_up_date, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [a.company, a.role, a.platform || '', a.portal_url || '', a.status || 'WISHLIST', a.salary_range || '', a.location || '', a.notes || '', a.applied_date || '', a.interview_date || '', a.follow_up_date || '', a.created_at || new Date().toISOString(), a.updated_at || new Date().toISOString()]
        );
      }
    }
    if (data.prep_topics) {
      await pool.query('DELETE FROM prep_topics');
      for (const t of data.prep_topics) {
        await pool.query(
          `INSERT INTO prep_topics (category, topic, difficulty, status, notes, resource_url) VALUES ($1,$2,$3,$4,$5,$6)`,
          [t.category, t.topic, t.difficulty || 'MEDIUM', t.status || 'TODO', t.notes || '', t.resource_url || '']
        );
      }
    }
    if (data.profile) {
      const p = data.profile;
      await pool.query(
        `UPDATE profile SET full_name=$1, email=$2, phone=$3, linkedin_url=$4, github_url=$5, portfolio_url=$6, current_role=$7, experience_years=$8, skills=$9, summary=$10 WHERE id=1`,
        [p.full_name || '', p.email || '', p.phone || '', p.linkedin_url || '', p.github_url || '', p.portfolio_url || '', p.current_role || '', p.experience_years || '', p.skills || '', p.summary || '']
      );
    }
    if (data.cover_templates) {
      await pool.query('DELETE FROM cover_templates');
      for (const t of data.cover_templates) {
        await pool.query(
          'INSERT INTO cover_templates (name, subject, body) VALUES ($1,$2,$3)',
          [t.name, t.subject || '', t.body || '']
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3456;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log('Job Hunt Pro running at http://localhost:' + PORT);
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
