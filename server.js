// server.js
const express = require("express");
const path = require("path");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const WebSocket = require("ws");
const fs = require("fs-extra");
const {
  initializeManager,
  createWorldFiles,
  startWorld,
  stopWorld,
  deleteWorld,
  getServerStatus,
  logEmitter,
  getLogBuffer,
  sendCommand,
} = require("./serverManager");

// Constants and Configuration
const PORT = 4000;
const DB_PATH = path.join(__dirname, "players.db");
const WORLDS_DIR = path.join(__dirname, "worlds");

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("./admin-ui"));

// Create HTTP server
const server = require("http").createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// WebSocket connection management
wss.on("connection", (ws) => {
  console.log("WebSocket client connected");

  // Send initial log buffers for all running worlds
  const initialLogs = getLogBuffer();
  ws.send(
    JSON.stringify({
      type: "initial_logs",
      logs: initialLogs, // this is now a map of worldId -> logs
    })
  );

  // Listen for new log entries
  const logHandler = (logEntry) => {
    // logEntry is {worldId, log}
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "log_entry",
          ...logEntry,
        })
      );
    }
  };

  logEmitter.on("log", logHandler);

  ws.on("close", () => {
    console.log("WebSocket client disconnected");
    logEmitter.off("log", logHandler);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    logEmitter.off("log", logHandler);
  });
});

// Database Management
let db = null;
function initializeDatabase() {
  fs.ensureDirSync(WORLDS_DIR);
  const db = new sqlite3.Database(DB_PATH);
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      token TEXT UNIQUE NOT NULL,
      dimension TEXT NOT NULL DEFAULT 'world',
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      z REAL DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      seed TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'STOPPED', -- STOPPED, STARTING, RUNNING, STOPPING, ERROR
      path TEXT UNIQUE NOT NULL,
      server_port INTEGER UNIQUE,
      dynmap_port INTEGER UNIQUE
    )`);
  });
  return db;
}

// --- World Management API ---
app.get("/api/worlds", (req, res) => {
  db.all(`SELECT * FROM worlds`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/worlds", (req, res) => {
  const { name, seed } = req.body;
  if (!name || !seed) {
    return res.status(400).json({ error: "Missing name or seed" });
  }

  db.get(
    "SELECT MAX(server_port) as max_server, MAX(dynmap_port) as max_dynmap FROM worlds",
    async (err, row) => {
      if (err) return res.status(500).json({ error: err.message });

      const server_port = row && row.max_server ? row.max_server + 1 : 25565;
      const dynmap_port = row && row.max_dynmap ? row.max_dynmap + 1 : 8123;
      const worldPath = path.join(WORLDS_DIR, uuidv4());

      const worldData = {
        name,
        seed,
        status: "CREATING",
        path: worldPath,
        server_port,
        dynmap_port,
      };

      try {
        await createWorldFiles(worldData);

        db.run(
          `INSERT INTO worlds (name, seed, status, path, server_port, dynmap_port) VALUES (?, ?, 'STOPPED', ?, ?, ?)`,
          [name, seed, worldPath, server_port, dynmap_port],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ id: this.lastID, ...worldData });
          }
        );
      } catch (e) {
        console.error("Failed to create world files", e);
        res.status(500).json({ error: "Failed to create world files" });
      }
    }
  );
});

app.post("/api/worlds/:id/start", async (req, res) => {
  const { id } = req.params;
  db.get(`SELECT * FROM worlds WHERE id = ?`, [id], async (err, world) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!world) return res.status(404).json({ error: "World not found" });

    try {
      await startWorld(world, db);
      res.json({ status: "starting" });
    } catch (e) {
      console.error(`Failed to start world ${id}:`, e);
      res.status(500).json({ error: e.message });
    }
  });
});

app.post("/api/worlds/:id/stop", async (req, res) => {
  const { id } = req.params;
  try {
    await stopWorld(id, db);
    res.json({ status: "stopping" });
  } catch (e) {
    console.error(`Failed to stop world ${id}:`, e);
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/worlds/:id", async (req, res) => {
  const { id } = req.params;
  db.get(`SELECT * FROM worlds WHERE id = ?`, [id], async (err, world) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!world) return res.status(404).json({ error: "World not found" });

    try {
      await deleteWorld(world, db);
      res.json({ status: "deleted" });
    } catch (e) {
      console.error(`Failed to delete world ${id}:`, e);
      res.status(500).json({ error: e.message });
    }
  });
});

app.get("/health", (req, res) => {
  res.json(getServerStatus());
});

// Player Management Routes (unchanged)
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
  db.all(
    `SELECT name, token, dimension, x, y, z FROM players`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.post("/update-position/:token", (req, res) => {
  const { token } = req.params;
  const { x, y, z, dimension } = req.body;

  db.run(
    `UPDATE players SET x = ?, y = ?, z = ?, dimension = ? WHERE token = ?`,
    [x, y, z, dimension, token],
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

app.post("/send-command", (req, res) => {
  const { command, worldId } = req.body;
  if (!command || !worldId)
    return res.status(400).json({ error: "Missing command or worldId" });
  try {
    sendCommand(command, worldId);
    res.json({ status: "sent" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Process Cleanup
process.on("exit", () => {
  // gracefully stop all running worlds on exit
  stopWorld(-1, db); // special case to stop all
});
process.on("SIGINT", () => process.exit());
process.on("SIGTERM", () => process.exit());

// Initialize and Start Server
db = initializeDatabase();
initializeManager(db);
server.listen(PORT, () => {
  console.log(`Admin server running on http://localhost:${PORT}`);
});
