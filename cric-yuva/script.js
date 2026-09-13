// ==========================================
// क्रिक युवा (Cric Yuva) - मुख्य ऐप कंट्रोलर
// फ़ाइल का नाम: script.js (100% स्टेबल फिक्स)
// ==========================================

let thisOverBallsArray = [];
let currentLocalMatchId = "MATCH-" + Math.floor(Math.random() * 100000);

// ऐप शुरू होते ही ड्रॉपडाउन लोड करना
document.addEventListener("DOMContentLoaded", function() {
    try {
        loadTeamsInDropdowns();
    } catch(e) {
        console.log("ड्रॉपडाउन लोड करने में एरर:", e);
    }
    showScreen('dashboardScreen'); 
});

// 1. स्क्रीन बदलने का फंक्शन
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
    } else {
        // अगर storage.js लोड न हो तो भी बैकअप चले
        let players = JSON.parse(localStorage.getItem("cy_players")) || [];
        players.push({ id: Date.now().toString(), name, battingStyle: bat, bowlingStyle: bowl });
        localStorage.setItem("cy_players", JSON.stringify(players));
        alert(`खिलाड़ी "${name}" ऑफलाइन मेमोरी में सेव हुआ!`);
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
        loadTeamsInDropdowns(); 
        showScreen('dashboardScreen');
    } else {
        let teams = JSON.parse(localStorage.getItem("cy_teams")) || [];
        teams.push({ id: Date.now().toString(), teamName });
        localStorage.setItem("cy_teams", JSON.stringify(teams));
        alert(`टीम "${teamName}" ऑफलाइन मेमोरी में बन गई!`);
        document.getElementById("newTeamName").value = "";
        loadTeamsInDropdowns();
        showScreen('dashboardScreen');
    }
}

// 4. मैच सेटअप स्क्रीन पर टीमों की लिस्ट लोड करना
function loadTeamsInDropdowns() {
    let teams = [];
    if (window.CricYuvaStorage) {
        teams = window.CricYuvaStorage.getOfflineTeams() || [];
    } else {
        teams = JSON.parse(localStorage.getItem("cy_teams")) || [];
    }
    
    const teamASelect = document.getElementById("matchTeamA");
    const teamBSelect = document.getElementById("matchTeamB");

    if (teamASelect && teamBSelect) {
        teamASelect.innerHTML = '<option value="">-- टीम चुनें --</option>';
        teamBSelect.innerHTML = '<option value="">-- टीम चुनें --</option>';

        teams.forEach(team => {
            const optionA = document.createElement("option");
            optionA.value = team.teamName || team.name;
            optionA.textContent = team.teamName || team.name;
            teamASelect.appendChild(optionA);

            const optionB = document.createElement("option");
            optionB.value = team.teamName || team.name;
            optionB.textContent = team.teamName || team.name;
            teamBSelect.appendChild(optionB);
        });
    }
}

// 5. टॉस और ओपनर वाली स्क्रीन को सेट करना
function setupMatchPlayersUI() {
    const teamAName = document.getElementById("matchTeamA").value;
    const teamBName = document.getElementById("matchTeamB").value;
    const totalOvers = document.getElementById("matchOvers").value;
    const ballType = document.getElementById("matchBallType").value;

    if (!teamAName || !teamBName) {
        alert("कृपया दोनों टीमों का चयन करें!");
        return;
    }
    if (teamAName === teamBName) {
        alert("दोनों टीमें अलग-अलग होनी चाहिए!");
        return;
    }

    // टॉस ड्रॉपडाउन को टीमों के नाम से भरना
    const tossSelect = document.getElementById("tossWinnerSelect");
    if (tossSelect) {
        tossSelect.innerHTML = "";
        const optA = document.createElement("option");
        optA.value = teamAName; optA.textContent = teamAName;
        tossSelect.appendChild(optA);

        const optB = document.createElement("option");
        optB.value = teamBName; optB.textContent = teamBName;
        tossSelect.appendChild(optB);
    }

    // डिस्प्ले पर नाम सेट करना
    if (document.getElementById("displayTeamA")) document.getElementById("displayTeamA").textContent = teamAName;
    if (document.getElementById("displayTeamB")) document.getElementById("displayTeamB").textContent = teamBName;

    window.tempMatchConfig = {
        teamAName: teamAName,
        teamBName: teamBName,
        maxOvers: Number(totalOvers) || 5,
        ballType: ballType
    };

    showScreen('tossAndPlayersScreen');
}

