/* CRIC YUVA - CLEAN script.js | ONLY JAVASCRIPT */

"use strict";

window.addEventListener("load", function(){
  setTimeout(function(){
    const splash=document.getElementById("splashScreen");
    if(splash){
      splash.classList.add("hide");
      setTimeout(function(){ splash.style.display="none"; },500);
    }
  },2200);

  updateHomeMatch();
});

let currentPage="home";
let pageHistory=["home"];

function openPage(pageName){
  const selected=document.getElementById(pageName);

  if(!selected)return;

  document.querySelectorAll(".page").forEach(function(page){
    page.classList.remove("active");
  });

  selected.classList.add("active");

  if(currentPage!==pageName){
    pageHistory.push(pageName);
  }

  currentPage=pageName;
  updateNavigation(pageName);
  closeDrawer();

  window.scrollTo({
    top:0,
    behavior:"smooth"
  });
}

function openHome(){
  pageHistory=["home"];
  currentPage="home";

  document.querySelectorAll(".page").forEach(function(page){
    page.classList.remove("active");
  });

  const home=document.getElementById("home");

  if(home){
    home.classList.add("active");
  }

  updateNavigation("home");
}

function goBack(){
  if(pageHistory.length<=1){
    openHome();
    return;
  }

  pageHistory.pop();

  const previousPage=pageHistory[pageHistory.length-1];

  document.querySelectorAll(".page").forEach(function(page){
    page.classList.remove("active");
  });

  const previous=document.getElementById(previousPage);

  if(previous){
    previous.classList.add("active");
    currentPage=previousPage;
    updateNavigation(previousPage);
  }
}

function updateNavigation(pageName){
  document.querySelectorAll(".navBtn").forEach(function(button){
    button.classList.remove("active");
  });

  const activeButton=document.querySelector(
    '.navBtn[data-page="'+pageName+'"]'
  );

  if(activeButton){
    activeButton.classList.add("active");
  }
}

function openDrawer(){
  const drawer=document.getElementById("drawer");
  const shade=document.getElementById("drawerShade");

  if(drawer){
    drawer.classList.add("open");
  }

  if(shade){
    shade.classList.add("open");
  }
}

