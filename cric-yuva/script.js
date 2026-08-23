/* =========================
   CRIC YUVA APP SCRIPT
========================= */

let currentPage = "home";
let pageHistory = ["home"];


/* =========================
   SPLASH SCREEN
========================= */

window.addEventListener("load", function () {
  setTimeout(function () {
    const splash = document.getElementById("splashScreen");

    if (splash) {
      splash.classList.add("hide");

      setTimeout(function () {
        splash.style.display = "none";
      }, 500);
    }
  }, 2500);
});


/* =========================
   PAGE SYSTEM
========================= */

function openPage(pageName) {

  const selectedPage =
    document.getElementById(pageName);

  if (!selectedPage) {
    return;
  }

  document
    .querySelectorAll(".page")
    .forEach(function (page) {
      page.classList.remove("active");
    });

  selectedPage.classList.add("active");

  if (currentPage !== pageName) {
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
   BACK BUTTON
========================= */

function goBack() {

  if (pageHistory.length > 1) {

    pageHistory.pop();

    const previousPage =
      pageHistory[pageHistory.length - 1];

    document
      .querySelectorAll(".page")
      .forEach(function (page) {
        page.classList.remove("active");
      });

    const selectedPage =
      document.getElementById(previousPage);

    if (selectedPage) {
      selectedPage.classList.add("active");
    }

    currentPage = previousPage;

    updateNavigation(previousPage);

  } else {

    openPage("home");

  }

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}


/* =========================
   BOTTOM NAVIGATION
========================= */

function updateNavigation(pageName) {

  document
    .querySelectorAll(".navBtn")
    .forEach(function (button) {

      button.classList.remove("active");

      if (
        button.dataset.page === pageName
      ) {
        button.classList.add("active");
      }

    });
}


/* =========================
   DRAWER
========================= */

function openDrawer() {

  const drawer =
    document.getElementById("drawer");

  const shade =
    document.getElementById("drawerShade");

  if (drawer) {
    drawer.classList.add("open");
  }

  if (shade) {
    shade.classList.add("open");
  }
}


function closeDrawer() {

  const drawer =
    document.getElementById("drawer");

  const shade =
    document.getElementById("drawerShade");

  if (drawer) {
    drawer.classList.remove("open");
  }

  if (shade) {
    shade.classList.remove("open");
  }
}


function drawerPage(pageName) {

  closeDrawer();

  openPage(pageName);
}


/* =========================
   MATCH SYSTEM
========================= */

let currentMatch = {
  teamA: "Team A",
  teamB: "Team B",
  score: "0/0",
  overs: "0.0",
  status: "☀️ Ready to Start",
  ground: "📍 Cricket Ground",
  created: false,
  started: false
};


function updateHomeMatch() {

  const teamA =
    document.getElementById("homeTeamA");

  const teamB =
    document.getElementById("homeTeamB");

  const score =
    document.getElementById("homeScore");

  const overs =
    document.getElementById("homeOvers");

  const status =
    document.getElementById("homeStatus");

  const ground =
    document.getElementById("homeGround");

  if (teamA) {
    teamA.textContent = currentMatch.teamA;
  }

  if (teamB) {
    teamB.textContent = currentMatch.teamB;
  }

  if (score) {
    score.textContent = currentMatch.score;
  }

  if (overs) {
    overs.textContent = currentMatch.overs;
  }

  if (status) {
    status.textContent = currentMatch.status;
  }

  if (ground) {
    ground.textContent = currentMatch.ground;
  }
}


function createSingleMatch() {

  currentMatch.created = true;
  currentMatch.status = "📅 Match Created";

  updateHomeMatch();

  const upcomingBox =
    document.getElementById("upcomingMatchesBox");

  if (upcomingBox) {
    upcomingBox.innerHTML =
      "<b>🏏 " +
      currentMatch.teamA +
      " VS " +
      currentMatch.teamB +
      "</b><br><br>📅 Upcoming Match<br>📍 Cricket Ground";
  }

  alert(
    "Match created successfully! 🏏\n\n" +
    "Now press Start Match to begin live scoring."
  );
}


function startSingleMatch() {

  if (!currentMatch.created) {

    alert(
      "Pehle Create Match karo."
    );

    return;
  }

  currentMatch.started = true;
  currentMatch.status = "🔴 LIVE NOW";

  updateHomeMatch();

  const liveBox =
    document.getElementById("liveMatchesBox");

  if (liveBox) {
    liveBox.innerHTML =
      "<b>🔴 LIVE: " +
      currentMatch.teamA +
      " VS " +
      currentMatch.teamB +
      "</b><br><br>" +
      currentMatch.score +
      " • " +
      currentMatch.overs +
      " Overs";
  }

  alert(
    "Live Match Started! 🔴🏏"
  );
}


function openCurrentMatch() {

  if (!currentMatch.created) {

    alert(
      "Abhi koi live match nahi hai.\n\n" +
      "Single Match → Create Match se match banao."
    );

    openPage("singleMatch");

    return;
  }

  alert(
    "🏏 " +
    currentMatch.teamA +
    " VS " +
    currentMatch.teamB +
    "\n\nScore: " +
    currentMatch.score +
    "\nOvers: " +
    currentMatch.overs +
    "\nStatus: " +
    currentMatch.status
  );
}


function showMyMatches() {

  if (!currentMatch.created) {

    alert(
      "Abhi koi match create nahi hua hai."
    );

    return;
  }

  alert(
    "🏏 My Match\n\n" +
    currentMatch.teamA +
    " VS " +
    currentMatch.teamB +
    "\n\nStatus: " +
    currentMatch.status
  );
}


function showScorecards() {

  if (!currentMatch.created) {

    alert(
      "Pehle match create karo."
    );

    return;
  }

  alert(
    "📊 LIVE SCORECARD\n\n" +
    currentMatch.teamA +
    " VS " +
    currentMatch.teamB +
    "\n\nScore: " +
    currentMatch.score +
    "\nOvers: " +
    currentMatch.overs
  );
}


/* =========================
   APP START
========================= */

document.addEventListener(
  "DOMContentLoaded",
  function () {

    updateHomeMatch();

    updateNavigation("home");

  }
);
