const fs = require("fs-extra");
const path = require("path");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");

// Constants
const TEMPLATE_DIR = path.join(__dirname, "server_template");

// Log streaming
const logEmitter = new EventEmitter();
const logBuffers = new Map(); // worldId -> logBuffer
const MAX_LOG_BUFFER = 1000;

function addLogEntry(worldId, entry, type = "log") {
  // Ensure worldId is a number for consistent type handling
  const numericWorldId = parseInt(worldId, 10);

  if (!logBuffers.has(numericWorldId)) {
    logBuffers.set(numericWorldId, []);
  }

  const logBuffer = logBuffers.get(numericWorldId);
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    message: entry,
    type,
  };

  logBuffer.push(logEntry);

  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.shift();
  }

  logEmitter.emit("log", { worldId: numericWorldId, log: logEntry });
}

function getLogBuffer() {
  const allLogs = {};
  for (const [worldId, buffer] of logBuffers.entries()) {
    allLogs[worldId] = [...buffer];
  }
  return allLogs;
}

// Server State Management
const runningServers = new Map(); // worldId -> {process, status}

// On startup, check for any worlds that were running and reset their status
async function initializeManager(db) {
  console.log("Initializing server manager...");
  db.run(`UPDATE worlds SET status = 'STOPPED' WHERE status = 'RUNNING'`);
}

// Minecraft Server Configuration
function generateServerProperties(world) {
  return `
level-seed=${world.seed}
server-port=${world.server_port}
query.port=${world.server_port}
motd=${world.name} - Dynmap Competition Server
online-mode=false
max-players=20
white-list=false
allow-nether=true
enable-command-block=false
spawn-animals=false
spawn-npcs=false
spawn-monsters=false
enable-rcon=false
`;
}

async function createWorldFiles(worldData) {
  await fs.copy(TEMPLATE_DIR, worldData.path);
  await fs.writeFile(
    path.join(worldData.path, "server.properties"),
    generateServerProperties(worldData)
  );
  // Update Dynmap configuration
  const dynmapConfigPath = path.join(
    worldData.path,
    "plugins/dynmap/configuration.txt"
  );
  let configTxt = await fs.readFile(dynmapConfigPath, "utf-8");
  configTxt = configTxt.replace(
    /^webserver-port:.*$/m,
    `webserver-port: ${worldData.dynmap_port}`
  );
  await fs.writeFile(dynmapConfigPath, configTxt);
}

