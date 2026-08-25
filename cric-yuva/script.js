/* =========================================================
   CRIC YUVA - FINAL CONNECTED JAVASCRIPT
   HTML + CSS + SCRIPT.JS CONNECTION SYSTEM
   ========================================================= */

"use strict";

/* =========================
   HELPERS
========================= */

const $ = (id) => document.getElementById(id);
const $$ = (selector) => document.querySelectorAll(selector);

function showMessage(message) {
  if (typeof message === "string" && message.trim()) {
    alert(message);
  }
}

/* =========================
   SCREEN SYSTEM
========================= */

const screenHistory = [];

function getActiveScreen() {
  return document.querySelector(".app-screen.active");
}

function showScreen(screenId, saveHistory = true) {
  const nextScreen = $(screenId);

  if (!nextScreen) {
    console.warn("Screen not found:", screenId);
    return;
  }

  const currentScreen = getActiveScreen();

  if (
    saveHistory &&
    currentScreen &&
    currentScreen.id !== screenId
  ) {
    screenHistory.push(currentScreen.id);
  }

  $$(".app-screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  nextScreen.classList.add("active");

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

  closeMenu();
  closeQuickModal();

  if (
    screenId === "screen5" ||
    nextScreen.classList.contains("home-screen")
  ) {
    updateHomeProfile();
  }

  if (
    screenId === "screen4" ||
    nextScreen.classList.contains("profile-screen")
  ) {
    loadProfileForm();
  }
}

function goBack() {
  if (screenHistory.length > 0) {
    const previousScreen = screenHistory.pop();
    showScreen(previousScreen, false);
    return;
  }

  showScreen("screen5", false);
}

/* Global functions for HTML onclick */

window.showScreen = showScreen;
window.goBack = goBack;

/* =========================
   SPLASH SCREEN
========================= */

function startApp() {
  setTimeout(() => {
    const savedUser = localStorage.getItem("cricYuvaUser");

    if (savedUser) {
      showScreen("screen5", false);
    } else {
      showScreen("screen2", false);
    }
  }, 2200);
}

/* =========================
   USER DATA
========================= */

const defaultUser = {
  name: "Cric Yuva Player",
  mobile: "",
  email: "",
  password: "",
  jerseyName: "",
  jerseyNumber: "",
  jerseySize: "",
  birthDate: "",
  photo: "",
  playerId: ""
};

function getUser() {
  try {
    const savedUser = localStorage.getItem("cricYuvaUser");

    if (!savedUser) {
      return { ...defaultUser };
    }

    return {
      ...defaultUser,
      ...JSON.parse(savedUser)
    };
  } catch (error) {
    console.error(error);
    return { ...defaultUser };
  }
}

function saveUser(user) {
  localStorage.setItem(
    "cricYuvaUser",
    JSON.stringify(user)
  );
}

function createPlayerId() {
  return (
    "CY" +
    Date.now().toString().slice(-6) +
    Math.floor(Math.random() * 90 + 10)
  );
}

/* =========================
   CREATE ACCOUNT
========================= */

function createAccount() {
  const nameInput = $("createName");
  const mobileInput = $("createMobile");
  const emailInput = $("createEmail");
  const passwordInput = $("createPassword");

  if (
    !nameInput ||
    !mobileInput ||
    !emailInput ||
    !passwordInput
  ) {
    console.warn("Create account inputs not found");
    return;
  }

  const name = nameInput.value.trim();
  const mobile = mobileInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!name) {
    showMessage("Please enter your name");
    nameInput.focus();
    return;
  }

  if (mobile.length < 10) {
    showMessage("Please enter a valid mobile number");
    mobileInput.focus();
    return;
  }

  if (!email.includes("@")) {
    showMessage("Please enter a valid email");
    emailInput.focus();
    return;
  }

  if (password.length < 4) {
    showMessage("Password must be at least 4 characters");
    passwordInput.focus();
    return;
  }

  const user = getUser();

  user.name = name;
  user.mobile = mobile;
  user.email = email;
  user.password = password;

  if (!user.playerId) {
    user.playerId = createPlayerId();
  }

  saveUser(user);

  updateHomeProfile();

  showMessage("Account created successfully!");

  showScreen("screen5");
}

window.createAccount = createAccount;

/* =========================
   LOGIN
========================= */

