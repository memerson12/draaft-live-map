package com.memerson.dynmapsync;

import org.bukkit.Bukkit;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;
import org.bukkit.scheduler.BukkitTask;
import org.dynmap.DynmapCommonAPI;
import org.dynmap.DynmapCommonAPIListener;
import org.dynmap.markers.Marker;
import org.dynmap.markers.MarkerAPI;
import org.dynmap.markers.MarkerIcon;
import org.dynmap.markers.MarkerSet;

import org.popcraft.chunky.Chunky;
import org.popcraft.chunky.ChunkyProvider;
import org.popcraft.chunky.event.task.GenerationTaskFinishEvent;
import org.popcraft.chunky.event.task.GenerationTaskUpdateEvent;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.*;
import java.util.Collections;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;
import java.util.logging.Level;
import java.util.logging.Logger;

public class DynmapMarkerSync extends JavaPlugin {

    public final Logger LOGGER = getLogger();
    private static final String MARKER_SET_ID = "live_map_players";
    private static final String[] WORLDS_TO_GENERATE = { "world", "world_nether", "world_the_end" };

    private Connection dbConnection;
    private DynmapCommonAPI dynmapApi;
    private MarkerAPI markerAPI;
    private MarkerSet markerSet;
    private MarkerIconCreator markerIconCreator;

    private int worldId;
    private WorldStatus worldStatus;
    private BukkitTask renderCheckTask;
//    private boolean dynmapEnabled = true;

    private final Set<String> worldsInProgress = Collections.synchronizedSet(new HashSet<>());

    @Override
    public void onEnable() {
        try {
            worldId = Integer.parseInt(System.getProperty("world.id"));
        } catch (NumberFormatException | NullPointerException e) {
            LOGGER.severe("'world.id' system property is not set or invalid! Disabling plugin.");
            this.setEnabled(false);
            return;
        }

        initDatabase();
        worldStatus = getWorldStatusFromDB();

        Bukkit.getPluginManager().disablePlugin(Objects.requireNonNull(Bukkit.getPluginManager().getPlugin("dynmap")));

        // **Correct Dynmap Initialization using the Listener**
        DynmapCommonAPIListener.register(new DynmapCommonAPIListener() {
            @Override
            public void apiEnabled(DynmapCommonAPI api) {
                dynmapApi = api;
                LOGGER.info("Successfully hooked into Dynmap API.");
                initializeDynmapComponents();
            }
        });

        try {
            Chunky chunky = ChunkyProvider.get();
            registerChunkyListeners(chunky);
            LOGGER.info("Successfully hooked into Chunky's EventBus.");
        } catch (IllegalStateException e) {
            LOGGER.log(Level.SEVERE, "Could not get Chunky instance. Is Chunky installed?", e);
            this.setEnabled(false);
            return;
        }

        new BukkitRunnable() {
            @Override
            public void run() {
                startWorldGeneration();
            }
        }.runTaskLater(this, 60L);

        LOGGER.info("DynmapMarkerSync enabled and waiting for Dynmap API...");
    }

    private void initializeDynmapComponents() {
        markerAPI = dynmapApi.getMarkerAPI();
        if (markerAPI == null) {
            LOGGER.severe("Failed to get MarkerAPI!");
            return;
        }
        markerIconCreator = new MarkerIconCreator(markerAPI);

        markerSet = markerAPI.getMarkerSet(MARKER_SET_ID);
        if (markerSet == null) {
            markerSet = markerAPI.createMarkerSet(MARKER_SET_ID, "Live Map Players", null, false);
        }

        runPlayerSyncTask();
        // Start checking for render completion if needed
        startRenderCheckTask();
    }

    private void registerChunkyListeners(Chunky chunky) {
        // Use the first update event as the trigger for starting
        chunky.getEventBus().subscribe(GenerationTaskUpdateEvent.class, event -> {
            String worldName = event.getGenerationTask().getSelection().world().getName();
            if (worldsInProgress.add(worldName)) { // .add() returns true if the element was not already in the set
                LOGGER.info("Chunky generation has STARTED for world: " + worldName);
//                if (dynmapApi != null
////                        && dynmapEnabled
//                ) {
//                    // Using the world-specific pause method is better practice if available in your
//                    // API version
//                    dynmapApi.setPauseFullRadiusRenders(true); // Pause all renders
//                    dynmapApi.setPauseUpdateRenders(true);
//                }
            }
        });

        // Listen for when Chunky finishes a task
        chunky.getEventBus().subscribe(GenerationTaskFinishEvent.class, event -> {
            String worldName = event.getGenerationTask().getSelection().world().getName();
            if (worldsInProgress.remove(worldName)) {
                LOGGER.info("Chunky generation has FINISHED for world: " + worldName);
                updateGenerationStatus(worldName, true);

                // Try to start the next world's generation
                startNextWorldGeneration();

                // Check if all generation is complete AFTER trying to start the next one
                if (worldsInProgress.isEmpty() && areAllWorldsGenerated()) {
                    LOGGER.info("All chunky generation tasks are complete. Proceeding to Dynmap renders.");
                    StartRendersAndChecks();
                }
            }
        });
    }

