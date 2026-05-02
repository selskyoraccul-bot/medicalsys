const API_BASE = "/api";
const SESSION_KEY = "doctor-lite-session-doctor-id";
const ONLINE_MS = 60 * 1000;
const PING_INTERVAL_MS = 5000;
const ACTIVITY_LOG_MAX = 200;

const state = defaultState();
let currentPatientId = null;
let currentAnalysisId = null;
let currentGuardianId = null;
let currentTemplateId = null;
let syncJob = null;
let pingJob = null;

const authPanel = document.getElementById("auth-panel");
const appPanel = document.getElementById("app-panel");
const logoutBtn = document.getElementById("logout-btn");
const deleteAccountBtn = document.getElementById("delete-account-btn");
const loginBlock = document.getElementById("login-block");
const registerBlock = document.getElementById("register-block");

const patientsList = document.getElementById("patients-list");
const analysesList = document.getElementById("analyses-list");
const guardiansList = document.getElementById("guardians-list");
const templatesList = document.getElementById("templates-list");
const doctorsStatusList = document.getElementById("doctors-status-list");

function boot() {
  void init();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

async function init() {
  bindEvents();
  const ok = await pullState();
  if (!ok) {
    alert("Не удалось подключиться к серверу. Запустите server.js и откройте сайт через него.");
  }
  migrateStateShape();
  renderAuthState();
  startSync();
  if (getCurrentDoctorId()) {
    startPing();
    void pingServer();
  }
}

function bindAuthPanelEvents() {
  const panel = document.getElementById("auth-panel");
  if (!panel) return;

  panel.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest("button") : null;
    if (!btn || !panel.contains(btn)) return;
    if (btn.id === "show-login-btn") {
      e.preventDefault();
      showAuthMode("login");
    } else if (btn.id === "show-register-btn") {
      e.preventDefault();
      showAuthMode("register");
    }
  });

  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      void loginDoctor();
    });
  }
  if (registerForm) {
    registerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      void registerDoctor();
    });
  }
}

function bindEvents() {
  bindAuthPanelEvents();
  logoutBtn?.addEventListener("click", logoutDoctor);
  deleteAccountBtn?.addEventListener("click", deleteOwnAccount);
  document.getElementById("add-patient-btn")?.addEventListener("click", addPatient);
  document.getElementById("delete-patient-btn")?.addEventListener("click", deletePatient);
  document.getElementById("patient-search")?.addEventListener("input", renderPatients);
  document.getElementById("patient-info-form")?.addEventListener("submit", savePatientInfo);
  document.getElementById("add-analysis-btn")?.addEventListener("click", addAnalysis);
  document.getElementById("save-analysis-btn")?.addEventListener("click", saveAnalysis);
  document.getElementById("save-diagnosis-btn")?.addEventListener("click", saveDiagnosis);
  document.getElementById("add-guardian-btn")?.addEventListener("click", addGuardian);
  document.getElementById("delete-guardian-btn")?.addEventListener("click", deleteGuardian);
  document.getElementById("guardian-form")?.addEventListener("submit", saveGuardian);
  document.getElementById("upload-template-btn")?.addEventListener("click", uploadTemplate);
  document.getElementById("open-template-btn")?.addEventListener("click", openTemplate);
  document.getElementById("delete-template-btn")?.addEventListener("click", deleteTemplate);

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });
}

function showAuthMode(mode) {
  const loginTab = document.getElementById("show-login-btn");
  const regTab = document.getElementById("show-register-btn");
  if (mode === "login") {
    loginBlock.classList.remove("hidden");
    registerBlock.classList.add("hidden");
    loginTab.classList.add("active");
    regTab.classList.remove("active");
  } else {
    loginBlock.classList.add("hidden");
    registerBlock.classList.remove("hidden");
    regTab.classList.add("active");
    loginTab.classList.remove("active");
  }
}

function defaultState() {
  return {
    doctors: [],
    patients: [],
    analyses: [],
    diagnoses: [],
    guardians: [],
    templates: [],
    activityLog: [],
  };
}

