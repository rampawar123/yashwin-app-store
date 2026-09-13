// ==========================================================================
// क्रिक युवा (Cric Yuva) - 100% प्रोफेशनल ऑफलाइन क्रिकेट स्कोरिंग इंजन
// फ़ाइल का नाम: phase-engine.js (CricHeroes Architecture)
// ==========================================================================

// पूरी तरह प्रोफेशनल मैच स्टेट ऑब्जेक्ट
let currentMatchState = {
    matchId: "",
    maxOvers: 5, // यूजर द्वारा तय किए गए कुल ओवर
    ballType: "Tennis",
    tossWinner: "",
    tossDecision: "",
    matchStatus: "Upcoming", // Upcoming, Live, Innings1_Ended, Completed
    winnerTeam: "",
    targetRuns: null, // सेकंड इनिंग्स के लिए लक्ष्य

    // दोनों टीमों के पूरे स्क्वाड (Playing 11)
    teamA: { name: "", squad: [], battedCount: 0 },
    teamB: { name: "", squad: [], battedCount: 0 },

    // लाइव इनिंग्स का डेटा
    currentInnings: 1, // 1 or 2
    battingTeam: null, 
    bowlingTeam: null,

    runs: 0,
    wickets: 0,
    ballsInCurrentOver: 0, // इस ओवर की वैध गेंदें (0 से 5)
    totalLegalBallsBowled: 0, 
    overs: 0,
    extras: { wide: 0, noBall: 0, bye: 0, legBye: 0 },

    // वर्तमान खिलाड़ी जो मैदान पर हैं
    striker: { id: "", name: "", runs: 0, balls: 0, fours: 0, sixes: 0, outStatus: "Not Out" },
    nonStriker: { id: "", name: "", runs: 0, balls: 0, fours: 0, sixes: 0, outStatus: "Not Out" },
    currentBowler: { id: "", name: "", overs: 0, ballsInOver: 0, runsConceded: 0, wickets: 0, maidens: 0 },

    // इनिंग्स की पूरी बल्लेबाजी और गेंदबाजी लिस्ट (स्कोरकार्ड के लिए)
    batsmenScorecard: {},
    bowlersScorecard: {},

    // CricHeroes की तरह वेगन व्हील और समरी के लिए बॉल-बाय-बॉल हिस्ट्री
    ballByBallHistory: []
};

// 1. प्रोफेशनल मैच शुरू करने का मास्टर फंक्शन
function startProfessionalMatch(matchConfig) {
    currentMatchState.matchId = matchConfig.matchId || "CY-" + Math.floor(Math.random() * 100000);
    currentMatchState.maxOvers = Number(matchConfig.maxOvers) || 5;
    currentMatchState.ballType = matchConfig.ballType || "Tennis";
    currentMatchState.tossWinner = matchConfig.tossWinner;
    currentMatchState.tossDecision = matchConfig.tossDecision;
    currentMatchState.matchStatus = "Live";
    currentMatchState.currentInnings = 1;

    // स्क्वाड सेट करना
    currentMatchState.teamA = { name: matchConfig.teamAName, squad: matchConfig.teamASquad, battedCount: 2 };
    currentMatchState.teamB = { name: matchConfig.teamBName, squad: matchConfig.teamBSquad, battedCount: 0 };

    // टॉस के फैसले के आधार पर बैटिंग/बॉलिंग टीम तय करना
    if (matchConfig.tossWinner === matchConfig.teamAName) {
        if (matchConfig.tossDecision === "Bat") {
            currentMatchState.battingTeam = currentMatchState.teamA;
            currentMatchState.bowlingTeam = currentMatchState.teamB;
        } else {
            currentMatchState.battingTeam = currentMatchState.teamB;
            currentMatchState.bowlingTeam = currentMatchState.teamA;
        }
    } else {
        if (matchConfig.tossDecision === "Bat") {
            currentMatchState.battingTeam = currentMatchState.teamB;
            currentMatchState.bowlingTeam = currentMatchState.teamA;
        } else {
            currentMatchState.battingTeam = currentMatchState.teamA;
            currentMatchState.bowlingTeam = currentMatchState.teamB;
        }
    }

    resetInningsState(matchConfig.strikerName, matchConfig.nonStrikerName, matchConfig.bowlerName);
    console.log("प्रोफेशनल क्रिकेट इंजन सफलतापूर्वक एक्टिवेट हुआ!");
}

