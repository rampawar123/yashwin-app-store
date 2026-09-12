// ==========================================
// क्रिक युवा (Cric Yuva) - मुख्य ऐप कंट्रोलर
// फ़ाइल का नाम: script.js
// ==========================================

// मैच की आईडी ट्रैक करने के लिए वेरिएबल
let currentLocalMatchId = "";
let thisOverBallsArray = [];

// ऐप शुरू होते ही ड्रॉपडाउन लोड करना
document.addEventListener("DOMContentLoaded", function() {
    loadTeamsInDropdowns();
    showScreen('dashboardScreen'); // शुरुआत में होम स्क्रीन दिखाएं
});

// 1. स्क्रीन बदलने का आसान फंक्शन (CricHeroes UI की तरह)
function showScreen(screenId) {
    const screens = document.querySelectorAll('.app-screen');
    screens.forEach(screen => screen.classList.add('hidden'));
    
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.remove('hidden');
    }
}

// 2. यूआई से नया खिलाड़ी रजिस्टर करना
function registerPlayerUI() {
    const name = document.getElementById("regPlayerName").value.trim();
    const bat = document.getElementById("regBattingStyle").value;
    const bowl = document.getElementById("regBowlingStyle").value;

    if (!name) {
        alert("कृपया खिलाड़ी का नाम दर्ज करें!");
        return;
    }

    if (window.CricYuvaStorage) {
        window.CricYuvaStorage.savePlayerOffline(name, bat, bowl);
        alert(`खिलाड़ी "${name}" सफलतापूर्वक रजिस्टर हो गया है!`);
        document.getElementById("regPlayerName").value = "";
        showScreen('dashboardScreen');
    }
}

// 3. यूआई से नई टीम बनाना
function createTeamUI() {
    const teamName = document.getElementById("newTeamName").value.trim();

    if (!teamName) {
        alert("कृपया टीम का नाम दर्ज करें!");
        return;
    }

    if (window.CricYuvaStorage) {
        window.CricYuvaStorage.saveTeamOffline(teamName);
        alert(`टीम "${teamName}" सफलतापूर्वक बन गई है!`);
        document.getElementById("newTeamName").value = "";
        loadTeamsInDropdowns(); // ड्रॉपडाउन लिस्ट को रिफ्रेश करें
        showScreen('dashboardScreen');
    }
}

// 4. मैच सेटअप स्क्रीन पर टीमों की लिस्ट लोड करना
function loadTeamsInDropdowns() {
    if (!window.CricYuvaStorage) return;
    
    const teams = window.CricYuvaStorage.getOfflineTeams();
    const teamASelect = document.getElementById("matchTeamA");
    const teamBSelect = document.getElementById("matchTeamB");

    if (teamASelect && teamBSelect) {
        teamASelect.innerHTML = '<option value="">-- टीम चुनें --</option>';
        teamBSelect.innerHTML = '<option value="">-- टीम चुनें --</option>';

        teams.forEach(team => {
            const optionA = document.createElement("option");
            optionA.value = team.id;
            optionA.textContent = team.teamName;
            teamASelect.appendChild(optionA);

            const optionB = document.createElement("option");
            optionB.value = team.id;
            optionB.textContent = team.teamName;
            teamBSelect.appendChild(optionB);
        });
    }
}

// 5. टॉस और ओपनर वाली स्क्रीन को सेट करना
function setupMatchPlayersUI() {
    const teamAId = document.getElementById("matchTeamA").value;
    const teamBId = document.getElementById("matchTeamB").value;
    const totalOvers = document.getElementById("matchOvers").value;
    const ballType = document.getElementById("matchBallType").value;

    if (!teamAId || !teamBId) {
        alert("कृपया दोनों टीमों का चयन करें!");
        return;
    }
    if (teamAId === teamBId) {
        alert("दोनों टीमें अलग-अलग होनी चाहिए!");
        return;
    }

    if (window.CricYuvaStorage && window.CricYuvaDB) {
        currentLocalMatchId = window.CricYuvaStorage.generateUUID();
        
        const teams = window.CricYuvaStorage.getOfflineTeams();
        const teamA = teams.find(t => t.id === teamAId);
        const teamB = teams.find(t => t.id === teamBId);

        // टॉस ड्रॉपडाउन को टीमों के नाम से भरना
        const tossSelect = document.getElementById("tossWinnerSelect");
        tossSelect.innerHTML = "";
        
        const optA = document.createElement("option");
        optA.value = teamA.id;
        optA.textContent = teamA.teamName;
        tossSelect.appendChild(optA);

        const optB = document.createElement("option");
        optB.value = teamB.id;
        optB.textContent = teamB.teamName;
        tossSelect.appendChild(optB);

        // टीमों के नाम डिस्प्ले पर सेट करना
        document.getElementById("displayTeamA").textContent = teamA.teamName;
        document.getElementById("displayTeamB").textContent = teamB.teamName;

        showScreen('tossAndPlayersScreen');
    }
}

