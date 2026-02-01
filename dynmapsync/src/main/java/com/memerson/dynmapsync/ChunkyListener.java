//package com.memerson.dynmapsync;
//
//import org.bukkit.event.EventHandler;
//import org.bukkit.event.Listener;
//import org.popcraft.chunky.event.Event;
//public class ChunkyListener implements Listener {
//
//    private final MyPlugin plugin;
//
//    public ChunkyListener(MyPlugin plugin) {
//        this.plugin = plugin;
//    }
//
//    @EventHandler
//    public void onChunkyStart(ChunkyTaskStartEvent event) {
//        // A Chunky task has started, so we pause Dynmap
//        plugin.pauseDynmapRenders();
//    }
//
//    @EventHandler
//    public void onChunkyComplete(ChunkyTaskCompletionEvent event) {
//        // The Chunky task is complete, so we can resume Dynmap
//        plugin.resumeDynmapRenders();
//    }
//}