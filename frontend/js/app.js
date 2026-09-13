/**
 * app.js — QC Candidate Test Portal SPA
 *
 * Vanilla JS single-page application.
 * Reads CONFIG.API_URL from config.js (loaded before this script).
 * JWT stored in localStorage; all API calls attach Authorization: Bearer header.
 * Hash-based routing: location.hash = '#page/sub'
 */

'use strict';

// ============================================================
// STATE
// ============================================================

const State = {
  user: null,   // { id, name, role, email }
  token: null,
  assessment: null, // persistent assessment state (sessionStorage)
};

function loadToken() {
  State.token = localStorage.getItem('qc_jwt');
  const raw = localStorage.getItem('qc_user');
  State.user = raw ? JSON.parse(raw) : null;
}

function saveAuth(token, user) {
  State.token = token;
  State.user = user;
  localStorage.setItem('qc_jwt', token);
  localStorage.setItem('qc_user', JSON.stringify(user));
}

function clearAuth() {
  State.token = null;
  State.user = null;
  localStorage.removeItem('qc_jwt');
  localStorage.removeItem('qc_user');
  sessionStorage.removeItem('qc_assessment');
}

function loadAssessment() {
  const raw = sessionStorage.getItem('qc_assessment');
  State.assessment = raw ? JSON.parse(raw) : null;
}

function saveAssessment(data) {
  State.assessment = data;
  sessionStorage.setItem('qc_assessment', JSON.stringify(data));
}

function clearAssessment() {
  State.assessment = null;
  sessionStorage.removeItem('qc_assessment');
}

// ============================================================
// API CLIENT
// ============================================================