// 6. मैच स्कोरिंग पैड शुरू करना
function startLiveScoringPad() {
    const striker = document.getElementById("strikerNameInput").value.trim();
    const nonStriker = document.getElementById("nonStrikerNameInput").value.trim();
    const bowler = document.getElementById("bowlerNameInput").value.trim();

    if (!striker || !nonStriker || !bowler) {
        alert("कृपया सभी ओपनिंग खिलाड़ियों के नाम दर्ज करें!");
        return;
    }

    // पुराने और नए दोनों प्रकार के मैच इंजन का सुरक्षित सपोर्ट
    if (window.startProfessionalMatch && window.tempMatchConfig) {
        const fullConfig = {
            ...window.tempMatchConfig,
            tossWinner: document.getElementById("tossWinnerSelect").value,
            tossDecision: document.getElementById("tossDecisionSelect").value,
            strikerName: striker,
            nonStrikerName: nonStriker,
            bowlerName: bowler
        };
        window.startProfessionalMatch(fullConfig);
    } else if (window.startMatchEngine) {
        window.startMatchEngine(striker, nonStriker, bowler);
    }

    thisOverBallsArray = [];
    if (document.getElementById("thisOverBalls")) document.getElementById("thisOverBalls").textContent = "";
    showScreen('liveScoringPadScreen');
}

// 7. प्रोफेशनल गेंद रिकॉर्ड सबमिट करना
function submitProfessionalBall(ballType, runs, isWicket, wicketType) {
    if (window.registerBallRecord) {
        const direction = document.getElementById("ballDirectionSelect").value;
        window.registerBallRecord({
            type: ballType,
            runs: runs,
            direction: direction,
            isWicket: isWicket,
            wicketType: wicketType || ""
        });
    } else {
        // पुराने इंजन के लिए फॉलबैक सपोर्ट
        if (ballType === "Normal") window.addNormalRuns ? window.addNormalRuns(runs) : null;
        if (ballType === "Wide") window.addWideBall ? window.addWideBall() : null;
        if (ballType === "NoBall") window.addNoBall ? window.addNoBall(runs) : null;
        if (isWicket) window.addWicketLogic ? window.addWicketLogic(wicketType) : null;
    }
}

// 8. यूआई बटन्स हैंडल्स (0,1,2,3,4,6)
function handleRunClickUI(run) {
    submitProfessionalBall("Normal", run, false);
    thisOverBallsArray.push(run);
    updateThisOverStripUI();
}

function handleWideClickUI() {
    submitProfessionalBall("Wide", 0, false);
    thisOverBallsArray.push("WD");
    updateThisOverStripUI();
}

function handleNoBallClickUI() {
    let runs = prompt("नो-बॉल पर बल्लेबाज ने कितने रन बनाए? (0,1,2,4,6):", "0");
    let batsmanRuns = Number(runs) || 0;
    submitProfessionalBall("NoBall", batsmanRuns, false);
    thisOverBallsArray.push("NB");
    updateThisOverStripUI();
}

function handleWicketClickUI() {
    let type = prompt("आउट का प्रकार दर्ज करें (Bowled, Caught, Run Out, LBW):", "Bowled");
    if (!type) type = "Bowled";
    submitProfessionalBall("Normal", 0, true, type);
    thisOverBallsArray.push("W");
    updateThisOverStripUI();
}

function updateThisOverStripUI() {
    if (document.getElementById("thisOverBalls")) {
        document.getElementById("thisOverBalls").textContent = thisOverBallsArray.join(" ");
    }
}

// 9. स्क्रीन डेटा लाइव अपडेट करना
function updateUI() {
    const scoreState = window.currentMatchState;
    if (!scoreState) return;

    // यदि नया प्रोफेशनल स्टेट है
    if (scoreState.striker && scoreState.currentBowler) {
        if (document.getElementById("liveScoreRunsWickets")) document.getElementById("liveScoreRunsWickets").textContent = `${scoreState.runs} / ${scoreState.wickets}`;
        if (document.getElementById("liveOversCount")) document.getElementById("liveOversCount").textContent = `ओवर: ${scoreState.overs}.${scoreState.ballsInCurrentOver}`;
        if (document.getElementById("strikerDisplay")) document.getElementById("strikerDisplay").textContent = `* ${scoreState.striker.name}: ${scoreState.striker.runs} (${scoreState.striker.balls})`;
        if (document.getElementById("nonStrikerDisplay")) document.getElementById("nonStrikerDisplay").textContent = `${scoreState.nonStriker.name}: ${scoreState.nonStriker.runs} (${scoreState.nonStriker.balls})`;
        if (document.getElementById("bowlerDisplay")) document.getElementById("bowlerDisplay").textContent = `🔴 बॉलर: ${scoreState.currentBowler.name} -> रन: ${scoreState.currentBowler.runsConceded} | विकेट: ${scoreState.currentBowler.wickets}`;
    } else {