function loginUser() {
  const mobileInput = $("loginMobile");
  const passwordInput = $("loginPassword");

  if (!mobileInput || !passwordInput) {
    console.warn("Login inputs not found");
    return;
  }

  const mobile = mobileInput.value.trim();
  const password = passwordInput.value.trim();

  const user = getUser();

  if (!user.mobile || !user.password) {
    showMessage("Please create your account first");
    showScreen("screen3");
    return;
  }

  if (mobile !== user.mobile) {
    showMessage("Mobile number is incorrect");
    return;
  }

  if (password !== user.password) {
    showMessage("Password is incorrect");
    return;
  }

  updateHomeProfile();

  showMessage("Welcome to CRIC YUVA!");

  showScreen("screen5");
}

window.loginUser = loginUser;

/* =========================
   LOGOUT
========================= */

function logoutUser() {
  const confirmLogout = confirm(
    "Are you sure you want to logout?"
  );

  if (!confirmLogout) {
    return;
  }

  screenHistory.length = 0;

  closeMenu();

  const passwordInput = $("loginPassword");

  if (passwordInput) {
    passwordInput.value = "";
  }

  showScreen("screen2", false);
}

window.logoutUser = logoutUser;

/* =========================
   PASSWORD SHOW / HIDE
========================= */

function togglePassword(inputId, button) {
  const input = $(inputId);

  if (!input) return;

  if (input.type === "password") {
    input.type = "text";

    if (button) {
      button.innerHTML =
        '<i class="fa-solid fa-eye-slash"></i>';
    }
  } else {
    input.type = "password";

    if (button) {
      button.innerHTML =
        '<i class="fa-solid fa-eye"></i>';
    }
  }
}

window.togglePassword = togglePassword;

/* =========================
   PROFILE
========================= */

function loadProfileForm() {
  const user = getUser();

  const fieldMap = {
    profileName: user.name,
    profileMobile: user.mobile,
    profileEmail: user.email,
    profileJerseyName: user.jerseyName,
    profileJerseyNumber: user.jerseyNumber,
    profileJerseySize: user.jerseySize,
    profileBirthDate: user.birthDate
  };

  Object.keys(fieldMap).forEach((id) => {
    const field = $(id);

    if (field) {
      field.value = fieldMap[id] || "";
    }
  });

  updateProfilePhoto(user.photo);
  updatePlayerId(user.playerId);
}

function saveProfileChanges() {
  const user = getUser();

  const fields = {
    profileName: "name",
    profileMobile: "mobile",
    profileEmail: "email",
    profileJerseyName: "jerseyName",
    profileJerseyNumber: "jerseyNumber",
    profileJerseySize: "jerseySize",
    profileBirthDate: "birthDate"
  };

  Object.keys(fields).forEach((id) => {
    const field = $(id);

    if (field) {
      user[fields[id]] = field.value.trim();
    }
  });

  if (!user.playerId) {
    user.playerId = createPlayerId();
  }

  saveUser(user);

  updateHomeProfile();

  showMessage("Profile updated successfully!");
}

window.saveProfileChanges = saveProfileChanges;

/* =========================
   PROFILE PHOTO
========================= */

function openPhotoPicker() {
  const input = $("profilePhotoInput");

  if (input) {
    input.click();
  }
}

window.openPhotoPicker = openPhotoPicker;

function handleProfilePhoto(event) {
  const file =
    event &&
    event.target &&
    event.target.files &&
    event.target.files[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showMessage("Please select an image file");
    return;
  }

  const reader = new FileReader();

  reader.onload = function (e) {
    const user = getUser();

    user.photo = e.target.result;

    saveUser(user);

    updateProfilePhoto(user.photo);
    updateHomeProfile();

    showMessage("Profile photo updated!");
  };

  reader.readAsDataURL(file);
}

window.handleProfilePhoto = handleProfilePhoto;

function updateProfilePhoto(photo) {
  const photoContainers = [
    ".profile-photo",
    ".home-profile-photo",
    ".home-profile-avatar",
    ".menu-profile-photo"
  ];

  photoContainers.forEach((selector) => {
    $$(selector).forEach((box) => {
      if (photo) {
        box.innerHTML = `<img src="${photo}" alt="Profile Photo">`;
      }
    });
  });
}

function updatePlayerId(playerId) {
  $$(".player-id, .home-player-id, .menu-player-id").forEach(
    (element) => {
      if (playerId) {
        element.textContent = "PLAYER ID: " + playerId;
      }
    }
  );
}

/* =========================
   UPDATE HOME PROFILE
========================= */