async function api(method, path, body = null, isFormData = false) {
  const headers = {};
  if (State.token) headers['Authorization'] = `Bearer ${State.token}`;
  if (!isFormData && body !== null) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${CONFIG.API_URL}/${path}`, {
    method,
    headers,
    body: isFormData ? body : body !== null ? JSON.stringify(body) : null,
  });

  // Handle binary responses (Excel/CSV)
  const ct = res.headers.get('Content-Type') || '';
  if (!res.ok) {
    let errMsg = 'Request failed';
    try { errMsg = (await res.json()).error || errMsg; } catch { /* ignore */ }
    if (res.status === 401) { clearAuth(); navigate('login'); }
    throw new Error(errMsg);
  }
  if (ct.includes('application/json')) return res.json();
  if (ct.includes('text/csv') || ct.includes('spreadsheet')) return res.blob();
  return res.text();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// ROUTER
// ============================================================

function navigate(hash) {
  location.hash = hash;
}

const ROUTES = {
  'login':                   renderLogin,
  'candidate/assessment':    renderAssessment,
  'candidate/results':       renderCandidateResults,
  'reviewer/review':         renderReviewAssessments,
  'reviewer/candidates':     renderCreateCandidate,
  'reviewer/schedules':      renderSchedules,
  'reviewer/upcoming':       renderUpcoming,
  'admin/projects':          renderProjects,
  'admin/accounts':          renderAccounts,
  'admin/questions':         renderQuestions,
};

async function render() {
  loadToken();
  loadAssessment();

  const hash = location.hash.replace('#', '') || 'login';

  if (!State.user) {
    // Check if DB has users; show bootstrap if not
    if (hash !== 'login') { navigate('login'); return; }
    const { hasUsers } = await api('GET', 'bootstrap/has-users').catch(() => ({ hasUsers: true }));
    if (!hasUsers) { renderBootstrap(); return; }
    renderLogin();
    return;
  }

  // Role-based default redirect
  const role = State.user.role;
  const defaultRoute = {
    Candidate: 'candidate/assessment',
    Reviewer: 'reviewer/review',
    Admin: 'reviewer/review',
  }[role] || 'login';

  if (hash === 'login') { navigate(defaultRoute); return; }

  const renderer = ROUTES[hash];
  if (!renderer) { navigate(defaultRoute); return; }

  // Guard role access
  if (hash.startsWith('candidate/') && role !== 'Candidate') { navigate(defaultRoute); return; }
  if ((hash.startsWith('reviewer/') || hash.startsWith('admin/')) && role === 'Candidate') { navigate(defaultRoute); return; }
  if (hash.startsWith('admin/') && role === 'Reviewer') { navigate(defaultRoute); return; }

  renderer();
}

window.addEventListener('hashchange', render);
window.addEventListener('load', render);

// ============================================================
// LAYOUT
// ============================================================

function appEl() { return document.getElementById('app'); }

function buildLayout(pageHtml, activeHash) {
  const user = State.user;
  const role = user.role;

  const candidateNav = `
    <span class="sidebar-nav-label">Assessment</span>
    <button class="nav-item ${activeHash==='candidate/assessment'?'active':''}" onclick="navigate('candidate/assessment')">
      <span class="nav-icon">📝</span> Take Assessment
    </button>
    <button class="nav-item ${activeHash==='candidate/results'?'active':''}" onclick="navigate('candidate/results')">
      <span class="nav-icon">📊</span> My Results
    </button>`;

  const reviewerNav = `
    <span class="sidebar-nav-label">Assessments</span>
    <button class="nav-item ${activeHash==='reviewer/review'?'active':''}" onclick="navigate('reviewer/review')">
      <span class="nav-icon">🔍</span> Review Assessments
    </button>
    <button class="nav-item ${activeHash==='reviewer/candidates'?'active':''}" onclick="navigate('reviewer/candidates')">
      <span class="nav-icon">👤</span> Create Candidate
    </button>
    <button class="nav-item ${activeHash==='reviewer/schedules'?'active':''}" onclick="navigate('reviewer/schedules')">
      <span class="nav-icon">📅</span> Schedule Candidate
    </button>
    <button class="nav-item ${activeHash==='reviewer/upcoming'?'active':''}" onclick="navigate('reviewer/upcoming')">
      <span class="nav-icon">⏰</span> Upcoming Schedules
    </button>
    <span class="sidebar-nav-label">Content</span>
    <button class="nav-item ${activeHash==='admin/questions'?'active':''}" onclick="navigate('admin/questions')">
      <span class="nav-icon">📚</span> Question Bank
    </button>`;

  const adminNav = reviewerNav + `
    <span class="sidebar-nav-label">Admin</span>
    <button class="nav-item ${activeHash==='admin/projects'?'active':''}" onclick="navigate('admin/projects')">
      <span class="nav-icon">🗂️</span> Projects
    </button>
    <button class="nav-item ${activeHash==='admin/accounts'?'active':''}" onclick="navigate('admin/accounts')">
      <span class="nav-icon">⚙️</span> Accounts
    </button>`;

  const nav = role === 'Candidate' ? candidateNav : role === 'Admin' ? adminNav : reviewerNav;

  appEl().innerHTML = `
    <div class="overlay" id="overlay" onclick="closeSidebar()"></div>
    <div class="app-layout">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <img src="img/C.A.T. Logo - Horizontal.jpg" alt="CAT Logo" class="sidebar-logo" />
          <div class="sidebar-user">
            <div class="sidebar-user-name">${esc(user.name)}</div>
            <div class="sidebar-user-role">${esc(user.role)}</div>
          </div>
        </div>
        <nav class="sidebar-nav">${nav}</nav>
        <div class="sidebar-footer">
          <button class="btn btn-ghost btn-sm" onclick="toggleChangePwd()" id="changePwdBtn">🔑 Change Password</button>
          <div id="changePwdPanel" style="display:none" class="change-pwd-panel"></div>
          <button class="btn btn-ghost btn-sm" onclick="signOut()">↩ Sign Out</button>
        </div>
      </aside>
      <main class="main-content fade-in">
        <div class="mobile-header">
          <button class="hamburger" onclick="openSidebar()">☰</button>
          <img src="img/C.A.T. Emblem.jpg" alt="CAT" style="height:32px">
        </div>
        ${pageHtml}
      </main>
    </div>`;
}

function openSidebar() {
  document.getElementById('sidebar')?.classList.add('open');
  document.getElementById('overlay')?.classList.add('visible');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('overlay')?.classList.remove('visible');
}
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;

function toggleChangePwd() {
  const panel = document.getElementById('changePwdPanel');
  if (!panel) return;
  if (panel.style.display === 'none') {
    panel.style.display = 'block';
    panel.innerHTML = changePwdForm();
  } else {
    panel.style.display = 'none';
  }
}
window.toggleChangePwd = toggleChangePwd;

function changePwdForm() {
  return `
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
      <input type="password" id="cpCurrent" placeholder="Current password" style="padding:8px 10px;font-size:0.8rem" />
      <input type="password" id="cpNew" placeholder="New password (6+ chars)" style="padding:8px 10px;font-size:0.8rem" />
      <input type="password" id="cpConfirm" placeholder="Confirm new password" style="padding:8px 10px;font-size:0.8rem" />
      <div id="cpMsg"></div>
      <button class="btn btn-primary btn-sm btn-full" onclick="doChangePwd()">Save Password</button>
    </div>`;
}

window.doChangePwd = async function () {
  const cur = document.getElementById('cpCurrent')?.value.trim();
  const nw = document.getElementById('cpNew')?.value.trim();
  const conf = document.getElementById('cpConfirm')?.value.trim();
  const msg = document.getElementById('cpMsg');
  if (nw !== conf) { msg.innerHTML = alert('error', 'Passwords do not match.'); return; }
  try {
    await api('POST', 'auth/change-password', { currentPassword: cur, newPassword: nw });
    clearAuth();
    navigate('login');
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

function signOut() {
  clearAuth();
  navigate('login');
}
window.signOut = signOut;

// ============================================================
// HELPERS
// ============================================================

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function alert(type, msg) {
  return `<div class="alert alert-${type}">${esc(msg)}</div>`;
}

function loading() {
  return `<div class="loading"><div class="spinner"></div> Loading…</div>`;
}

function expander(title, bodyHtml, open = false) {
  const id = 'exp_' + Math.random().toString(36).slice(2);
  return `
    <div class="expander ${open ? 'open' : ''}" id="${id}">
      <button class="expander-header" onclick="toggleExpander('${id}')">
        ${esc(title)} <span class="expander-arrow">▼</span>
      </button>
      <div class="expander-body" style="display:${open?'block':'none'}">${bodyHtml}</div>
    </div>`;
}
window.toggleExpander = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const body = el.querySelector('.expander-body');
  const open = el.classList.toggle('open');
  body.style.display = open ? 'block' : 'none';
};

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function sample(arr, n) {
  const s = [...arr].sort(() => Math.random() - 0.5);
  return s.slice(0, n);
}
function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }
function randomToken() { return crypto.randomUUID().replace(/-/g, ''); }

const TYPE_LABELS = {
  mcq: 'Multiple Choice', essay: 'Essay', oral: 'Oral Test',
  practicum: 'Practicum', practical: 'Practical Test',
};

// ============================================================
// PAGE: BOOTSTRAP (first-run admin setup)
// ============================================================

function renderBootstrap() {
  appEl().innerHTML = `
    <div class="login-page">
      <div class="login-card fade-in">
        <img src="img/C.A.T. Logo - Horizontal.jpg" alt="CAT Logo" class="login-logo" />
        <h1 class="login-title">Initial Setup</h1>
        <p class="login-subtitle" style="margin-bottom:20px">Create the first administrator account on a trusted local connection.</p>
        <div id="bootMsg"></div>
        <div class="form-group"><label>Full Name</label><input type="text" id="bootName" placeholder="Administrator name" /></div>
        <div class="form-group"><label>Username</label><input type="text" id="bootUser" placeholder="admin" /></div>
        <div class="form-group"><label>Password (6+ characters)</label><input type="password" id="bootPass" /></div>
        <button class="btn btn-primary btn-full" onclick="doBootstrap()">Create Administrator</button>
      </div>
    </div>`;
}

window.doBootstrap = async function () {
  const name = document.getElementById('bootName').value.trim();
  const username = document.getElementById('bootUser').value.trim();
  const password = document.getElementById('bootPass').value;
  const msg = document.getElementById('bootMsg');
  try {
    await api('POST', 'bootstrap/create-admin', { username, name, password });
    msg.innerHTML = alert('success', 'Administrator created. Please sign in.');
    setTimeout(() => navigate('login'), 1200);
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

// ============================================================
// PAGE: LOGIN
// ============================================================

function renderLogin() {
  appEl().innerHTML = `
    <div class="login-page">
      <div class="login-card fade-in">
        <img src="img/C.A.T. Logo - Horizontal.jpg" alt="CAT Logo" class="login-logo" />
        <h1 class="login-title">QC Candidate Test Portal</h1>
        <p class="login-subtitle">Technical assessments · Multiple disciplines · Evidence-based grading</p>
        <div id="loginMsg"></div>
        <div class="form-group"><label>Username</label><input type="text" id="loginUser" autocomplete="username" /></div>
        <div class="form-group"><label>Password</label><input type="password" id="loginPass" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()" /></div>
        <button class="btn btn-primary btn-full" id="loginBtn" onclick="doLogin()">Sign In</button>
      </div>
    </div>`;
}

window.doLogin = async function () {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const btn = document.getElementById('loginBtn');
  const msg = document.getElementById('loginMsg');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const { token, user } = await api('POST', 'auth/login', { username, password });
    saveAuth(token, user);
    clearAssessment();
    render();
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
};

// ============================================================
// PAGE: CANDIDATE — TAKE ASSESSMENT
// ============================================================

async function renderAssessment() {
  // If already submitted in this session, show completion
  if (State.assessment?.phase === 'submitted') {
    buildLayout(submittedHtml(), 'candidate/assessment');
    return;
  }

  buildLayout(loading(), 'candidate/assessment');

  try {
    const allQuestions = await api('GET', 'questions');
    const disciplines = [...new Set(allQuestions.filter(q => q.active).map(q => q.discipline))].sort();

    if (!disciplines.length) {
      buildLayout(`
        <h1 class="page-title">Take an Assessment</h1>
        <div class="alert alert-info">No assessments are currently available.</div>`, 'candidate/assessment');
      return;
    }

    // Phase routing
    const phase = State.assessment?.phase || 'details';

    if (phase === 'details') {
      renderAssessmentDetails(disciplines, allQuestions);
    } else if (phase === 'mcq') {
      renderAssessmentMcq();
    } else if (phase === 'essay') {
      renderAssessmentEssay();
    }
  } catch (e) {
    buildLayout(`<div>${alert('error', e.message)}</div>`, 'candidate/assessment');
  }
}

function renderAssessmentDetails(disciplines, allQuestions) {
  const today = new Date().toISOString().slice(0, 10);
  const html = `
    <h1 class="page-title">Take an Assessment</h1>
    <p class="page-subtitle">Complete all candidate details before starting.</p>
    <div id="detailsMsg"></div>
    <div class="card">
      <h3>Candidate Details</h3>
      <div class="grid-2">
        <div class="form-group"><label>Discipline</label>
          <select id="aDisc">${disciplines.map(d=>`<option>${esc(d)}</option>`).join('')}</select></div>
        <div class="form-group"><label>Full Name</label>
          <input type="text" id="aName" value="${esc(State.user.name)}" /></div>
        <div class="form-group"><label>Email</label>
          <input type="text" id="aEmail" value="${esc(State.user.email||'')}" disabled /></div>
        <div class="form-group"><label>Designation</label>
          <input type="text" id="aDesig" /></div>
        <div class="form-group"><label>Iqama No</label>
          <input type="text" id="aIqama" /></div>
        <div class="form-group"><label>Employee No</label>
          <input type="text" id="aEmpNo" /></div>
        <div class="form-group"><label>Date of Exam</label>
          <input type="date" id="aExamDate" value="${today}" disabled /></div>
        <div class="form-group"><label>Project Location</label>
          <input type="text" id="aProjLoc" /></div>
      </div>
      <div class="alert alert-info" style="margin:0 0 16px">
        You will complete 20 Multiple Choice, 5 Essay, 5 Oral, and 5 Practicum questions.
      </div>
      <button class="btn btn-primary" onclick="startAssessment(${JSON.stringify(disciplines).replace(/"/g,'&quot;')}, ${JSON.stringify(allQuestions).replace(/"/g,'&quot;')})">
        Start Multiple Choice Questions →
      </button>
    </div>`;
  buildLayout(html, 'candidate/assessment');
}

window.startAssessment = function(disciplines, allQuestions) {
  const discipline = document.getElementById('aDisc').value;
  const name = document.getElementById('aName').value.trim();
  const designation = document.getElementById('aDesig').value.trim();
  const iqama = document.getElementById('aIqama').value.trim();
  const empNo = document.getElementById('aEmpNo').value.trim();
  const projLoc = document.getElementById('aProjLoc').value.trim();
  const examDate = document.getElementById('aExamDate').value;
  const msg = document.getElementById('detailsMsg');

  if (!name || !designation || !iqama || !empNo || !projLoc) {
    msg.innerHTML = alert('error', 'Complete all candidate details before starting.');
    return;
  }

  const bank = allQuestions.filter(q => q.active && q.discipline === discipline);
  const mcqBank = bank.filter(q => q.q_type === 'mcq');
  const essayPool = bank.filter(q => q.q_type === 'essay');
  const oralPool = bank.filter(q => q.q_type === 'oral');
  const practicumPool = bank.filter(q => q.q_type === 'practicum');

  if (mcqBank.length < 20 || essayPool.length < 5 || oralPool.length < 5 || practicumPool.length < 5) {
    msg.innerHTML = alert('error', `This discipline needs at least 20 MCQ, 5 Essay, 5 Oral, and 5 Practicum questions. It currently has ${mcqBank.length} MCQ, ${essayPool.length} Essay, ${oralPool.length} Oral, and ${practicumPool.length} Practicum questions.`);
    return;
  }

  const mcqSelected = sample(mcqBank, 20);
  const essaySelected = [
    ...sample(essayPool, 5),
    ...sample(oralPool, 5),
    ...sample(practicumPool, 5),
  ];
  const mcqOptions = {};
  for (const q of mcqSelected) {
    mcqOptions[q.id] = shuffle(JSON.parse(q.options));
  }

  saveAssessment({
    phase: 'mcq',
    discipline,
    details: { name, email: State.user.email || '', designation, iqama_no: iqama, employee_no: empNo, exam_date: examDate, project_location: projLoc },
    mcqIds: mcqSelected.map(q => q.id),
    essayIds: essaySelected.map(q => q.id),
    mcqOptions,
    mcqQuestions: mcqSelected,
    essayQuestions: essaySelected,
    responses: {},
    token: randomToken(),
  });
  renderAssessmentMcq();
};

function phaseBar(phase) {
  const steps = ['Candidate Details', 'Multiple Choice (20)', 'Essay / Oral / Practicum (15)', 'Complete'];
  const idx = { details: 0, mcq: 1, essay: 2, submitted: 3 }[phase] ?? 0;
  return `<div class="phase-indicator">${steps.map((s, i) => `
    <div class="phase-step ${i < idx ? 'done' : i === idx ? 'active' : ''}">${i < idx ? '✓ ' : ''}${s}</div>`).join('')}</div>`;
}

function renderAssessmentMcq() {
  const a = State.assessment;
  if (!a || a.phase !== 'mcq') { renderAssessment(); return; }

  const qs = a.mcqQuestions;
  const questionsHtml = qs.map((q, idx) => {
    const opts = a.mcqOptions[q.id] || JSON.parse(q.options || '[]');
    const selected = a.responses[q.id];
    return `
      <div class="question-card">
        <div class="question-num">Question ${idx + 1} of 20 — Multiple Choice</div>
        <div class="question-text">${esc(q.question_text)}</div>
        <div class="radio-group" id="rg_${q.id}">
          ${opts.map(opt => `
            <label class="radio-option ${selected === opt ? 'selected' : ''}" id="ro_${q.id}_${btoa(opt).slice(0,8)}">
              <input type="radio" name="q_${q.id}" value="${esc(opt)}" ${selected === opt ? 'checked' : ''}
                onchange="selectMcq(${q.id}, this.value, '${q.id}')">
              ${esc(opt)}
            </label>`).join('')}
        </div>
      </div>`;
  }).join('');

  const html = `
    <h1 class="page-title">Multiple Choice Questions</h1>
    ${phaseBar('mcq')}
    <div id="mcqMsg"></div>
    ${questionsHtml}
    <div style="margin-top:24px">
      <button class="btn btn-primary" onclick="submitMcq()">Continue to Essay, Oral & Practicum →</button>
    </div>`;
  buildLayout(html, 'candidate/assessment');
}

window.selectMcq = function(questionId, value) {
  const a = State.assessment;
  if (!a) return;
  a.responses[questionId] = value;
  saveAssessment(a);
  // Update visual selection
  document.querySelectorAll(`[name="q_${questionId}"]`).forEach(el => {
    el.closest('.radio-option')?.classList.toggle('selected', el.value === value);
  });
};

window.submitMcq = function() {
  const a = State.assessment;
  const msg = document.getElementById('mcqMsg');
  const unanswered = a.mcqIds.filter(id => !a.responses[id]);
  if (unanswered.length) {
    msg.innerHTML = alert('error', 'Answer every Multiple Choice Question before continuing.');
    msg.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  a.phase = 'essay';
  saveAssessment(a);
  renderAssessmentEssay();
};

function renderAssessmentEssay() {
  const a = State.assessment;
  if (!a) { renderAssessment(); return; }

  const qs = a.essayQuestions;
  const questionsHtml = qs.map((q, idx) => {
    const tagCls = { essay: 'tag-essay', oral: 'tag-oral', practicum: 'tag-practicum', practical: 'tag-practical' }[q.q_type] || 'tag-essay';
    const val = a.responses[q.id] || '';
    return `
      <div class="question-card">
        <div class="question-num">Question ${idx + 1} of 15</div>
        <span class="question-type-tag ${tagCls}">${TYPE_LABELS[q.q_type] || q.q_type}</span>
        <div class="question-text">${esc(q.question_text)}</div>
        <textarea id="ea_${q.id}" rows="6" maxlength="20000" placeholder="Type your answer here…"
          oninput="saveEssayResponse(${q.id}, this.value)">${esc(val)}</textarea>
      </div>`;
  }).join('');

  const html = `
    <h1 class="page-title">Essay, Oral & Practicum Questions</h1>
    ${phaseBar('essay')}
    <div class="alert alert-info">Read each question and type your answer. Essay answers are reviewed and scored by a Reviewer.</div>
    <div id="essayMsg"></div>
    ${questionsHtml}
    <div style="margin-top:24px">
      <button class="btn btn-primary" onclick="submitEssay()">Submit Assessment</button>
    </div>`;
  buildLayout(html, 'candidate/assessment');
}

window.saveEssayResponse = function(questionId, value) {
  const a = State.assessment;
  if (!a) return;
  a.responses[questionId] = value;
  saveAssessment(a);
};

window.submitEssay = async function() {
  const a = State.assessment;
  const msg = document.getElementById('essayMsg');
  const unanswered = a.essayIds.filter(id => !a.responses[id]?.trim());
  if (unanswered.length) {
    msg.innerHTML = alert('error', 'Answer every Essay, Oral, and Practicum question before submitting.');
    msg.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const btn = document.querySelector('#essayMsg + div button') || document.querySelector('[onclick="submitEssay()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  try {
    const responses = {};
    for (const [k, v] of Object.entries(a.responses)) responses[Number(k)] = v;
    await api('POST', 'submissions', {
      discipline: a.discipline,
      responses,
      token: a.token,
      candidate_details: a.details,
      question_ids: [...a.mcqIds, ...a.essayIds],
    });
    a.phase = 'submitted';
    saveAssessment(a);
    buildLayout(submittedHtml(), 'candidate/assessment');
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Assessment'; }
  }
};

function submittedHtml() {
  return `
    <div class="submitted-state">
      <div class="submitted-icon">✅</div>
      <div class="submitted-title">Assessment Submitted</div>
      <div class="submitted-desc">This completes the online test. Next test is Oral and Practicum. Your results will appear once a reviewer grades your submission.</div>
      <button class="btn btn-secondary" onclick="signOut()">↩ Sign Out</button>
    </div>`;
}

// ============================================================
// PAGE: CANDIDATE — MY RESULTS
// ============================================================

async function renderCandidateResults() {
  buildLayout(loading(), 'candidate/results');
  try {
    const rows = await api('GET', 'submissions');
    if (!rows.length) {
      buildLayout(`
        <h1 class="page-title">My Results</h1>
        <div class="alert alert-info">Your submitted assessments will appear here.</div>`, 'candidate/results');
      return;
    }
    const tableRows = rows.map(r => `
      <tr>
        <td>#${r.id}</td>
        <td>${esc(r.discipline)}</td>
        <td>${formatDate(r.created_at)}</td>
        <td><span class="badge badge-${r.status==='Graded'?'graded':'pending'}">${esc(r.status)}</span></td>
        <td>${r.status==='Graded' ? `<span class="badge badge-${r.result?.startsWith('PASS')?'pass':'fail'}">${esc(r.result)}</span>` : '—'}</td>
        <td>${r.status==='Graded' ? esc(r.reviewer_comments||'No feedback provided.') : '—'}</td>
      </tr>`).join('');
    const html = `
      <h1 class="page-title">My Results</h1>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Discipline</th><th>Submitted</th><th>Status</th><th>Result</th><th>Reviewer Comments</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
    buildLayout(html, 'candidate/results');
  } catch (e) {
    buildLayout(alert('error', e.message), 'candidate/results');
  }
}

