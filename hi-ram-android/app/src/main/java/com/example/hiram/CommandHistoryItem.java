package com.example.hiram;

public class CommandHistoryItem {
    public final String commandText;
    public final String resultFeedback;
    public final String timestamp;
    public final boolean success;

    public CommandHistoryItem(String commandText, String resultFeedback, String timestamp, boolean success) {
        this.commandText = commandText;
        this.resultFeedback = resultFeedback;
        this.timestamp = timestamp;
        this.success = success;
    }
}
