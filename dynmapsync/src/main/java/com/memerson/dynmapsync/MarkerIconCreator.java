package com.memerson.dynmapsync;

import org.dynmap.markers.MarkerAPI;
import org.dynmap.markers.MarkerIcon;

import java.io.InputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;

public class MarkerIconCreator {

    // Replace this with your actual instance that provides createMarkerIcon
    private final MarkerAPI markerAPI;

    public MarkerIconCreator(MarkerAPI markerAPI) {
        this.markerAPI = markerAPI;
    }

    public MarkerIcon registerSkinMarker(String username, String markerId, String label) {
        String skinUrl = "https://mineskin.eu/helm/" + username + "/100.png";
        System.out.println("Downloading " + username + "'s skin from " + skinUrl);
        try (InputStream inputStream = downloadPng(skinUrl)) {
            if (inputStream != null) {
                MarkerIcon icon = markerAPI.createMarkerIcon(markerId, label, inputStream);
                if (icon != null) {
                    System.out.println("Marker icon created successfully for " + username);
                } else {
                    System.out.println("Failed to create marker icon.");
                }
                return icon;
            } else {
                System.out.println("Failed to download PNG.");
                return null;
            }
        } catch (IOException e) {
            e.printStackTrace();
            return null;
        }
    }

    private InputStream downloadPng(String urlStr) throws IOException {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestProperty("User-Agent", "Java Marker Downloader");
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(5000);
        conn.setDoInput(true);
        int responseCode = conn.getResponseCode();
        if (responseCode == HttpURLConnection.HTTP_OK) {
            return conn.getInputStream(); // Will be auto-closed by try-with-resources
        } else {
            System.err.println("Failed to fetch image. HTTP code: " + responseCode);
            conn.disconnect();
            return null;
        }
    }
}
