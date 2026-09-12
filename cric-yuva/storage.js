// ==========================================
// क्रिक युवा (Cric Yuva) - ऑफलाइन स्टोरेज इंजन
// फ़ाइल का नाम: storage.js
// ==========================================

const CricYuvaStorage = {
    // 1. बिना इंटरनेट के दुनिया की सबसे अनोखी आईडी (UUID v4) बनाने का फंक्शन
    generateUUID: function() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    // 2. नए खिलाड़ी को ऑफलाइन मेमोरी में सेव करने का लॉजिक
    savePlayerOffline: function(playerName, battingStyle, bowlingStyle) {
        let players = JSON.parse(localStorage.getItem("cy_players")) || [];
        
        const newPlayer = {
            id: this.generateUUID(), // अनोखी आईडी दी गई
            name: playerName,
            battingStyle: battingStyle,
            bowlingStyle: bowlingStyle,
            sync_status: "pending" // अभी यह सिर्फ ऑफलाइन सेव है
        };

        players.push(newPlayer);
        localStorage.setItem("cy_players", JSON.stringify(players));
        console.log(`खिलाड़ी ऑफलाइन सेव हुआ: ${playerName}`);
        return newPlayer;
    },

    // 3. सभी खिलाड़ियों की लिस्ट फोन की मेमोरी से निकालने का लॉजिक
    getOfflinePlayers: function() {
        return JSON.parse(localStorage.getItem("cy_players")) || [];
    },

    // 4. नई टीम को ऑफलाइन मेमोरी में सेव करने का लॉजिक
    saveTeamOffline: function(teamName) {
        let teams = JSON.parse(localStorage.getItem("cy_teams")) || [];
        
        const newTeam = {
            id: this.generateUUID(),
            teamName: teamName,
            players: [], // इसमें बाद में खिलाड़ियों की आईडी जोड़ी जाएगी
            sync_status: "pending"
        };

        teams.push(newTeam);
        localStorage.setItem("cy_teams", JSON.stringify(teams));
        console.log(`टीम ऑफलाइन सेव हुई: ${teamName}`);
        return newTeam;
    },

    // 5. सभी टीमों की लिस्ट फोन की मेमोरी से निकालने का लॉजिक
    getOfflineTeams: function() {
        return JSON.parse(localStorage.getItem("cy_teams")) || [];
    },

    // 6. किसी खिलाड़ी को ऑफलाइन टीम के अंदर जोड़ने का लॉजिक
    addPlayerToTeamOffline: function(teamId, playerId) {
        let teams = this.getOfflineTeams();
        let team = teams.find(t => t.id === teamId);
        
        if (team) {
            // अगर खिलाड़ी पहले से टीम में नहीं है, तो ही जोड़ें
            if (!team.players.includes(playerId)) {
                team.players.push(playerId);
                team.sync_status = "pending"; // डेटा बदला है, इसलिए सिंक पेंडिंग करें
                localStorage.setItem("cy_teams", JSON.stringify(teams));
                console.log(`खिलाड़ी ${playerId} को टीम ${team.teamName} में जोड़ा गया`);
                return true;
            }
        }
        return false;
    },

    // 7. चालू मैच की स्थिति (Live Match Score) को हर गेंद के बाद सेव करने का लॉजिक
    saveCurrentMatchState: function(matchId, matchStateData) {
        let matches = JSON.parse(localStorage.getItem("cy_matches")) || [];
        let matchIndex = matches.findIndex(m => m.matchId === matchId);

        const matchData = {
            matchId: matchId,
            liveScore: matchStateData,
            sync_status: "pending",
            lastUpdated: new Date().toISOString()
        };

        if (matchIndex > -1) {
            matches[matchIndex] = matchData; // पहले से है तो अपडेट करें
        } else {
            matches.push(matchData); // नया है तो जोड़ें
        }

        localStorage.setItem("cy_matches", JSON.stringify(matches));
        localStorage.setItem("cy_current_live_match_id", matchId); // चालू मैच की आईडी याद रखें
        console.log("मैच का स्कोर ऑफलाइन सुरक्षित कर दिया गया है।");
    },

    // 8. किसी विशिष्ट मैच का डेटा मेमोरी से लोड करने का लॉजिक
    getMatchDetails: function(matchId) {
        let matches = JSON.parse(localStorage.getItem("cy_matches")) || [];
        return matches.find(m => m.matchId === matchId) || null;
    }
};

// ग्लोबल विंडो ऑब्जेक्ट में सेट करना ताकि दूसरी फाइलें इसे इस्तेमाल कर सकें
if (typeof window !== "undefined") {
    window.CricYuvaStorage = CricYuvaStorage;
}