// ============================================================
// PAGE: REVIEWER — REVIEW ASSESSMENTS
// ============================================================

async function renderReviewAssessments() {
  buildLayout(loading(), 'reviewer/review');
  try {
    const rows = await api('GET', 'submissions');
    const pending = rows.filter(r => r.status === 'Pending Review').length;
    const graded = rows.filter(r => r.status === 'Graded').length;

    const filterOptions = ['All', 'Pending Review', 'Graded'].map(s =>
      `<option>${s}</option>`).join('');

    const tableRows = rows.map(r => `
      <tr style="cursor:pointer" onclick="openGrading(${r.id})">
        <td>#${r.id}</td>
        <td>${esc(r.candidate_name)}</td>
        <td>${esc(r.discipline)}</td>
        <td>${formatDate(r.created_at)}</td>
        <td><span class="badge badge-${r.status==='Graded'?'graded':'pending'}">${esc(r.status)}</span></td>
        <td>${r.status==='Graded'?`<span class="badge badge-${r.result?.startsWith('PASS')?'pass':'fail'}">${esc(r.result)}</span>`:'—'}</td>
      </tr>`).join('');

    const html = `
      <h1 class="page-title">Assessment Review</h1>
      <div class="metrics-row">
        <div class="metric-card"><div class="metric-value">${pending}</div><div class="metric-label">Pending Review</div></div>
        <div class="metric-card"><div class="metric-value">${graded}</div><div class="metric-label">Graded</div></div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px">
        <select id="statusFilter" onchange="filterSubmissions()" style="width:auto;flex-shrink:0">${filterOptions}</select>
        <a href="#" onclick="exportCsv(event)" class="btn btn-secondary btn-sm">⬇ CSV</a>
        <a href="#" onclick="exportExcel(event)" class="btn btn-secondary btn-sm">⬇ Excel</a>
      </div>
      <div class="table-wrap">
        <table id="submissionsTable">
          <thead><tr><th>#</th><th>Candidate</th><th>Discipline</th><th>Submitted</th><th>Status</th><th>Result</th></tr></thead>
          <tbody id="submissionsBody">${tableRows}</tbody>
        </table>
      </div>
      <div id="gradingPanel" style="margin-top:24px"></div>`;

    buildLayout(html, 'reviewer/review');
    // Store rows for filter
    window._reviewRows = rows;
  } catch (e) {
    buildLayout(alert('error', e.message), 'reviewer/review');
  }
}