function migrateStateShape() {
  if ((!state.doctors || state.doctors.length === 0) && Array.isArray(state.users) && state.users.length) {
    state.doctors = state.users.map((u) => ({
      id: u.id,
      fullName: u.username || u.fullName || "Врач",
      position: u.position || "",
      cabinet: u.cabinet || "",
      passwordHash: u.passwordHash,
      lastSeen: null,
    }));
  }
  if (!Array.isArray(state.doctors)) state.doctors = [];
  if (!Array.isArray(state.activityLog)) state.activityLog = [];
  delete state.users;
  delete state.sessionUserId;
}

function getCurrentDoctorId() {
  return sessionStorage.getItem(SESSION_KEY);
}

function setCurrentDoctorId(id) {
  try {
    if (id) sessionStorage.setItem(SESSION_KEY, id);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    alert("Не удалось сохранить вход в браузере. Разрешите локальное хранилище для сайта.");
  }
}

function getCurrentDoctor() {
  const id = getCurrentDoctorId();
  if (!id) return null;
  return state.doctors.find((d) => d.id === id) || null;
}

async function pullState() {
  try {
    const response = await fetch(`${API_BASE}/state`);
    if (!response.ok) return false;
    const remote = await response.json();
    const fresh = { ...defaultState(), ...remote };
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, fresh);
    migrateStateShape();
    return true;
  } catch {
    return false;
  }
}

async function pushState() {
  try {
    const payload = { ...state };
    delete payload.users;
    delete payload.sessionUserId;
    await fetch(`${API_BASE}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return true;
  } catch {
    alert("Ошибка сохранения на сервер.");
    return false;
  }
}

function saveState() {
  void pushState();
}

async function pingServer() {
  const id = getCurrentDoctorId();
  if (!id) return;
  try {
    await fetch(`${API_BASE}/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctorId: id }),
    });
  } catch {
    /* ignore */
  }
}

function startPing() {
  if (pingJob) clearInterval(pingJob);
  pingJob = setInterval(() => void pingServer(), PING_INTERVAL_MS);
}

function stopPing() {
  if (pingJob) clearInterval(pingJob);
  pingJob = null;
}

