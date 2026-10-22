
package com.example.hiram;

import java.util.Locale;

public class VoiceCommandProcessor {

    public enum CommandType {
        OPEN_YOUTUBE,
        SEARCH_YOUTUBE,
        FIND_CONTACT,
        WRITE_MESSAGE,
        OPEN_APP,
        UNKNOWN
    }

    public static class ParsedCommand {
        public final CommandType type;
        public final String argument;

        public ParsedCommand(CommandType type, String argument) {
            this.type = type;
            this.argument = argument;
        }
    }

    public ParsedCommand parse(String spokenText) {
        if (spokenText == null || spokenText.trim().isEmpty()) {
            return new ParsedCommand(CommandType.UNKNOWN, "");
        }

        String text = spokenText.trim();
        String lower = text.toLowerCase(Locale.ROOT);

        if (lower.contains("youtube") || lower.contains("यूट्यूब")) {
            String query = text
                    .replaceAll("(?i)open youtube|youtube kholo|यूट्यूब खोलो", "")
                    .trim();

            if (!query.isEmpty()) {
                return new ParsedCommand(CommandType.SEARCH_YOUTUBE, query);
            }
            return new ParsedCommand(CommandType.OPEN_YOUTUBE, "");
        }

        if (lower.startsWith("contact ") || lower.startsWith("number of ")
                || lower.startsWith("कॉन्टैक्ट ") || lower.startsWith("नंबर बताओ ")) {
            String name = text.replaceFirst(
                    "(?i)^(contact|number of|कॉन्टैक्ट|नंबर बताओ)\\s*", "").trim();
            return new ParsedCommand(CommandType.FIND_CONTACT, name);
        }

        if (lower.startsWith("message ") || lower.startsWith("मैसेज ")) {
            return new ParsedCommand(CommandType.WRITE_MESSAGE, text);
        }

        if (lower.startsWith("open ") || lower.startsWith("खोलो ")) {
            String appName = text.replaceFirst(
                    "(?i)^(open|खोलो)\\s*", "").trim();
            return new ParsedCommand(CommandType.OPEN_APP, appName);
        }

        return new ParsedCommand(CommandType.UNKNOWN, text);
    }
}
