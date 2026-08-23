/* =========================
   CRIC YUVA - MAIN SCRIPT
========================= */


/* =========================
   PAGE SYSTEM
========================= */

let currentPage = "home";
let pageHistory = ["home"];


function openPage(pageName){

  const selectedPage =
    document.getElementById(pageName);

  if(!selectedPage){
    console.log("Page not found:", pageName);
    return;
  }

  document
    .querySelectorAll(".page")
    .forEach(function(page){

      page.classList.remove("active");

    });

  selectedPage.classList.add("active");


  if(currentPage !== pageName){
    pageHistory.push(pageName);
  }

  currentPage = pageName;

  updateNavigation(pageName);

  closeDrawer();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}


/* =========================
   HOME
========================= */

function openHome(){

  pageHistory = ["home"];
  currentPage = "home";

  document
    .querySelectorAll(".page")
    .forEach(function(page){

      page.classList.remove("active");

    });

  const home =
    document.getElementById("home");

  if(home){
    home.classList.add("active");
  }

  updateNavigation("home");

  closeDrawer();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}


/* =========================
   BACK BUTTON
========================= */

function goBack(){

  if(pageHistory.length > 1){

    pageHistory.pop();

    const previousPage =
      pageHistory[
        pageHistory.length - 1
      ];

    document
      .querySelectorAll(".page")
      .forEach(function(page){

        page.classList.remove("active");

      });

    const previous =
      document.getElementById(previousPage);

    if(previous){

      previous.classList.add("active");

      currentPage = previousPage;

      updateNavigation(previousPage);

      closeDrawer();

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });

    }

  }else{

    openHome();

  }

}


/* =========================
   BOTTOM NAVIGATION
========================= */

function updateNavigation(pageName){

  document
    .querySelectorAll(".navBtn")
    .forEach(function(button){

      button.classList.remove("active");

    });

  const activeButton =
    document.querySelector(
      '.navBtn[data-page="' +
      pageName +
      '"]'
    );

  if(activeButton){

    activeButton.classList.add("active");

  }

}


/* =========================
   DRAWER
========================= */

function openDrawer(){

  const drawer =
    document.getElementById("drawer");

  const shade =
    document.getElementById("drawerShade");

  if(drawer){
    drawer.classList.add("open");
  }

  if(shade){
    shade.classList.add("open");
  }

}


function closeDrawer(){

  const drawer =
    document.getElementById("drawer");

  const shade =
    document.getElementById("drawerShade");

  if(drawer){
    drawer.classList.remove("open");
  }

  if(shade){
    shade.classList.remove("open");
  }

}


function drawerPage(pageName){

  closeDrawer();

  openPage(pageName);

}


/* =========================
   SAFE HTML
========================= */

function escapeHTML(value){

  const div =
    document.createElement("div");

  div.textContent =
    String(value || "");

  return div.innerHTML;

}


/* =========================
   TEAMS
========================= */

function getTeams(){

  let teams = [];

  try{

    teams = JSON.parse(
      localStorage.getItem("CY_TEAMS") || "[]"
    );

  }catch(error){

    teams = [];

  }


  if(
    !Array.isArray(teams) ||
    teams.length < 2
  ){

    teams = [

      {
        id: "team-a",
        name: "CRIC YUVA WARRIORS"
      },

      {
        id: "team-b",
        name: "CRIC YUVA KINGS"
      }

    ];

  }

  return teams;

}


/* =========================
   MATCH STORAGE
========================= */

function getMatches(){

  try{

    const matches = JSON.parse(
      localStorage.getItem(
        "CY_SINGLE_MATCHES"
      ) || "[]"
    );

    return Array.isArray(matches)
      ? matches
      : [];

  }catch(error){

    return [];

  }

}


function saveMatches(matches){

  localStorage.setItem(
    "CY_SINGLE_MATCHES",
    JSON.stringify(matches)
  );

}


/* =========================
   CREATE MATCH
========================= */