function startSync() {
  if (syncJob) clearInterval(syncJob);
  syncJob = setInterval(async () => {
    if (!getCurrentDoctorId()) return;
    const before = JSON.stringify(state);
    const ok = await pullState();
    if (!ok) return;
    if (before !== JSON.stringify(state)) {
      renderAuthState();
    } else {
      renderDoctorsSidebar();
      renderActivityLog();
    }
  }, 3000);
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function hashPassword(input) {
  return btoa(unescape(encodeURIComponent(input))).slice(0, 40);
}

function logChange(message) {
  const doc = getCurrentDoctor();
  if (!doc) return;
  state.activityLog.unshift({
    id: uid("log"),
    at: new Date().toISOString(),
    doctorId: doc.id,
    doctorName: doc.fullName,
    message,
  });
  if (state.activityLog.length > ACTIVITY_LOG_MAX) {
    state.activityLog.length = ACTIVITY_LOG_MAX;
  }
}

async function registerDoctor() {
  await pullState();
  migrateStateShape();
  const fullName = document.getElementById("reg-fullname").value.trim();
  const position = document.getElementById("reg-position").value.trim();
  const cabinet = document.getElementById("reg-cabinet").value.trim();
  const password = document.getElementById("reg-password").value;
  if (!fullName || !password) return alert("Заполните ФИО и пароль.");
  if (state.doctors.some((d) => d.fullName.toLowerCase() === fullName.toLowerCase())) {
    return alert("Врач с таким ФИО уже зарегистрирован.");
  }
  const newId = uid("d");
  state.doctors.push({
    id: newId,
    fullName,
    position,
    cabinet,
    passwordHash: hashPassword(password),
    lastSeen: null,
  });
  state.activityLog.unshift({
    id: uid("log"),
    at: new Date().toISOString(),
    doctorId: newId,
    doctorName: fullName,
    message: `Регистрация врача${cabinet ? `, каб. ${cabinet}` : ""}${position ? ` (${position})` : ""}`,
  });
  if (state.activityLog.length > ACTIVITY_LOG_MAX) state.activityLog.length = ACTIVITY_LOG_MAX;
  await pushState();
  document.getElementById("reg-password").value = "";
  alert("Регистрация выполнена. Перейдите на вкладку «Вход».");
  showAuthMode("login");
  document.getElementById("login-fullname").value = fullName;
}

async function loginDoctor() {
  await pullState();
  migrateStateShape();
  const fullName = document.getElementById("login-fullname").value.trim();
  const password = document.getElementById("login-password").value;
  if (!fullName || !password) return alert("Введите ФИО и пароль.");
  const doctor = state.doctors.find((d) => d.fullName.toLowerCase() === fullName.toLowerCase());
  if (!doctor || doctor.passwordHash !== hashPassword(password)) {
    return alert("Неверное ФИО или пароль.");
  }
  setCurrentDoctorId(doctor.id);
  startPing();
  void pingServer();
  renderAuthState();
}

function logoutDoctor() {
  setCurrentDoctorId(null);
  stopPing();
  currentPatientId = null;
  currentAnalysisId = null;
  currentGuardianId = null;
  currentTemplateId = null;
  renderAuthState();
}

function renderAuthState() {
  const loggedIn = Boolean(getCurrentDoctorId());
  authPanel.classList.toggle("hidden", loggedIn);
  appPanel.classList.toggle("hidden", !loggedIn);
  logoutBtn.classList.toggle("hidden", !loggedIn);
  deleteAccountBtn?.classList.toggle("hidden", !loggedIn);
  if (loggedIn) renderApp();
}

function renderApp() {
  renderPatients();
  renderAnalyses();
  renderDiagnosis();
  renderGuardians();
  renderTemplates();
  renderDoctorsSidebar();
  renderActivityLog();
}

function renderDoctorsSidebar() {
  const now = Date.now();
  const rows = [...state.doctors].sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
  doctorsStatusList.innerHTML =
    rows
      .map((d) => {
        const t = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
        const online = t && now - t < ONLINE_MS;
        const dot = online
          ? '<span class="status-dot online" title="Онлайн"></span>'
          : '<span class="status-dot offline" title="Не в сети"></span>';
        const cab = d.cabinet ? escapeHTML(d.cabinet) : "—";
        const pos = d.position ? `<div class="doctor-sub">${escapeHTML(d.position)}</div>` : "";
        return `<li class="doctor-item"><div class="doctor-row">${dot}<span class="doctor-name">${escapeHTML(d.fullName)}</span><span class="doctor-cab">${cab}</span></div>${pos}</li>`;
      })
      .join("") || "<li>Нет зарегистрированных врачей.</li>";
}

function renderActivityLog() {
  const tbody = document.querySelector("#activity-log-table tbody");
  const entries = [...state.activityLog].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 80);
  tbody.innerHTML = entries
    .map(
      (e) =>
        `<tr><td>${escapeHTML(formatLogTime(e.at))}</td><td>${escapeHTML(e.doctorName || "—")}</td><td>${escapeHTML(e.message)}</td></tr>`
    )
    .join("");
}

function formatLogTime(iso) {
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

function renderPatients() {
  const query = document.getElementById("patient-search").value.trim().toLowerCase();
  const rows = state.patients
    .filter((p) => !query || p.fullName.toLowerCase().includes(query))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));

  patientsList.innerHTML =
    rows
      .map((p) => `<li data-id="${p.id}" class="${p.id === currentPatientId ? "active" : ""}">${escapeHTML(p.fullName)}</li>`)
      .join("") || "<li>Пациентов пока нет.</li>";

  patientsList.querySelectorAll("li[data-id]").forEach((li) => {
    li.addEventListener("click", () => {
      currentPatientId = li.dataset.id;
      currentAnalysisId = null;
      currentGuardianId = null;
      fillPatientInfo();
      renderApp();
    });
  });
}

