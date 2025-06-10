package com.memerson.dynmapsync;

import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;
import org.dynmap.DynmapCommonAPI;
import org.dynmap.DynmapCommonAPIListener;
import org.dynmap.markers.Marker;
import org.dynmap.markers.MarkerAPI;
import org.dynmap.markers.MarkerSet;

import java.io.File;
import java.sql.*;
import java.util.HashMap;
import java.util.Map;

public class DynmapMarkerSync extends JavaPlugin {
    private MarkerAPI markerAPI;
    private MarkerSet markerSet;
    private Connection dbConnection;
    private final String MARKER_SET_ID = "live_map_players";

    @Override
    public void onEnable() {
        initDatabase();
        DynmapCommonAPIListener.register(new DynmapMarkerListener(this));
    }

    public void onDynmapReady(DynmapCommonAPI api) {
        markerAPI = api.getMarkerAPI();
        if (markerAPI == null) {
            getLogger().severe("Failed to get MarkerAPI!");
            return;
        }

        markerSet = markerAPI.getMarkerSet(MARKER_SET_ID);
        if (markerSet == null) {
            markerSet = markerAPI.createMarkerSet(MARKER_SET_ID, "Live Map Players", null, false);
        }

        runTaskLoop();
    }

    private void initDatabase() {
        try {
            File dbFile = new File(getServer().getWorldContainer().getParent(), "players.db");
            dbConnection = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath());
        } catch (SQLException e) {
            getLogger().severe("Failed to open players.db: " + e.getMessage());
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
            getLogger().warning("DB read error: " + e.getMessage());
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
            getLogger().warning("DB close error: " + e.getMessage());
        }
    }
}