// इनिंग्स रीसेट करने का आंतरिक फंक्शन
function resetInningsState(striker, nonStriker, bowler) {
    currentMatchState.runs = 0;
    currentMatchState.wickets = 0;
    currentMatchState.ballsInCurrentOver = 0;
    currentMatchState.totalLegalBallsBowled = 0;
    currentMatchState.overs = 0;
    currentMatchState.extras = { wide: 0, noBall: 0, bye: 0, legBye: 0 };
    currentMatchState.ballByBallHistory = [];

    // पहले दो बल्लेबाजों को स्कोरकार्ड में दर्ज करना
    setupBatsmanScorecard(striker);
    setupBatsmanScorecard(nonStriker);
    setupBowlerScorecard(bowler);

    currentMatchState.striker = currentMatchState.batsmenScorecard[striker];
    currentMatchState.nonStriker = currentMatchState.batsmenScorecard[nonStriker];
    currentMatchState.currentBowler = currentMatchState.bowlersScorecard[bowler];
}

function setupBatsmanScorecard(name) {
    if (!currentMatchState.batsmenScorecard[name]) {
        currentMatchState.batsmenScorecard[name] = { name: name, runs: 0, balls: 0, fours: 0, sixes: 0, outStatus: "Not Out" };
    }
}

function setupBowlerScorecard(name) {
    if (!currentMatchState.bowlersScorecard[name]) {
        currentMatchState.bowlersScorecard[name] = { name: name, overs: 0, ballsInOver: 0, runsConceded: 0, wickets: 0, maidens: 0 };
    }
}

// 2. स्ट्राइक रोटेशन लॉजिक
function swapStrike() {
    let temp = currentMatchState.striker;
    currentMatchState.striker = currentMatchState.nonStriker;
    currentMatchState.nonStriker = temp;
}