function addPatient() {
  const fullName = prompt("Введите ФИО / имя пациента:");
  if (!fullName || !fullName.trim()) return;
  if (state.patients.some((p) => p.fullName.toLowerCase() === fullName.trim().toLowerCase())) {
    return alert("Такой человек уже добавлен.");
  }
  const name = fullName.trim();
  state.patients.push({ id: uid("p"), fullName: name, birthDate: "", phone: "", notes: "" });
  logChange(`Добавлен пациент: ${name}`);
  saveState();
  renderPatients();
}

function deletePatient() {
  if (!currentPatientId) return alert("Сначала выберите пациента в списке.");
  const patient = state.patients.find((p) => p.id === currentPatientId);
  if (!patient) return;
  const ok = confirm(`Удалить пациента '${patient.fullName}' и все связанные записи?`);
  if (!ok) return;

  state.patients = state.patients.filter((p) => p.id !== currentPatientId);
  state.analyses = state.analyses.filter((a) => a.patientId !== currentPatientId);
  state.diagnoses = state.diagnoses.filter((d) => d.patientId !== currentPatientId);
  state.guardians = state.guardians.filter((g) => g.patientId !== currentPatientId);

  logChange(`Удалён пациент: ${patient.fullName}`);
  currentPatientId = null;
  currentAnalysisId = null;
  currentGuardianId = null;
  saveState();
  renderApp();
}

function deleteOwnAccount() {
  const doctor = getCurrentDoctor();
  if (!doctor) return;
  if (state.doctors.length <= 1) {
    alert("Нельзя удалить последний аккаунт врача.");
    return;
  }
  const ok = confirm(`Удалить ваш аккаунт '${doctor.fullName}'? После этого потребуется вход под другим врачом.`);
  if (!ok) return;

  state.activityLog.unshift({
    id: uid("log"),
    at: new Date().toISOString(),
    doctorId: doctor.id,
    doctorName: doctor.fullName,
    message: "Врач удалил свой аккаунт",
  });
  if (state.activityLog.length > ACTIVITY_LOG_MAX) state.activityLog.length = ACTIVITY_LOG_MAX;

  state.doctors = state.doctors.filter((d) => d.id !== doctor.id);
  setCurrentDoctorId(null);
  stopPing();
  currentPatientId = null;
  currentAnalysisId = null;
  currentGuardianId = null;
  currentTemplateId = null;
  saveState();
  renderAuthState();
  alert("Ваш аккаунт удалён.");
}

function fillPatientInfo() {
  const patient = state.patients.find((p) => p.id === currentPatientId);
  document.getElementById("info-name").value = patient?.fullName || "";
  document.getElementById("info-birth").value = patient?.birthDate || "";
  document.getElementById("info-phone").value = patient?.phone || "";
  document.getElementById("info-notes").value = patient?.notes || "";
}

function savePatientInfo(event) {
  event.preventDefault();
  if (!currentPatientId) return alert("Сначала выберите человека.");
  const patient = state.patients.find((p) => p.id === currentPatientId);
  if (!patient) return;
  const fullName = document.getElementById("info-name").value.trim();
  if (!fullName) return alert("ФИО не может быть пустым.");
  patient.fullName = fullName;
  patient.birthDate = document.getElementById("info-birth").value.trim();
  patient.phone = document.getElementById("info-phone").value.trim();
  patient.notes = document.getElementById("info-notes").value.trim();
  logChange(`Сохранены данные пациента: ${fullName}`);
  saveState();
  renderPatients();
  alert("Информация о пациенте обновлена.");
}

