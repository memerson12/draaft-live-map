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

    private MarkerAPI markerAPI;
    private MarkerSet markerSet;
    private Connection dbConnection;
    private final String MARKER_SET_ID = "live_map_players";
    private boolean chunkyCommandExecuted = false;

    @Override
    public void onEnable() {
        initDatabase();
        DynmapCommonAPIListener.register(new DynmapMarkerListener(this));
        getServer().getPluginManager().registerEvents(this, this);
        LOGGER.info("DynmapMarkerSync enabled");

        // Check if world is already loaded and execute Chunky command
        if (getServer().getWorld("world") != null) {
            LOGGER.info("World is already loaded, executing Chunky command immediately");
            executeChunkyCommand();
        } else {
            LOGGER.info("World not yet loaded, waiting for WorldLoadEvent");
        }
    }

    private void executeChunkyCommand() {
        if (chunkyCommandExecuted) {
            return;
        }

        chunkyCommandExecuted = true;
        LOGGER.info("Executing Chunky command...");

        // Execute the command on the main thread after a delay
        new BukkitRunnable() {
            @Override
            public void run() {
                // Execute the Chunky command
                boolean success = Bukkit.dispatchCommand(Bukkit.getConsoleSender(),
                        "chunky start world square 0 0 3000");
                if (success) {
                    LOGGER.info("Chunky command executed successfully");
                } else {
                    LOGGER.warning("Failed to execute Chunky command");
                }
            }
        }.runTaskLater(this, 40L); // 2 second delay (40 ticks = 2 seconds)
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
        api.triggerRenderOfVolume("world", -1000, 0, -1000, 1000, 255, 1000);

        markerAPI = api.getMarkerAPI();
        if (markerAPI == null) {
            LOGGER.severe("Failed to get MarkerAPI!");
            return;
        }

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
            File dbFile = new File(path.getParent().toAbsolutePath().toFile(), "players.db");

            LOGGER.info("Loading players.db from " + dbFile.getAbsolutePath());
            dbConnection = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath());
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
        }.runTaskTimer(this, 0L, 100L); // 5 sec interval
    }

    private void syncMarkers() {
        if (markerSet == null || dbConnection == null)
            return;
        try (Statement stmt = dbConnection.createStatement();
                ResultSet rs = stmt.executeQuery("SELECT token, name, x, y, z FROM players")) {

            Map<String, Marker> markersMap = new HashMap<>();
            for (Marker m : markerSet.getMarkers()) {
                markersMap.put(m.getMarkerID(), m);
            }

            while (rs.next()) {
                String token = rs.getString("token");
                String name = rs.getString("name");
                double x = rs.getDouble("x");
                double y = rs.getDouble("y");
                double z = rs.getDouble("z");

                String markerId = "plr_" + token;
                Marker m = markersMap.remove(markerId);
                if (m != null) {
                    m.setLocation("world", x, y, z);
                    m.setLabel(name);
                } else {
                    markerSet.createMarker(markerId, name, "world", x, y, z, markerAPI.getMarkerIcon("default"), false);
                }
            }

            for (Marker stale : markersMap.values()) {
                stale.deleteMarker();
            }

        } catch (SQLException e) {
            LOGGER.warning("DB read error: " + e.getMessage());
        }
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
}