function createSingleMatch(){

  const box =
    document.getElementById("singleMatch");

  if(!box) return;


  box.innerHTML = `

    <button
      class="backBtn"
      onclick="openSingleMatchMenu()"
    >
      ← Back
    </button>

    <h2 class="createMatchTitle">
      🏏 Create Match
    </h2>


    <div class="teamWrap">

      <div class="teamBox">

        <div class="teamLabel">
          TEAM A
        </div>

        <div class="teamLogo">
          🏏
        </div>

        <div
          class="teamName"
          id="teamAName"
        >
          Select Team A
        </div>

        <select
          id="teamASelect"
          onchange="updateTeamNames()"
        >
          <option value="">
            Select Team A
          </option>
        </select>

      </div>


      <div class="vsBox">
        VS
      </div>


      <div class="teamBox">

        <div class="teamLabel">
          TEAM B
        </div>

        <div class="teamLogo">
          🏏
        </div>

        <div
          class="teamName"
          id="teamBName"
        >
          Select Team B
        </div>

        <select
          id="teamBSelect"
          onchange="updateTeamNames()"
        >
          <option value="">
            Select Team B
          </option>
        </select>

      </div>

    </div>


    <div class="modernMatchCard">

      <h3>
        📋 Match Details
      </h3>


      <label>
        🏏 Match Overs
      </label>

      <select id="matchOvers">

        <option value="">
          Select Overs
        </option>

        <option value="1">1 Over</option>
        <option value="2">2 Overs</option>
        <option value="3">3 Overs</option>
        <option value="4">4 Overs</option>
        <option value="5">5 Overs</option>
        <option value="6">6 Overs</option>
        <option value="8">8 Overs</option>
        <option value="10">10 Overs</option>
        <option value="12">12 Overs</option>
        <option value="15">15 Overs</option>
        <option value="20">20 Overs</option>
        <option value="50">50 Overs</option>

      </select>


      <label>
        📅 Match Date
      </label>

      <input
        type="date"
        id="matchDate"
      >


      <label>
        📍 Ground Name
      </label>

      <input
        type="text"
        id="groundName"
        placeholder="Enter Ground Name"
      >


      <div class="matchNote">

        ℹ️ Toss aur Playing XI
        Start Match ke baad select karenge.

      </div>


      <button
        class="createMatchBtn"
        onclick="saveSingleMatch()"
      >
        🏆 CREATE MATCH
      </button>

    </div>

  `;


  loadMatchTeams();

}


/* =========================
   LOAD TEAMS
========================= */

function loadMatchTeams(){

  const teamASelect =
    document.getElementById("teamASelect");

  const teamBSelect =
    document.getElementById("teamBSelect");


  if(
    !teamASelect ||
    !teamBSelect
  ){
    return;
  }


  const teams = getTeams();


  teams.forEach(function(team, index){

    const id =
      team.id || String(index);

    const name =
      team.name ||
      team.teamName ||
      "Team " + (index + 1);


    const optionA =
      document.createElement("option");

    optionA.value = id;
    optionA.textContent = name;


    const optionB =
      document.createElement("option");

    optionB.value = id;
    optionB.textContent = name;


    teamASelect.appendChild(optionA);

    teamBSelect.appendChild(optionB);

  });

}


function updateTeamNames(){

  const teams = getTeams();


  const teamASelect =
    document.getElementById("teamASelect");

  const teamBSelect =
    document.getElementById("teamBSelect");

  const teamAName =
    document.getElementById("teamAName");

  const teamBName =
    document.getElementById("teamBName");


  if(
    !teamASelect ||
    !teamBSelect ||
    !teamAName ||
    !teamBName
  ){
    return;
  }


  const teamA =
    teams.find(function(team){

      return (
        String(team.id) ===
        String(teamASelect.value)
      );

    });


  const teamB =
    teams.find(function(team){

      return (
        String(team.id) ===
        String(teamBSelect.value)
      );

    });


  teamAName.textContent =
    teamA
      ? (teamA.name || teamA.teamName)
      : "Select Team A";


  teamBName.textContent =
    teamB
      ? (teamB.name || teamB.teamName)
      : "Select Team B";

}


/* =========================
   SAVE MATCH
========================= */

