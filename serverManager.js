const fs = require("fs-extra");
const path = require("path");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");

// Constants
const TEMPLATE_DIR = path.join(__dirname, "server_template");
const SERVER_DIR = path.join(__dirname, "server_instance");
const DYNMAP_PORT = 8123;

// Log streaming
const logEmitter = new EventEmitter();
const logBuffer = [];
const MAX_LOG_BUFFER = 1000; // Keep last 1000 lines

function addLogEntry(entry) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    message: entry,
    type: "log",
  };

  logBuffer.push(logEntry);

  // Keep buffer size manageable
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.shift();
  }

  // Emit to all connected clients
  logEmitter.emit("log", logEntry);
}

function getLogBuffer() {
  return [...logBuffer];
}

// Server State Management
let serverProcess = null;
let serverStatus = {
  isRunning: false,
  isInitialized: false,
  startTime: null,
};

// Minecraft Server Configuration
function generateServerProperties(seed) {
  return `
level-seed=${seed}
server-port=25565
query.port=25565
webserver-port=${DYNMAP_PORT}
motd=Dynmap Competition Server
online-mode=false
max-players=4
white-list=false
allow-nether=false
enable-command-block=false
spawn-animals=false
spawn-npcs=false
spawn-monsters=false
enable-rcon=false
`;
}

// Server Process Management
async function stopAndCleanup() {
  console.log("Stopping and cleaning up server...");
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }

  serverStatus.isRunning = false;
  serverStatus.isInitialized = false;

  await new Promise((resolve) => setTimeout(resolve, 500));

  let retries = 3;
  while (retries > 0) {
    try {
      await fs.remove(SERVER_DIR);
      console.log("Successfully cleaned up server_instance folder.");
      return;
    } catch (err) {
      retries--;
      if (retries === 0) {
        console.error(
          "Failed to clean up server_instance after multiple attempts:",
          err
        );
        throw err;
      }
      console.log(
        `Cleanup attempt failed, retrying... (${retries} attempts remaining)`
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function startServer(seed) {
  await fs.copy(TEMPLATE_DIR, SERVER_DIR);
  await fs.writeFile(
    path.join(SERVER_DIR, "server.properties"),
    generateServerProperties(seed)
  );

  // Create log file stream
  const logFile = fs.createWriteStream(path.join(SERVER_DIR, "server.log"), {
    flags: "a",
  });

  // Create a promise that resolves when the server is initialized
  const initializationPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server initialization timed out after 2 minutes"));
    }, 120000); // 2 minute timeout

    let initializationCheckInterval = null;

    serverProcess = spawn(
      "java",
      [
        "-Xms8192M",
        "-Xmx8192M",
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
        "-XX:G1NewSizePercent=30",
        "-XX:G1MaxNewSizePercent=40",
        "-XX:G1HeapRegionSize=8M",
        "-XX:G1ReservePercent=20",
        "-DPaper.WorkerThreadCount=12",
        "-jar",
        "paper-server-launcher.jar",
        "--nogui",
      ],
      {
        cwd: SERVER_DIR,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    // Pipe stdout to both file and our processing
    serverProcess.stdout.pipe(logFile);
    serverProcess.stderr.pipe(logFile);
    serverProcess.stderr.pipe(process.stderr); // Keep console error visibility

    serverStatus = {
      isRunning: true,
      isInitialized: false,
      startTime: new Date(),
    };

    // Function to check if server is initialized
    const checkInitialization = () => {
      if (serverStatus.isInitialized) {
        clearInterval(initializationCheckInterval);
        clearTimeout(timeout);
        resolve();
      }
    };

    // Start checking initialization status every 500ms
    initializationCheckInterval = setInterval(checkInitialization, 500);

    serverProcess.on("error", (err) => {
      console.error("Failed to start server process:", err);
      serverProcess = null;
      serverStatus.isRunning = false;
      serverStatus.isInitialized = false;
      if (initializationCheckInterval) {
        clearInterval(initializationCheckInterval);
        initializationCheckInterval = null;
      }
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess.on("exit", (code, signal) => {
      if (code !== 0) {
        console.error(
          `Server process exited with code ${code} and signal ${signal}`
        );
        serverProcess = null;
        serverStatus.isRunning = false;
        serverStatus.isInitialized = false;
        if (initializationCheckInterval) {
          clearInterval(initializationCheckInterval);
          initializationCheckInterval = null;
        }
        clearTimeout(timeout);
        reject(new Error(`Server process exited with code ${code}`));
      }
    });

    serverProcess.stdout.on("data", (data) => {
      const output = data.toString();

      // Add to log buffer for streaming
      const lines = output.split("\n").filter((line) => line.trim());
      lines.forEach((line) => addLogEntry(line));

      if (output.includes(`! For help, type "help"`)) {
        serverStatus.isInitialized = true;
        console.log("Minecraft server fully initialized");
      }
    });

    serverProcess.stderr.on("data", (data) => {
      const output = data.toString();

      // Add to log buffer for streaming
      const lines = output.split("\n").filter((line) => line.trim());
      lines.forEach((line) => addLogEntry(`[ERROR] ${line}`));
    });
  });

  return initializationPromise;
}

function getServerStatus() {
  const currentTime = new Date();
  const uptime = serverStatus.startTime
    ? (currentTime - serverStatus.startTime) / 1000
    : 0;

  return {
    isRunning: serverStatus.isRunning,
    isInitialized: serverStatus.isInitialized,
    uptime: Math.floor(uptime),
    startTime: serverStatus.startTime,
  };
}

module.exports = {
  startServer,
  stopAndCleanup,
  getServerStatus,
  DYNMAP_PORT,
  logEmitter,
  addLogEntry,
  getLogBuffer,
};