function analysesForCurrentPatient() {
  return state.analyses.filter((a) => a.patientId === currentPatientId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function renderAnalyses() {
  const list = analysesForCurrentPatient();
  analysesList.innerHTML =
    list
      .map((a) => `<li data-id="${a.id}" class="${a.id === currentAnalysisId ? "active" : ""}">${escapeHTML(a.title)}</li>`)
      .join("") || "<li>Документов пока нет.</li>";

  analysesList.querySelectorAll("li[data-id]").forEach((li) => {
    li.addEventListener("click", () => {
      currentAnalysisId = li.dataset.id;
      const row = state.analyses.find((a) => a.id === currentAnalysisId);
      document.getElementById("analysis-text").value = row?.content || "";
      renderAnalyses();
    });
  });

  if (!currentAnalysisId) document.getElementById("analysis-text").value = "";
}

function addAnalysis() {
  if (!currentPatientId) return alert("Сначала выберите человека в списке слева.");
  const title = prompt("Название документа анализов:");
  if (!title || !title.trim()) return;
  const t = title.trim();
  state.analyses.push({
    id: uid("a"),
    patientId: currentPatientId,
    title: t,
    content: "",
    updatedBy: getCurrentDoctorId(),
    updatedAt: new Date().toISOString(),
  });
  logChange(`Создан документ анализов: «${t}»`);
  saveState();
  renderAnalyses();
}

function saveAnalysis() {
  if (!currentAnalysisId) return alert("Выберите документ анализов.");
  const row = state.analyses.find((a) => a.id === currentAnalysisId);
  if (!row) return;
  row.content = document.getElementById("analysis-text").value;
  row.updatedBy = getCurrentDoctorId();
  row.updatedAt = new Date().toISOString();
  logChange(`Сохранён документ анализов: «${row.title}»`);
  saveState();
  renderAnalyses();
  alert("Документ анализов обновлен и доступен всем пользователям.");
}

function renderDiagnosis() {
  const row = state.diagnoses.find((d) => d.patientId === currentPatientId);
  document.getElementById("diagnosis-text").value = row?.diagnosisText || "";
}

function saveDiagnosis() {
  if (!currentPatientId) return alert("Сначала выберите человека.");
  const patient = state.patients.find((p) => p.id === currentPatientId);
  const text = document.getElementById("diagnosis-text").value;
  const existing = state.diagnoses.find((d) => d.patientId === currentPatientId);
  if (existing) {
    existing.diagnosisText = text;
    existing.updatedBy = getCurrentDoctorId();
    existing.updatedAt = new Date().toISOString();
  } else {
    state.diagnoses.push({
      patientId: currentPatientId,
      diagnosisText: text,
      updatedBy: getCurrentDoctorId(),
      updatedAt: new Date().toISOString(),
    });
  }
  logChange(`Обновлён диагноз: ${patient?.fullName || "пациент"}`);
  saveState();
  alert("Диагноз сохранен.");
}

function guardiansForCurrentPatient() {
  return state.guardians.filter((g) => g.patientId === currentPatientId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function renderGuardians() {
  const rows = guardiansForCurrentPatient();
  guardiansList.innerHTML =
    rows
      .map((g) => {
        const caption = `${g.fullName || "Без имени"}${g.relationType ? ` (${g.relationType})` : ""}`;
        return `<li data-id="${g.id}" class="${g.id === currentGuardianId ? "active" : ""}">${escapeHTML(caption)}</li>`;
      })
      .join("") || "<li>Опекунов пока нет.</li>";

  guardiansList.querySelectorAll("li[data-id]").forEach((li) => {
    li.addEventListener("click", () => {
      currentGuardianId = li.dataset.id;
      const row = state.guardians.find((g) => g.id === currentGuardianId);
      document.getElementById("guardian-name").value = row?.fullName || "";
      document.getElementById("guardian-phone").value = row?.phone || "";
      document.getElementById("guardian-relation").value = row?.relationType || "";
      document.getElementById("guardian-notes").value = row?.notes || "";
      renderGuardians();
    });
  });

  if (!currentGuardianId) {
    document.getElementById("guardian-form").reset();
  }
}

function addGuardian() {
  if (!currentPatientId) return alert("Сначала выберите человека в списке слева.");
  const fullName = prompt("Введите ФИО опекуна:");
  if (!fullName || !fullName.trim()) return;
  const relationType = (prompt("Введите степень родства:") || "").trim();
  const phone = (prompt("Введите телефон опекуна:") || "").trim();
  const name = fullName.trim();
  state.guardians.push({
    id: uid("g"),
    patientId: currentPatientId,
    fullName: name,
    phone,
    relationType,
    notes: "",
    updatedBy: getCurrentDoctorId(),
    updatedAt: new Date().toISOString(),
  });
  logChange(`Добавлен опекун: ${name}`);
  saveState();
  renderGuardians();
}

function saveGuardian(event) {
  event.preventDefault();
  if (!currentGuardianId) return alert("Выберите опекуна.");
  const row = state.guardians.find((g) => g.id === currentGuardianId);
  if (!row) return;
  const fullName = document.getElementById("guardian-name").value.trim();
  if (!fullName) return alert("Укажите ФИО опекуна.");
  row.fullName = fullName;
  row.phone = document.getElementById("guardian-phone").value.trim();
  row.relationType = document.getElementById("guardian-relation").value.trim();
  row.notes = document.getElementById("guardian-notes").value.trim();
  row.updatedBy = getCurrentDoctorId();
  row.updatedAt = new Date().toISOString();
  logChange(`Сохранены данные опекуна: ${fullName}`);
  saveState();
  renderGuardians();
  alert("Информация об опекуне обновлена и доступна всем пользователям.");
}

function deleteGuardian() {
  if (!currentGuardianId) return alert("Выберите опекуна для удаления.");
  if (!confirm("Удалить выбранного опекуна?")) return;
  const row = state.guardians.find((g) => g.id === currentGuardianId);
  const label = row?.fullName || "опекун";
  state.guardians = state.guardians.filter((g) => g.id !== currentGuardianId);
  currentGuardianId = null;
  logChange(`Удалён опекун: ${label}`);
  saveState();
  renderGuardians();
}

function renderTemplates() {
  templatesList.innerHTML = state.templates
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    .map(
      (t) =>
        `<li data-id="${t.id}" class="${t.id === currentTemplateId ? "active" : ""}">${escapeHTML(t.displayName)} | ${new Date(t.uploadedAt).toLocaleString("ru-RU")}</li>`
    )
    .join("") || "<li>Шаблонов пока нет.</li>";

  templatesList.querySelectorAll("li[data-id]").forEach((li) => {
    li.addEventListener("click", () => {
      currentTemplateId = li.dataset.id;
      renderTemplates();
    });
  });
}

function uploadTemplate() {
  const fileInput = document.getElementById("template-file");
  const file = fileInput.files[0];
  if (!file) return alert("Выберите файл шаблона.");
  const reader = new FileReader();
  reader.onload = () => {
    state.templates.push({
      id: uid("t"),
      displayName: file.name,
      mimeType: file.type || "application/octet-stream",
      dataUrl: String(reader.result),
      uploadedBy: getCurrentDoctorId(),
      uploadedAt: new Date().toISOString(),
    });
    logChange(`Загружен шаблон: ${file.name}`);
    saveState();
    fileInput.value = "";
    renderTemplates();
    alert("Документ добавлен в шаблоны.");
  };
  reader.readAsDataURL(file);
}

function openTemplate() {
  if (!currentTemplateId) return alert("Выберите шаблон в списке.");
  const row = state.templates.find((t) => t.id === currentTemplateId);
  if (!row) return;
  const a = document.createElement("a");
  a.href = row.dataUrl;
  a.download = row.displayName;
  a.click();
}

function deleteTemplate() {
  if (!currentTemplateId) return alert("Выберите шаблон для удаления.");
  const row = state.templates.find((t) => t.id === currentTemplateId);
  if (!row) return;
  if (!confirm(`Удалить шаблон '${row.displayName}'?`)) return;
  logChange(`Удалён шаблон: ${row.displayName}`);
  state.templates = state.templates.filter((t) => t.id !== currentTemplateId);
  currentTemplateId = null;
  saveState();
  renderTemplates();
}

function activateTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-content").forEach((tab) => {
    tab.classList.toggle("active", tab.id === `tab-${tabName}`);
  });
}

function escapeHTML(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
