const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DB_FILE = process.env.DB_FILE_PATH || path.join(DATA_DIR, "db.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

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

function normalizeState(raw) {
  const base = { ...defaultState(), ...raw };
  if ((!base.doctors || base.doctors.length === 0) && Array.isArray(raw.users)) {
    base.doctors = raw.users.map((u) => ({
      id: u.id,
      fullName: u.username || u.fullName || "Врач",
      position: u.position || "",
      cabinet: u.cabinet || "",
      passwordHash: u.passwordHash,
      lastSeen: null,
    }));
  }
  if (!Array.isArray(base.activityLog)) base.activityLog = [];
  delete base.users;
  delete base.sessionUserId;
  return base;
}

function mergePreserveDoctorPresence(prev, incoming) {
  const next = normalizeState(incoming);
  const prevDoctors = prev.doctors || [];
  next.doctors = (next.doctors || []).map((d) => {
    const old = prevDoctors.find((x) => x.id === d.id);
    if (!old || !old.lastSeen) return d;
    const oldT = new Date(old.lastSeen).getTime();
    const newT = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
    return oldT > newT ? { ...d, lastSeen: old.lastSeen } : d;
  });
  return next;
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultState(), null, 2), "utf8");
  }
}

function readDb() {
  ensureDb();
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

function writeDb(nextState) {
  const safe = normalizeState(nextState);
  fs.writeFileSync(DB_FILE, JSON.stringify(safe, null, 2), "utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": MIME[".json"] });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = reqUrl;

  if (req.method === "GET" && pathname === "/api/state") {
    return sendJson(res, 200, readDb());
  }

  if (req.method === "PUT" && pathname === "/api/state") {
    try {
      const incoming = await parseJsonBody(req);
      const prev = readDb();
      writeDb(mergePreserveDoctorPresence(prev, incoming));
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/ping") {
    try {
      const body = await parseJsonBody(req);
      const doctorId = body.doctorId;
      if (!doctorId) return sendJson(res, 400, { ok: false, error: "doctorId required" });
      const db = readDb();
      const doc = db.doctors.find((d) => d.id === doctorId);
      if (doc) {
        doc.lastSeen = new Date().toISOString();
        writeDb(db);
      }
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "GET" && pathname === "/") {
    return sendFile(res, path.join(ROOT, "index.html"));
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(ROOT, safePath);
  if (fullPath.startsWith(ROOT) && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return sendFile(res, fullPath);
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

server.listen(PORT, HOST, () => {
  ensureDb();
  console.log(`DOCTOR-LITE web server started: http://localhost:${PORT}`);
  console.log(`Database file: ${DB_FILE}`);
});
