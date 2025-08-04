package com.memerson.dynmapsync;

import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.world.WorldLoadEvent;
import org.bukkit.Bukkit;
import org.dynmap.DynmapCommonAPI;
import org.dynmap.DynmapCommonAPIListener;
import org.dynmap.markers.Marker;
import org.dynmap.markers.MarkerAPI;
import org.dynmap.markers.MarkerIcon;
import org.dynmap.markers.MarkerSet;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.*;
import java.util.HashMap;
import java.util.Map;
import java.util.logging.Logger;

public class DynmapMarkerSync extends JavaPlugin implements Listener {

    public final Logger LOGGER = getLogger();
    private final String MARKER_SET_ID = "live_map_players";

    private Connection dbConnection;

    private MarkerAPI markerAPI;
    private MarkerSet markerSet;
    private MarkerIconCreator markerIconCreator;

    private boolean chunkyCommandExecuted = false;
    private boolean isPregenerating = false;
    private boolean isMapRendering = false;
    private WorldStatus worldStatus;
    private int worldId;

    @Override
    public void onEnable() {
        worldId = Integer.parseInt(System.getProperty("world.id"));
        initDatabase();
        worldStatus = getWorldStatusFromDB();
        DynmapCommonAPIListener.register(new DynmapMarkerListener(this));
        getServer().getPluginManager().registerEvents(this, this);
        LOGGER.info("DynmapMarkerSync enabled");

        // Check if world is already loaded and execute Chunky command
        if (getServer().getWorld("world") != null && !worldStatus.isWholeWorldGenerated()) {
            executeChunkyCommand();
        } else {
            LOGGER.info("World not yet loaded, waiting for WorldLoadEvent");
        }
    }

    private void executeChunkyCommand() {
        if (chunkyCommandExecuted || isPregenerating) {
            return;
        }

        chunkyCommandExecuted = true;

        new BukkitRunnable() {
            @Override
            public void run() {
                // Check if Chunky is installed
                if (Bukkit.getPluginManager().getPlugin("Chunky") == null) {
                    LOGGER.warning("Chunky plugin not found. Cannot generate world.");
                    return;
                }

                if (isOverworldFullyGenerated()) {
                    LOGGER.info("Overworld already generated");
                } else {
                    LOGGER.info("Using Chunky to load Overworld");
                    boolean success = Bukkit.dispatchCommand(Bukkit.getConsoleSender(),
                            "chunky start world square 0 0 3000");
                    if (success) {
                        isPregenerating = true;
                        LOGGER.info("\tOVERWORLD: Chunky command executed successfully");
                    } else {
                        LOGGER.warning("\tOVERWORLD: Failed to execute Chunky command");
                    }
                }

                if (isNetherFullyGenerated()) {
                    LOGGER.info("Nether already generated");
                } else {
                    LOGGER.info("Using Chunky to load Nether");
                    boolean success = Bukkit.dispatchCommand(Bukkit.getConsoleSender(),
                            "chunky start world_nether square 0 0 3000");
                    if (success) {
                        isPregenerating = true;
                        LOGGER.info("\tNETHER: Chunky command executed successfully");
                    } else {
                        LOGGER.warning("\tNETHER: Failed to execute Chunky command");
                    }
                }

                if (isEndFullyGenerated()) {
                    LOGGER.info("End already generated");
                } else {
                    LOGGER.info("Using Chunky to load End");
                    boolean success = Bukkit.dispatchCommand(Bukkit.getConsoleSender(),
                            "chunky start world_the_end square 0 0 3000");
                    if (success) {
                        isPregenerating = true;
                        LOGGER.info("\tEND: Chunky command executed successfully");
                    } else {
                        LOGGER.warning("\tEND: Failed to execute Chunky command");
                    }
                }
            }
        }.runTaskLater(this, 40L); // 2 second delay (40 ticks = 2 seconds)
    }

    private boolean _checkFilesExists(String path, String... fileNames) {
        File worldContainer = Bukkit.getWorldContainer();
        File regionDir = new File(worldContainer, path);

        boolean areAllTrue = true;
        for (String fileName : fileNames) {
            areAllTrue = areAllTrue && new File(regionDir, fileName).exists();
        }

        return areAllTrue;
    }

    @EventHandler
    public void onWorldLoad(WorldLoadEvent event) {
        LOGGER.info("DynmapMarkerSync onWorldLoad");
        LOGGER.info(event.getWorld().getName());
        if (!chunkyCommandExecuted && event.getWorld().getName().equals("world")) {
            executeChunkyCommand();
        }
    }

    public void onDynmapReady(DynmapCommonAPI api) {
        markerAPI = api.getMarkerAPI();
        if (markerAPI == null) {
            LOGGER.severe("Failed to get MarkerAPI!");
            return;
        }
        markerIconCreator = new MarkerIconCreator(markerAPI);

        markerSet = markerAPI.getMarkerSet(MARKER_SET_ID);
        if (markerSet == null) {
            markerSet = markerAPI.createMarkerSet(MARKER_SET_ID, "Live Map Players", null, false);
        }

        LOGGER.info("Marker set created!");
        runTaskLoop();
    }

