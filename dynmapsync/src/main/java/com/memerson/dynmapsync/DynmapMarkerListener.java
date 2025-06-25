package com.memerson.dynmapsync;

import org.dynmap.DynmapCommonAPI;
import org.dynmap.DynmapCommonAPIListener;

public class DynmapMarkerListener extends DynmapCommonAPIListener {
    private final DynmapMarkerSync plugin;

    public DynmapMarkerListener(DynmapMarkerSync plugin) {
        this.plugin = plugin;
    }

    @Override
    public void apiEnabled(DynmapCommonAPI api) {
        plugin.LOGGER.info("Dynmap API enabled");
        plugin.onDynmapReady(api);
    }
}