    private void startWorldGeneration() {
        if (Bukkit.getPluginManager().getPlugin("Chunky") == null) {
            LOGGER.warning("Chunky plugin not found.");
            return;
        }
//        Bukkit.getPluginManager().disablePlugin(Objects.requireNonNull(Bukkit.getPluginManager().getPlugin("dynmap")));
//        dynmapEnabled = false;

        // Start the first world in the sequence
        startNextWorldGeneration();
    }

    private void startNextWorldGeneration() {
        new BukkitRunnable() {
            @Override
            public void run() {
                for (String worldName : WORLDS_TO_GENERATE) {
                    if (!isGenerationComplete(worldName)) {
                        // Found the next world that needs generation, start it and then exit the loop
                        LOGGER.info("Starting Chunky generation for world: " + worldName);
                        dispatchCommand("chunky start " + worldName + " square 0 0 3000");
                        return; // Exit after starting one task
                    }
                }

                // This part is reached only if all worlds are already generated
                LOGGER.info("All worlds are already generated. Checking for pending renders.");
                StartRendersAndChecks();
            }
        }.runTask(this);`
    }

    private boolean areAllWorldsGenerated() {
        for (String worldName : WORLDS_TO_GENERATE) {
            if (!isGenerationComplete(worldName)) {
                return false;
            }
        }
        return true;
    }

    private void StartRendersAndChecks() {
        Bukkit.getPluginManager().enablePlugin(Objects.requireNonNull(Bukkit.getPluginManager().getPlugin("dynmap")));
        if (dynmapApi != null) {
//            Bukkit.getPluginManager()
//                    .enablePlugin(Objects.requireNonNull(Bukkit.getPluginManager().getPlugin("dynmap")));
//            dynmapEnabled = true;
            dynmapApi.setPauseFullRadiusRenders(false);
            dynmapApi.setPauseUpdateRenders(false);
            for (String worldName : WORLDS_TO_GENERATE) {
                if (!isRenderComplete(worldName)) {
                    LOGGER.info("Starting Dynmap full render for: " + worldName);
                    dispatchCommand("dynmap fullrender " + worldName);
                }
            }
            startRenderCheckTask(); // Ensure the checker is running
        }
    }

    private void dispatchCommand(String command) {
        new BukkitRunnable() {
            @Override
            public void run() {
                Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command);
            }
        }.runTask(this);
    }

    private void startRenderCheckTask() {
        // If task is already running, don't start another one
        if (renderCheckTask != null && !renderCheckTask.isCancelled()) {
            return;
        }
        renderCheckTask = new BukkitRunnable() {
            @Override
            public void run() {
                if (worldStatus == null)
                    return;
                boolean changed = false;
                // Check Overworld
                if (worldStatus.isOverworldGenerated() && !worldStatus.isOverworldMapRendered()
                        && isOverworldMapFullyRendered()) {
                    updateRenderStatus("world", true);
                    changed = true;
                }
                // Check Nether
                if (worldStatus.isNetherGenerated() && !worldStatus.isNetherMapRendered()
                        && isNetherMapFullyRendered()) {
                    updateRenderStatus("world_nether", true);
                    changed = true;
                }
                // Check End
                if (worldStatus.isEndGenerated() && !worldStatus.isEndMapRendered() && isEndMapFullyRendered()) {
                    updateRenderStatus("world_the_end", true);
                    changed = true;
                }

                if (changed) {
                    LOGGER.info("Detected render completion via file check and updated database.");
                }

                // If everything is done, cancel this task to save resources
                if (worldStatus.isWholeMapRendered()) {
                    LOGGER.info("All worlds are rendered. Stopping render check task.");
                    this.cancel();
                }
            }
        }.runTaskTimer(this, 20L * 30, 20L * 30); // Start after 30s, check every 30s
    }

    // === Database and State Management Methods ===
    private void updateGenerationStatus(String worldName, boolean status) {
        if (worldStatus == null)
            return;
        boolean changed = false;
        switch (worldName) {
            case "world":
                if (worldStatus.isOverworldGenerated() != status) {
                    worldStatus.setOverworldGenerated(status);
                    changed = true;
                }
                break;
            case "world_nether":
                if (worldStatus.isNetherGenerated() != status) {
                    worldStatus.setNetherGenerated(status);
                    changed = true;
                }
                break;
            case "world_the_end":
                if (worldStatus.isEndGenerated() != status) {
                    worldStatus.setEndGenerated(status);
                    changed = true;
                }
                break;
        }
        if (changed)
            upsertWorldStatus();
    }

    private void updateRenderStatus(String worldName, boolean status) {
        if (worldStatus == null)
            return;
        boolean changed = false;
        switch (worldName) {
            case "world":
                if (worldStatus.isOverworldMapRendered() != status) {
                    worldStatus.setOverworldMapRendered(status);
                    changed = true;
                }
                break;
            case "world_nether":
                if (worldStatus.isNetherMapRendered() != status) {
                    worldStatus.setNetherMapRendered(status);
                    changed = true;
                }
                break;
            case "world_the_end":
                if (worldStatus.isEndMapRendered() != status) {
                    worldStatus.setEndMapRendered(status);
                    changed = true;
                }
                break;
        }
        if (changed)
            upsertWorldStatus();
    }

    private boolean isGenerationComplete(String worldName) {
        if (worldStatus == null)
            return false;
        switch (worldName) {
            case "world":
                return worldStatus.isOverworldGenerated();
            case "world_nether":
                return worldStatus.isNetherGenerated();
            case "world_the_end":
                return worldStatus.isEndGenerated();
            default:
                return false;
        }
    }

    private boolean isRenderComplete(String worldName) {
        if (worldStatus == null)
            return false;
        switch (worldName) {
            case "world":
                return worldStatus.isOverworldMapRendered();
            case "world_nether":
                return worldStatus.isNetherMapRendered();
            case "world_the_end":
                return worldStatus.isEndMapRendered();
            default:
                return false;
        }
    }

    private WorldStatus getWorldStatusFromDB() {
        if (dbConnection == null)
            return new WorldStatus(false, false, false, false, false, false);
        String sql = "SELECT * FROM worlds WHERE id = ?";
        try (PreparedStatement stmt = dbConnection.prepareStatement(sql)) {
            stmt.setInt(1, worldId);
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return new WorldStatus(
                            rs.getBoolean("isOverworldGenerated"), rs.getBoolean("isNetherGenerated"),
                            rs.getBoolean("isEndGenerated"),
                            rs.getBoolean("isOverworldMapRendered"), rs.getBoolean("isNetherMapRendered"),
                            rs.getBoolean("isEndMapRendered"));
                }
            }
        } catch (SQLException e) {
            LOGGER.log(Level.SEVERE, "Failed to get WorldStatus from DB", e);
        }
        return new WorldStatus(false, false, false, false, false, false);
    }

    private void upsertWorldStatus() {
        if (dbConnection == null || worldStatus == null)
            return;
        String sql = "UPDATE worlds SET isOverworldGenerated = ?, isNetherGenerated = ?, isEndGenerated = ?, isOverworldMapRendered = ?, isNetherMapRendered = ?, isEndMapRendered = ? WHERE id = ?";
        try (PreparedStatement stmt = dbConnection.prepareStatement(sql)) {
            stmt.setBoolean(1, worldStatus.isOverworldGenerated());
            stmt.setBoolean(2, worldStatus.isNetherGenerated());
            stmt.setBoolean(3, worldStatus.isEndGenerated());
            stmt.setBoolean(4, worldStatus.isOverworldMapRendered());
            stmt.setBoolean(5, worldStatus.isNetherMapRendered());
            stmt.setBoolean(6, worldStatus.isEndMapRendered());
            stmt.setInt(7, worldId);
            if (stmt.executeUpdate() > 0) {
                LOGGER.info("Successfully updated world status in database.");
            }
        } catch (SQLException e) {
            LOGGER.log(Level.SEVERE, "Failed to upsert WorldStatus to DB", e);
        }
    }

    private void initDatabase() {
        try {
            Path path = Paths.get(System.getProperty("user.dir"));
            File dbFile = new File(path.getParent().getParent().toAbsolutePath().toFile(), "players.db");
            LOGGER.info("Loading players.db from " + dbFile.getAbsolutePath());
            if (!dbFile.exists()) {
                LOGGER.severe("Database file not found at: " + dbFile.getAbsolutePath());
                return;
            }
            dbConnection = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath());
            try (Statement stmt = dbConnection.createStatement()) {
                stmt.execute("PRAGMA journal_mode = WAL;");
            }
        } catch (SQLException e) {
            LOGGER.log(Level.SEVERE, "Failed to connect to players.db", e);
        }
    }

    private void runPlayerSyncTask() {
        new BukkitRunnable() {
            @Override
            public void run() {
                syncMarkers();
            }
        }.runTaskTimerAsynchronously(this, 100, 20L);
    }

    private void syncMarkers() {
        if (markerSet == null || dbConnection == null
//                || !dynmapEnabled
        )
            return;
        Set<String> existingMarkerIds = new HashSet<>();
        for (Marker m : markerSet.getMarkers()) {
            existingMarkerIds.add(m.getMarkerID());
        }
        String sql = "SELECT token, name, x, y, z, dimension FROM players";
        try (Statement stmt = dbConnection.createStatement();
                ResultSet rs = stmt.executeQuery(sql)) {
            while (rs.next()) {
                String token = rs.getString("token");
                String name = rs.getString("name");
                String dimension = rs.getString("dimension");
                double x = rs.getDouble("x");
                double y = rs.getDouble("y");
                double z = rs.getDouble("z");
                String markerId = "player_" + token;
                existingMarkerIds.remove(markerId);
                Marker marker = markerSet.findMarker(markerId);
                if (marker != null) {
                    if (!marker.getWorld().equals(dimension)) {
                        marker.deleteMarker();
                        createMarker(name, markerId, dimension, x, y, z);
                    } else {
                        marker.setLocation(dimension, x, y, z);
                    }
                    createMarker(name, markerId, dimension, x, y, z);
                }
            }
            for (String staleId : existingMarkerIds) {
                Marker markerToRemove = markerSet.findMarker(staleId);
                if (markerToRemove != null) {
                    markerToRemove.deleteMarker();
                }
            }
        } catch (SQLException e) {
            LOGGER.log(Level.WARNING, "Database read error during marker sync", e);
        }
    }

    private void createMarker(String name, String markerId, String dimension, double x, double y, double z) {
        String iconId = "player_skin_" + name;
        MarkerIcon icon = markerAPI.getMarkerIcon(iconId);
        if (icon == null) {
            icon = markerIconCreator.registerSkinMarker(name, iconId, name);
        }
        if (markerSet != null) {
            markerSet.createMarker(markerId, name, true, dimension, x, y, z, icon, false);
        }
    }

    @Override
    public void onDisable() {
        if (markerSet != null) {
            markerSet.deleteMarkerSet();
        }
        try {
            if (dbConnection != null && !dbConnection.isClosed()) {
                dbConnection.close();
            }
        } catch (SQLException e) {
            LOGGER.log(Level.WARNING, "DB close error on disable", e);
        }
        LOGGER.info("DynmapMarkerSync disabled");
    }

    private boolean _checkFilesExists(String path, String... fileNames) {
        File worldContainer = Bukkit.getWorldContainer();
        File regionDir = new File(worldContainer, path);
        if (!regionDir.isDirectory())
            return false;
        for (String fileName : fileNames) {
            if (!new File(regionDir, fileName).exists()) {
                return false;
            }
        }
        return true;
    }

    private boolean isOverworldMapFullyRendered() {
        return _checkFilesExists("plugins/dynmap/web/tiles/world", "flat_2_-3.hash", "flat_2_3.hash", "flat_-3_-3.hash",
                "flat_-3_3.hash");
    }

    private boolean isNetherMapFullyRendered() {
        return _checkFilesExists("plugins/dynmap/web/tiles/world_nether", "flat_2_-3.hash", "flat_2_3.hash",
                "flat_-3_-3.hash", "flat_-3_3.hash");
    }

    private boolean isEndMapFullyRendered() {
        return _checkFilesExists("plugins/dynmap/web/tiles/world_the_end", "flat_2_-3.hash", "flat_2_3.hash",
                "flat_-3_-3.hash", "flat_-3_3.hash");
    }
}