// 6. मैच शुरू करना और कोर इंजन को एक्टिवेट करना
function startLiveScoringPad() {
    const striker = document.getElementById("strikerNameInput").value.trim();
    const nonStriker = document.getElementById("nonStrikerNameInput").value.trim();
    const bowler = document.getElementById("bowlerNameInput").value.trim();

    if (!striker || !nonStriker || !bowler) {
        alert("कृपया सभी ओपनिंग खिलाड़ियों के नाम दर्ज करें!");
        return;
    }

    if (window.startMatchEngine) {
        window.startMatchEngine(striker, nonStriker, bowler);
        thisOverBallsArray = [];
        document.getElementById("thisOverBalls").textContent = "";
        showScreen('liveScoringPadScreen');
    }
}

// 7. रन बटन क्लिक (0, 1, 2, 3, 4, 6) हैंडलर
function handleRunClick(run) {
    if (window.addNormalRuns) {
        window.addNormalRuns(run);
        thisOverBallsArray.push(run);
        updateThisOverStripUI();
    }
}

// 8. वाइड बटन क्लिक हैंडलर
function handleWideClick() {
    if (window.addWideBall) {
        window.addWideBall();
        thisOverBallsArray.push("WD");
        updateThisOverStripUI();
    }
}

// 9. नो-बॉल बटन क्लिक हैंडलर
function handleNoBallClick() {
    let runs = prompt("क्या बल्लेबाज ने नो-बॉल पर कोई रन बनाया? (0, 1, 2, 4, 6 दर्ज करें):", "0");
    let batsmanRuns = Number(runs);
    
    // यहाँ की कोडिंग मिस्टेक को पूरी तरह फिक्स कर दिया गया है
    if (isNaN(batsmanRuns)) {
        batsmanRuns = 0;
    }
    
    if (window.addNoBall) {
        window.addNoBall(batsmanRuns);
        thisOverBallsArray.push("NB");
        updateThisOverStripUI();
    }
}

// 10. विकेट बटन क्लिक हैंडलर
function handleWicketClick() {
    let type = prompt("आउट का प्रकार दर्ज करें (उदा. Bowled, Caught, Run Out, LBW):", "Bowled");
    if (!type) type = "Bowled";

    if (window.addWicketLogic) {
        window.addWicketLogic(type);
        thisOverBallsArray.push("W");
        updateThisOverStripUI();
    }
}

// 11. ओवर पट्टी को लाइव स्क्रीन पर दिखाना
function updateThisOverStripUI() {
    document.getElementById("thisOverBalls").textContent = thisOverBallsArray.join(" ");
}

// 12. क्रिकेट दिमाग के डेटा को मोबाइल स्क्रीन पर लाइव रिफ्रेश करना (CricHeroes लुक)
function updateUI() {
    if (!window.currentMatchState) return;

    const state = window.currentMatchState;

    // मुख्य स्कोर अपडेट
    document.getElementById("liveScoreRunsWickets").textContent = `${state.runs} / ${state.wickets}`;
    
    // ओवर का लाइव प्रदर्शन
    let displayOvers = Math.floor(state.overs);
    let displayBalls = state.bowler.xmlBalls;
    document.getElementById("liveOversCount").textContent = `ओवर: ${displayOvers}.${displayBalls}`;

    // बल्लेबाजों और बॉलर के लाइव टेक्स्ट
    document.getElementById("strikerDisplay").textContent = `* ${state.striker.name}: ${state.striker.runs} (${state.striker.balls}) [4s:${state.striker.fours} 6s:${state.striker.sixes}]`;
    document.getElementById("nonStrikerDisplay").textContent = `${state.nonStriker.name}: ${state.nonStriker.runs} (${state.nonStriker.balls}) [4s:${state.nonStriker.fours} 6s:${state.nonStriker.sixes}]`;
    document.getElementById("bowlerDisplay").textContent = `🔴 बॉलर: ${state.bowler.name} -> ओवर: ${state.bowler.overs}.${state.bowler.xmlBalls} | रन दिए: ${state.bowler.runsConceded} | विकेट: ${state.bowler.wickets}`;

    // फोन की लोकल मेमोरी में बैकअप लें
    if (window.CricYuvaStorage && currentLocalMatchId) {
        window.CricYuvaStorage.saveCurrentMatchState(currentLocalMatchId, state);
    }
}

// 13. ओवर पूरा होने पर नया बॉलर चुनने का ऑफलाइन हुक
function triggerNextBowlerPopup() {
    setTimeout(() => {
        let nextBowler = prompt("ओवर पूरा हुआ! अगले बॉलर का नाम दर्ज करें:", "नया बॉलर");
        if (!nextBowler) nextBowler = "नया बॉलर";
        
        if (window.currentMatchState) {
            window.currentMatchState.bowler.name = nextBowler;
            window.currentMatchState.bowler.xmlBalls = 0;
            thisOverBallsArray = []; 
            updateThisOverStripUI();
            updateUI();
        }
    }, 300);
}

// 14. विकेट गिरने पर नए बल्लेबाज का नाम दर्ज करने का ऑफलाइन हुक
function triggerNextBatsmanPopup() {
    setTimeout(() => {
        let nextBatsman = prompt("बल्लेबाज आउट! नए बल्लेबाज का नाम दर्ज करें:", "नया बल्लेबाज");
        if (!nextBatsman) nextBatsman = "नया बल्लेबाज";
        
        if (window.setNewBatsmanOffline) {
            window.setNewBatsmanOffline(nextBatsman);
        }
    }, 300);
}
