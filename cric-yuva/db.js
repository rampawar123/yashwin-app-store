// ==========================================
// क्रिक युवा (Cric Yuva) - ऑफलाइन डेटाबेस मॉडल
// फ़ाइल का नाम: db.js
// ==========================================

// यह फ़ाइल सुनिश्चित करती है कि सभी फ़ाइलों को डेटा का सही और एक जैसा ढांचा मिले।

const CricYuvaDB = {
    // 1. खिलाड़ियों का डिफ़ॉल्ट डेटा ढांचा (Player Blueprint)
    createPlayerObject: function(id, name, battingStyle, bowlingStyle) {
        return {
            id: id,
            name: name,
            battingStyle: battingStyle || "Right-hand",
            bowlingStyle: bowlingStyle || "None",
            stats: {
                matches: 0,
                runs: 0,
                wickets: 0,
                highestScore: 0
            },
            sync_status: "pending"
        };
    },

    // 2. टीमों का डिफ़ॉल्ट डेटा ढांचा (Team Blueprint)
    createTeamObject: function(id, teamName) {
        return {
            id: id,
            teamName: teamName,
            players: [], // इसमें खिलाड़ियों की यूनिक UUID स्टोर होगी
            sync_status: "pending"
        };
    },

    // 3. मैचों का सबसे महत्वपूर्ण ढांचा (Match Blueprint - CricHeroes की तरह)
    createMatchObject: function(matchId, teamA_Id, teamB_Id, totalOvers, ballType) {
        return {
            matchId: matchId,
            teamA_id: teamA_Id,
            teamB_id: teamB_Id,
            totalOvers: Number(totalOvers) || 5,
            ballType: ballType || "Tennis",
            tossWinner: "",
            tossDecision: "", // Bat or Bowl
            matchStatus: "Upcoming", // Upcoming, Live, Completed
            winnerTeamId: "",
            
            // लाइव स्कोरिंग की वर्तमान स्थिति
            liveScore: {
                currentInnings: 1, // 1st Innings or 2nd Innings
                totalRuns: 0,
                totalWickets: 0,
                totalBalls: 0, // ओवर के लिए: (totalBalls / 6)
                oversCount: 0,
                extras: { wide: 0, noBall: 0, bye: 0, legBye: 0 },
                strikerId: "",
                nonStrikerId: "",
                currentBowlerId: ""
            },

            // बॉल-बाय-बॉल पूरी हिस्ट्री (CricHeroes की तरह ओवर ग्राफ और समरी बनाने के लिए)
            ballByBallHistory: []
        };
    },

    // 4. हर एक गेंद की हिस्ट्री रिकॉर्ड करने का ढांचा (Ball History Blueprint)
    createBallRecord: function(innings, over, ball, batsmanId, bowlerId, runs, extraType, isWicket, wicketType) {
        return {
            innings: Number(innings),
            over: Number(over),
            ball: Number(ball),
            batsmanId: batsmanId,
            bowlerId: bowlerId,
            runsScored: Number(runs),
            extraType: extraType || "None", // None, Wide, NoBall, Bye, LegBye
            isWicket: Boolean(isWicket),
            wicketType: wicketType || "None" // None, Bowled, Caught, RunOut, LBW, etc.
        };
    }
};

// Global Window ऑब्जेक्ट में सेट करना ताकि पूरी एप्लीकेशन इसका उपयोग कर सके
if (typeof window !== "undefined") {
    window.CricYuvaDB = CricYuvaDB;
}