function saveSingleMatch(){

  const teamAId =
    document.getElementById(
      "teamASelect"
    ).value;

  const teamBId =
    document.getElementById(
      "teamBSelect"
    ).value;

  const overs =
    document.getElementById(
      "matchOvers"
    ).value;

  const date =
    document.getElementById(
      "matchDate"
    ).value;

  const ground =
    document.getElementById(
      "groundName"
    ).value.trim();


  if(!teamAId || !teamBId){

    alert(
      "Please select Team A and Team B"
    );

    return;

  }


  if(teamAId === teamBId){

    alert(
      "Team A and Team B cannot be the same"
    );

    return;

  }


  if(!overs){

    alert(
      "Please select match overs"
    );

    return;

  }


  if(!date){

    alert(
      "Please select match date"
    );

    return;

  }


  if(!ground){

    alert(
      "Please enter ground name"
    );

    return;

  }


  const teams = getTeams();


  const teamA =
    teams.find(function(team){

      return (
        String(team.id) ===
        String(teamAId)
      );

    });


  const teamB =
    teams.find(function(team){

      return (
        String(team.id) ===
        String(teamBId)
      );

    });


  const match = {

    id: Date.now(),

    teamA:
      teamA
        ? (teamA.name || teamA.teamName)
        : "Team A",

    teamB:
      teamB
        ? (teamB.name || teamB.teamName)
        : "Team B",

    overs: Number(overs),

    date: date,

    ground: ground,

    status: "upcoming",

    createdAt:
      new Date().toISOString()

  };


  const matches = getMatches();

  matches.push(match);

  saveMatches(matches);


  alert(
    "🏆 Match Created Successfully!"
  );


  updateHomeMatch();

  startSingleMatch();

}


/* =========================
   START MATCH
========================= */

function startSingleMatch(){

  const matches = getMatches();


  if(!matches.length){

    alert(
      "Pehle Create Match se match banao."
    );

    return;

  }


  const match =
    matches.find(function(item){

      return item.status === "upcoming";

    })
    || matches[0];


  const box =
    document.getElementById("singleMatch");

  if(!box) return;


  box.innerHTML = `

    <button
      class="backBtn"
      onclick="openSingleMatchMenu()"
    >
      ← Back
    </button>

    <h2 class="createMatchTitle">
      ☀️ Match Ready
    </h2>


    <div class="sunnyMatchCard">

      <div class="cloud"></div>

      <div class="liveRibbon">
        <span class="liveDot"></span>
        READY TO START
      </div>

      <div class="stadium">
        <div class="stand"></div>
      </div>

      <div class="pitch"></div>

      <div class="pitchStrip"></div>

      <div class="player a"></div>
      <div class="player b"></div>
      <div class="player c"></div>
      <div class="player d"></div>
      <div class="player e"></div>
      <div class="player f"></div>
      <div class="player g"></div>


      <div class="scoreOverlay">

        <div class="matchTeamsRow">

          <div class="previewTeam">

            <div class="previewTeamName">
              ${escapeHTML(match.teamA)}
            </div>

            <div class="previewScore">
              0/0
            </div>

          </div>


          <div class="previewVS">
            VS
          </div>


          <div class="previewTeam">

            <div class="previewTeamName">
              ${escapeHTML(match.teamB)}
            </div>

            <div class="previewScore">
              0.0
            </div>

          </div>

        </div>


        <div class="previewStatus">

          <span>
            🏏 ${match.overs} Overs
          </span>

          <span>
            📍 ${escapeHTML(match.ground)}
          </span>

        </div>

      </div>

    </div>


    <div class="modernMatchCard">

      <h3>
        🏆 ${escapeHTML(match.teamA)}
        🆚
        ${escapeHTML(match.teamB)}
      </h3>


      <div class="matchNote">

        ☀️ Day Match

        <br><br>

        🏏 ${match.overs} Overs

        <br><br>

        📅 ${escapeHTML(match.date)}

        <br><br>

        📍 ${escapeHTML(match.ground)}

      </div>


      <button
        class="createMatchBtn"
        onclick="beginMatch('${match.id}')"
      >
        ▶ START MATCH
      </button>

    </div>

  `;

}


/* =========================
   BEGIN MATCH
========================= */

function beginMatch(matchId){

  const matches = getMatches();


  const match =
    matches.find(function(item){

      return (
        String(item.id) ===
        String(matchId)
      );

    });


  if(!match){

    alert("Match nahi mila.");

    return;

  }


  match.status = "live";

  saveMatches(matches);


  const scoreKey =
    "CY_LIVE_SCORE_" + match.id;


  const existingScore =
    localStorage.getItem(scoreKey);


  if(!existingScore){

    const newScore = {

      matchId: match.id,

      teamA: match.teamA,

      teamB: match.teamB,

      maxOvers:
        Number(match.overs) || 20,

      runs: 0,

      wickets: 0,

      totalBalls: 0,

      striker: "Batsman 1",

      nonStriker: "Batsman 2",

      selectedDirection: "Straight",

      commentary: [
        "🏏 Match started! First ball coming up."
      ],

      inningsComplete: false

    };


    localStorage.setItem(
      scoreKey,
      JSON.stringify(newScore)
    );

  }


  updateHomeMatch();

  showScorecards();

}


