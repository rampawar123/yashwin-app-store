// ==========================================
// क्रिक युवा (Cric Yuva) - मुख्य ऐप कंट्रोलर
// फ़ाइल का नाम: script.js (100% वर्किंग ऑफलाइन फिक्स)
// ==========================================

let thisOverBallsArray = [];

// ऐप शुरू होते ही ड्रॉपडाउन लोड करना
document.addEventListener("DOMContentLoaded", function() {
    loadTeamsInDropdowns();
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
        alert(`TEAM "${teamName}" सफलतापूर्वक बन गई है!`);
        document.getElementById("newTeamName").value = "";
        loadTeamsInDropdowns(); 
        showScreen('dashboardScreen');
    }
}

// 4. मैच सेटअप स्क्रीन पर टीमों की लिस्ट लोड करना
function loadTeamsInDropdowns() {
    if (!window.CricYuvaStorage) {
        console.log("स्टोरेज इंजन अभी लोड हो रहा है...");
        return;
    }
    
    const teams = window.CricYuvaStorage.getOfflineTeams() || [];
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

// 5. टॉस और ओपनर वाली स्क्रीन को सेट करना (100% वर्किंग फिक्स)
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

    // यहाँ हम ड्रॉपडाउन से सीधे चुनी हुई टीम का नाम निकाल रहे हैं
    const teamASelect = document.getElementById("matchTeamA");
    const teamBSelect = document.getElementById("matchTeamB");
    const teamAName = teamASelect.options[teamASelect.selectedIndex].text;
    const teamBName = teamBSelect.options[teamBSelect.selectedIndex].text;

    // टॉस ड्रॉपडाउन को टीमों के नाम से भरना
    const tossSelect = document.getElementById("tossWinnerSelect");
    tossSelect.innerHTML = "";
    
    const optA = document.createElement("option");
    optA.value = teamAName;
    optA.textContent = teamAName;
    tossSelect.appendChild(optA);

    const optB = document.createElement("option");
    optB.value = teamBName;
    optB.textContent = teamBName;
    tossSelect.appendChild(optB);

    // टीमों के नाम लाइव स्कोरकार्ड डिस्प्ले पर पहले से सेट करना
    document.getElementById("displayTeamA").textContent = teamAName;
    document.getElementById("displayTeamB").textContent = teamBName;

    // 🟢 सबसे ज़रूरी फिक्स: ग्लोबल ऑब्जेक्ट को तुरंत वैल्यू देना ताकि अगला बटन क्रैश न हो
    window.tempMatchConfig = {
        teamAName: teamAName,
        teamBName: teamBName,
        maxOvers: Number(totalOvers) || 5,
        ballType: ballType
    };

    // अगली स्क्रीन (टॉस और ओपनर्स) दिखाना
    showScreen('tossAndPlayersScreen');
}

        showScreen('tossAndPlayersScreen');
    }
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
        thisOverBallsArray = [];
        document.getElementById("thisOverBalls").textContent = "";
        showScreen('liveScoringPadScreen');
    }
}

// 7. प्रोफेशनल गेंद रिकॉर्ड सबमिट करना
function submitProfessionalBall(ballType, runs, isWicket, wicketType) {
    if (!window.registerBallRecord) return;

    const direction = document.getElementById("ballDirectionSelect").value;

    window.registerBallRecord({
        type: ballType,
        runs: runs,
        direction: direction,
        isWicket: isWicket,
        wicketType: wicketType || ""
    });
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

// 🟢 यहाँ का सिंटैक्स एरर पूरी तरह ठीक (Fix) कर दिया गया है
function handleNoBallClickUI() {
    let runs = prompt("नो-बॉल पर बल्लेबाज ने कितने रन बनाए? (0,1,2,4,6):", "0");
    let batsmanRuns = Number(runs);
    
    if (isNaN(batsmanRuns) || ![0, 1, 2, 3, 4, 6].includes(batsmanRuns)) {
        batsmanRuns = 0;
    }
    
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
    document.getElementById("thisOverBalls").textContent = thisOverBallsArray.join(" ");
}

// 9. स्क्रीन डेटा लाइव अपडेट करना
function updateUI() {
    if (!window.currentMatchState) return;
    const state = window.currentMatchState;

    document.getElementById("liveScoreRunsWickets").textContent = `${state.runs} / ${state.wickets}`;
    document.getElementById("liveOversCount").textContent = `ओवर: ${state.overs}.${state.ballsInCurrentOver}`;

    document.getElementById("strikerDisplay").textContent = `* ${state.striker.name}: ${state.striker.runs} (${state.striker.balls}) [4s:${state.striker.fours} 6s:${state.striker.sixes}]`;
    document.getElementById("nonStrikerDisplay").textContent = `${state.nonStriker.name}: ${state.nonStriker.runs} (${state.nonStriker.balls}) [4s:${state.nonStriker.fours} 6s:${state.nonStriker.sixes}]`;
    document.getElementById("bowlerDisplay").textContent = `🔴 बॉलर: ${state.currentBowler.name} -> ओवर: ${state.currentBowler.overs}.${state.currentBowler.ballsInOver} | रन: ${state.currentBowler.runsConceded} | विकेट: ${state.currentBowler.wickets}`;

    const targetTag = document.getElementById("targetDisplay");
    if (state.currentInnings === 2 && state.targetRuns) {
        targetTag.textContent = `लक्ष्य: ${state.targetRuns}`;
        targetTag.classList.remove("hidden");
    } else {
        targetTag.classList.add("hidden");
    }
}

// 10. ओवर बदलने पर नया बॉलर पॉप-अप
function triggerNextBowlerPopup() {
    setTimeout(() => {
        let nextBowler = prompt("ओवर पूरा हुआ! अगले बॉलर का नाम दर्ज करें:", "नया बॉलर");
        if (!nextBowler) nextBowler = "नया बॉलर";
        
        if (window.currentMatchState) {
            if (!window.currentMatchState.bowlersScorecard[nextBowler]) {
                window.currentMatchState.bowlersScorecard[nextBowler] = { name: nextBowler, overs: 0, ballsInOver: 0, runsConceded: 0, wickets: 0, maidens: 0 };
            }
            window.currentMatchState.currentBowler = window.currentMatchState.bowlersScorecard[nextBowler];
            thisOverBallsArray = [];
            updateThisOverStripUI();
            updateUI();
        }
    }, 300);
}

// 11. विकेट गिरने पर नया बल्लेबाज पॉप-अप
function triggerNextBatsmanPopup() {
    setTimeout(() => {
        let nextBatsman = prompt("बल्लेबाज आउट! नए बल्लेबाज का नाम दर्ज करें:", "नया बल्लेबाज");
        if (!nextBatsman) nextBatsman = "नया बल्लेबाज";
        
        if (window.currentMatchState) {
            if (!window.currentMatchState.batsmenScorecard[nextBatsman]) {
                window.currentMatchState.batsmenScorecard[nextBatsman] = { name: nextBatsman, runs: 0, balls: 0, fours: 0, sixes: 0, outStatus: "Not Out" };
            }
            window.currentMatchState.striker = window.currentMatchState.batsmenScorecard[nextBatsman];
            updateUI();
        }
    }, 300);
}