// 3. हर गेंद का रिकॉर्ड और दिशा (Direction) दर्ज करने का मुख्य फंक्शन
function registerBallRecord(ballData) {
    // ballData = { type: "Normal/Wide/NoBall/Bye/LegBye", runs: 0, direction: "Cover/MidWicket...", isWicket: false, wicketType: "" }
    
    let runsScored = Number(ballData.runs) || 0;
    let direction = ballData.direction || "Straight";
    let extraRuns = 0;
    let isLegalBall = true;

    // एक्स्ट्रास के कड़े नियम
    if (ballData.type === "Wide") {
        extraRuns = 1 + runsScored; // वाइड + बाई के रन अगर भागे हों
        currentMatchState.extras.wide += extraRuns;
        currentMatchState.runs += extraRuns;
        currentMatchState.currentBowler.runsConceded += extraRuns;
        isLegalBall = false;
    } 
    else if (ballData.type === "NoBall") {
        extraRuns = 1;
        currentMatchState.extras.noBall += 1;
        currentMatchState.runs += (extraRuns + runsScored);
        currentMatchState.currentBowler.runsConceded += (extraRuns + runsScored);
        currentMatchState.striker.runs += runsScored;
        currentMatchState.striker.balls += 1;
        if (runsScored === 4) currentMatchState.striker.fours += 1;
        if (runsScored === 6) currentMatchState.striker.sixes += 1;
        isLegalBall = false;
        if (runsScored % 2 !== 0) swapStrike();
    } 
    else if (ballData.type === "Bye" || ballData.type === "LegBye") {
        currentMatchState.runs += runsScored;
        currentMatchState.currentBowler.runsConceded += 0; // बाई/लेग-बाई के रन बॉलर को नहीं पड़ते
        if (ballData.type === "Bye") currentMatchState.extras.bye += runsScored;
        if (ballData.type === "LegBye") currentMatchState.extras.legBye += runsScored;
        currentMatchState.striker.balls += 1;
        if (runsScored % 2 !== 0) swapStrike();
    } 
    else { // Normal Legal Delivery
        currentMatchState.runs += runsScored;
        currentMatchState.currentBowler.runsConceded += runsScored;
        currentMatchState.striker.runs += runsScored;
        currentMatchState.striker.balls += 1;
        if (runsScored === 4) currentMatchState.striker.fours += 1;
        if (runsScored === 6) currentMatchState.striker.sixes += 1;
        if (runsScored % 2 !== 0) swapStrike();
    }

    // गेंद लीगल होने पर ओवर का गणित बढ़ाएं
    if (isLegalBall) {
        currentMatchState.ballsInCurrentOver += 1;
        currentMatchState.totalLegalBallsBowled += 1;
        currentMatchState.currentBowler.ballsInOver += 1;
    }

    // विकेट की जांच
    if (ballData.isWicket) {
        handleWicketEngine(ballData.wicketType);
    }

    // बॉल हिस्ट्री में सेव करें (वेगन व्हील के लिए दिशा के साथ)
    currentMatchState.ballByBallHistory.push({
        innings: currentMatchState.currentInnings,
        over: currentMatchState.overs,
        ball: currentMatchState.ballsInCurrentOver,
        batsman: currentMatchState.striker.name,
        bowler: currentMatchState.currentBowler.name,
        runs: runsScored,
        type: ballData.type,
        direction: direction,
        isWicket: ballData.isWicket
    });

    // चेस (Innings 2) के दौरान जीत की जांच
    if (currentMatchState.currentInnings === 2 && currentMatchState.runs >= currentMatchState.targetRuns) {
        endMatch(currentMatchState.battingTeam.name + " ने मैच जीत लिया!");
        return;
    }

    // ओवर खत्म होने की जांच (6 वैध गेंदें)
    if (isLegalBall && currentMatchState.ballsInCurrentOver === 6) {
        handleOverCompletion();
    }

    if (typeof updateUI === "function") window.updateUI();
}

// 4. विकेट गिरने का एडवांस इंजन
function handleWicketEngine(type) {
    currentMatchState.wickets += 1;
    currentMatchState.striker.outStatus = type; // स्कोरकार्ड में आउट का तरीका दर्ज

    if (type !== "Run Out") {
        currentMatchState.currentBowler.wickets += 1;
    }

    // जांचें कि क्या पूरी टीम आउट (10 विकेट या ऑल-आउट) हो गई है
    if (currentMatchState.wickets === 10 || currentMatchState.wickets >= (currentMatchState.battingTeam.squad.length - 1)) {
        handleInningsBreak();
    } else {
        // नया बल्लेबाज चुनने का इंटरफेस ट्रिगर करें
        if (typeof triggerNextBatsmanPopup === "function") window.triggerNextBatsmanPopup();
    }
}

// 5. ओवर पूरा होने का लॉजिक
function handleOverCompletion() {
    currentMatchState.overs += 1;
    currentMatchState.ballsInCurrentOver = 0;
    
    currentMatchState.currentBowler.overs += 1;
    currentMatchState.currentBowler.ballsInOver = 0;

    // ओवर समाप्ति पर भी स्ट्राइक बदलती है
    swapStrike();

    // जांचें कि क्या तय किए गए कुल ओवर समाप्त हो गए हैं
    if (currentMatchState.overs === currentMatchState.maxOvers) {
        handleInningsBreak();
    } else {
        if (typeof triggerNextBowlerPopup === "function") window.triggerNextBowlerPopup();
    }
}

// 6. इनिंग्स खत्म होने और टारगेट सेट होने का लॉजिक
function handleInningsBreak() {
    if (currentMatchState.currentInnings === 1) {
        currentMatchState.currentInnings = 2;