/* =========================
   LIVE MATCH DATA
========================= */

function getLiveMatchAndScore(){

  const matches = getMatches();


  const match =
    matches.find(function(item){

      return item.status === "live";

    });


  if(!match){

    return null;

  }


  const key =
    "CY_LIVE_SCORE_" + match.id;


  let score = null;


  try{

    const saved =
      localStorage.getItem(key);

    score =
      saved
        ? JSON.parse(saved)
        : null;

  }catch(error){

    score = null;

  }


  return {

    match: match,

    key: key,

    score: score

  };

}


function saveLiveScore(key, score){

  localStorage.setItem(
    key,
    JSON.stringify(score)
  );

}


/* =========================
   SCORE HELPERS
========================= */

function getCurrentOver(score){

  if(!score){

    return "0.0";

  }


  const overs =
    Math.floor(
      Number(score.totalBalls || 0) / 6
    );

  const balls =
    Number(score.totalBalls || 0) % 6;


  return overs + "." + balls;

}


function getRunRate(score){

  if(
    !score ||
    !score.totalBalls
  ){

    return "0.00";

  }


  const overs =
    Number(score.totalBalls) / 6;


  return (
    Number(score.runs || 0) / overs
  ).toFixed(2);

}


function getBallsRemaining(score){

  if(!score){

    return 0;

  }


  const maxBalls =
    Number(score.maxOvers || 0) * 6;

  const playedBalls =
    Number(score.totalBalls || 0);


  return Math.max(
    0,
    maxBalls - playedBalls
  );

}


function getRequiredRuns(match, score){

  if(
    !match ||
    !score ||
    !score.target
  ){

    return null;

  }


  const required =
    Number(score.target) -
    Number(score.runs || 0);


  return required > 0
    ? required
    : 0;

}


function ballNumberText(score){

  const totalBalls =
    Number(score.totalBalls || 0);

  if(totalBalls <= 0){
    return "0.0";
  }


  const over =
    Math.floor(
      (totalBalls - 1) / 6
    ) + 1;


  const ball =
    ((totalBalls - 1) % 6) + 1;


  return over + "." + ball;

}


function swapBatsmen(score){

  const temp = score.striker;

  score.striker =
    score.nonStriker;

  score.nonStriker =
    temp;

}


/* =========================
   LIVE SCORE SCREEN
========================= */

function showScorecards(){

  const live =
    getLiveMatchAndScore();


  if(
    !live ||
    !live.match ||
    !live.score
  ){

    alert(
      "Koi live match ya score nahi mila. Start Match se match start karo."
    );

    return;

  }


  renderScoreScreen();

}