window.filterSubmissions = function() {
  const filter = document.getElementById('statusFilter')?.value;
  const rows = window._reviewRows || [];
  const filtered = filter === 'All' ? rows : rows.filter(r => r.status === filter);
  const tbody = document.getElementById('submissionsBody');
  if (!tbody) return;
  tbody.innerHTML = filtered.map(r => `
    <tr style="cursor:pointer" onclick="openGrading(${r.id})">
      <td>#${r.id}</td>
      <td>${esc(r.candidate_name)}</td>
      <td>${esc(r.discipline)}</td>
      <td>${formatDate(r.created_at)}</td>
      <td><span class="badge badge-${r.status==='Graded'?'graded':'pending'}">${esc(r.status)}</span></td>
      <td>${r.status==='Graded'?`<span class="badge badge-${r.result?.startsWith('PASS')?'pass':'fail'}">${esc(r.result)}</span>`:'—'}</td>
    </tr>`).join('');
};

window.openGrading = async function(sid) {
  const panel = document.getElementById('gradingPanel');
  if (!panel) return;
  panel.innerHTML = loading();
  panel.scrollIntoView({ behavior: 'smooth' });
  try {
    const [rows, answers] = await Promise.all([api('GET','submissions'), api('GET',`submissions/${sid}/answers`)]);
    const sub = rows.find(r => r.id === sid);
    if (!sub) { panel.innerHTML = alert('error','Submission not found.'); return; }

    const answerHtml = answers.map(a => {
      const q = JSON.parse(a.snapshot);
      const isReviewer = ['essay','practicum','oral','practical'].includes(q.q_type);
      const tagCls = { essay:'tag-essay', oral:'tag-oral', practicum:'tag-practicum', practical:'tag-practical' }[q.q_type] || '';
      return `
        <div class="question-card" style="margin-bottom:16px">
          ${isReviewer ? `<span class="question-type-tag ${tagCls}">${TYPE_LABELS[q.q_type]||q.q_type}</span>` : ''}
          <div class="question-text">${esc(q.question_text)}</div>
          <textarea rows="4" disabled style="margin:8px 0;opacity:0.85">${esc(a.submitted_answer)}</textarea>
          ${isReviewer ? `
            <div class="rubric-box">📋 Rubric: ${esc(q.rubric)}</div>
            <div class="form-group" style="margin:0">
              <label>Points (max ${q.max_points})</label>
              <input type="number" id="score_${a.id}" min="0" max="${q.max_points}" step="0.5"
                value="${a.awarded_score}" ${sub.status==='Graded'?'disabled':''} style="width:120px" />
            </div>` : `
            <div class="range-label">Correct answer: ${esc(q.correct_answer)} · Awarded: ${a.awarded_score}</div>`}
        </div>`;
    }).join('');

    panel.innerHTML = `
      <div class="card">
        <h3>Assessment #${sub.id} — ${esc(sub.candidate_name)}</h3>
        <div class="grid-2" style="margin-bottom:16px;font-size:0.85rem">
          <div><strong>Discipline:</strong> ${esc(sub.discipline)}</div>
          <div><strong>MCQ Score:</strong> ${sub.mcq_score}/${sub.max_possible_points}</div>
          <div><strong>Email:</strong> ${esc(sub.email||'')}</div>
          <div><strong>Designation:</strong> ${esc(sub.designation||'')}</div>
          <div><strong>Iqama No:</strong> ${esc(sub.iqama_no||'')}</div>
          <div><strong>Project Location:</strong> ${esc(sub.project_location||'')}</div>
          <div><strong>Exam Date:</strong> ${formatDate(sub.exam_date)}</div>
          <div><strong>Status:</strong> ${esc(sub.status)}</div>
        </div>
        <hr class="divider" />
        <div id="gradingMsg"></div>
        ${answerHtml}
        <div class="form-group">
          <label>Reviewer Comments</label>
          <textarea id="reviewerComments" rows="4" ${sub.status==='Graded'?'disabled':''}>${esc(sub.reviewer_comments||'')}</textarea>
        </div>
        ${sub.status !== 'Graded' ? `<button class="btn btn-primary" onclick="finalizeGrade(${sid}, ${JSON.stringify(answers.filter(a=>['essay','practicum','oral','practical'].includes(JSON.parse(a.snapshot).q_type)).map(a=>a.id))})">Finalize Grade</button>` : `<div class="alert alert-success">This assessment has been graded. Result: ${esc(sub.result||'')}</div>`}
      </div>`;
  } catch (e) {
    panel.innerHTML = alert('error', e.message);
  }
};

