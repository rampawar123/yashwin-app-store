// ==========================================
// क्रिक युवा (Cric Yuva) - मुख्य स्कोरिंग इंजन
// फ़ाइल का नाम: phase-engine.js
// ==========================================

// मैच की लाइव स्थिति (State) को सुरक्षित रखने के लिए मुख्य ऑब्जेक्ट
let currentMatchState = {
    runs: 0,
    wickets: 0,
    balls: 0, // इस ओवर में फेंकी गई वैध गेंदें (0 से 5)
    overs: 0, // पूरे हो चुके ओवर
    striker: { name: "", runs: 0, balls: 0, fours: 0, sixes: 0 },
    nonStriker: { name: "", runs: 0, balls: 0, fours: 0, sixes: 0 },
    bowler: { name: "", overs: 0, xmlBalls: 0, runsConceded: 0, wickets: 0 }
};

// 1. मैच शुरू करने और ओपनर्स सेट करने का फंक्शन
function startMatchEngine(strikerName, nonStrikerName, bowlerName) {
    currentMatchState.runs = 0;
    currentMatchState.wickets = 0;
    currentMatchState.balls = 0;
    currentMatchState.overs = 0;

    // बल्लेबाज सेट करें
    currentMatchState.striker = { name: strikerName, runs: 0, balls: 0, fours: 0, sixes: 0 };
    currentMatchState.nonStriker = { name: nonStrikerName, runs: 0, balls: 0, fours: 0, sixes: 0 };
    
    // बॉलर सेट करें
    currentMatchState.bowler = { name: bowlerName, overs: 0, xmlBalls: 0, runsConceded: 0, wickets: 0 };

    console.log("मैच इंजन शुरू हुआ! ओपनर्स सेट कर दिए गए हैं।");
    if (typeof updateUI === "function") updateUI(); 
}

// 2. बल्लेबाजों की स्ट्राइक आपस में बदलने (Strike Rotation) का लॉजिक
function swapBatsmenStrike() {
    let temp = currentMatchState.striker;
    currentMatchState.striker = currentMatchState.nonStriker;
    currentMatchState.nonStriker = temp;
    console.log(`स्ट्राइक बदली! अब स्ट्राइक पर है: ${currentMatchState.striker.name}`);
}

// 3. सामान्य रन (0, 1, 2, 3, 4, 6) लेने पर स्कोर अपडेट करने का लॉजिक
function addNormalRuns(runValue) {
    currentMatchState.runs += runValue;
    currentMatchState.bowler.runsConceded += runValue;

    // स्ट्राइक वाले बल्लेबाज के रन और गेंदें बढ़ाएं
    currentMatchState.striker.runs += runValue;
    currentMatchState.striker.balls += 1;

    // चौके या छक्के का हिसाब रखें
    if (runValue === 4) currentMatchState.striker.fours += 1;
    if (runValue === 6) currentMatchState.striker.sixes += 1;

    // वैध गेंद की गिनती बढ़ाएं
    currentMatchState.balls += 1;
    currentMatchState.bowler.xmlBalls += 1;

    // 1 या 3 रन पर स्ट्राइक बदलें
    if (runValue === 1 || runValue === 3) {
        swapBatsmenStrike();
    }

    // ओवर खत्म होने की जांच करें
    checkOverCompletion();
}

// 4. ओवर खत्म होने की जांच करने का लॉजिक (हर 6 वैध गेंदों बाद)
function checkOverCompletion() {
    if (currentMatchState.bowler.xmlBalls === 6) {
        currentMatchState.overs += 1;
        currentMatchState.balls = 0; // नए ओवर के लिए गेंदें फिर से 0 करें
        currentMatchState.bowler.overs += 1;
        currentMatchState.bowler.xmlBalls = 0; // बॉलर का ओवर पूरा हुआ

        console.log(`ओवर नंबर ${currentMatchState.overs} पूरा हुआ!`);
        
        // ओवर खत्म होने पर बल्लेबाज स्ट्राइक बदलते हैं
        swapBatsmenStrike();
        
        // स्क्रिप्ट को बताएंगे कि नया बॉलर चुनने का पॉप-अप दिखाएं
        if (typeof triggerNextBowlerPopup === "function") triggerNextBowlerPopup();
    }
    if (typeof updateUI === "function") updateUI();
}

// 5. वाइड बॉल (Wide Ball) होने पर स्कोर अपडेट करने का लॉजिक
function addWideBall() {
    currentMatchState.runs += 1;
    currentMatchState.bowler.runsConceded += 1;
    console.log("वाइड बॉल! टीम को 1 रन मिला। गेंद दोबारा फेंकी जाएगी।");
    if (typeof updateUI === "function") updateUI();
}

// 6. नो-बॉल (No Ball) होने पर स्कोर अपडेट करने का लॉजिक
function addNoBall(runsFromBatsman) {
    let totalNoBallRuns = 1 + runsFromBatsman;
    currentMatchState.runs += totalNoBallRuns;
    currentMatchState.bowler.runsConceded += totalNoBallRuns;
    
    currentMatchState.striker.runs += runsFromBatsman;
    currentMatchState.striker.balls += 1; // नो-बॉल पर बल्लेबाज की गेंद गिनी जाती है
    
    if (runsFromBatsman === 4) currentMatchState.striker.fours += 1;
    if (runsFromBatsman === 6) currentMatchState.striker.sixes += 1;
    
    if (runsFromBatsman === 1 || runsFromBatsman === 3) {
        swapBatsmenStrike();
    }
    
    console.log(`नो-बॉल! टीम को कुल ${totalNoBallRuns} रन मिले। अगली गेंद फ्री-हिट होगी।`);
    if (typeof updateUI === "function") updateUI();
}

// 7. विकेट गिरने (Wicket) का लॉजिक
function addWicketLogic(wicketType) {
    currentMatchState.wickets += 1;
    
    // रन-आउट के अलावा बाकी विकेट बॉलर के खाते में जाते हैं
    if (wicketType !== "Run Out") {
        currentMatchState.bowler.wickets += 1;
    }
    
    currentMatchState.balls += 1;
    currentMatchState.bowler.xmlBalls += 1;
    currentMatchState.striker.balls += 1;

    console.log(`विकेट गिरा! आउट का प्रकार: ${wicketType}. बल्लेबाज आउट हुआ: ${currentMatchState.striker.name}`);
    
    if (currentMatchState.bowler.xmlBalls === 6) {
        checkOverCompletion();
    } else {
        if (typeof triggerNextBatsmanPopup === "function") triggerNextBatsmanPopup();
    }
    if (typeof updateUI === "function") updateUI();
}

// 8. नए बल्लेबाज को सेट करने का लॉजिक (आउट होने के बाद)
function setNewBatsmanOffline(newPlayerName) {
    currentMatchState.striker = { name: newPlayerName, runs: 0, balls: 0, fours: 0, sixes: 0 };
    console.log(`नए बल्लेबाज मैदान पर आए: ${newPlayerName}`);
    if (typeof updateUI === "function") updateUI();
}

// ग्लोबल विंडो ऑब्जेक्ट में सेट करना ताकि दूसरी फाइलें इसे इस्तेमाल कर सकें
if (typeof window !== "undefined") {
    window.currentMatchState = currentMatchState;
    window.startMatchEngine = startMatchEngine;
    window.addNormalRuns = addNormalRuns;
    window.addWideBall = addWideBall;
    window.addNoBall = addNoBall;
    window.addWicketLogic = addWicketLogic;
    window.setNewBatsmanOffline = setNewBatsmanOffline;
}