function renderScoreScreen(){

  const live =
    getLiveMatchAndScore();


  if(
    !live ||
    !live.match ||
    !live.score
  ){
    return;
  }


  const match = live.match;
  const score = live.score;


  const scoreText =
    Number(score.runs || 0)
    + "/"
    + Number(score.wickets || 0);


  const runRate =
    getRunRate(score);

  const ballsRemaining =
    getBallsRemaining(score);

  const requiredRuns =
    getRequiredRuns(match, score);

  const overText =
    getCurrentOver(score);


  const requiredText =
    requiredRuns === null
      ? "First innings"
      : (
          requiredRuns > 0
            ? requiredRuns + " runs needed"
            : "Target achieved"
        );


  const ballsText =
    ballsRemaining +
    " balls remaining";


  const commentary =
    Array.isArray(score.commentary)
      ? score.commentary
      : [];


  const commentaryHTML =
    commentary.length

      ? commentary
          .slice()
          .reverse()
          .slice(0, 10)
          .map(function(item){

            return `

              <div class="matchNote">
                🎙️ ${escapeHTML(item)}
              </div>

            `;

          })
          .join("")

      : `

          <div class="matchNote">
            🎙️ Commentary will appear here.
          </div>

        `;


  const box =
    document.getElementById("singleMatch");

  if(!box) return;


  box.innerHTML = `

    <button
      class="backBtn"
      onclick="openSingleMatchMenu()"
    >
      ← Back
    </button>


    <h2 class="createMatchTitle">
      🔴 Live Match
    </h2>


    <div class="liveScoreHeader">

      <div class="liveScoreTeams">

        ${escapeHTML(score.teamA)}

        🆚

        ${escapeHTML(score.teamB)}

      </div>


      <div class="bigScore">
        ${scoreText}
      </div>


      <div class="overText">
        Overs: ${overText}
        / ${score.maxOvers}
      </div>


      <div class="matchNote">

        📈 Run Rate:
        <b>${runRate}</b>

        <br>

        ⏳ ${ballsText}

        <br>

        🎯 ${requiredText}

      </div>


      <div class="liveInfoGrid">

        <div class="infoMini">

          STRIKER

          <b>
            ${escapeHTML(score.striker)}
          </b>

        </div>


        <div class="infoMini">

          NON-STRIKER

          <b>
            ${escapeHTML(score.nonStriker)}
          </b>

        </div>

      </div>

    </div>


    <div class="modernMatchCard">

      <h3>
        🎯 Shot Direction
      </h3>


      <div class="directionGrid">

        ${directionButton("Cover", score)}

        ${directionButton("Point", score)}

        ${directionButton("Straight", score)}

        ${directionButton("Long On", score)}

        ${directionButton("Long Off", score)}

        ${directionButton("Mid Wicket", score)}

        ${directionButton("Square Leg", score)}

        ${directionButton("Fine Leg", score)}

      </div>


      <div class="matchNote">

        🎯 Selected:

        <b>
          ${escapeHTML(
            score.selectedDirection
          )}
        </b>

      </div>

    </div>


    <div class="modernMatchCard">

      <h3>
        🏏 Ball Result
      </h3>


      <div class="scoreButtons">

        <button
          class="runBtn"
          onclick="addBall(0)"
        >
          0
        </button>

        <button
          class="runBtn"
          onclick="addBall(1)"
        >
          1
        </button>

        <button
          class="runBtn"
          onclick="addBall(2)"
        >
          2
        </button>

        <button
          class="runBtn"
          onclick="addBall(3)"
        >
          3
        </button>

        <button
          class="runBtn boundary"
          onclick="addBall(4)"
        >
          4
        </button>

        <button
          class="runBtn six"
          onclick="addBall(6)"
        >
          6
        </button>

      </div>


      <div class="extraButtons">

        <button
          class="extraBtn wideBtn"
          onclick="addWide()"
        >
          ⚠️ WD
        </button>

        <button
          class="extraBtn noBallBtn"
          onclick="addNoBall()"
        >
          ⚠️ NB
        </button>

        <button
          class="extraBtn byeBtn"
          onclick="addBye(1)"
        >
          BYE
        </button>

        <button
          class="extraBtn legByeBtn"
          onclick="addLegBye(1)"
        >
          LB
        </button>

        <button
          class="extraBtn wicket"
          onclick="addWicket()"
        >
          🏏 OUT
        </button>

        <button
          class="extraBtn undoBtn"
          onclick="undoLastBall()"
        >
          ↩️ UNDO
        </button>

      </div>

    </div>


    <div class="modernMatchCard">

      <h3>
        🎙️ Live Commentary
      </h3>

      ${commentaryHTML}

    </div>

  `;

}


/* =========================
   DIRECTION
========================= */

function directionButton(direction, score){

  const active =
    score.selectedDirection === direction
      ? "active"
      : "";


  return `

    <button
      class="directionBtn ${active}"
      onclick="selectShotDirection('${direction}')"
    >
      🏏 ${direction}
    </button>

  `;

}


function selectShotDirection(direction){

  const live =
    getLiveMatchAndScore();


  if(
    !live ||
    !live.score
  ){
    return;
  }


  live.score.selectedDirection =
    direction;


  saveLiveScore(
    live.key,
    live.score
  );


  renderScoreScreen();

}


/* =========================
   ADD BALL
========================= */

function canPlayBall(score){

  if(score.inningsComplete){

    alert(
      "Innings already completed."
    );

    return false;

  }


  if(
    Math.floor(
      Number(score.totalBalls || 0) / 6
    ) >= Number(score.maxOvers || 0)
  ){

    alert(
      "Match overs completed."
    );

    return false;

  }


  if(
    Number(score.wickets || 0) >= 10
  ){

    alert(
      "All wickets completed."
    );

    return false;

  }


  return true;

}