async function startWorld(world, db) {
  if (runningServers.has(world.id)) {
    throw new Error(`World ${world.id} is already running or starting.`);
  }

  db.run(`UPDATE worlds SET status = 'STARTING' WHERE id = ?`, [world.id]);
  addLogEntry(world.id, `Starting world '${world.name}'...`);

  const serverProcess = spawn(
    "java",
    [
      "-Xms2048M",
      "-Xmx2048M",
      // Memory and GC flags as before, but maybe reduced per server
      "-XX:+UseG1GC",
      "-XX:+ParallelRefProcEnabled",
      "-XX:MaxGCPauseMillis=200",
      "-XX:+UnlockExperimentalVMOptions",
      "-XX:+DisableExplicitGC",
      "-XX:+AlwaysPreTouch",
      "-XX:G1HeapWastePercent=5",
      "-XX:G1MixedGCCountTarget=4",
      "-XX:InitiatingHeapOccupancyPercent=15",
      "-XX:G1MixedGCLiveThresholdPercent=90",
      "-XX:G1RSetUpdatingPauseTimePercent=5",
      "-XX:SurvivorRatio=32",
      "-XX:+PerfDisableSharedMem",
      "-XX:MaxTenuringThreshold=1",
      "-Dusing.aikars.flags=https://mcflags.emc.gs",
      "-Daikars.new.flags=true",
      "-jar",
      "paper-server-launcher.jar",
      "--nogui",
    ],
    {
      cwd: world.path,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  const status = {
    isInitialized: false,
    startTime: new Date(),
  };

  runningServers.set(world.id, { process: serverProcess, status });

  // Create log file stream
  const logFile = fs.createWriteStream(path.join(world.path, "server.log"), {
    flags: "a",
  });
  serverProcess.stdout.pipe(logFile);
  serverProcess.stderr.pipe(logFile);

  const handleOutput = (data) => {
    const output = data.toString();
    const lines = output.split("\n").filter((line) => line.trim());
    lines.forEach((line) => addLogEntry(world.id, line));

    if (output.includes(`! For help, type "help"`)) {
      status.isInitialized = true;
      db.run(`UPDATE worlds SET status = 'RUNNING' WHERE id = ?`, [world.id]);
      addLogEntry(world.id, `World '${world.name}' is fully initialized.`);
    }
  };

  serverProcess.stdout.on("data", handleOutput);
  serverProcess.stderr.on("data", (data) => {
    const output = data.toString();
    const lines = output.split("\n").filter((line) => line.trim());
    lines.forEach((line) => addLogEntry(world.id, `[ERROR] ${line}`, "error"));
  });

  serverProcess.on("error", (err) => {
    console.error(`Error starting world ${world.id}:`, err);
    addLogEntry(
      world.id,
      `Failed to start server process: ${err.message}`,
      "error"
    );
    db.run(`UPDATE worlds SET status = 'ERROR' WHERE id = ?`, [world.id]);
    runningServers.delete(world.id);
  });

  serverProcess.on("exit", (code, signal) => {
    console.log(
      `World ${world.id} exited with code ${code} and signal ${signal}`
    );
    addLogEntry(
      world.id,
      `Server process exited (code: ${code}, signal: ${signal})`
    );
    db.run(`UPDATE worlds SET status = 'STOPPED' WHERE id = ?`, [world.id]);
    runningServers.delete(world.id);
  });
}

async function stopWorld(worldId, db) {
  if (worldId === -1) {
    // Stop all running worlds
    console.log("Stopping all running worlds...");
    const promises = [];
    for (const id of runningServers.keys()) {
      promises.push(stopWorld(id, db));
    }
    await Promise.all(promises);
    return;
  }

  // Ensure worldId is a number for consistent type handling
  const numericWorldId = parseInt(worldId, 10);

  console.log("worldId:", worldId);
  console.log("numericWorldId:", numericWorldId);
  console.log("Running servers:", Array.from(runningServers.keys()));
  console.log(
    "Running servers types:",
    Array.from(runningServers.keys()).map((k) => `${k} (${typeof k})`)
  );

  const server = runningServers.get(numericWorldId);
  console.log("Server:", server);
  if (server) {
    db.run(`UPDATE worlds SET status = 'STOPPING' WHERE id = ?`, [
      numericWorldId,
    ]);
    console.log("Stopping world...", numericWorldId);
    addLogEntry(numericWorldId, `Stopping world...`);
    server.process.kill();
    runningServers.delete(numericWorldId);
  }
}

async function deleteWorld(world, db) {
  // Ensure world.id is a number for consistent type handling
  const numericWorldId = parseInt(world.id, 10);

  if (runningServers.has(numericWorldId)) {
    await stopWorld(numericWorldId, db);
    // Give it a moment to release file handles
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  db.run(`DELETE FROM worlds WHERE id = ?`, [numericWorldId]);
  await fs.remove(world.path);
  logBuffers.delete(numericWorldId); // Clean up log buffer
  console.log(`Successfully deleted world ${numericWorldId}`);
}

function getServerStatus() {
  const status = {};
  for (const [worldId, serverData] of runningServers.entries()) {
    const currentTime = new Date();
    const uptime = serverData.status.startTime
      ? (currentTime - serverData.status.startTime) / 1000
      : 0;

    status[worldId] = {
      isInitialized: serverData.status.isInitialized,
      uptime: Math.floor(uptime),
      startTime: serverData.status.startTime,
    };
  }
  return status;
}

function sendCommand(command, worldId) {
  const server = runningServers.get(parseInt(worldId, 10));
  if (!server) {
    throw new Error("Server for the given world is not running");
  }
  server.process.stdin.write(command + "\n");
}

module.exports = {
  initializeManager,
  createWorldFiles,
  startWorld,
  stopWorld,
  deleteWorld,
  getServerStatus,
  logEmitter,
  addLogEntry,
  getLogBuffer,
  sendCommand,
};
