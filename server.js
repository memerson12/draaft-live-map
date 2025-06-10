// server.js
const express = require("express");
const path = require("path");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const {
  startServer,
  stopAndCleanup,
  getServerStatus,
  DYNMAP_PORT,
} = require("./serverManager");

// Constants and Configuration
const PORT = 4000;
const DB_PATH = path.join(__dirname, "players.db");

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("./admin-ui"));

// Database Management
let db = null;
function initializeDatabase() {
  const db = new sqlite3.Database(DB_PATH);
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      token TEXT UNIQUE NOT NULL,
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      z REAL DEFAULT 0
    )`);
  });
  return db;
}

// API Routes
app.post("/start-server", async (req, res) => {
  const { seed } = req.body;
  if (!seed) return res.status(400).json({ error: "Missing seed" });

  try {
    await startServer(seed);
    res.json({
      status: "started",
      dynmapUrl: `http://localhost:${DYNMAP_PORT}`,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to start server",
      details: err.message,
    });
  }
});

app.post("/stop-server", async (req, res) => {
  try {
    await stopAndCleanup();
    res.json({ status: "stopped and cleaned up" });
  } catch (err) {
    res.status(500).json({
      error: "Server stopped, but cleanup failed",
      details: err.message,
    });
  }
});

app.get("/health", (req, res) => {
  res.json(getServerStatus());
});

// Player Management Routes
app.post("/add-player", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Missing name" });
  const token = uuidv4();

  db.run(
    `INSERT INTO players (name, token) VALUES (?, ?)`,
    [name, token],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ name, token, url: `http://localhost:${PORT}/track/${token}` });
    }
  );
});

app.post("/remove-player", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Missing token" });

  db.run(`DELETE FROM players WHERE token = ?`, [token], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: "removed", token });
  });
});

app.get("/players", (req, res) => {
  db.all(`SELECT name, token, x, y, z FROM players`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/update-position/:token", (req, res) => {
  const { token } = req.params;
  const { x, y, z } = req.body;

  db.run(
    `UPDATE players SET x = ?, y = ?, z = ? WHERE token = ?`,
    [x, y, z, token],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Token not found" });
      res.json({ status: "updated" });
    }
  );
});

app.get("/track/:token", (req, res) => {
  res.send(
    `<!DOCTYPE html><html><body><h1>Tracking enabled</h1><p>Token: ${req.params.token}</p></body></html>`
  );
});

// Process Cleanup
process.on("exit", () => {
  stopAndCleanup();
});
process.on("SIGINT", () => process.exit());
process.on("SIGTERM", () => process.exit());

// Initialize and Start Server
db = initializeDatabase();
app.listen(PORT, () => {
  console.log(`Admin server running on http://localhost:${PORT}`);
});