function addBall(runs){

  const live =
    getLiveMatchAndScore();


  if(
    !live ||
    !live.score
  ){
    return;
  }


  const score = live.score;


  if(!canPlayBall(score)){
    return;
  }


  const direction =
    score.selectedDirection ||
    "Straight";


  score.runs =
    Number(score.runs || 0)
    + Number(runs);


  score.totalBalls =
    Number(score.totalBalls || 0)
    + 1;


  let text = "";


  if(runs === 0){

    text =
      direction +
      " ki taraf shot, dot ball.";

  }else if(runs === 1){

    text =
      direction +
      " ki taraf shot aur 1 run.";

    swapBatsmen(score);

  }else if(runs === 2){

    text =
      direction +
      " ki taraf 2 runs.";

  }else if(runs === 3){

    text =
      direction +
      " ki taraf shandaar 3 runs.";

    swapBatsmen(score);

  }else if(runs === 4){

    text =
      "🔥 " +
      direction +
      " ki taraf FOUR!";

  }else if(runs === 6){

    text =
      "🚀 " +
      direction +
      " ki taraf SIX!";

  }


  score.commentary.push(
    ballNumberText(score)
    + " — "
    + text
  );


  handleOverComplete(score);

  checkMatchComplete(score);


  saveLiveScore(
    live.key,
    score
  );


  updateHomeMatch();

  renderScoreScreen();

}


/* =========================
   WIDE
========================= */

function addWide(){

  const live =
    getLiveMatchAndScore();


  if(
    !live ||
    !live.score
  ){
    return;
  }


  const score = live.score;


  if(!canPlayBall(score)){
    return;
  }


  score.runs =
    Number(score.runs || 0)
    + 1;


  score.commentary.push(
    "🚨 Wide ball! 1 extra run."
  );


  saveLiveScore(
    live.key,
    score
  );


  updateHomeMatch();

  renderScoreScreen();

}


/* =========================
   NO BALL
========================= */

function addNoBall(){

  const live =
    getLiveMatchAndScore();


  if(
    !live ||
    !live.score
  ){
    return;
  }


  const score = live.score;


  if(!canPlayBall(score)){
    return;
  }


  score.runs =
    Number(score.runs || 0)
    + 1;


  score.commentary.push(
    "⚠️ NO BALL! 1 extra run. Free Hit!"
  );


  saveLiveScore(
    live.key,
    score
  );


  updateHomeMatch();

  renderScoreScreen();

}


/* =========================
   WICKET
========================= */

function addWicket(){

  const live =
    getLiveMatchAndScore();


  if(
    !live ||
    !live.score
  ){
    return;
  }


  const score = live.score;


  if(!canPlayBall(score)){
    return;
  }


  score.wickets =
    Number(score.wickets || 0)
    + 1;


  score.totalBalls =
    Number(score.totalBalls || 0)
    + 1;


  score.commentary.push(
    ballNumberText(score)
    + " — 🏏 WICKET! "
    + score.striker
    + " OUT!"
  );


  score.striker =
    "Batsman " +
    (Number(score.wickets) + 2);


  handleOverComplete(score);

  checkMatchComplete(score);


  saveLiveScore(
    live.key,
    score
  );


  updateHomeMatch();

  renderScoreScreen();

}


/* =========================
   BYE
========================= */

function addBye(runs){

  if(runs === undefined){
    runs = 1;
  }


  const live =
    getLiveMatchAndScore();


  if(
    !live ||
    !live.score
  ){
    return;
  }


  const score = live.score;


  if(!canPlayBall(score)){
    return;
  }


  score.runs =
    Number(score.runs || 0)
    + Number(runs);


  score.totalBalls =
    Number(score.totalBalls || 0)
    + 1;


  score.commentary.push(
    ballNumberText(score)
    + " — 🔵 BYE +"
    + runs
    + " run"
  );


  if(Number(runs) % 2 === 1){
    swapBatsmen(score);
  }


  handleOverComplete(score);

  checkMatchComplete(score);


  saveLiveScore(
    live.key,
    score
  );


  updateHomeMatch();

  renderScoreScreen();

}


/* =========================
   LEG BYE
========================= */

