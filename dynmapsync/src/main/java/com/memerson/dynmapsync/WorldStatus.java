package com.memerson.dynmapsync;

import java.util.Objects;

public class WorldStatus {
    private boolean isOverworldGenerated;
    private boolean isNetherGenerated;
    private boolean isEndGenerated;

    private boolean isOverworldMapRendered;
    private boolean isNetherMapRendered;
    private boolean isEndMapRendered;

    public WorldStatus(boolean isOverworldGenerated, boolean isNetherGenerated, boolean isEndGenerated, boolean isOverworldMapRendered, boolean isNetherMapRendered, boolean isEndMapRendered) {
        this.isOverworldGenerated = isOverworldGenerated;
        this.isNetherGenerated = isNetherGenerated;
        this.isEndGenerated = isEndGenerated;
        this.isOverworldMapRendered = isOverworldMapRendered;
        this.isNetherMapRendered = isNetherMapRendered;
        this.isEndMapRendered = isEndMapRendered;
    }

    @Override
    public boolean equals(Object o) {
        if (o == null || getClass() != o.getClass()) return false;
        WorldStatus that = (WorldStatus) o;
        return isOverworldGenerated == that.isOverworldGenerated && isNetherGenerated == that.isNetherGenerated && isEndGenerated == that.isEndGenerated && isOverworldMapRendered == that.isOverworldMapRendered && isNetherMapRendered == that.isNetherMapRendered && isEndMapRendered == that.isEndMapRendered;
    }

    @Override
    public int hashCode() {
        return Objects.hash(isOverworldGenerated, isNetherGenerated, isEndGenerated, isOverworldMapRendered, isNetherMapRendered, isEndMapRendered);
    }

    public boolean isWholeWorldGenerated() {
        return isOverworldGenerated && isNetherGenerated && isEndGenerated;
    }

    public boolean isWholeMapRendered() {
        return isOverworldMapRendered && isNetherMapRendered && isEndMapRendered;
    }

    public boolean isOverworldGenerated() {
        return isOverworldGenerated;
    }

    public void setOverworldGenerated(boolean overworldGenerated) {
        isOverworldGenerated = overworldGenerated;
    }

    public boolean isNetherGenerated() {
        return isNetherGenerated;
    }

    public void setNetherGenerated(boolean netherGenerated) {
        isNetherGenerated = netherGenerated;
    }

    public boolean isEndGenerated() {
        return isEndGenerated;
    }

    public void setEndGenerated(boolean endGenerated) {
        isEndGenerated = endGenerated;
    }

    public boolean isOverworldMapRendered() {
        return isOverworldMapRendered;
    }

    public void setOverworldMapRendered(boolean overworldMapRendered) {
        isOverworldMapRendered = overworldMapRendered;
    }

    public boolean isNetherMapRendered() {
        return isNetherMapRendered;
    }

    public void setNetherMapRendered(boolean netherMapRendered) {
        isNetherMapRendered = netherMapRendered;
    }

    public boolean isEndMapRendered() {
        return isEndMapRendered;
    }

    public void setEndMapRendered(boolean endMapRendered) {
        isEndMapRendered = endMapRendered;
    }

    @Override
    public String toString() {
        return "WorldStatus{" +
                "isOverworldGenerated=" + isOverworldGenerated +
                ", isNetherGenerated=" + isNetherGenerated +
                ", isEndGenerated=" + isEndGenerated +
                ", isOverworldMapRendered=" + isOverworldMapRendered +
                ", isNetherMapRendered=" + isNetherMapRendered +
                ", isEndMapRendered=" + isEndMapRendered +
                '}';
    }
}