function closeDrawer(){
  const drawer=document.getElementById("drawer");
  const shade=document.getElementById("drawerShade");

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

function getTeams(){
  let teams=[];

  try{
    teams=JSON.parse(
      localStorage.getItem("CY_TEAMS")||"[]"
    );
  }catch(e){
    teams=[];
  }

  if(!Array.isArray(teams)||teams.length===0){
    try{
      teams=JSON.parse(
        localStorage.getItem("cricYuvaTeams")||"[]"
      );
    }catch(e){
      teams=[];
    }
  }

  return Array.isArray(teams)?teams:[];
}

function getMatches(){
  try{
    const matches=JSON.parse(
      localStorage.getItem("CY_SINGLE_MATCHES")||"[]"
    );

    return Array.isArray(matches)?matches:[];
  }catch(e){
    return [];
  }
}

function saveMatches(matches){
  localStorage.setItem(
    "CY_SINGLE_MATCHES",
    JSON.stringify(matches)
  );
}

function createSingleMatch(){
  const box=document.getElementById("singleMatch");

  if(!box)return;

  box.innerHTML=`
    <button class="backBtn" onclick="openSingleMatchMenu()">
      ← Back
    </button>

    <h2 class="createMatchTitle">🏏 Create Match</h2>

    <div class="teamWrap">

      <div class="teamBox">
        <div class="teamLabel">TEAM A</div>
        <div class="teamLogo">🏏</div>

        <div class="teamName" id="teamAName">
          Select Team A
        </div>

        <select id="teamASelect" onchange="updateTeamNames()">
          <option value="">Select Team A</option>
        </select>
      </div>

      <div class="vsBox">VS</div>

      <div class="teamBox">
        <div class="teamLabel">TEAM B</div>
        <div class="teamLogo">🏏</div>

        <div class="teamName" id="teamBName">
          Select Team B
        </div>

        <select id="teamBSelect" onchange="updateTeamNames()">
          <option value="">Select Team B</option>
        </select>
      </div>

    </div>

    <div class="modernMatchCard">

      <h3>📋 Match Details</h3>

      <label>🏏 Match Overs</label>

      <select id="matchOvers">
        <option value="">Select Overs</option>
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

      <label>📅 Match Date</label>

      <input
        type="date"
        id="matchDate"
      >

      <label>📍 Ground Name</label>

      <input
        type="text"
        id="groundName"
        placeholder="Enter Ground Name"
      >

      <div class="matchNote">
        ℹ️ Toss aur Playing XI Start Match ke baad select karenge.
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

function loadMatchTeams(){
  const a=document.getElementById("teamASelect");
  const b=document.getElementById("teamBSelect");

  if(!a||!b)return;

  a.innerHTML='<option value="">Select Team A</option>';
  b.innerHTML='<option value="">Select Team B</option>';

  getTeams().forEach(function(team,index){

    const id=team.id||String(index);
    const name=
      team.name||
      team.teamName||
      ("Team "+(index+1));

    const optionA=document.createElement("option");

    optionA.value=id;
    optionA.textContent=name;

    a.appendChild(optionA);

    const optionB=document.createElement("option");

    optionB.value=id;
    optionB.textContent=name;

    b.appendChild(optionB);
  });
}

function updateTeamNames(){
  const teams=getTeams();

  const a=document.getElementById("teamASelect");
  const b=document.getElementById("teamBSelect");

  const aName=document.getElementById("teamAName");
  const bName=document.getElementById("teamBName");

  if(!a||!b||!aName||!bName)return;

  const teamA=teams.find(function(team,index){
    return String(team.id||index)===String(a.value);
  });

  const teamB=teams.find(function(team,index){
    return String(team.id||index)===String(b.value);
  });

  if(teamA&&teamB&&String(a.value)===String(b.value)){
    alert("Team A aur Team B alag select karo.");
    b.value="";
  }

  const newTeamB=teams.find(function(team,index){
    return String(team.id||index)===String(b.value);
  });

  aName.textContent=
    teamA?
    (teamA.name||teamA.teamName||"Team A"):
    "Select Team A";

  bName.textContent=
    newTeamB?
    (newTeamB.name||newTeamB.teamName||"Team B"):
    "Select Team B";
}

function saveSingleMatch(){
  const a=document.getElementById("teamASelect");
  const b=document.getElementById("teamBSelect");

  const overs=document.getElementById("matchOvers");
  const date=document.getElementById("matchDate");
  const ground=document.getElementById("groundName");

  if(!a||!b||!overs||!date||!ground)return;

  if(!a.value||!b.value||!overs.value){
    alert("Team A, Team B aur Overs select karo.");
    return;
  }

  if(String(a.value)===String(b.value)){
    alert("Team A aur Team B alag hone chahiye.");
    return;
  }

  const teams=getTeams();

  const teamA=teams.find(function(team,index){
    return String(team.id||index)===String(a.value);
  });

  const teamB=teams.find(function(team,index){
    return String(team.id||index)===String(b.value);
  });

  if(!teamA||!teamB){
    alert("Selected team data nahi mila.");
    return;
  }

  const matches=getMatches();

  matches.push({
    id:"MATCH-"+Date.now(),
    type:"Single Match",

    teamA:a.value,
    teamB:b.value,

    teamAName:
      teamA.name||
      teamA.teamName||
      "Team A",

    teamBName:
      teamB.name||
      teamB.teamName||
      "Team B",

    overs:Number(overs.value),
    date:date.value,
    ground:ground.value.trim(),

    status:"scheduled",

    created:new Date().toLocaleDateString()
  });

  saveMatches(matches);

  alert("🏆 Match created successfully!");

  updateHomeMatch();
  openSingleMatchMenu();
}

function showMyMatches(){
  const box=document.getElementById("singleMatch");

  if(!box)return;

  const matches=getMatches();

  if(!matches.length){

    box.innerHTML=`
      <button class="backBtn" onclick="openSingleMatchMenu()">
        ← Back
      </button>

      <h2>📋 My Matches</h2>

      <div class="emptyBox">
        No matches found. Create your first match.
      </div>
    `;

    return;
  }

  let html=`
    <button class="backBtn" onclick="openSingleMatchMenu()">
      ← Back
    </button>

    <h2>📋 My Matches</h2>
  `;

  matches
    .slice()
    .reverse()
    .forEach(function(match){

      html+=`
        <div class="pageCard">

          <b>
            ${escapeHTML(match.teamAName)}
            🆚
            ${escapeHTML(match.teamBName)}
          </b>

          <div class="smallText">

            🏏 ${escapeHTML(match.overs)} Overs

            <br>

            📍 ${escapeHTML(
              match.ground||"Ground not set"
            )}

            <br>

            Status:
            ${escapeHTML(match.status||"scheduled")}

          </div>

          <button
            class="btn"
            style="margin-top:10px"
            onclick="startMatchById('${match.id}')"
          >
            ▶️ Start Match
          </button>

        </div>
      `;
    });

  box.innerHTML=html;
}

function startSingleMatch(){
  const match=
    getMatches().find(function(item){
      return item.status==="scheduled";
    })
    ||
    getMatches().find(function(item){
      return item.status==="live";
    });

  if(!match){
    alert("Pehle match create karo.");
    return;
  }

  startMatchById(match.id);
}

function startMatchById(matchId){
  const matches=getMatches();

  const match=matches.find(function(item){
    return item.id===matchId;
  });

  if(!match)return;

  match.status="live";

  saveMatches(matches);

  let score=getLiveScoreById(matchId);

  if(!score){

    score={
      matchId:matchId,

      runs:0,
      wickets:0,

      totalBalls:0,

      maxOvers:Number(match.overs||0),

      striker:"Batsman 1",
      nonStriker:"Batsman 2",

      commentary:[],
      history:[]
    };

    saveLiveScoreById(matchId,score);
  }

  renderScoreScreen(matchId);
  updateHomeMatch();
}

function getLiveScoreById(matchId){
  try{
    return JSON.parse(
      localStorage.getItem(
        "CY_LIVE_SCORE_"+matchId
      )||"null"
    );
  }catch(e){
    return null;
  }
}

function saveLiveScoreById(matchId,score){
  localStorage.setItem(
    "CY_LIVE_SCORE_"+matchId,
    JSON.stringify(score)
  );
}

function getLiveMatchAndScore(){
  const match=getMatches().find(function(item){
    return item.status==="live";
  });

  if(!match)return null;

  const score=getLiveScoreById(match.id);

  if(!score)return null;

  return {
    match:match,
    score:score
  };
}

function getCurrentOver(score){
  const balls=Number(score.totalBalls||0);

  return Math.floor(balls/6)+"."+(balls%6);
}

function renderScoreScreen(matchId){

  const box=document.getElementById("singleMatch");

  const match=getMatches().find(function(item){
    return item.id===matchId;
  });

  const score=getLiveScoreById(matchId);

  if(!box||!match||!score)return;

  const commentary=
    (score.commentary||[])
    .slice()
    .reverse();

  box.innerHTML=`

    <button
      class="backBtn"
      onclick="openSingleMatchMenu()"
    >
      ← Back
    </button>

    <h2>🔴 Live Score</h2>

    <div class="pageCard">

      <b>
        ${escapeHTML(match.teamAName)}
        🆚
        ${escapeHTML(match.teamBName)}
      </b>

      <h1>
        ${score.runs}/${score.wickets}
      </h1>

      <div class="smallText">
        Overs:
        ${getCurrentOver(score)}
        /
        ${match.overs}
      </div>

    </div>

    <div class="pageGrid">

      <button class="pageOption" onclick="addBall(0)">0</button>

      <button class="pageOption" onclick="addBall(1)">1</button>

      <button class="pageOption" onclick="addBall(2)">2</button>

      <button class="pageOption" onclick="addBall(3)">3</button>

      <button class="pageOption" onclick="addBall(4)">4</button>

      <button class="pageOption" onclick="addBall(6)">6</button>

      <button class="pageOption" onclick="addWide()">WD</button>

      <button class="pageOption" onclick="addNoBall()">NB</button>

      <button class="pageOption" onclick="addWicket()">
        WICKET
      </button>

      <button class="pageOption" onclick="undoLastBall()">
        ↩ UNDO
      </button>

    </div>

    <div class="pageCard">

      <b>🎙️ Commentary</b>

      <div class="smallText">

        ${
          commentary.length
          ?
          commentary.map(function(item){
            return "<div>"+
              escapeHTML(item)+
              "</div>";
          }).join("")
          :
          "No commentary yet."
        }

      </div>

    </div>
  `;
}

function addBall(runs){

  const live=getLiveMatchAndScore();

  if(!live)return;

  live.score.runs+=Number(runs)||0;

  live.score.totalBalls+=1;

  live.score.history.push({
    type:"ball",
    runs:Number(runs)||0
  });

  live.score.commentary.push(
    getCurrentOver(live.score)+
    " — +"+
    (Number(runs)||0)+
    " run"
  );

  afterLegalBall(live);
}

function addWide(){

  const live=getLiveMatchAndScore();

  if(!live)return;

  live.score.runs+=1;

  live.score.history.push({
    type:"wide",
    runs:1
  });

  live.score.commentary.push(
    "🚨 Wide ball! 1 extra run."
  );

  finishScoreUpdate(live);
}

function addNoBall(){

  const live=getLiveMatchAndScore();

  if(!live)return;

  live.score.runs+=1;

  live.score.history.push({
    type:"noball",
    runs:1
  });

  live.score.commentary.push(
    "⚠️ No Ball! 1 extra run."
  );

  finishScoreUpdate(live);
}

function addWicket(){

  const live=getLiveMatchAndScore();

  if(!live)return;

  if(live.score.wickets>=10)return;

  live.score.wickets+=1;

  live.score.totalBalls+=1;

  live.score.history.push({
    type:"wicket"
  });

  live.score.commentary.push(
    "🏏 WICKET!"
  );

  afterLegalBall(live);
}

function afterLegalBall(live){

  if(
    live.score.totalBalls>0 &&
    live.score.totalBalls%6===0
  ){

    live.score.commentary.push(
      "🔔 OVER COMPLETE! Score: "+
      live.score.runs+
      "/"+
      live.score.wickets
    );

    swapBatsmen(live.score);
  }

  checkMatchComplete(live);

  finishScoreUpdate(live);
}

function checkMatchComplete(live){

  const maxBalls=
    Number(
      live.match.overs||
      live.score.maxOvers||
      0
    )*6;

  if(
    live.score.totalBalls<maxBalls &&
    live.score.wickets<10
  ){
    return;
  }

  const matches=getMatches();

  const index=matches.findIndex(function(item){
    return item.id===live.match.id;
  });

  if(index!==-1){

    matches[index].status="completed";

    matches[index].result=
      live.score.runs+
      "/"+
      live.score.wickets;

    saveMatches(matches);
  }

  live.score.commentary.push(
    "🏁 INNINGS COMPLETE!"
  );
}

function finishScoreUpdate(live){

  saveLiveScoreById(
    live.match.id,
    live.score
  );

  updateHomeMatch();

  renderScoreScreen(
    live.match.id
  );
}

function swapBatsmen(score){

  const temp=score.striker;

  score.striker=score.nonStriker;

  score.nonStriker=temp;
}

function undoLastBall(){

  const live=getLiveMatchAndScore();

  if(!live)return;

  const last=live.score.history.pop();

  if(!last)return;

  if(last.type==="wicket"){

    live.score.wickets=Math.max(
      0,
      live.score.wickets-1
    );

    live.score.totalBalls=Math.max(
      0,
      live.score.totalBalls-1
    );

  }else if(
    last.type==="wide" ||
    last.type==="noball"
  ){

    live.score.runs=Math.max(
      0,
      live.score.runs-last.runs
    );

  }else{

    live.score.runs=Math.max(
      0,
      live.score.runs-last.runs
    );

    live.score.totalBalls=Math.max(
      0,
      live.score.totalBalls-1
    );
  }

  live.score.commentary.push(
    "↩ Last action undone."
  );

  finishScoreUpdate(live);
}

function showScorecards(){

  const box=document.getElementById("singleMatch");

  if(!box)return;

  const matches=getMatches();

  const scored=matches.filter(function(match){
    return getLiveScoreById(match.id);
  });

  let html=`

    <button
      class="backBtn"
      onclick="openSingleMatchMenu()"
    >
      ← Back
    </button>

    <h2>📊 Scorecards</h2>
  `;

  if(!scored.length){

    html+=`
      <div class="emptyBox">
        No scorecards yet.
      </div>
    `;

  }else{

    scored
      .slice()
      .reverse()
      .forEach(function(match){

        const score=getLiveScoreById(match.id);

        html+=`

          <div class="pageCard">

            <b>
              ${escapeHTML(match.teamAName)}
              🆚
              ${escapeHTML(match.teamBName)}
            </b>

            <h3>
              ${score.runs}/${score.wickets}
            </h3>

            <div class="smallText">
              Overs:
              ${getCurrentOver(score)}
              /
              ${match.overs}
            </div>

            <div class="smallText">
              ${escapeHTML(match.status||"")}
            </div>

          </div>
        `;
      });
  }

  box.innerHTML=html;
}

function updateHomeMatch(){

  const matches=getMatches();

  const match=
    matches.find(function(item){
      return item.status==="live";
    })
    ||
    matches.find(function(item){
      return item.status==="scheduled";
    });

  if(!match)return;

  const score=getLiveScoreById(match.id);

  const homeScore=
    document.getElementById("homeScore");

  const homeOvers=
    document.getElementById("homeOvers");

  const homeStatus=
    document.getElementById("homeStatus");

  const homeTeamA=
    document.getElementById("homeTeamA");

  const homeTeamB=
    document.getElementById("homeTeamB");

  if(homeTeamA){
    homeTeamA.textContent=
      match.teamAName||"TEAM A";
  }

  if(homeTeamB){
    homeTeamB.textContent=
      match.teamBName||"TEAM B";
  }

  if(match.status==="live"&&score){

    if(homeScore){
      homeScore.textContent=
        score.runs+"/"+score.wickets;
    }

    if(homeOvers){
      homeOvers.textContent=
        getCurrentOver(score)+" OV";
    }

    if(homeStatus){
      homeStatus.textContent="🔴 LIVE";
    }

  }else{

    if(homeScore){
      homeScore.textContent="READY";
    }

    if(homeOvers){
      homeOvers.textContent=
        match.overs+" OV";
    }

    if(homeStatus){
      homeStatus.textContent=
        "☀️ Upcoming Match";
    }
  }
}

function openCurrentMatch(){

  const match=
    getMatches().find(function(item){
      return item.status==="live";
    })
    ||
    getMatches().find(function(item){
      return item.status==="scheduled";
    });

  openPage("singleMatch");

  setTimeout(function(){

    if(match&&match.status==="live"){
      renderScoreScreen(match.id);
    }else{
      openSingleMatchMenu();
    }

  },100);
}

function openSingleMatchMenu(){

  const box=document.getElementById("singleMatch");

  if(!box)return;

  box.innerHTML=`

    <button
      class="backBtn"
      onclick="goBack()"
    >
      ← Back
    </button>

    <h2>🏏 Single Match</h2>

    <div class="pageCard">

      <b>
        Create and manage your cricket match.
      </b>

      <div class="smallText">
        Pehle Create Match karo, phir Start Match se
        live scoring shuru karo.
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

function escapeHTML(value){

  const div=document.createElement("div");

  div.textContent=String(value??"");

  return div.innerHTML;
}

window.addEventListener("popstate",function(){
  goBack();
});