function addLegBye(runs){

  if(runs === undefined){
    runs = 1;
  }


  const live =
    getLiveMatchAndScore();


  if(
    !live ||
    !live.score
  ){
    return;
  }


  const score = live.score;


  if(!canPlayBall(score)){
    return;
  }


  score.runs =
    Number(score.runs || 0)
    + Number(runs);


  score.totalBalls =
    Number(score.totalBalls || 0)
    + 1;


  score.commentary.push(
    ballNumberText(score)
    + " — 🟢 LEG BYE +"
    + runs
    + " run"
  );


  if(Number(runs) % 2 === 1){
    swapBatsmen(score);
  }


  handleOverComplete(score);

  checkMatchComplete(score);


  saveLiveScore(
    live.key,
    score
  );


  updateHomeMatch();

  renderScoreScreen();

}


/* =========================
   OVER COMPLETE
========================= */

function handleOverComplete(score){

  if(
    Number(score.totalBalls || 0) > 0 &&
    Number(score.totalBalls || 0) % 6 === 0
  ){

    score.commentary.push(
      "🔔 OVER COMPLETE! Score: "
      + score.runs
      + "/"
      + score.wickets
    );

    swapBatsmen(score);

  }

}


/* =========================
   MATCH COMPLETE
========================= */

function checkMatchComplete(score){

  const completedOvers =
    Math.floor(
      Number(score.totalBalls || 0) / 6
    );


  if(
    completedOvers >=
      Number(score.maxOvers || 0)
    ||
    Number(score.wickets || 0) >= 10
  ){

    if(!score.inningsComplete){

      score.commentary.push(
        "🏁 Innings Complete!"
      );

      score.inningsComplete = true;

    }

  }

}


/* =========================
   UNDO
========================= */

function undoLastBall(){

  alert(
    "UNDO feature next update me full history ke saath add karenge."
  );

}


/* =========================
   HOME LIVE MATCH UPDATE
========================= */

function updateHomeMatch(){

  const matches = getMatches();


  const liveMatch =
    matches.find(function(item){

      return item.status === "live";

    });


  const upcomingMatch =
    matches.find(function(item){

      return item.status === "upcoming";

    });


  const match =
    liveMatch || upcomingMatch;


  const teamA =
    document.getElementById("homeTeamA");

  const teamB =
    document.getElementById("homeTeamB");

  const homeScore =
    document.getElementById("homeScore");

  const homeOvers =
    document.getElementById("homeOvers");

  const homeStatus =
    document.getElementById("homeStatus");

  const homeGround =
    document.getElementById("homeGround");

  const liveBox =
    document.getElementById("liveMatchesBox");

  const upcomingBox =
    document.getElementById(
      "upcomingMatchesBox"
    );


  if(!match){

    if(teamA){
      teamA.textContent = "Team A";
    }

    if(teamB){
      teamB.textContent = "Team B";
    }

    if(homeScore){
      homeScore.textContent = "0/0";
    }

    if(homeOvers){
      homeOvers.textContent = "0.0";
    }

    if(homeStatus){
      homeStatus.textContent =
        "☀️ Ready to Start";
    }

    if(homeGround){
      homeGround.textContent =
        "📍 Cricket Ground";
    }

    if(liveBox){
      liveBox.textContent =
        "No live matches right now.";
    }

    if(upcomingBox){
      upcomingBox.textContent =
        "Create a match and it will appear here.";
    }

    return;

  }


  if(teamA){
    teamA.textContent = match.teamA;
  }

  if(teamB){
    teamB.textContent = match.teamB;
  }

  if(homeGround){
    homeGround.textContent =
      "📍 " + match.ground;
  }


  if(liveMatch){

    const live =
      getLiveMatchAndScore();


    if(
      live &&
      live.score
    ){

      if(homeScore){

        homeScore.textContent =
          live.score.runs
          + "/"
          + live.score.wickets;

      }


      if(homeOvers){

        homeOvers.textContent =
          getCurrentOver(live.score);

      }

    }


    if(homeStatus){
      homeStatus.textContent =
        "🔴 LIVE NOW";
    }


    if(liveBox){

      liveBox.innerHTML =
        "🔴 "
        + escapeHTML(match.teamA)
        + " vs "
        + escapeHTML(match.teamB)
        + " is LIVE now!";

    }


    if(upcomingBox){

      upcomingBox.textContent =
        "No upcoming match selected.";

    }

  }else{

    if(homeScore){
      homeScore.textContent =
        "READY";
    }

    if(homeOvers){
      homeOvers.textContent =
        match.overs + " OV";
    }

    if(homeStatus){
      homeStatus.textContent =
        "☀️ Upcoming Match";
    }

    if(liveBox){
      liveBox.textContent =
        "No live matches right now.";
    }

    if(upcomingBox){

      upcomingBox.innerHTML =
        "📅 "
        + escapeHTML(match.teamA)
        + " vs "
        + escapeHTML(match.teamB)
        + " • "
        + escapeHTML(match.date)
        + " • "
        + escapeHTML(match.ground);

    }

  }

}