window.finalizeGrade = async function(sid, essayAnswerIds) {
  const scores = {};
  for (const id of essayAnswerIds) {
    const el = document.getElementById(`score_${id}`);
    scores[id] = el ? parseFloat(el.value) : 0;
  }
  const comments = document.getElementById('reviewerComments')?.value || '';
  const msg = document.getElementById('gradingMsg');
  try {
    await api('POST', `submissions/${sid}/grade`, { scores, comments });
    msg.innerHTML = alert('success', 'Grade finalized successfully.');
    setTimeout(() => renderReviewAssessments(), 1500);
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

window.exportCsv = async function(e) {
  e.preventDefault();
  try {
    const blob = await api('GET', 'export/csv');
    downloadBlob(blob, 'qc-results.csv');
  } catch(e) { alert('error', e.message); }
};
window.exportExcel = async function(e) {
  e.preventDefault();
  try {
    const blob = await api('GET', 'export/excel');
    downloadBlob(blob, 'CTA Record Log.xlsx');
  } catch(e) { alert('error', e.message); }
};

// ============================================================
// PAGE: REVIEWER — CREATE CANDIDATE
// ============================================================

async function renderCreateCandidate() {
  buildLayout(loading(), 'reviewer/candidates');
  try {
    const disciplines = await api('GET', 'disciplines');
    const discOpts = disciplines.map(d => `<option>${esc(d)}</option>`).join('');
    const html = `
      <h1 class="page-title">Create Candidate Account</h1>
      <p class="page-subtitle">Login credentials are generated when the schedule invitation is sent.</p>
      <div class="card">
        <div id="candMsg"></div>
        <div class="grid-2">
          <div class="form-group"><label>Full Name</label><input type="text" id="cName" /></div>
          <div class="form-group"><label>Username</label><input type="text" id="cUser" /></div>
          <div class="form-group"><label>Email</label><input type="email" id="cEmail" /></div>
          <div class="form-group"><label>Discipline</label><select id="cDisc">${discOpts}</select></div>
          <div class="form-group"><label>Iqama No</label><input type="text" id="cIqama" /></div>
          <div class="form-group"><label>Employee No</label><input type="text" id="cEmpNo" /></div>
          <div class="form-group"><label>Mobile No</label><input type="text" id="cMobile" /></div>
        </div>
        <div class="alert alert-info" style="margin:0 0 16px">A temporary password is generated and emailed when the schedule invitation is sent.</div>
        <button class="btn btn-primary" onclick="doCreateCandidate()">Create Account</button>
      </div>`;
    buildLayout(html, 'reviewer/candidates');
  } catch (e) {
    buildLayout(alert('error', e.message), 'reviewer/candidates');
  }
}

window.doCreateCandidate = async function() {
  const msg = document.getElementById('candMsg');
  const data = {
    name: document.getElementById('cName').value.trim(),
    username: document.getElementById('cUser').value.trim(),
    email: document.getElementById('cEmail').value.trim(),
    discipline: document.getElementById('cDisc').value,
    iqama_no: document.getElementById('cIqama').value.trim(),
    employee_no: document.getElementById('cEmpNo').value.trim(),
    mobile_no: document.getElementById('cMobile').value.trim(),
  };
  try {
    await api('POST', 'candidates', data);
    msg.innerHTML = alert('success', 'Candidate account created.');
    ['cName','cUser','cEmail','cIqama','cEmpNo','cMobile'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

// ============================================================
// PAGE: REVIEWER — SCHEDULE CANDIDATES
// ============================================================

async function renderSchedules() {
  buildLayout(loading(), 'reviewer/schedules');
  try {
    const candidates = await api('GET', 'candidates');
    if (!candidates.length) {
      buildLayout(`<h1 class="page-title">Create Candidate Schedules</h1><div class="alert alert-info">No candidate accounts yet. Create one first.</div>`, 'reviewer/schedules');
      return;
    }

    const opts = candidates.map(c => `<option value="${c.id}">${esc(c.name)} — ${esc(c.discipline)} — ${esc(c.iqama_no)}</option>`).join('');
    const html = `
      <h1 class="page-title">Create Candidate Schedules</h1>
      <div class="card">
        <div class="grid-3">
          <div class="form-group"><label>Filter by Name</label><input type="text" id="fName" oninput="filterCandidates()" /></div>
          <div class="form-group"><label>Filter by Discipline</label><input type="text" id="fDisc" oninput="filterCandidates()" /></div>
          <div class="form-group"><label>Filter by Iqama</label><input type="text" id="fIqama" oninput="filterCandidates()" /></div>
        </div>
        <div class="form-group"><label>Select Candidate</label><select id="candSelect" onchange="loadCandSchedule()">${opts}</select></div>
        <div id="schedPanel"></div>
      </div>`;
    buildLayout(html, 'reviewer/schedules');
    window._schedCandidates = candidates;
    loadCandSchedule();
  } catch (e) {
    buildLayout(alert('error', e.message), 'reviewer/schedules');
  }
}

window.filterCandidates = function() {
  const name = document.getElementById('fName')?.value.toLowerCase() || '';
  const disc = document.getElementById('fDisc')?.value.toLowerCase() || '';
  const iqama = document.getElementById('fIqama')?.value.toLowerCase() || '';
  const sel = document.getElementById('candSelect');
  if (!sel) return;
  const filtered = (window._schedCandidates || []).filter(c =>
    (!name || c.name.toLowerCase().includes(name)) &&
    (!disc || c.discipline.toLowerCase().includes(disc)) &&
    (!iqama || c.iqama_no.toLowerCase().includes(iqama))
  );
  sel.innerHTML = filtered.map(c => `<option value="${c.id}">${esc(c.name)} — ${esc(c.discipline)} — ${esc(c.iqama_no)}</option>`).join('');
  loadCandSchedule();
};

window.loadCandSchedule = function() {
  const sel = document.getElementById('candSelect');
  const panel = document.getElementById('schedPanel');
  if (!sel || !panel) return;
  const c = (window._schedCandidates || []).find(x => String(x.id) === String(sel.value));
  if (!c) { panel.innerHTML = ''; return; }

  const today = new Date().toISOString().slice(0, 10);
  const scheduledDate = c.test_date ? String(c.test_date).slice(0, 10) : '';
  const minDate = scheduledDate ? (scheduledDate < today ? scheduledDate : today) : today;
  panel.innerHTML = `
    <hr class="divider" />
    <div style="font-size:0.85rem;margin-bottom:12px">
      <strong>Email:</strong> ${esc(c.email)} &nbsp;|&nbsp;
      <strong>Current Test Date:</strong> ${scheduledDate ? formatDate(c.test_date) : 'Not scheduled'}
    </div>
    <div id="schedMsg"></div>
    <div class="form-group"><label>Test Date</label>
      <input type="date" id="schedDate" value="${scheduledDate || today}" min="${minDate}" style="width:200px" /></div>
    <button class="btn btn-primary" onclick="saveSchedule(${c.id})">Save Schedule</button>`;
};

window.saveSchedule = async function(candidateId) {
  const date = document.getElementById('schedDate')?.value;
  const msg = document.getElementById('schedMsg');
  const today = new Date().toISOString().slice(0, 10);
  if (!date || date < today) { msg.innerHTML = alert('error','Test date must be today or a future date.'); return; }
  try {
    await api('POST', `candidates/${candidateId}/schedule`, { test_date: date });
    msg.innerHTML = alert('success', 'Schedule saved successfully.');
    await renderSchedules();
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

// ============================================================
// PAGE: REVIEWER — UPCOMING SCHEDULES
// ============================================================

async function renderUpcoming() {
  buildLayout(loading(), 'reviewer/upcoming');
  try {
    const candidates = await api('GET', 'candidates');
    const today = new Date().toISOString().slice(0, 10);
    let upcoming = candidates.filter(c => c.test_date && c.test_date >= today);

    const html = `
      <h1 class="page-title">Upcoming Candidate Schedules</h1>
      <div class="grid-3" style="margin-bottom:16px">
        <div class="form-group"><label>Filter by Name</label><input type="text" id="ufName" oninput="filterUpcoming()" /></div>
        <div class="form-group"><label>Filter by Discipline</label><input type="text" id="ufDisc" oninput="filterUpcoming()" /></div>
        <div class="form-group"><label>Filter by Iqama</label><input type="text" id="ufIqama" oninput="filterUpcoming()" /></div>
      </div>
      <div id="upcomingList"></div>`;

    buildLayout(html, 'reviewer/upcoming');
    window._upcomingCandidates = upcoming;
    renderUpcomingList(upcoming);
  } catch (e) {
    buildLayout(alert('error', e.message), 'reviewer/upcoming');
  }
}

window.filterUpcoming = function() {
  const name = document.getElementById('ufName')?.value.toLowerCase() || '';
  const disc = document.getElementById('ufDisc')?.value.toLowerCase() || '';
  const iqama = document.getElementById('ufIqama')?.value.toLowerCase() || '';
  const filtered = (window._upcomingCandidates || []).filter(c =>
    (!name || c.name.toLowerCase().includes(name)) &&
    (!disc || c.discipline.toLowerCase().includes(disc)) &&
    (!iqama || c.iqama_no.toLowerCase().includes(iqama))
  );
  renderUpcomingList(filtered);
};

function renderUpcomingList(candidates) {
  const list = document.getElementById('upcomingList');
  if (!list) return;
  if (!candidates.length) { list.innerHTML = `<div class="alert alert-info">No upcoming schedules match the filters.</div>`; return; }
  list.innerHTML = candidates.map(c => {
    const pastSchedules = (c.previous_schedules || []).map(p =>
      `<div style="font-size:0.8rem;color:var(--text-muted)">📅 ${formatDate(p.test_date)} (rescheduled ${formatDate(p.scheduled_at)})</div>`).join('');
    const isAdmin = State.user.role === 'Admin';
    return expander(`${c.name} — ${c.discipline} — ${c.iqama_no} — ${formatDate(c.test_date)}`, `
      <div style="font-size:0.85rem;margin-bottom:12px">
        <strong>Email:</strong> ${esc(c.email)}<br/>
        ${c.invitation_sent_at ? '✅ Invitation sent.' : '⚠ Invitation not yet sent.'}
      </div>
      ${pastSchedules ? `<div style="margin-bottom:12px"><strong>Past Schedules:</strong>${pastSchedules}</div>` : ''}
      <div id="inviteMsg_${c.id}"></div>
      <div class="btn-group">
        ${c.email ? `<button class="btn btn-primary btn-sm" onclick="sendInvite(${c.id})">📨 Send Schedule & Login Credentials</button>` : ''}
        ${isAdmin ? `<button class="btn btn-danger btn-sm" onclick="removeSchedule(${c.id})">Remove Schedule</button>` : ''}
      </div>`);
  }).join('');
}

window.sendInvite = async function(candidateId) {
  const msg = document.getElementById(`inviteMsg_${candidateId}`);
  const c = (window._upcomingCandidates || []).find(x => x.id === candidateId);
  if (!c) return;
  if (msg) msg.innerHTML = `<div class="alert alert-info">Sending…</div>`;
  try {
    await api('POST', `candidates/${candidateId}/invite`, {
      email: c.email, name: c.name, username: c.username,
      discipline: c.discipline, test_date: c.test_date,
    });
    if (msg) msg.innerHTML = alert('success', 'Schedule and login credentials sent. The temporary password is now active.');
    c.invitation_sent_at = new Date().toISOString();
  } catch (e) {
    if (msg) msg.innerHTML = alert('error', e.message);
  }
};

window.removeSchedule = async function(candidateId) {
  if (!confirm('Remove this candidate\'s schedule? The account will be kept.')) return;
  try {
    await api('DELETE', `candidates/${candidateId}/schedule`);
    await renderUpcoming();
  } catch (e) { alert('error', e.message); }
};

// ============================================================
// PAGE: ADMIN — PROJECTS
// ============================================================

async function renderProjects() {
  buildLayout(loading(), 'admin/projects');
  try {
    const projects = await api('GET', 'projects');
    const projectList = projects.map(p => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:0.9rem">${esc(p)}</span>
        <button class="btn btn-danger btn-sm" onclick="deleteProject('${esc(p)}')">Delete</button>
      </div>`).join('');

    const html = `
      <h1 class="page-title">Projects</h1>
      <div class="card" style="margin-bottom:20px">
        <h3>🧪 Test Email Delivery</h3>
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:12px">Send a test message to confirm your Resend/SMTP settings before inviting candidates or reviewers.</p>
        <div class="form-group"><label>Admin email address</label>
          <input type="email" id="testEmailAddr" value="${esc(State.user.email||'')}" style="max-width:360px" /></div>
        <div id="testEmailMsg"></div>
        <button class="btn btn-primary" onclick="sendTestEmail()">Send Test Email</button>
      </div>
      <hr class="divider" />
      <div class="card">
        <h3>🗂 Projects List</h3>
        <div id="projMsg"></div>
        <div class="form-group" style="display:flex;gap:8px">
          <input type="text" id="projInput" placeholder="Project name" style="flex:1" />
          <button class="btn btn-primary" onclick="addProject()">Add Project</button>
        </div>
        <div id="projectList">${projectList || '<p style="color:var(--text-muted);font-size:0.85rem">No projects yet.</p>'}</div>
      </div>`;
    buildLayout(html, 'admin/projects');
    window._projects = projects;
  } catch (e) {
    buildLayout(alert('error', e.message), 'admin/projects');
  }
}

window.sendTestEmail = async function() {
  const email = document.getElementById('testEmailAddr')?.value.trim();
  const msg = document.getElementById('testEmailMsg');
  if (!email) { msg.innerHTML = alert('error', 'Enter an email address.'); return; }
  msg.innerHTML = `<div class="alert alert-info">Sending…</div>`;
  try {
    await api('POST', 'email/test', { email, name: State.user.name });
    msg.innerHTML = alert('success', `Test email delivered to ${email}.`);
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

window.addProject = async function() {
  const name = document.getElementById('projInput')?.value.trim();
  const msg = document.getElementById('projMsg');
  if (!name) { msg.innerHTML = alert('error', 'Enter a project name.'); return; }
  try {
    await api('POST', 'projects', { name });
    msg.innerHTML = alert('success', 'Project added.');
    document.getElementById('projInput').value = '';
    await renderProjects();
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

window.deleteProject = async function(name) {
  if (!confirm(`Delete project "${name}"?`)) return;
  try {
    await api('DELETE', `projects/${encodeURIComponent(name)}`);
    await renderProjects();
  } catch (e) { alert('error', e.message); }
};

// ============================================================
// PAGE: ADMIN — ACCOUNTS
// ============================================================

async function renderAccounts() {
  buildLayout(loading(), 'admin/accounts');
  try {
    const [staff, projects] = await Promise.all([api('GET', 'staff'), api('GET', 'projects')]);

    const html = `
      <h1 class="page-title">Accounts</h1>
      <div class="card" style="margin-bottom:20px">
        <h3>Create Staff Account</h3>
        <div id="staffMsg"></div>
        <div class="grid-2">
          <div class="form-group"><label>Full Name</label><input type="text" id="sName" /></div>
          <div class="form-group"><label>Username</label><input type="text" id="sUser" /></div>
          <div class="form-group"><label>Email</label><input type="email" id="sEmail" /></div>
          <div class="form-group"><label>Role</label>
            <select id="sRole"><option>Reviewer</option><option>Admin</option></select></div>
          <div class="form-group">
            <label>Password (6+ chars)</label>
            <div style="display:flex;gap:8px">
              <input type="password" id="sPass" style="flex:1" />
              <button class="btn btn-secondary btn-sm" onclick="genStaffPwd()">Generate</button>
            </div>
            <div id="genPwdBox" style="display:none"></div>
          </div>
          <div class="form-group"><label>Confirm Password</label><input type="password" id="sPassConf" /></div>
        </div>
        <button class="btn btn-primary" onclick="createStaff()">Create Account</button>
      </div>
      <hr class="divider" />
      <h2>Existing Accounts</h2>
      <div id="staffList">
        ${staff.map(s => renderStaffCard(s, projects)).join('')}
      </div>`;
    buildLayout(html, 'admin/accounts');
    window._staffList = staff;
    window._projectsList = projects;
  } catch (e) {
    buildLayout(alert('error', e.message), 'admin/accounts');
  }
}

function renderStaffCard(s, projects) {
  const isMe = s.id === State.user.id;
  const projChecks = projects.map(p => `
    <label class="multiselect-item">
      <input type="checkbox" name="proj_${s.id}" value="${esc(p)}" ${(s.assigned_projects||[]).includes(p)?'checked':''}> ${esc(p)}
    </label>`).join('');

  return expander(`${esc(s.name)} (${esc(s.username)}) — ${esc(s.role)}`, `
    <div style="font-size:0.85rem;margin-bottom:12px">Email: ${esc(s.email||'')}</div>
    <div id="staffCardMsg_${s.id}"></div>
    ${s.role === 'Reviewer' ? `
      <div class="form-group">
        <label>Reviewer Email</label>
        <div style="display:flex;gap:8px">
          <input type="email" id="rEmail_${s.id}" value="${esc(s.email||'')}" style="flex:1" />
          <button class="btn btn-secondary btn-sm" onclick="saveReviewerEmail(${s.id})">Save</button>
        </div>
      </div>
      <div class="form-group">
        <label>New Password (6+ chars)</label>
        <div style="display:flex;gap:8px">
          <input type="password" id="rPwd_${s.id}" style="flex:1" />
          <button class="btn btn-secondary btn-sm" onclick="setReviewerPwd(${s.id})">Set Password</button>
        </div>
      </div>
      <div class="form-group">
        <label>Assigned Projects</label>
        <div class="multiselect-list">${projChecks || '<span style="color:var(--text-dim);font-size:0.8rem">No projects.</span>'}</div>
        <button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="saveStaffProjects(${s.id})">Save Assignments</button>
      </div>
      <div style="margin-top:8px">
        <button class="btn btn-primary btn-sm" onclick="sendReviewerCreds(${s.id})">📧 Send Credentials Email</button>
      </div>` : ''}
    ${!isMe ? `<div style="margin-top:12px"><button class="btn btn-danger btn-sm" onclick="deleteStaff(${s.id})">Delete Account</button></div>` : ''}`);
}

window.genStaffPwd = async function() {
  try {
    const { password } = await api('GET', 'auth/generate-password');
    document.getElementById('sPass').value = password;
    document.getElementById('sPassConf').value = password;
    const box = document.getElementById('genPwdBox');
    box.style.display = 'block';
    box.innerHTML = `<div class="code-block" style="margin-top:6px">${esc(password)}</div>`;
  } catch(e) { alert('error', e.message); }
};

window.createStaff = async function() {
  const msg = document.getElementById('staffMsg');
  const name = document.getElementById('sName').value.trim();
  const username = document.getElementById('sUser').value.trim();
  const email = document.getElementById('sEmail').value.trim();
  const role = document.getElementById('sRole').value;
  const password = document.getElementById('sPass').value;
  const confirm = document.getElementById('sPassConf').value;
  if (password !== confirm) { msg.innerHTML = alert('error','Passwords do not match.'); return; }
  try {
    await api('POST', 'staff', { name, username, email, role, password });
    msg.innerHTML = alert('success', `${role} account created.`);
    await renderAccounts();
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

window.saveReviewerEmail = async function(id) {
  const email = document.getElementById(`rEmail_${id}`)?.value.trim();
  const msg = document.getElementById(`staffCardMsg_${id}`);
  try {
    await api('PUT', `staff/${id}/email`, { email });
    msg.innerHTML = alert('success', 'Email saved.');
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

window.setReviewerPwd = async function(id) {
  const pwd = document.getElementById(`rPwd_${id}`)?.value;
  const msg = document.getElementById(`staffCardMsg_${id}`);
  try {
    await api('PUT', `staff/${id}/password`, { password: pwd });
    msg.innerHTML = alert('success', 'Password set. Click "Send Credentials Email" when ready.');
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

window.saveStaffProjects = async function(id) {
  const checked = [...document.querySelectorAll(`[name="proj_${id}"]:checked`)].map(el => el.value);
  const msg = document.getElementById(`staffCardMsg_${id}`);
  try {
    await api('PUT', `staff/${id}/projects`, { projects: checked });
    msg.innerHTML = alert('success', 'Assignments saved.');
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

window.sendReviewerCreds = async function(id) {
  const s = (window._staffList || []).find(x => x.id === id);
  if (!s) return;
  const pwd = document.getElementById(`rPwd_${id}`)?.value;
  const email = document.getElementById(`rEmail_${id}`)?.value.trim() || s.email;
  const msg = document.getElementById(`staffCardMsg_${id}`);
  if (!pwd) { msg.innerHTML = alert('error','Set the reviewer password first, then send credentials.'); return; }
  try {
    await api('POST', `staff/${id}/send-credentials`, { email, name: s.name, username: s.username, password: pwd });
    msg.innerHTML = alert('success', 'Reviewer login credentials emailed.');
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

window.deleteStaff = async function(id) {
  if (!confirm('Delete this account? This action cannot be undone.')) return;
  try {
    await api('DELETE', `staff/${id}`);
    await renderAccounts();
  } catch (e) { alert('error', e.message); }
};

// ============================================================
// PAGE: QUESTION BANK
// ============================================================

async function renderQuestions() {
  buildLayout(loading(), 'admin/questions');
  try {
    const [questions, disciplines] = await Promise.all([
      api('GET', 'questions?include_inactive=true'),
      api('GET', 'disciplines'),
    ]);
    const discOpts = disciplines.map(d => `<option>${esc(d)}</option>`).join('');
    const isAdmin = State.user.role === 'Admin';

    const wipeSection = isAdmin ? `
      ${expander('⚠ Wipe Question Bank', `
        <div class="alert alert-warning" style="margin-bottom:12px">This will delete all questions. Questions already answered by candidates will be deactivated instead to preserve records.</div>
        <div id="wipeMsg"></div>
        <button class="btn btn-danger" onclick="wipeQuestions()">Wipe Question Bank</button>
        <hr class="divider" />
        <div class="alert alert-error" style="margin-bottom:12px">Destructive: completely removes archived questions AND deletes assessment records of any candidates who answered them.</div>
        <button class="btn btn-danger" onclick="wipeArchived()">Wipe Archived Questions & Candidate Records</button>`)}` : '';

    const browseRows = questions.map(q => {
      const parsedOptions = Array.isArray(JSON.parse(q.options || '[]')) ? JSON.parse(q.options || '[]') : [];
      const optsList = q.q_type === 'mcq' ? parsedOptions.map((o) =>
        `<div style="font-size:0.8rem;color:${o===q.correct_answer?'var(--success)':'var(--text-muted)'}">${o===q.correct_answer?'✅ ':'⬜ '}${esc(o)}</div>`).join('') : '';
      const buttons = isAdmin ? (q.is_used ?
        `<button class="btn btn-secondary btn-sm" onclick="setActive(${q.id},${!q.active})">${q.active?'Archive':'Restore'}</button>
         ${!q.active?`<button class="btn btn-danger btn-sm" onclick="deleteQuestion(${q.id},true)">Delete (removes records)</button>`:''}` :
        `<button class="btn btn-danger btn-sm" onclick="deleteQuestion(${q.id},false)">Delete</button>`) : '';
      return expander(`#${q.id} · ${esc(q.discipline)} · ${TYPE_LABELS[q.q_type]||q.q_type} · ${q.active?'Active':'Archived'}`, `
        <div style="margin-bottom:8px;line-height:1.6">${esc(q.question_text)}</div>
        ${q.q_type==='mcq' ? optsList : `<div class="rubric-box">${esc(q.rubric)}</div>`}
        <div class="btn-group" style="margin-top:10px">${buttons}</div>`);
    }).join('');

    const html = `
      <h1 class="page-title">Question Bank</h1>
      <p class="page-subtitle">Add project-specific technical questions and rubrics before scheduling assessments.</p>

      ${wipeSection}

      <div style="display:flex;gap:10px;margin-bottom:16px">
        <a href="#" onclick="downloadTemplate(event)" class="btn btn-secondary btn-sm">⬇ Download Excel Template</a>
      </div>

      ${expander('📤 Import Questions from Excel', `
        <div id="importMsg"></div>
        <div class="form-group"><label>Excel Workbook (.xlsx)</label><input type="file" id="importFile" accept=".xlsx" /></div>
        <button class="btn btn-primary" onclick="importQuestions()">Import Questions</button>
        <div id="importResults" style="margin-top:12px"></div>`)}

      ${expander('➕ Add a Question', `
        <div id="addQMsg"></div>
        <div class="form-group"><label>Question Type</label>
          <select id="qKind" onchange="toggleQKind()">
            <option value="mcq">Multiple Choice Question</option>
            <option value="essay">Essay</option>
            <option value="practicum">Practicum</option>
            <option value="oral">Oral Test</option>
            <option value="practical">Practical Test</option>
          </select></div>
        <div class="form-group"><label>Discipline</label><select id="qDisc">${discOpts}</select></div>
        <div class="form-group"><label>Question</label><textarea id="qPrompt" rows="3"></textarea></div>
        <div id="mcqFields">
          <div class="form-group"><label>MCQ Options (one per line)</label><textarea id="qOpts" rows="4"></textarea></div>
          <div class="form-group"><label>Correct Answer (exact match)</label><input type="text" id="qCorrect" /></div>
        </div>
        <div id="essayFields" style="display:none">
          <div class="form-group"><label>Scoring Rubric</label><textarea id="qRubric" rows="4"></textarea></div>
          <div class="form-group"><label>Maximum Points (1–100)</label><input type="number" id="qPoints" value="10" min="1" max="100" /></div>
        </div>
        <button class="btn btn-primary" onclick="addQuestion()">Add Question</button>`, true)}

      ${isAdmin ? expander('🤖 Auto-generate Placeholder Questions', `
        <div id="autoGenMsg"></div>
        <div class="grid-3">
          <div class="form-group"><label>Discipline</label><select id="agDisc">${discOpts}</select></div>
          <div class="form-group"><label>Type</label>
            <select id="agKind">
              <option value="mcq">Multiple Choice</option>
              <option value="essay">Essay</option>
              <option value="practicum">Practicum</option>
              <option value="oral">Oral Test</option>
              <option value="practical">Practical Test</option>
            </select></div>
          <div class="form-group"><label>Count</label><input type="number" id="agCount" value="5" min="1" max="500" /></div>
        </div>
        <button class="btn btn-primary" onclick="autoGenerate()">Generate</button>`) : ''}

      <hr class="divider" />
      <h2>Browse Questions</h2>
      <div class="grid-2" style="margin-bottom:16px">
        <div class="form-group"><label>Filter by Discipline</label>
          <select id="filterDisc" onchange="filterQuestions()"><option value="">All</option>${discOpts}</select></div>
        <div class="form-group"><label>Filter by Type</label>
          <select id="filterType" onchange="filterQuestions()">
            <option value="">All</option>
            ${Object.entries(TYPE_LABELS).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
          </select></div>
      </div>
      <label class="multiselect-item" style="margin-bottom:12px">
        <input type="checkbox" id="showArchived" onchange="filterQuestions()"> Show archived questions
      </label>
      <div id="questionBrowse">${browseRows}</div>`;

    buildLayout(html, 'admin/questions');
    window._allQuestions = questions;
  } catch (e) {
    buildLayout(alert('error', e.message), 'admin/questions');
  }
}

window.toggleQKind = function() {
  const kind = document.getElementById('qKind')?.value;
  const isMcq = kind === 'mcq';
  document.getElementById('mcqFields').style.display = isMcq ? '' : 'none';
  document.getElementById('essayFields').style.display = isMcq ? 'none' : '';
  const pts = document.getElementById('qPoints');
  if (pts) { pts.value = isMcq ? '1' : '10'; pts.disabled = isMcq; }
};

window.filterQuestions = function() {
  const disc = document.getElementById('filterDisc')?.value || '';
  const type = document.getElementById('filterType')?.value || '';
  const showArchived = document.getElementById('showArchived')?.checked;
  const filtered = (window._allQuestions || []).filter(q =>
    (!disc || q.discipline === disc) &&
    (!type || q.q_type === type) &&
    (showArchived || q.active)
  );
  const container = document.getElementById('questionBrowse');
  if (!container) return;
  if (!filtered.length) { container.innerHTML = `<div class="alert alert-info">No questions match the selected filters.</div>`; return; }
  container.innerHTML = filtered.map(q => {
    const parsedOptions = Array.isArray(JSON.parse(q.options || '[]')) ? JSON.parse(q.options || '[]') : [];
    const optsList = q.q_type === 'mcq' ? parsedOptions.map((o) =>
      `<div style="font-size:0.8rem;color:${o===q.correct_answer?'var(--success)':'var(--text-muted)'}">${o===q.correct_answer?'✅ ':'⬜ '}${esc(o)}</div>`).join('') : '';
    const isAdmin = State.user.role === 'Admin';
    const buttons = isAdmin ? (q.is_used ?
      `<button class="btn btn-secondary btn-sm" onclick="setActive(${q.id},${!q.active})">${q.active?'Archive':'Restore'}</button>
       ${!q.active?`<button class="btn btn-danger btn-sm" onclick="deleteQuestion(${q.id},true)">Delete (removes records)</button>`:''}` :
      `<button class="btn btn-danger btn-sm" onclick="deleteQuestion(${q.id},false)">Delete</button>`) : '';
    return expander(`#${q.id} · ${esc(q.discipline)} · ${TYPE_LABELS[q.q_type]||q.q_type} · ${q.active?'Active':'Archived'}`, `
      <div style="margin-bottom:8px;line-height:1.6">${esc(q.question_text)}</div>
      ${q.q_type==='mcq' ? optsList : `<div class="rubric-box">${esc(q.rubric)}</div>`}
      <div class="btn-group" style="margin-top:10px">${buttons}</div>`);
  }).join('');
};

window.addQuestion = async function() {
  const kind = document.getElementById('qKind').value;
  const msg = document.getElementById('addQMsg');
  const isMcq = kind === 'mcq';
  const options = isMcq ? (document.getElementById('qOpts').value.split('\n').map(v=>v.trim()).filter(Boolean)) : [];
  const body = {
    discipline: document.getElementById('qDisc').value,
    kind,
    prompt: document.getElementById('qPrompt').value.trim(),
    options,
    correct: isMcq ? document.getElementById('qCorrect').value.trim() : '',
    rubric: !isMcq ? document.getElementById('qRubric').value.trim() : '',
    points: isMcq ? 1 : parseInt(document.getElementById('qPoints').value)||10,
  };
  try {
    await api('POST', 'questions', body);
    msg.innerHTML = alert('success', 'Question added.');
    await renderQuestions();
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

window.setActive = async function(id, active) {
  try {
    await api('PATCH', `questions/${id}/active`, { active });
    await renderQuestions();
  } catch (e) { alert('error', e.message); }
};

window.deleteQuestion = async function(id, force) {
  const msg = force ? 'Delete this question and all candidate records that reference it?' : 'Delete this question?';
  if (!confirm(msg)) return;
  try {
    await api('DELETE', `questions/${id}${force?'?force=true':''}`);
    await renderQuestions();
  } catch (e) { alert('error', e.message); }
};

window.wipeQuestions = async function() {
  const msg = document.getElementById('wipeMsg');
  if (!confirm('Wipe the entire question bank? This cannot be undone.')) return;
  try {
    await api('POST', 'questions/wipe');
    msg.innerHTML = alert('success', 'Question bank wiped.');
    await renderQuestions();
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

window.wipeArchived = async function() {
  if (!confirm('Delete all archived questions and the assessment records of any candidates who answered them? This cannot be undone.')) return;
  try {
    await api('POST', 'questions/wipe-archived');
    await renderQuestions();
  } catch (e) { alert('error', e.message); }
};

window.downloadTemplate = async function(e) {
  e.preventDefault();
  try {
    const blob = await api('GET', 'questions/template');
    downloadBlob(blob, 'qc-question-template.xlsx');
  } catch(e) { alert('error', e.message); }
};

window.importQuestions = async function() {
  const file = document.getElementById('importFile')?.files?.[0];
  const msg = document.getElementById('importMsg');
  const results = document.getElementById('importResults');
  if (!file) { msg.innerHTML = alert('error', 'Select an Excel file first.'); return; }
  msg.innerHTML = `<div class="alert alert-info">Importing…</div>`;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const data = await api('POST', 'questions/import', formData, true);
    const success = data.filter(r => r.success).length;
    const fail = data.length - success;
    msg.innerHTML = fail === 0
      ? alert('success', `${success} questions imported successfully.`)
      : alert('warning', `Import finished: ${success} succeeded, ${fail} failed.`);
    results.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Row</th><th>Status</th><th>Preview</th><th>Error</th></tr></thead>
      <tbody>${data.map(r=>`<tr>
        <td>${r.rowNumber}</td>
        <td>${r.success?'✅':'❌'}</td>
        <td style="max-width:300px;word-break:break-word">${esc((r.prompt||'').slice(0,80))}</td>
        <td style="color:var(--error)">${esc(r.error||'')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
    await renderQuestions();
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};

window.autoGenerate = async function() {
  const msg = document.getElementById('autoGenMsg');
  const body = {
    discipline: document.getElementById('agDisc').value,
    kind: document.getElementById('agKind').value,
    count: parseInt(document.getElementById('agCount').value)||5,
  };
  msg.innerHTML = `<div class="alert alert-info">Generating…</div>`;
  try {
    await api('POST', 'questions/autogenerate', body);
    msg.innerHTML = alert('success', `${body.count} placeholder questions generated.`);
    await renderQuestions();
  } catch (e) {
    msg.innerHTML = alert('error', e.message);
  }
};