function updateHomeProfile() {
  const user = getUser();

  const name =
    user.name ||
    user.jerseyName ||
    "Cric Yuva Player";

  const firstLetter = name.charAt(0).toUpperCase();

  $$(".welcome-name, .welcome-profile-info h2, .welcome-card h2").forEach(
    (element) => {
      element.textContent = name;
    }
  );

  $$(".menu-user strong").forEach((element) => {
    element.textContent = name;
  });

  $$(".menu-user small").forEach((element) => {
    element.textContent =
      user.playerId
        ? "PLAYER ID: " + user.playerId
        : "CRIC YUVA PLAYER";
  });

  updatePlayerId(user.playerId);

  const avatarSelectors = [
    ".home-profile-avatar",
    ".home-profile-photo",
    ".menu-profile-photo"
  ];

  avatarSelectors.forEach((selector) => {
    $$(selector).forEach((avatar) => {
      if (user.photo) {
        avatar.innerHTML =
          `<img src="${user.photo}" alt="Profile Photo">`;
      } else {
        avatar.innerHTML =
          `<span>${firstLetter}</span>`;
      }
    });
  });
}

/* =========================
   SIDE MENU
========================= */

function openMenu() {
  const menu = $("sideMenu");
  const overlay = $("menuOverlay");

  if (menu) {
    menu.classList.add("open");
  }

  if (overlay) {
    overlay.classList.add("open");
  }

  updateHomeProfile();
}

function closeMenu() {
  const menu = $("sideMenu");
  const overlay = $("menuOverlay");

  if (menu) {
    menu.classList.remove("open");
  }

  if (overlay) {
    overlay.classList.remove("open");
  }
}

window.openMenu = openMenu;
window.closeMenu = closeMenu;

/* =========================
   QUICK ACCESS MODAL
========================= */

function openQuickModal() {
  const modal = $("quickModal");

  if (modal) {
    modal.classList.add("open");
  }
}

function closeQuickModal() {
  const modal = $("quickModal");

  if (modal) {
    modal.classList.remove("open");
  }
}

window.openQuickModal = openQuickModal;
window.closeQuickModal = closeQuickModal;

/* =========================
   FEATURE PAGE
========================= */

const featureData = {
  matches: {
    title: "My Matches",
    icon: "fa-solid fa-trophy",
    text: "View your upcoming matches, match history and complete score details."
  },

  tournament: {
    title: "Tournaments",
    icon: "fa-solid fa-trophy",
    text: "Create, manage and join cricket tournaments."
  },

  players: {
    title: "Players",
    icon: "fa-solid fa-users",
    text: "Find players, manage player profiles and connect with your cricket community."
  },

  teams: {
    title: "Teams",
    icon: "fa-solid fa-shield-halved",
    text: "Create your team, add players and manage your complete squad."
  },

  score: {
    title: "Live Scoring",
    icon: "fa-solid fa-cricket-bat-ball",
    text: "Start live scoring with runs, wickets, wides, no-balls and complete over management."
  },

  chat: {
    title: "Chat",
    icon: "fa-solid fa-comments",
    text: "Chat with your friends, players and cricket groups."
  },

  profile: {
    title: "My Profile",
    icon: "fa-solid fa-user",
    text: "Manage your personal player profile, jersey details and profile photo."
  },

  subscription: {
    title: "Subscription",
    icon: "fa-solid fa-crown",
    text: "View your subscription plan and premium CRIC YUVA features."
  },

  notifications: {
    title: "Notifications",
    icon: "fa-solid fa-bell",
    text: "View your latest match, tournament and player notifications."
  },

  settings: {
    title: "Settings",
    icon: "fa-solid fa-gear",
    text: "Manage your CRIC YUVA application settings."
  },

  help: {
    title: "Help & Support",
    icon: "fa-solid fa-circle-question",
    text: "Get help and support for your CRIC YUVA account."
  }
};

function openFeature(feature) {
  if (feature === "profile") {
    showScreen("screen4");
    return;
  }

  const data =
    featureData[feature] ||
    {
      title: "CRIC YUVA",
      icon: "fa-solid fa-cricket-bat-ball",
      text: "This feature is coming soon."
    };

  const title = $("featureTitle");
  const heading = $("featureHeading");
  const text = $("featureText");
  const icon = $("featureIcon");

  if (title) title.textContent = data.title;
  if (heading) heading.textContent = data.title;
  if (text) text.textContent = data.text;

  if (icon) {
    icon.className = data.icon;
  }

  showScreen("screen6");
}