/* =========================
   OPEN CURRENT MATCH
========================= */

function openCurrentMatch(){

  const matches = getMatches();


  const live =
    matches.find(function(item){

      return item.status === "live";

    });


  if(live){

    openPage("singleMatch");

    setTimeout(function(){

      showScorecards();

    }, 100);

    return;

  }


  const upcoming =
    matches.find(function(item){

      return item.status === "upcoming";

    });


  if(upcoming){

    openPage("singleMatch");

    setTimeout(function(){

      startSingleMatch();

    }, 100);

    return;

  }


  openPage("singleMatch");

  setTimeout(function(){

    openSingleMatchMenu();

  }, 100);

}


/* =========================
   MY MATCHES
========================= */

function showMyMatches(){

  const matches = getMatches();


  const box =
    document.getElementById("singleMatch");

  if(!box) return;


  if(!matches.length){

    box.innerHTML = `

      <button
        class="backBtn"
        onclick="openSingleMatchMenu()"
      >
        ← Back
      </button>

      <h2>
        📋 My Matches
      </h2>

      <div class="emptyBox">
        No matches found.
        Create your first match.
      </div>

    `;

    return;

  }


  let html = `

    <button
      class="backBtn"
      onclick="openSingleMatchMenu()"
    >
      ← Back
    </button>

    <h2>
      📋 My Matches
    </h2>

  `;


  matches
    .slice()
    .reverse()
    .forEach(function(match){

      html += `

        <div class="pageCard">

          <b>
            ${escapeHTML(match.teamA)}
            🆚
            ${escapeHTML(match.teamB)}
          </b>

          <div class="smallText">

            🏏 ${match.overs} Overs

            <br>

            📅 ${escapeHTML(match.date)}

            <br>

            📍 ${escapeHTML(match.ground)}

            <br>

            Status:
            ${escapeHTML(match.status)}

          </div>

        </div>

      `;

    });


  box.innerHTML = html;

}


/* =========================
   SINGLE MATCH MENU
========================= */

function openSingleMatchMenu(){

  const box =
    document.getElementById("singleMatch");

  if(!box) return;


  box.innerHTML = `

    <button
      class="backBtn"
      onclick="goBack()"
    >
      ← Back
    </button>

    <h2>
      🏏 Single Match
    </h2>


    <div class="pageCard">

      <b>
        Create and manage your cricket match.
      </b>

      <div class="smallText">

        Pehle Create Match karo,
        phir Start Match se live scoring shuru karo.

      </div>

    </div>


    <div class="pageGrid">

      <button
        class="pageOption"
        onclick="createSingleMatch()"
      >
        <span>➕</span>
        Create Match
      </button>


      <button
        class="pageOption"
        onclick="showMyMatches()"
      >
        <span>📋</span>
        My Matches
      </button>


      <button
        class="pageOption"
        onclick="startSingleMatch()"
      >
        <span>▶️</span>
        Start Match
      </button>


      <button
        class="pageOption"
        onclick="showScorecards()"
      >
        <span>📊</span>
        Live Score
      </button>

    </div>

  `;

}


/* =========================
   SPLASH + INITIAL LOAD
========================= */

window.addEventListener(
  "load",
  function(){

    setTimeout(function(){

      const splash =
        document.getElementById(
          "splashScreen"
        );

      if(splash){

        splash.classList.add("hide");

        setTimeout(function(){

          splash.style.display =
            "none";

        }, 500);

      }

    }, 2200);


    updateHomeMatch();

  }
);


/* =========================
   READY
========================= */

document.addEventListener(
  "DOMContentLoaded",
  function(){

    updateHomeMatch();

  }
);