    private void initDatabase() {
        try {
            LOGGER.info("Initializing database...");
            LOGGER.info(System.getProperty("user.dir"));
            Path path = Paths.get(System.getProperty("user.dir"));
            File dbFile = new File(path.getParent().getParent().toAbsolutePath().toFile(), "players.db");

            LOGGER.info("Loading players.db from " + dbFile.getAbsolutePath());
            dbConnection = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath());
            try (Statement stmt = dbConnection.createStatement()) {
                stmt.execute("PRAGMA journal_mode = WAL;");
            }
        } catch (SQLException e) {
            LOGGER.severe("Failed to open players.db: " + e.getMessage());
        }
    }

    private void runTaskLoop() {
        new BukkitRunnable() {
            @Override
            public void run() {
                syncMarkers();
            }
        }.runTaskTimer(this, 100, 10L);

        new BukkitRunnable() {
            @Override
            public void run() {
                boolean didStatusChange = updateWorldStatus();

                if (worldStatus.isWholeWorldGenerated() && isPregenerating)
                    isPregenerating = false;
                if (worldStatus.isWholeMapRendered() && isMapRendering)
                    isMapRendering = false;

                if (worldStatus.isWholeWorldGenerated() && !worldStatus.isWholeMapRendered() && !isMapRendering) {
                    startFullRender();
                }

                if (didStatusChange) {
                    upsertWorldStatus();
                }
            }
        }.runTaskTimer(this, 5 * 20, 30 * 20);
    }

    private void startFullRender() {
        if (isMapRendering)
            return;
        if (Bukkit.getPluginManager().getPlugin("dynmap") == null) {
            LOGGER.warning("Dynmap plugin not found. Cannot render world.");
            return;
        }

        if (isOverworldFullyGenerated()) {
            LOGGER.info("Overworld already rendered");
        } else {
            LOGGER.info("Using dynmap to render the Overworld");
            boolean success = Bukkit.dispatchCommand(Bukkit.getConsoleSender(),
                    "dynmap fullrender world:flat");
            if (success) {
                isMapRendering = true;
                LOGGER.info("\tOVERWORLD: Dynmap command executed successfully");
            } else {
                LOGGER.warning("\tOVERWORLD: Failed to execute Dynmap command");
            }
        }

        if (isNetherMapFullyRendered()) {
            LOGGER.info("Nether already rendered");
        } else {
            LOGGER.info("Using Dynmap to render the Nether");
            boolean success = Bukkit.dispatchCommand(Bukkit.getConsoleSender(),
                    "dynmap fullrender world_nether:flat");
            if (success) {
                isMapRendering = true;
                LOGGER.info("\tNETHER: Dynmap command executed successfully");
            } else {
                LOGGER.warning("\tNETHER: Failed to execute Dynmap command");
            }
        }

        if (isEndMapFullyRendered()) {
            LOGGER.info("End already rendered");
        } else {
            LOGGER.info("Using Dynmap to render the End");
            boolean success = Bukkit.dispatchCommand(Bukkit.getConsoleSender(),
                    "dynmap fullrender world_the_end:flat");
            if (success) {
                isMapRendering = true;
                LOGGER.info("\tEND: Dynmap command executed successfully");
            } else {
                LOGGER.warning("\tEND: Failed to execute Dynmap command");
            }
        }
    }

    private boolean updateWorldStatus() {
        WorldStatus newWorldStatus = getWorldStatus();

        boolean isDirty = !newWorldStatus.equals(worldStatus);
        worldStatus = newWorldStatus;
        return isDirty;
    }

    private WorldStatus getWorldStatusFromDB() {
        if (dbConnection == null)
            return null;

        String sql = "SELECT isOverworldGenerated, " +
                "isNetherGenerated, " +
                "isEndGenerated, " +
                "isOverworldMapRendered, " +
                "isNetherMapRendered, " +
                "isEndMapRendered FROM worlds WHERE id = ?";

        try (PreparedStatement stmt = dbConnection.prepareStatement(sql)) {
            stmt.setInt(1, worldId);
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return new WorldStatus(
                            rs.getBoolean("isOverworldGenerated"),
                            rs.getBoolean("isNetherGenerated"),
                            rs.getBoolean("isEndGenerated"),
                            rs.getBoolean("isOverworldMapRendered"),
                            rs.getBoolean("isNetherMapRendered"),
                            rs.getBoolean("isEndMapRendered"));
                }
            }
        } catch (SQLException e) {
            LOGGER.severe("Failed to get WorldStatus from DB: " + e.getMessage());
        }
        return null;
    }

    private WorldStatus getWorldStatus() {
        return new WorldStatus(
                isOverworldFullyGenerated(),
                isNetherFullyGenerated(),
                isEndFullyGenerated(),
                isOverworldMapFullyRendered(),
                isNetherMapFullyRendered(),
                isEndMapFullyRendered());
    }

    private void upsertWorldStatus() {
        if (dbConnection == null || worldStatus == null)
            return;

        String sql = "UPDATE worlds SET " +
                "isOverworldGenerated = ?, " +
                "isNetherGenerated = ?, " +
                "isEndGenerated = ?, " +
                "isOverworldMapRendered = ?, " +
                "isNetherMapRendered = ?, " +
                "isEndMapRendered = ? " +
                "WHERE id = ?";

        try (PreparedStatement stmt = dbConnection.prepareStatement(sql)) {
            stmt.setBoolean(1, worldStatus.isOverworldGenerated());
            stmt.setBoolean(2, worldStatus.isNetherGenerated());
            stmt.setBoolean(3, worldStatus.isEndGenerated());
            stmt.setBoolean(4, worldStatus.isOverworldMapRendered());
            stmt.setBoolean(5, worldStatus.isNetherMapRendered());
            stmt.setBoolean(6, worldStatus.isEndMapRendered());
            stmt.setInt(7, worldId);
            stmt.executeUpdate();
        } catch (SQLException e) {
            LOGGER.severe("Failed to upsert WorldStatus to DB: " + e.getMessage());
        }
    }

    private void syncMarkers() {
        if (markerSet == null || dbConnection == null)
            return;
        try (Statement stmt = dbConnection.createStatement();
                ResultSet rs = stmt.executeQuery("SELECT token, name, x, y, z, dimension FROM players")) {

            Map<String, Marker> markersMap = new HashMap<>();
            for (Marker m : markerSet.getMarkers()) {
                markersMap.put(m.getMarkerID(), m);
            }

            while (rs.next()) {
                String token = rs.getString("token");
                String name = rs.getString("name");
                String dimension = rs.getString("dimension");
                double x = rs.getDouble("x");
                double y = rs.getDouble("y");
                double z = rs.getDouble("z");

                String markerId = "plr_" + token;
                Marker m = markersMap.remove(markerId);

                if (m != null) {
                    if (!m.getWorld().equals(dimension)) {
                        m.deleteMarker();
                        createMarker(name, markerId, dimension, x, y, z);
                    } else {
                        m.setLocation(dimension, x, y, z);
                    }

                } else {
                    createMarker(name, markerId, dimension, x, y, z);
                }
            }

            for (Marker stale : markersMap.values()) {
                stale.deleteMarker();
            }

        } catch (SQLException e) {
            LOGGER.warning("DB read error: " + e.getMessage());
        }
    }

    private void createMarker(String name, String markerId, String dimension, double x, double y, double z) {
        MarkerIcon icon = markerAPI.getMarkerIcon(name);
        if (icon == null) {
            LOGGER.info("Creating new marker icon: " + name);
            icon = markerIconCreator.registerSkinMarker(name, name, name);
        } else {
            LOGGER.info("Marker icon already exists: " + name + ". Skipping Icon Creation...");
        }
        Marker marker = markerSet.createMarker(markerId, name, dimension, x, y, z, icon, false);
        marker.setLabel(name);
    }

    @Override
    public void onDisable() {
        if (markerSet != null)
            markerSet.deleteMarkerSet();
        try {
            if (dbConnection != null && !dbConnection.isClosed())
                dbConnection.close();
        } catch (SQLException e) {
            LOGGER.warning("DB close error: " + e.getMessage());
        }
    }

    /**
     * To check if we have already generated all the chunks we need,
     * we check the region files to see if the following exists:
     * - r.-6.5.mca -> -3000, 3000
     * - r.5.5.mca -> 3000, 3000
     * - r.5.-6.mca -> 3000, -3000
     * - r.-6.-6.mca -> -3000, -3000
     *
     * @return True if the world has been fully generated
     */
    private boolean isOverworldFullyGenerated() {
        return _checkFilesExists(
                "world/region",
                "r.-6.5.mca", "r.5.5.mca", "r.5.-6.mca", "r.-6.-6.mca");
    }

    private boolean isNetherFullyGenerated() {
        return _checkFilesExists(
                "world_nether/DIM-1/region",
                "r.-6.5.mca", "r.5.5.mca", "r.5.-6.mca", "r.-6.-6.mca");
    }

    private boolean isEndFullyGenerated() {
        return _checkFilesExists(
                "world_the_end/DIM1/region",
                "r.-6.5.mca", "r.5.5.mca", "r.5.-6.mca", "r.-6.-6.mca");
    }

    private boolean isOverworldMapFullyRendered() {
        return _checkFilesExists(
                "plugins/dynmap/web/tiles/world",
                "flat_2_-3.hash", "flat_2_3.hash", "flat_-3_-3.hash", "flat_-3_3.hash");
    }

    private boolean isNetherMapFullyRendered() {
        return _checkFilesExists(
                "plugins/dynmap/web/tiles/world_nether",
                "flat_2_-3.hash", "flat_2_3.hash", "flat_-3_-3.hash", "flat_-3_3.hash");
    }

    private boolean isEndMapFullyRendered() {
        return _checkFilesExists(
                "plugins/dynmap/web/tiles/world_the_end",
                "flat_2_-3.hash", "flat_2_3.hash", "flat_-3_-3.hash", "flat_-3_3.hash");
    }
}