window.openFeature = openFeature;

/* =========================
   LIVE MATCH
========================= */

function watchLive() {
  showMessage(
    "Live match will open when the tournament organizer adds the live streaming link."
  );
}

window.watchLive = watchLive;

function openMatchDetails() {
  openFeature("matches");
}

window.openMatchDetails = openMatchDetails;

/* =========================
   NOTIFICATIONS
========================= */

function openNotifications() {
  const dot = $("notificationDot");

  if (dot) {
    dot.style.display = "none";
  }

  openFeature("notifications");
}

window.openNotifications = openNotifications;

/* =========================
   NAVIGATION ACTIVE STATE
========================= */

function setActiveNav(button) {
  $$(".bottom-nav-item, .bottom-nav-btn").forEach((item) => {
    item.classList.remove("active", "active-nav");
  });

  if (button) {
    button.classList.add("active");
    button.classList.add("active-nav");
  }
}

window.setActiveNav = setActiveNav;

/* =========================
   BOTTOM NAVIGATION
========================= */

function goHome(button) {
  setActiveNav(button);
  showScreen("screen5");
}

function goMatches(button) {
  setActiveNav(button);
  openFeature("matches");
}

function goTournament(button) {
  setActiveNav(button);
  openFeature("tournament");
}

function goPlayers(button) {
  setActiveNav(button);
  openFeature("players");
}

function goProfile(button) {
  setActiveNav(button);
  showScreen("screen4");
}

window.goHome = goHome;
window.goMatches = goMatches;
window.goTournament = goTournament;
window.goPlayers = goPlayers;
window.goProfile = goProfile;

/* =========================
   EVENT CONNECTION SYSTEM
========================= */

document.addEventListener("DOMContentLoaded", () => {

  /* Splash */
  const splashScreen = $("screen1");

  if (
    splashScreen &&
    splashScreen.classList.contains("active")
  ) {
    startApp();
  }

  /* Login */
  const loginButton = $("loginButton");

  if (loginButton) {
    loginButton.addEventListener("click", loginUser);
  }

  /* Create Account */
  const createButton = $("createAccountButton");

  if (createButton) {
    createButton.addEventListener(
      "click",
      createAccount
    );
  }

  /* Save Profile */
  const saveProfileButton =
    $("saveProfileButton");

  if (saveProfileButton) {
    saveProfileButton.addEventListener(
      "click",
      saveProfileChanges
    );
  }

  /* Photo Upload */
  const photoInput =
    $("profilePhotoInput");

  if (photoInput) {
    photoInput.addEventListener(
      "change",
      handleProfilePhoto
    );
  }

  /* Menu buttons */
  const menuButton =
    $("homeMenuButton");

  if (menuButton) {
    menuButton.addEventListener(
      "click",
      openMenu
    );
  }

  const closeMenuButton =
    $("closeMenuButton");

  if (closeMenuButton) {
    closeMenuButton.addEventListener(
      "click",
      closeMenu
    );
  }

  const menuOverlay =
    $("menuOverlay");

  if (menuOverlay) {
    menuOverlay.addEventListener(
      "click",
      closeMenu
    );
  }

  /* Notification */
  const notificationButton =
    $("notificationButton");

  if (notificationButton) {
    notificationButton.addEventListener(
      "click",
      openNotifications
    );
  }

  /* Enter key login */
  ["loginMobile", "loginPassword"].forEach(
    (id) => {
      const input = $(id);

      if (input) {
        input.addEventListener(
          "keydown",
          (event) => {
            if (event.key === "Enter") {
              loginUser();
            }
          }
        );
      }
    }
  );

  /* Enter key create account */
  [
    "createName",
    "createMobile",
    "createEmail",
    "createPassword"
  ].forEach((id) => {
    const input = $(id);

    if (input) {
      input.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Enter") {
            createAccount();
          }
        }
      );
    }
  });

  updateHomeProfile();

});

/* =========================
   ANDROID BACK BUTTON STYLE
========================= */

window.addEventListener(
  "popstate",
  () => {
    goBack();
  }
);

/* =========================
   AUTO LOAD
========================= */

window.addEventListener(
  "load",
  () => {
    updateHomeProfile();

    const activeScreen = getActiveScreen();

    if (
      activeScreen &&
      (
        activeScreen.id === "screen5" ||
        activeScreen.classList.contains("home-screen")
      )
    ) {
      updateHomeProfile();
    }
  }
);
