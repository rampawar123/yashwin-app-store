document.addEventListener("DOMContentLoaded", function () {

  // ==========================================
  // SAFE TOAST & IFRAME ALERT INTERCEPTOR
  // ==========================================
  function showToast(msg, isError = false) {
    if (!msg) return;
    let toast = document.getElementById("cricYuvaToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "cricYuvaToast";
      toast.className = "toast-message";
      document.body.appendChild(toast);
    }
    const icon = isError ? "fa-circle-exclamation text-red" : "fa-circle-check text-orange";
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${String(msg).replace(/\n/g, "<br>")}</span>`;
    toast.style.display = "flex";
    if (window._toastTimer) clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
      toast.style.display = "none";
    }, 3500);
  }

  // Intercept window.alert inside iFrame to prevent UI thread freezing
  const _origAlert = window.alert;
  window.alert = function (message) {
    try {
      showToast(message);
    } catch (e) {
      try { if (_origAlert) _origAlert.call(window, message); } catch (err) { console.log(message); }
    }
  };

  // ==========================================
  // STORAGE PERSISTENCE & USER DATA ISOLATION
  // ==========================================
  function getUserStorage(key, fallback = null) {
    if (window.CricYuvaStorage) {
      return window.CricYuvaStorage.getUserItem(key, fallback);
    }
    const val = localStorage.getItem(key);
    return val !== null ? val : fallback;
  }

  function setUserStorage(key, value) {
    if (window.CricYuvaStorage) {
      window.CricYuvaStorage.setUserItem(key, value);
    } else {
      localStorage.setItem(key, value);
    }
  }

  function removeUserStorage(key) {
    if (window.CricYuvaStorage) {
      window.CricYuvaStorage.removeUserItem(key);
    } else {
      localStorage.removeItem(key);
    }
  }


  // ==========================================
  // CLOUD API + SHARE/QR HELPERS
  // ==========================================
  const CricYuvaCloud = {
    base: (window.CRIC_YUVA_API_BASE || "").replace(/\/$/, ""),
    async request(path, options = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(this.base + path, { ...options, signal: controller.signal, headers: { "Content-Type": "application/json", ...(localStorage.getItem("cricYuvaCloudToken") ? { Authorization: `Bearer ${localStorage.getItem("cricYuvaCloudToken")}` } : {}), ...(options.headers || {}) } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
      } finally { clearTimeout(timer); }
    },
    register(payload) { return this.request("/api/auth/register", { method: "POST", body: JSON.stringify(payload) }); },
    login(payload) { return this.request("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }); },
    joinTeam(payload) { return this.request("/api/join/team", { method: "POST", body: JSON.stringify(payload) }); },
    joinTournament(payload) { return this.request("/api/join/tournament", { method: "POST", body: JSON.stringify(payload) }); },
    playerRequest(payload) { return this.request("/api/player/request", { method: "POST", body: JSON.stringify(payload) }); },
    saveLive(payload) { return this.request(`/api/live/match/${encodeURIComponent(payload.matchId)}`, { method: "POST", body: JSON.stringify(payload) }); }
  };
  window.CricYuvaCloud = CricYuvaCloud;

  function getAppBaseUrl() {
    return window.location.origin + window.location.pathname;
  }

  function buildShareUrl(type, id) {
    return `${getAppBaseUrl()}?${encodeURIComponent(type)}=${encodeURIComponent(id || "")}`;
  }

  function openShareQr(title, url) {
    const modal = document.getElementById("cricYuvaShareQrModal");
    const titleEl = document.getElementById("shareQrTitle");
    const urlEl = document.getElementById("shareQrUrl");
    const canvas = document.getElementById("shareQrCanvas");
    if (!modal || !urlEl) return;
    if (titleEl) titleEl.textContent = title || "Share Cric Yuva";
    urlEl.value = url;
    if (canvas && window.QRCode && typeof window.QRCode.toCanvas === "function") {
      window.QRCode.toCanvas(canvas, url, { width: 220, margin: 2 }, () => {});
    }
    modal.style.display = "flex";
  }

  function shareCurrentUrl(url, title = "Cric Yuva") {
    if (navigator.share) { navigator.share({ title, url }).catch(() => {}); }
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => showToast("Link copied!"));
    else prompt("Share link:", url);
  }

  // One-time cleanup of known demo tournament records. User-created tournaments are preserved.
  function cleanKnownDemoData() {
    try {
      const blockedIds = new Set(["tourney_ypl_2026", "tourney_champions_2026", "tourney_knockout_2026"]);
      const raw = getUserStorage(TOURNAMENT_STORAGE_KEY, null);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          const clean = list.filter(t => t && t.id && !blockedIds.has(t.id));
          if (clean.length !== list.length) setUserStorage(TOURNAMENT_STORAGE_KEY, JSON.stringify(clean));
        }
      }
    } catch (e) {}
  }
  cleanKnownDemoData();

  // ==========================================
  // PROFILE DATA HELPERS & DRAWER SYNC
  // ==========================================

  function displayProfilePhoto(photoDataUrl) {
    const profilePhoto = document.getElementById("profilePhoto");
    const drawerAvatar = document.getElementById("drawerAvatar");
    const savedName = localStorage.getItem("cricYuvaProfileName") || "";
    const initialText = savedName.trim() ? savedName.trim().charAt(0).toUpperCase() : "P";

    if (profilePhoto) {
      if (photoDataUrl) {
        profilePhoto.innerHTML = '<img src="' + photoDataUrl + '" alt="Profile Photo" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
      } else {
        profilePhoto.innerHTML = '<span id="profileInitial">' + (savedName.trim() ? savedName.trim().charAt(0).toUpperCase() : "PLAYER") + '</span>';
      }
    }

    if (drawerAvatar) {
      if (photoDataUrl) {
        drawerAvatar.innerHTML = '<img src="' + photoDataUrl + '" alt="User Avatar">';
      } else {
        drawerAvatar.innerHTML = '<span id="drawerAvatarInitial">' + initialText + '</span>';
      }
    }
  }

  function loadProfileData() {
    const savedMobile = localStorage.getItem("cricYuvaMobile") || "";
    const profileMobile = document.getElementById("profileMobile");
    if (profileMobile) profileMobile.value = localStorage.getItem("cricYuvaProfileMobile") || savedMobile;

    const profileName = document.getElementById("profileName");
    const savedName = localStorage.getItem("cricYuvaProfileName") || "";
    if (profileName) profileName.value = savedName;

    const profileEmail = document.getElementById("profileEmail");
    if (profileEmail) profileEmail.value = localStorage.getItem("cricYuvaProfileEmail") || "";

    const jerseyName = document.getElementById("jerseyName");
    if (jerseyName) jerseyName.value = localStorage.getItem("cricYuvaJerseyName") || "";

    const jerseyNumber = document.getElementById("jerseyNumber");
    if (jerseyNumber) jerseyNumber.value = localStorage.getItem("cricYuvaJerseyNumber") || "";

    const jerseySize = document.getElementById("jerseySize");
    if (jerseySize) jerseySize.value = localStorage.getItem("cricYuvaJerseySize") || "";

    const pantSize = document.getElementById("pantSize");
    if (pantSize) pantSize.value = localStorage.getItem("cricYuvaPantSize") || "";

    const dateOfBirth = document.getElementById("dateOfBirth");
    if (dateOfBirth) dateOfBirth.value = localStorage.getItem("cricYuvaDateOfBirth") || "";

    const savedPhoto = localStorage.getItem("cricYuvaProfilePhoto");
    displayProfilePhoto(savedPhoto);

    // Sync Drawer Header Info
    const drawerUserName = document.getElementById("drawerUserName");
    if (drawerUserName) {
      drawerUserName.textContent = savedName.trim() ? savedName : "Cric Yuva Player";
    }

    const drawerUserMobile = document.getElementById("drawerUserMobile");
    if (drawerUserMobile) {
      const mob = localStorage.getItem("cricYuvaProfileMobile") || savedMobile;
      drawerUserMobile.textContent = mob ? "+91 " + mob : "+91 Mobile";
    }

    // Sync Player ID across Profile & Drawer
    let pid = localStorage.getItem("cricYuvaPlayerId");
    if (!pid) {
      const mobSuffix = (localStorage.getItem("cricYuvaProfileMobile") || savedMobile || "1001").slice(-4);
      pid = "CY2026-" + mobSuffix;
      localStorage.setItem("cricYuvaPlayerId", pid);
    }
    const playerIdEl = document.getElementById("playerId");
    if (playerIdEl) playerIdEl.textContent = pid;

    const drawerPlayerId = document.getElementById("drawerPlayerId");
    if (drawerPlayerId) drawerPlayerId.textContent = "ID: " + pid;

    const drawerAvatarInitial = document.getElementById("drawerAvatarInitial");
    if (drawerAvatarInitial) {
      drawerAvatarInitial.textContent = getPlayerInitials(savedName.trim() || "Player");
    }
  }


  // ==========================================
  // SCREEN FUNCTION
  // ==========================================

  function showScreen(screenId) {
    document.querySelectorAll(".app-screen").forEach(function (screen) {
      screen.classList.remove("active");
    });

    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
      targetScreen.classList.add("active");
      window.scrollTo(0, 0);
      targetScreen.scrollTop = 0;
      const innerScrolls = targetScreen.querySelectorAll(".history-content-scroll, .stats-content-scroll, .tourney-content-scroll, .tourney-detail-scroll, .home-scroll-content, .team-scroll-content, .live-score-scroll");
      innerScrolls.forEach(function (inner) {
        inner.scrollTop = 0;
      });
    }
  }


  // ==========================================
  // STARTUP & NAVIGATION FLOW HELPERS
  // ==========================================

  function hasSavedAccount() {
    const mobile = localStorage.getItem("cricYuvaMobile");
    const pass = localStorage.getItem("cricYuvaPassword");
    return !!(mobile && mobile.trim() && pass);
  }

  function isProfileCompleted() {
    const profileName = localStorage.getItem("cricYuvaProfileName");
    return !!(profileName && profileName.trim().length > 0);
  }

  function isUserLoggedIn() {
    return localStorage.getItem("cricYuvaLoggedIn") === "true";
  }

  function getStartupTargetScreen() {
    const hasAccount = hasSavedAccount();
    const loggedIn = isUserLoggedIn();
    const profileDone = isProfileCompleted();

    // 1. If there is no saved account:
    //    Splash/Login screen -> Create Account/Login (Screen 2)
    if (!hasAccount) {
      return "screen2";
    }

    // 2. If account exists but profile is not completed:
    //    Open Profile Setup page (Screen 4)
    if (!profileDone) {
      return "screen4";
    }

    // 3 & 4. If account exists and profile is already completed:
    //    If user has NOT logged out: App reload/reopen must directly show MAIN HOME PAGE (Screen 5)
    if (loggedIn) {
      return "screen5";
    }

    // 5. If user logged out: show Login screen (Screen 2)
    return "screen2";
  }

  // Initial Data Sync & Splash Screen Auto-Transition
  if (isUserLoggedIn()) {
    loadProfileData();
  }

  const initialTargetScreen = getStartupTargetScreen();

  setTimeout(function () {
    const splashScreen = document.getElementById("screen1");
    if (splashScreen) splashScreen.classList.remove("active");

    showScreen(initialTargetScreen);
  }, 1800);


  // ==========================================
  // PASSWORD SHOW / HIDE (EYE TOGGLE)
  // ==========================================

  function setupPasswordEye(button, inputId) {
    if (!button) return;

    button.addEventListener("click", function () {
      const passwordInput = document.getElementById(inputId);
      if (!passwordInput) return;

      const icon = button.querySelector("i");

      if (passwordInput.type === "password") {
        passwordInput.type = "text";
        if (icon) {
          icon.classList.remove("fa-eye");
          icon.classList.add("fa-eye-slash");
        }
      } else {
        passwordInput.type = "password";
        if (icon) {
          icon.classList.remove("fa-eye-slash");
          icon.classList.add("fa-eye");
        }
      }
    });
  }

  // LOGIN PASSWORD EYE
  setupPasswordEye(
    document.getElementById("loginEyeButton"),
    "loginPassword"
  );

  // NEW PASSWORD EYE
  setupPasswordEye(
    document.getElementById("newPasswordEye"),
    "newPassword"
  );

  // VERIFY PASSWORD EYE
  setupPasswordEye(
    document.getElementById("verifyPasswordEye"),
    "verifyPassword"
  );


  // ==========================================
  // NAVIGATION BUTTONS
  // ==========================================

  const createAccountButton = document.getElementById("createAccountButton");
  if (createAccountButton) {
    createAccountButton.addEventListener("click", function () {
      showScreen("screen3");
    });
  }

  document.querySelectorAll(".back-button").forEach(function (button) {
    button.addEventListener("click", function () {
      showScreen("screen2");
    });
  });

  // Profile Back Button (returns to Home Page Screen 5)
  const profileBackButton = document.getElementById("profileBackButton");
  if (profileBackButton) {
    profileBackButton.addEventListener("click", function () {
      showScreen("screen5");
    });
  }


  // ==========================================
  // CREATE NEW ACCOUNT - SAVE & AUTO-LOGIN -> OPEN PROFILE
  // ==========================================

  const saveAccountButton = document.getElementById("saveAccountButton");
  if (saveAccountButton) {
    saveAccountButton.addEventListener("click", async function () {
      const mobile = document.getElementById("newMobile");
      const password = document.getElementById("newPassword");
      const verifyPassword = document.getElementById("verifyPassword");

      if (!mobile || !password || !verifyPassword) {
        alert("Input fields not found. Please check form.");
        return;
      }

      const mobileValue = mobile.value.trim();
      const passwordValue = password.value.trim();
      const verifyPasswordValue = verifyPassword.value.trim();

      if (mobileValue.length !== 10) {
        alert("Please enter a valid 10 digit mobile number.");
        return;
      }

      if (passwordValue.length < 4) {
        alert("Password must be at least 4 characters.");
        return;
      }

      if (passwordValue !== verifyPasswordValue) {
        alert("Password does not match!");
        return;
      }

      let cloudRegistered = false;
      try {
        const cloud = await CricYuvaCloud.register({ mobile: mobileValue, password: passwordValue });
        if (cloud && cloud.user) {
          cloudRegistered = true;
          localStorage.setItem("cricYuvaCloudUserId", cloud.user.userId || cloud.user.id || "");
          if (cloud.token) localStorage.setItem("cricYuvaCloudToken", cloud.token);
        }
      } catch (e) { /* local fallback keeps offline testing usable */ }

      if (window.CricYuvaStorage) {
        const regRes = window.CricYuvaStorage.registerUser({
          mobile: mobileValue,
          password: passwordValue
        });
        if (!regRes.success && !cloudRegistered) {
          alert(regRes.error || "Could not register account. Please try again.");
          return;
        }
      } else {
        localStorage.setItem("cricYuvaMobile", mobileValue);
        localStorage.setItem("cricYuvaPassword", passwordValue);
      }
      localStorage.setItem("cricYuvaLoggedIn", "true");

      // Start with an empty real-player team; no demo squad is created.
      removeUserStorage(TEAM_STORAGE_KEY);

      loadProfileData();

      alert("Account created successfully! Now set up your Player Profile.");
      showScreen("screen4");
    });
  }


  // ==========================================
  // LOGIN BUTTON -> DIRECT TO MAIN HOME PAGE (SCREEN 5)
  // ==========================================

  const loginButton = document.getElementById("loginButton");
  if (loginButton) {
    loginButton.addEventListener("click", async function () {
      const loginMobile = document.getElementById("loginMobile");
      const loginPassword = document.getElementById("loginPassword");

      if (!loginMobile || !loginPassword) return;

      const mob = loginMobile.value.trim();
      const pwd = loginPassword.value;

      if (!mob || !pwd) {
        alert("Please enter both mobile number and password.");
        return;
      }

      try {
        const cloud = await CricYuvaCloud.login({ mobile: mob, password: pwd });
        if (cloud && cloud.user) {
          localStorage.setItem("cricYuvaCloudUserId", cloud.user.userId || cloud.user.id || "");
          if (cloud.token) localStorage.setItem("cricYuvaCloudToken", cloud.token);
          localStorage.setItem("cricYuvaLoggedIn", "true");
          if (cloud.user.name) localStorage.setItem("cricYuvaProfileName", cloud.user.name);
          if (cloud.user.playerId) localStorage.setItem("cricYuvaPlayerId", cloud.user.playerId);
          loadProfileData();
          showScreen(isProfileCompleted() ? "screen5" : "screen4");
          hydrateCloudData().finally(() => processPendingInvite());
          return;
        }
      } catch (e) { /* use local account when server is unavailable */ }

      if (window.CricYuvaStorage) {
        const auth = window.CricYuvaStorage.authenticateUser(mob, pwd);
        if (auth.success) {
          localStorage.setItem("cricYuvaLoggedIn", "true");
          loadProfileData();
          if (isProfileCompleted()) {
            showScreen("screen5");
          } else {
            showScreen("screen4");
          }
          hydrateCloudData().finally(() => processPendingInvite());
          return;
        } else {
          alert(auth.error || "Invalid mobile number or password!");
          return;
        }
      }

      const savedMobile = localStorage.getItem("cricYuvaMobile");
      const savedPassword = localStorage.getItem("cricYuvaPassword");

      if (!savedMobile || !savedPassword) {
        alert("Please create a new account first.");
        return;
      }

      if (mob === savedMobile && pwd === savedPassword) {
        localStorage.setItem("cricYuvaLoggedIn", "true");
        loadProfileData();
        if (isProfileCompleted()) {
          showScreen("screen5");
        } else {
          showScreen("screen4");
        }
      } else {
        alert("Invalid mobile number or password!");
      }
    });
  }


  // ==========================================
  // LOGOUT (ONLY WAY TO CLEAR SESSION)
  // ==========================================

  function handleLogout() {
    if (window.CricYuvaStorage) {
      window.CricYuvaStorage.clearActiveSession();
    }
    localStorage.removeItem("cricYuvaLoggedIn");
    localStorage.removeItem("cricYuvaCloudToken");
    localStorage.removeItem("cricYuvaCloudUserId");
    const loginMobile = document.getElementById("loginMobile");
    const loginPassword = document.getElementById("loginPassword");
    if (loginMobile) loginMobile.value = "";
    if (loginPassword) loginPassword.value = "";
    closeMenuDrawer();
    showScreen("screen2");
  }

  const headerLogoutButton = document.getElementById("headerLogoutButton");
  if (headerLogoutButton) {
    headerLogoutButton.addEventListener("click", handleLogout);
  }

  const drawerLogoutBtn = document.getElementById("drawerLogoutBtn");
  if (drawerLogoutBtn) {
    drawerLogoutBtn.addEventListener("click", handleLogout);
  }


  // ==========================================
  // PROFILE PHOTO (ADD & REPLACE VIA FILE PICKER)
  // ==========================================

  const replacePhotoBtn = document.getElementById("replacePhotoBtn");
  const profilePhoto = document.getElementById("profilePhoto");
  const profilePhotoInput = document.getElementById("profilePhotoInput");

  if (replacePhotoBtn && profilePhotoInput) {
    replacePhotoBtn.addEventListener("click", function () {
      profilePhotoInput.click();
    });
  }

  if (profilePhoto && profilePhotoInput) {
    profilePhoto.addEventListener("click", function () {
      profilePhotoInput.click();
    });
  }

  if (profilePhotoInput) {
    profilePhotoInput.addEventListener("change", function (event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function (e) {
        const dataUrl = e.target.result;
        displayProfilePhoto(dataUrl);
        localStorage.setItem("cricYuvaProfilePhoto", dataUrl);
      };
      reader.readAsDataURL(file);
    });
  }


  // ==========================================
  // PROFILE SAVE CHANGES -> TRANSITIONS DIRECTLY TO SCREEN 5 (HOME)
  // ==========================================

  const saveProfileButton = document.getElementById("saveProfileButton");
  if (saveProfileButton) {
    saveProfileButton.addEventListener("click", async function () {
      const profileName = document.getElementById("profileName");
      const profileMobile = document.getElementById("profileMobile");
      const profileEmail = document.getElementById("profileEmail");
      const jerseyName = document.getElementById("jerseyName");
      const jerseyNumber = document.getElementById("jerseyNumber");
      const jerseySize = document.getElementById("jerseySize");
      const pantSize = document.getElementById("pantSize");
      const dateOfBirth = document.getElementById("dateOfBirth");

      if (profileName) localStorage.setItem("cricYuvaProfileName", profileName.value.trim());
      if (profileMobile) {
        const mob = profileMobile.value.trim();
        localStorage.setItem("cricYuvaProfileMobile", mob);
        if (mob) localStorage.setItem("cricYuvaMobile", mob);
      }
      if (profileEmail) localStorage.setItem("cricYuvaProfileEmail", profileEmail.value.trim());
      if (jerseyName) localStorage.setItem("cricYuvaJerseyName", jerseyName.value.trim());
      if (jerseyNumber) localStorage.setItem("cricYuvaJerseyNumber", jerseyNumber.value.trim());
      if (jerseySize) localStorage.setItem("cricYuvaJerseySize", jerseySize.value);
      if (pantSize) localStorage.setItem("cricYuvaPantSize", pantSize.value);
      if (dateOfBirth) localStorage.setItem("cricYuvaDateOfBirth", dateOfBirth.value);

      try {
        await CricYuvaCloud.request("/api/profile", { method: "PUT", body: JSON.stringify({
          name: localStorage.getItem("cricYuvaProfileName") || "",
          mobile: localStorage.getItem("cricYuvaProfileMobile") || "",
          email: localStorage.getItem("cricYuvaProfileEmail") || "",
          jerseyName: localStorage.getItem("cricYuvaJerseyName") || "",
          jerseyNumber: localStorage.getItem("cricYuvaJerseyNumber") || "",
          jerseySize: localStorage.getItem("cricYuvaJerseySize") || "",
          pantSize: localStorage.getItem("cricYuvaPantSize") || "",
          dateOfBirth: localStorage.getItem("cricYuvaDateOfBirth") || ""
        }) });
      } catch (e) {}

      loadProfileData();

      if (window.NotificationService && window.NotificationService.addNotification) {
        window.NotificationService.addNotification({
          title: "Profile Updated",
          message: `Profile details for ${localStorage.getItem("cricYuvaProfileName") || "Player"} have been saved successfully.`,
          type: "profile"
        });
      }
      alert("Profile changes saved successfully!");
      // Directly transition to MAIN HOME PAGE (Screen 5)
      showScreen("screen5");
    });
  }


  // ==========================================
  // 3-LINE MENU DRAWER CONTROLS
  // ==========================================

  const homeMenuBtn = document.getElementById("homeMenuBtn");
  const menuDrawer = document.getElementById("menuDrawer");
  const menuDrawerOverlay = document.getElementById("menuDrawerOverlay");
  const drawerCloseBtn = document.getElementById("drawerCloseBtn");

  function openMenuDrawer() {
    loadProfileData();
    if (menuDrawer) menuDrawer.classList.add("active");
    if (menuDrawerOverlay) menuDrawerOverlay.classList.add("active");
  }

  function closeMenuDrawer() {
    if (menuDrawer) menuDrawer.classList.remove("active");
    if (menuDrawerOverlay) menuDrawerOverlay.classList.remove("active");
  }

  if (homeMenuBtn) {
    homeMenuBtn.addEventListener("click", openMenuDrawer);
  }

  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener("click", closeMenuDrawer);
  }

  if (menuDrawerOverlay) {
    menuDrawerOverlay.addEventListener("click", closeMenuDrawer);
  }

  // Drawer Profile Click -> Open Screen 4 (Profile)
  const drawerItemProfile = document.getElementById("drawerItemProfile");
  const drawerProfileClick = document.getElementById("drawerProfileClick");

  function openProfileFromDrawer() {
    closeMenuDrawer();
    loadProfileData();
    showScreen("screen4");
  }

  if (drawerItemProfile) drawerItemProfile.addEventListener("click", openProfileFromDrawer);
  if (drawerProfileClick) drawerProfileClick.addEventListener("click", openProfileFromDrawer);

  // Drawer other items
  const drawerItemTeam = document.getElementById("drawerItemTeam");
  if (drawerItemTeam) {
    drawerItemTeam.addEventListener("click", function () {
      closeMenuDrawer();
      renderMyTeamPage();
      showScreen("screen6");
    });
  }

  const drawerItemMatches = document.getElementById("drawerItemMatches");
  if (drawerItemMatches) {
    drawerItemMatches.addEventListener("click", function () {
      closeMenuDrawer();
      renderMatchHistoryScreen();
      showScreen("screen9");
    });
  }

  const drawerItemTournament = document.getElementById("drawerItemTournament");
  if (drawerItemTournament) {
    drawerItemTournament.addEventListener("click", function () {
      closeMenuDrawer();
      openTournamentScreen();
    });
  }

  const drawerItemStats = document.getElementById("drawerItemStats");
  if (drawerItemStats) {
    drawerItemStats.addEventListener("click", function () {
      closeMenuDrawer();
      renderPlayerStatsScreen();
      showScreen("screen10");
    });
  }

  // Settings Modal Controls
  const drawerItemSettings = document.getElementById("drawerItemSettings");
  const settingsModalBackdrop = document.getElementById("settingsModalBackdrop");
  const settingsCloseBtn = document.getElementById("settingsCloseBtn");

  function openSettingsModal() {
    if (!settingsModalBackdrop) return;
    // Load and sync current settings from storage
    const settingTts = document.getElementById("settingCommentaryTts");
    if (settingTts) settingTts.checked = localStorage.getItem("cricYuvaSettingTts") !== "false";

    const settingSound = document.getElementById("settingSoundFx");
    if (settingSound) settingSound.checked = localStorage.getItem("cricYuvaSettingSoundFx") !== "false";

    const settingAuto = document.getElementById("settingAutoSave");
    if (settingAuto) settingAuto.checked = localStorage.getItem("cricYuvaSettingAutoSave") !== "false";

    const settingLive = document.getElementById("settingLiveBroadcast");
    if (settingLive) settingLive.checked = localStorage.getItem("cricYuvaSettingLiveBroadcast") !== "false";

    const currentTheme = localStorage.getItem("cricYuvaTheme") || "dark";
    const btnThemeDark = document.getElementById("btnThemeDark");
    const btnThemeLight = document.getElementById("btnThemeLight");
    if (btnThemeDark && btnThemeLight) {
      if (currentTheme === "light") {
        btnThemeLight.classList.add("active");
        btnThemeDark.classList.remove("active");
      } else {
        btnThemeDark.classList.add("active");
        btnThemeLight.classList.remove("active");
      }
    }

    settingsModalBackdrop.style.display = "flex";
  }

  function closeSettingsModal() {
    if (settingsModalBackdrop) settingsModalBackdrop.style.display = "none";
  }

  if (drawerItemSettings) {
    drawerItemSettings.addEventListener("click", function () {
      closeMenuDrawer();
      openSettingsModal();
    });
  }

  if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener("click", closeSettingsModal);
  }

  if (settingsModalBackdrop) {
    settingsModalBackdrop.addEventListener("click", function (e) {
      if (e.target === settingsModalBackdrop) closeSettingsModal();
    });
  }

  // Settings Change Handlers
  const settingCommentaryTts = document.getElementById("settingCommentaryTts");
  if (settingCommentaryTts) {
    settingCommentaryTts.addEventListener("change", function () {
      localStorage.setItem("cricYuvaSettingTts", this.checked ? "true" : "false");
      showToast(this.checked ? "Commentary TTS speech enabled" : "Commentary TTS speech muted");
    });
  }

  const settingSoundFx = document.getElementById("settingSoundFx");
  if (settingSoundFx) {
    settingSoundFx.addEventListener("change", function () {
      localStorage.setItem("cricYuvaSettingSoundFx", this.checked ? "true" : "false");
      showToast(this.checked ? "Boundary Sound FX enabled" : "Boundary Sound FX disabled");
    });
  }

  const settingAutoSave = document.getElementById("settingAutoSave");
  if (settingAutoSave) {
    settingAutoSave.addEventListener("change", function () {
      localStorage.setItem("cricYuvaSettingAutoSave", this.checked ? "true" : "false");
      showToast(this.checked ? "Instant Match Auto-Save active" : "Auto-Save disabled");
    });
  }

  const settingLiveBroadcast = document.getElementById("settingLiveBroadcast");
  if (settingLiveBroadcast) {
    settingLiveBroadcast.addEventListener("change", function () {
      localStorage.setItem("cricYuvaSettingLiveBroadcast", this.checked ? "true" : "false");
      showToast(this.checked ? "Live Score Broadcast active" : "Live Score Broadcast paused");
    });
  }

  const btnThemeDark = document.getElementById("btnThemeDark");
  const btnThemeLight = document.getElementById("btnThemeLight");

  if (btnThemeDark && btnThemeLight) {
    btnThemeDark.addEventListener("click", function () {
      btnThemeDark.classList.add("active");
      btnThemeLight.classList.remove("active");
      localStorage.setItem("cricYuvaTheme", "dark");
      document.body.classList.remove("stadium-light-theme");
      showToast("Dark Stadium theme applied");
    });

    btnThemeLight.addEventListener("click", function () {
      btnThemeLight.classList.add("active");
      btnThemeDark.classList.remove("active");
      localStorage.setItem("cricYuvaTheme", "light");
      document.body.classList.add("stadium-light-theme");
      showToast("Stadium Light theme applied");
    });
  }

  const btnSettingsResetCache = document.getElementById("btnSettingsResetCache");
  if (btnSettingsResetCache) {
    btnSettingsResetCache.addEventListener("click", function () {
      seedDefaultHistoryIfEmpty();
      showToast("Cache refreshed & data re-synchronized successfully!");
      closeSettingsModal();
    });
  }

  // Help & Support Modal Controls
  const drawerItemHelp = document.getElementById("drawerItemHelp");
  const helpModalBackdrop = document.getElementById("helpModalBackdrop");
  const helpCloseBtn = document.getElementById("helpCloseBtn");

  function openHelpModal() {
    if (helpModalBackdrop) helpModalBackdrop.style.display = "flex";
  }

  function closeHelpModal() {
    if (helpModalBackdrop) helpModalBackdrop.style.display = "none";
  }

  if (drawerItemHelp) {
    drawerItemHelp.addEventListener("click", function () {
      closeMenuDrawer();
      openHelpModal();
    });
  }

  if (helpCloseBtn) {
    helpCloseBtn.addEventListener("click", closeHelpModal);
  }

  if (helpModalBackdrop) {
    helpModalBackdrop.addEventListener("click", function (e) {
      if (e.target === helpModalBackdrop) closeHelpModal();
    });
  }

  // FAQ Accordion Toggle Handlers
  document.querySelectorAll(".faq-question-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const item = btn.closest(".faq-accordion-item");
      if (item) {
        item.classList.toggle("open");
      }
    });
  });

  const btnWhatsAppSupport = document.getElementById("btnWhatsAppSupport");
  if (btnWhatsAppSupport) {
    btnWhatsAppSupport.addEventListener("click", function () {
      showToast("Connecting to WhatsApp Support Assistant (+91 98822-YUVA)...");
    });
  }

  const btnQuickScoringGuide = document.getElementById("btnQuickScoringGuide");
  if (btnQuickScoringGuide) {
    btnQuickScoringGuide.addEventListener("click", function () {
      showToast("Opening Cric Yuva Official Rulebook & Scoring Guide...");
    });
  }

  const btnSubmitFeedback = document.getElementById("btnSubmitFeedback");
  const helpFeedbackText = document.getElementById("helpFeedbackText");
  if (btnSubmitFeedback && helpFeedbackText) {
    btnSubmitFeedback.addEventListener("click", function () {
      const txt = helpFeedbackText.value.trim();
      if (!txt) {
        showToast("Please enter your message or question before submitting");
        return;
      }
      helpFeedbackText.value = "";
      closeHelpModal();
      showToast("Thank you! Your feedback has been sent to our support team.");
    });
  }


  // ==========================================
  // LIVE STREAM & SCORECARD TOGGLE
  // ==========================================

  const btnShowVideo = document.getElementById("btnShowVideo");
  const btnShowScorecard = document.getElementById("btnShowScorecard");
  const liveVideoContainer = document.getElementById("liveVideoContainer");
  const liveScorecardContainer = document.getElementById("liveScorecardContainer");

  if (btnShowVideo && btnShowScorecard) {
    btnShowVideo.addEventListener("click", function () {
      btnShowVideo.classList.add("active");
      btnShowScorecard.classList.remove("active");
      if (liveVideoContainer) liveVideoContainer.style.display = "block";
      if (liveScorecardContainer) liveScorecardContainer.style.display = "none";
    });

    btnShowScorecard.addEventListener("click", function () {
      btnShowScorecard.classList.add("active");
      btnShowVideo.classList.remove("active");
      if (liveVideoContainer) liveVideoContainer.style.display = "none";
      if (liveScorecardContainer) liveScorecardContainer.style.display = "block";
    });
  }

  // Social streaming buttons
  document.querySelectorAll(".stream-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const platform = btn.textContent.trim();
      if (window.openBroadcastCenterModal) {
        window.openBroadcastCenterModal("SINGLE_MATCH", null, platform);
      }
    });
  });


  // ==========================================
  // MATCH CENTER TABS (LIVE & PAST)
  // ==========================================

  const tabLiveMatches = document.getElementById("tabLiveMatches");
  const tabPastMatches = document.getElementById("tabPastMatches");
  const liveMatchesContainer = document.getElementById("liveMatchesContainer");
  const pastMatchesContainer = document.getElementById("pastMatchesContainer");

  if (tabLiveMatches && tabPastMatches) {
    tabLiveMatches.addEventListener("click", function () {
      tabLiveMatches.classList.add("active");
      tabPastMatches.classList.remove("active");
      if (liveMatchesContainer) liveMatchesContainer.style.display = "flex";
      if (pastMatchesContainer) pastMatchesContainer.style.display = "none";
    });

    tabPastMatches.addEventListener("click", function () {
      tabPastMatches.classList.add("active");
      tabLiveMatches.classList.remove("active");
      if (liveMatchesContainer) liveMatchesContainer.style.display = "none";
      if (pastMatchesContainer) pastMatchesContainer.style.display = "flex";
    });
  }


  // ==========================================
  // SCORECARD MODAL POPUP
  // ==========================================

  const scorecardModal = document.getElementById("scorecardModal");
  const scorecardCloseBtn = document.getElementById("scorecardCloseBtn");

  document.querySelectorAll(".view-scorecard-btn").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const pastCard = btn.closest(".past-card");
      if (pastCard && pastCard.dataset.matchId) {
        const historyList = getMatchHistoryList();
        const matched = historyList.find(m => m.matchId === pastCard.dataset.matchId);
        if (matched) { openHistoryMatchDetailsModal(matched); return; }
      }
      if (scorecardModal) scorecardModal.style.display = "flex";
    });
  });

  if (scorecardCloseBtn && scorecardModal) {
    scorecardCloseBtn.addEventListener("click", function () {
      scorecardModal.style.display = "none";
    });

    scorecardModal.addEventListener("click", function (e) {
      if (e.target === scorecardModal) {
        scorecardModal.style.display = "none";
      }
    });
  }


  // ==========================================
  // NOTIFICATIONS MODAL POPUP
  // ==========================================

  // ==========================================
  // DYNAMIC NOTIFICATION SERVICE
  // ==========================================
  const NotificationService = {
    STORAGE_KEY: "cricYuvaNotifications",
    getNotifications() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      const defaults = [
        {
          id: "notif_welcome",
          title: "Welcome to Cric Yuva!",
          message: "Experience professional cricket scoring, auction tournaments & live broadcast studio.",
          time: "Just now",
          type: "welcome",
          unread: true
        },
        {
          id: "notif_system_ready",
          title: "Scoring & Tournaments Ready",
          message: "Single Match, Regular Tournament & Auction Tournament are ready for live action.",
          time: "5m ago",
          type: "match",
          unread: false
        }
      ];
      this.save(defaults);
      return defaults;
    },
    save(list) {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(list));
      } catch (e) {}
      this.updateBadge();
    },
    addNotification({ title, message, type = "event" }) {
      const list = this.getNotifications();
      const newNotif = {
        id: `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        title: title || "Cricket Notification",
        message: message || "",
        time: "Just now",
        type: type,
        unread: true
      };
      list.unshift(newNotif);
      if (list.length > 50) list.pop();
      this.save(list);
      this.render();
    },
    clearAll() {
      this.save([]);
      this.render();
    },
    markAllRead() {
      const list = this.getNotifications();
      list.forEach(n => n.unread = false);
      this.save(list);
      this.render();
    },
    updateBadge() {
      const list = this.getNotifications();
      const unreadCount = list.filter(n => n.unread).length;
      const homeBadge = document.getElementById("homeNotifBadge");
      const countPill = document.getElementById("notifModalCountPill");
      if (homeBadge) {
        if (unreadCount > 0) {
          homeBadge.style.display = "block";
          homeBadge.textContent = unreadCount > 9 ? "9+" : unreadCount;
        } else {
          homeBadge.style.display = "none";
        }
      }
      if (countPill) {
        countPill.textContent = `${unreadCount} New`;
      }
    },
    render() {
      const container = document.getElementById("notifListContainer");
      const emptyState = document.getElementById("notifEmptyState");
      if (!container) return;
      const list = this.getNotifications();
      this.updateBadge();

      if (list.length === 0) {
        container.innerHTML = "";
        if (emptyState) emptyState.style.display = "block";
        return;
      }

      if (emptyState) emptyState.style.display = "none";

      const icons = {
        match: "fa-solid fa-baseball-bat-ball",
        tournament: "fa-solid fa-trophy",
        auction: "fa-solid fa-gavel",
        profile: "fa-solid fa-user-check",
        welcome: "fa-solid fa-handshake-angle",
        event: "fa-solid fa-bell"
      };

      container.innerHTML = list.map(n => `
        <div class="notif-item ${n.unread ? 'unread' : ''}" data-id="${n.id}">
          <div class="notif-item-icon">
            <i class="${icons[n.type] || icons.event}"></i>
          </div>
          <div class="notif-item-body">
            <div class="notif-item-title">${n.title}</div>
            <div class="notif-item-desc">${n.message}</div>
            <div class="notif-item-time">${n.time}</div>
          </div>
          <button type="button" class="notif-delete-btn" data-id="${n.id}" title="Delete notification" aria-label="Delete notification">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      `).join("");

      container.querySelectorAll(".notif-item").forEach(item => {
        item.addEventListener("click", (event) => {
          if (event.target.closest(".notif-delete-btn")) return;
          const id = item.dataset.id;
          const currentList = this.getNotifications();
          const target = currentList.find(x => x.id === id);
          if (target) {
            target.unread = false;
            this.save(currentList);
            item.classList.remove("unread");
          }
        });
      });
      container.querySelectorAll(".notif-delete-btn").forEach(btn => {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          const id = btn.dataset.id;
          this.save(this.getNotifications().filter(n => n.id !== id));
          this.render();
        });
      });
    }
  };
  window.NotificationService = NotificationService;

  const notifButton = document.getElementById("notifButton");
  const notifModal = document.getElementById("notifModal");
  const notifCloseBtn = document.getElementById("notifCloseBtn");
  const btnClearAllNotifs = document.getElementById("btnClearAllNotifs");

  if (notifButton && notifModal) {
    notifButton.addEventListener("click", function () {
      NotificationService.render();
      notifModal.style.display = "flex";
    });
  }

  if (btnClearAllNotifs) {
    btnClearAllNotifs.addEventListener("click", function () {
      NotificationService.clearAll();
    });
  }

  if (notifCloseBtn && notifModal) {
    notifCloseBtn.addEventListener("click", function () {
      notifModal.style.display = "none";
    });

    notifModal.addEventListener("click", function (e) {
      if (e.target === notifModal) {
        notifModal.style.display = "none";
      }
    });
  }

  // Initialize badge at startup
  NotificationService.updateBadge();


  // ==========================================
  // CENTER PLUS (+) QUICK ACTIONS MODAL
  // ==========================================

  const centerPlusBtn = document.getElementById("centerPlusBtn");
  const quickPlusModalBackdrop = document.getElementById("quickPlusModalBackdrop");
  const quickPlusCloseBtn = document.getElementById("quickPlusCloseBtn");

  if (centerPlusBtn && quickPlusModalBackdrop) {
    centerPlusBtn.addEventListener("click", function () {
      quickPlusModalBackdrop.style.display = "flex";
    });
  }

  if (quickPlusCloseBtn && quickPlusModalBackdrop) {
    quickPlusCloseBtn.addEventListener("click", function () {
      quickPlusModalBackdrop.style.display = "none";
    });

    quickPlusModalBackdrop.addEventListener("click", function (e) {
      if (e.target === quickPlusModalBackdrop) {
        quickPlusModalBackdrop.style.display = "none";
      }
    });
  }

  // Quick Action Buttons
  const qaStartMatch = document.getElementById("qaStartMatch");
  if (qaStartMatch) {
    qaStartMatch.addEventListener("click", function () {
      if (quickPlusModalBackdrop) quickPlusModalBackdrop.style.display = "none";
      openStartMatchSetup();
    });
  }

  const qaCreateTournament = document.getElementById("qaCreateTournament");
  if (qaCreateTournament) {
    qaCreateTournament.addEventListener("click", function () {
      if (quickPlusModalBackdrop) quickPlusModalBackdrop.style.display = "none";
      openCreateTournamentWizard();
    });
  }

  const qaAddTeam = document.getElementById("qaAddTeam");
  if (qaAddTeam) {
    qaAddTeam.addEventListener("click", function () {
      quickPlusModalBackdrop.style.display = "none";
      renderMyTeamPage();
      showScreen("screen6");
    });
  }

  const qaLiveStream = document.getElementById("qaLiveStream");
  if (qaLiveStream) {
    qaLiveStream.addEventListener("click", function () {
      if (quickPlusModalBackdrop) quickPlusModalBackdrop.style.display = "none";
      if (window.openBroadcastCenterModal) {
        window.openBroadcastCenterModal();
      }
    });
  }


  // ==========================================
  // HUB 4 OPTION CARDS
  // ==========================================

  const optMyTeam = document.getElementById("optMyTeam");
  if (optMyTeam) {
    optMyTeam.addEventListener("click", function () {
      renderMyTeamPage();
      showScreen("screen6");
    });
  }

  const optMatches = document.getElementById("optMatches");
  if (optMatches) {
    optMatches.addEventListener("click", function () {
      renderMatchHistoryScreen();
      showScreen("screen9");
    });
  }

  const optTournament = document.getElementById("optTournament");
  if (optTournament) {
    optTournament.addEventListener("click", function () {
      openTournamentScreen();
    });
  }

  const optStatistics = document.getElementById("optStatistics");
  if (optStatistics) {
    optStatistics.addEventListener("click", function () {
      renderPlayerStatsScreen();
      showScreen("screen10");
    });
  }

  // ==========================================
  // HOME QUICK ACCESS & UPCOMING MATCHES
  // ==========================================

  const homeQaStartMatch = document.getElementById("homeQaStartMatch");
  if (homeQaStartMatch) {
    homeQaStartMatch.addEventListener("click", function () {
      openStartMatchSetup();
    });
  }

  const homeQaTournament = document.getElementById("homeQaTournament");
  if (homeQaTournament) {
    homeQaTournament.addEventListener("click", function () {
      openTournamentOverviewStandings();
    });
  }

  const homeQaMyTeam = document.getElementById("homeQaMyTeam");
  if (homeQaMyTeam) {
    homeQaMyTeam.addEventListener("click", function () {
      renderMyTeamPage();
      showScreen("screen6");
    });
  }

  const homeQaHistory = document.getElementById("homeQaHistory");
  if (homeQaHistory) {
    homeQaHistory.addEventListener("click", function () {
      renderMatchHistoryScreen();
      showScreen("screen9");
    });
  }

  const btnHomeViewAllUpcoming = document.getElementById("btnHomeViewAllUpcoming");
  if (btnHomeViewAllUpcoming) {
    btnHomeViewAllUpcoming.addEventListener("click", function () {
      const matchSection = document.querySelector(".matches-slide-section");
      if (matchSection) {
        matchSection.scrollIntoView({ behavior: "smooth" });
      } else {
        renderMatchHistoryScreen();
        showScreen("screen9");
      }
    });
  }

  // Start Upcoming Match from Home Card
  document.addEventListener("click", function (e) {
    const btn = e.target.closest(".btn-start-upcoming-match");
    if (!btn) return;
    const teamA = btn.dataset.teama || "";
    const teamB = btn.dataset.teamb || "";
    const overs = parseInt(btn.dataset.overs, 10) || 20;
    const ground = btn.dataset.ground || "";
    const tournament = btn.dataset.tournament || "";

    openStartMatchSetup({
      teamA: teamA,
      teamB: teamB,
      overs: overs,
      ground: ground,
      tournament: tournament
    });
  });


  // ==========================================
  // BOTTOM NAVIGATION BAR
  // ==========================================

  const navHome = document.getElementById("navHome");
  if (navHome) {
    navHome.addEventListener("click", function () {
      if (typeof updateHomeLiveScoreboard === "function") updateHomeLiveScoreboard();
      showScreen("screen5");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const navMatches = document.getElementById("navMatches");
  if (navMatches) {
    navMatches.addEventListener("click", function () {
      renderMatchHistoryScreen();
      showScreen("screen9");
    });
  }

  const navUpdates = document.getElementById("navUpdates");
  if (navUpdates) {
    navUpdates.addEventListener("click", function () {
      if (notifModal) notifModal.style.display = "flex";
    });
  }

  const navMenu = document.getElementById("navMenu");
  if (navMenu) {
    navMenu.addEventListener("click", openMenuDrawer);
  }


  // ==========================================
  // FORGOT PASSWORD
  // ==========================================

  const forgotPasswordButton = document.getElementById("forgotPasswordButton");
  const forgotPasswordModal = document.getElementById("forgotPasswordModal");
  const forgotPasswordCloseBtn = document.getElementById("forgotPasswordCloseBtn");
  const btnResetPasswordSubmit = document.getElementById("btnResetPasswordSubmit");

  if (forgotPasswordButton && forgotPasswordModal) {
    forgotPasswordButton.addEventListener("click", function () {
      const mobileInput = document.getElementById("loginMobile");
      const forgotMobile = document.getElementById("forgotMobileInput");
      if (forgotMobile && mobileInput && mobileInput.value) {
        forgotMobile.value = mobileInput.value.trim();
      }
      forgotPasswordModal.style.display = "flex";
    });
  }

  if (forgotPasswordCloseBtn && forgotPasswordModal) {
    forgotPasswordCloseBtn.addEventListener("click", function () {
      forgotPasswordModal.style.display = "none";
    });
    forgotPasswordModal.addEventListener("click", function (e) {
      if (e.target === forgotPasswordModal) {
        forgotPasswordModal.style.display = "none";
      }
    });
  }

  if (btnResetPasswordSubmit && forgotPasswordModal) {
    btnResetPasswordSubmit.addEventListener("click", function () {
      const mobile = (document.getElementById("forgotMobileInput")?.value || "").trim();
      const newPass = (document.getElementById("forgotNewPasswordInput")?.value || "").trim();
      const confirmPass = (document.getElementById("forgotVerifyPasswordInput")?.value || "").trim();

      if (!mobile || !/^\d{10}$/.test(mobile)) {
        alert("Please enter a valid 10-digit registered mobile number.");
        return;
      }
      if (!newPass || newPass.length < 4) {
        alert("Password must be at least 4 characters long.");
        return;
      }
      if (newPass !== confirmPass) {
        alert("Passwords do not match. Please re-enter.");
        return;
      }

      localStorage.setItem("cricYuvaMobile", mobile);
      localStorage.setItem("cricYuvaPassword", newPass);

      const loginMobile = document.getElementById("loginMobile");
      const loginPassword = document.getElementById("loginPassword");
      if (loginMobile) loginMobile.value = mobile;
      if (loginPassword) loginPassword.value = newPass;

      if (window.NotificationService && window.NotificationService.addNotification) {
        window.NotificationService.addNotification({
          title: "Password Updated",
          message: "Your Cric Yuva account password has been reset successfully.",
          type: "profile"
        });
      }

      alert("Password reset successfully! You can now log in.");
      forgotPasswordModal.style.display = "none";
    });
  }


  // ==========================================
  // SCREEN 6 — MY TEAM MODULE (STEP 3)
  // ==========================================

  const TEAM_STORAGE_KEY = "cricYuvaTeamData";
  let currentRoleFilter = "all";
  let tempTeamLogoDataUrl = "";
  let tempPlayerPhotoDataUrl = "";

  // Back Button Navigation (Team Screen -> Home Screen)
  const teamBackButton = document.getElementById("teamBackButton");
  if (teamBackButton) {
    teamBackButton.addEventListener("click", function () {
      showScreen("screen5");
    });
  }

  // Get Saved Team Data from localStorage (User-isolated)
  function getTeamData() {
    try {
      const data = getUserStorage(TEAM_STORAGE_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error("Error reading team data:", e);
      return null;
    }
  }

  function getMyTeamData() {
    return getTeamData() || initDefaultTeam();
  }

  // Save Team Data to localStorage (User-isolated)
  function saveTeamData(teamData) {
    try {
      if (teamData && teamData.teamName && !teamData.id) teamData.id = `team_${String(teamData.teamName).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}_${Date.now()}`;
      setUserStorage(TEAM_STORAGE_KEY, JSON.stringify(teamData));
      if (teamData && teamData.teamName && window.CricYuvaCloud) {
        window.CricYuvaCloud.request("/api/teams", { method: "POST", body: JSON.stringify({
          id: teamData.id || ("team_" + btoa(unescape(encodeURIComponent(teamData.teamName))).replace(/[^a-z0-9]/gi, "").slice(0, 24)),
          name: teamData.teamName, logo: teamData.teamLogo || teamData.logo || "", players: teamData.players || [],
          captainName: teamData.captainName || "", viceCaptainName: teamData.viceCaptainName || ""
        }) }).catch(() => {});
      }
    } catch (e) {
      console.error("Error saving team data:", e);
    }
  }

  // Initialize Default Team (incorporates real user profile data if available)
  function initDefaultTeam() {
    const savedName = localStorage.getItem("cricYuvaProfileName") || localStorage.getItem("cricYuvaName") || "";
    const savedPhoto = localStorage.getItem("cricYuvaProfilePhoto") || "";
    const savedJersey = localStorage.getItem("cricYuvaJerseyNumber") || "";
    return {
      teamName: "",
      teamLogo: "",
      captainName: savedName.trim(),
      viceCaptainName: "",
      players: savedName.trim() ? [{
        id: localStorage.getItem("cricYuvaPlayerId") || ("CY2026-" + (localStorage.getItem("cricYuvaProfileMobile") || "").slice(-4)),
        name: savedName.trim(),
        role: "Batsman",
        jersey: savedJersey,
        isCaptain: true,
        isViceCaptain: false,
        photo: savedPhoto
      }] : []
    };
  }

  // Get Initials for Logo
  function getInitials(text) {
    if (!text) return "MY";
    const parts = text.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // Render My Team Screen
  function renderMyTeamPage(filter = currentRoleFilter) {
    currentRoleFilter = filter;
    let team = getTeamData();

    const noTeamContainer = document.getElementById("noTeamContainer");
    const activeTeamContainer = document.getElementById("activeTeamContainer");

    if (!team || !team.players || team.players.length === 0) {
      if (noTeamContainer) noTeamContainer.style.display = "block";
      if (activeTeamContainer) activeTeamContainer.style.display = "none";
      return;
    }

    if (noTeamContainer) noTeamContainer.style.display = "none";
    if (activeTeamContainer) activeTeamContainer.style.display = "flex";

    // Set Team Header Data
    const teamNameDisplay = document.getElementById("teamNameDisplay");
    if (teamNameDisplay) teamNameDisplay.textContent = team.teamName || "My Team";

    const teamLogoDisplay = document.getElementById("teamLogoDisplay");
    if (teamLogoDisplay) {
      if (team.teamLogo) {
        teamLogoDisplay.innerHTML = `<img src="${team.teamLogo}" alt="${team.teamName}">`;
      } else {
        teamLogoDisplay.innerHTML = `<div class="team-logo-initials" id="teamLogoInitials">${getInitials(team.teamName)}</div>`;
      }
    }

    // Set Captain and Vice-Captain
    const captainPlayer = team.players.find(p => p.isCaptain);
    const vcPlayer = team.players.find(p => p.isViceCaptain);

    const teamCaptainDisplay = document.getElementById("teamCaptainDisplay");
    if (teamCaptainDisplay) {
      teamCaptainDisplay.textContent = captainPlayer ? captainPlayer.name : (team.captainName || "Not Assigned");
    }

    const teamViceCaptainDisplay = document.getElementById("teamViceCaptainDisplay");
    if (teamViceCaptainDisplay) {
      teamViceCaptainDisplay.textContent = vcPlayer ? vcPlayer.name : (team.viceCaptainName || "Not Assigned");
    }

    // Update Counts
    const totalCount = team.players.length;
    const batCount = team.players.filter(p => p.role === "Batsman").length;
    const bowlCount = team.players.filter(p => p.role === "Bowler").length;
    const arCount = team.players.filter(p => p.role === "All-Rounder").length;
    const wkCount = team.players.filter(p => p.role === "Wicket Keeper").length;

    const teamTotalPlayersCount = document.getElementById("teamTotalPlayersCount");
    if (teamTotalPlayersCount) teamTotalPlayersCount.innerHTML = `<i class="fa-solid fa-users"></i> ${totalCount} Players`;

    const squadListCount = document.getElementById("squadListCount");
    if (squadListCount) squadListCount.textContent = totalCount;

    const countAll = document.getElementById("countAll");
    if (countAll) countAll.textContent = totalCount;

    const countBat = document.getElementById("countBat");
    if (countBat) countBat.textContent = batCount;

    const countBowl = document.getElementById("countBowl");
    if (countBowl) countBowl.textContent = bowlCount;

    const countAllR = document.getElementById("countAllR");
    if (countAllR) countAllR.textContent = arCount;

    const countWk = document.getElementById("countWk");
    if (countWk) countWk.textContent = wkCount;

    // Filter Players
    let filteredPlayers = team.players;
    if (filter !== "all") {
      filteredPlayers = team.players.filter(p => p.role === filter);
    }

    // Render Players List
    const playersListContainer = document.getElementById("playersListContainer");
    if (playersListContainer) {
      if (filteredPlayers.length === 0) {
        playersListContainer.innerHTML = `
          <div style="text-align:center; padding: 24px; color: #8c93a4; font-size: 13px;">
            No players found for role <b>${filter}</b>.
          </div>
        `;
      } else {
        playersListContainer.innerHTML = filteredPlayers.map(player => {
          let roleBadgeClass = "bat-tag";
          let roleIcon = '<i class="fa-solid fa-baseball-bat-ball"></i>';
          
          if (player.role === "Bowler") {
            roleBadgeClass = "bowl-tag";
            roleIcon = '<i class="fa-solid fa-bullseye"></i>';
          } else if (player.role === "All-Rounder") {
            roleBadgeClass = "ar-tag";
            roleIcon = '<i class="fa-solid fa-bolt"></i>';
          } else if (player.role === "Wicket Keeper") {
            roleBadgeClass = "wk-tag";
            roleIcon = '<i class="fa-solid fa-mitten"></i>';
          }

          const isCapClass = player.isCaptain ? "is-captain" : (player.isViceCaptain ? "is-vice-captain" : "");
          const initials = getInitials(player.name);

          const inXI = player.inPlayingXI !== false;
          const xiBadge = `
            <span class="playing-xi-badge ${inXI ? 'in-xi' : 'bench'}" data-toggle-xi="${player.id}" title="${inXI ? 'In Playing XI (Tap to Bench)' : 'On Bench (Tap to add to XI)'}">
              <i class="fa-solid ${inXI ? 'fa-check' : 'fa-chair'}"></i> ${inXI ? 'XI' : 'BENCH'}
            </span>
          `;
          return `
            <div class="player-card-item ${isCapClass}" data-player-id="${player.id}" style="cursor:pointer;">
              <div class="player-card-left">
                <div class="player-avatar-box">
                  ${player.photo ? `<img src="${player.photo}" alt="${player.name}">` : `<span>${initials}</span>`}
                </div>
                <div class="player-info-meta">
                  <div class="player-name-row">
                    <strong>${player.name}</strong>
                    ${player.jersey ? `<span class="player-jersey-badge">#${player.jersey}</span>` : ""}
                  </div>
                  <div class="player-role-tags">
                    ${player.isCaptain ? '<span class="role-badge captain-tag">👑 Captain</span>' : ""}
                    ${player.isViceCaptain ? '<span class="role-badge vc-tag">🎖️ Vice-Captain</span>' : ""}
                    <span class="role-badge ${roleBadgeClass}">${roleIcon} ${player.role}</span>
                    ${xiBadge}
                  </div>
                </div>
              </div>
              <div class="player-card-actions">
                <button type="button" class="player-action-icon-btn btn-edit-player" data-id="${player.id}" title="Edit Player">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button type="button" class="player-action-icon-btn delete-btn btn-delete-player" data-id="${player.id}" title="Remove Player">
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>
            </div>
          `;
        }).join("");
      }
    }

    // Attach Player Action Handlers
    attachPlayerActionHandlers();
  }

  // Filter Chips Click
  const roleFilterChips = document.querySelectorAll(".role-filter-chip");
  roleFilterChips.forEach(chip => {
    chip.addEventListener("click", function () {
      roleFilterChips.forEach(c => c.classList.remove("active"));
      this.classList.add("active");
      const filter = this.getAttribute("data-filter") || "all";
      renderMyTeamPage(filter);
    });
  });

  // Attach Edit/Delete/Toggle XI/Profile Listeners to rendered player cards
  function attachPlayerActionHandlers() {
    // Edit Player
    document.querySelectorAll(".btn-edit-player").forEach(btn => {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const playerId = this.getAttribute("data-id");
        openEditPlayerModal(playerId);
      });
    });

    // Delete Player
    document.querySelectorAll(".btn-delete-player").forEach(btn => {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const playerId = this.getAttribute("data-id");
        handleDeletePlayer(playerId);
      });
    });

    // Toggle Playing XI
    document.querySelectorAll("[data-toggle-xi]").forEach(btn => {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const playerId = this.getAttribute("data-toggle-xi");
        togglePlayerPlayingXI(playerId);
      });
    });

    // Tap Player Card to view detailed profile modal
    document.querySelectorAll(".player-card-item").forEach(card => {
      card.addEventListener("click", function (e) {
        if (e.target.closest(".player-action-icon-btn") || e.target.closest(".playing-xi-badge")) return;
        const playerId = this.getAttribute("data-player-id");
        if (playerId) openPlayerProfileDetailModal(playerId);
      });
    });
  }

  function handleDeletePlayer(playerId) {
    const team = getTeamData();
    if (!team || !team.players) return;

    const player = team.players.find(p => p.id === playerId);
    if (!player) return;

    const confirmDelete = confirm(`Are you sure you want to remove ${player.name} from the squad?`);
    if (confirmDelete) {
      team.players = team.players.filter(p => p.id !== playerId);
      // If deleted player was captain, reset captain name
      if (player.isCaptain) {
        team.captainName = "Not Assigned";
      }
      if (player.isViceCaptain) {
        team.viceCaptainName = "Not Assigned";
      }
      saveTeamData(team);
      renderMyTeamPage(currentRoleFilter);
    }
  }

  // ==========================================
  // CREATE / EDIT TEAM MODAL
  // ==========================================

  const teamModal = document.getElementById("teamModal");
  const teamModalCloseBtn = document.getElementById("teamModalCloseBtn");
  const teamForm = document.getElementById("teamForm");
  const btnCreateTeamOpen = document.getElementById("btnCreateTeamOpen");
  const btnEditTeamOpen = document.getElementById("btnEditTeamOpen");
  const teamTopActionBtn = document.getElementById("teamTopActionBtn");
  const teamLogoFileInput = document.getElementById("teamLogoFileInput");
  const teamLogoPickerBox = document.getElementById("teamLogoPickerBox");
  const teamLogoModalPreview = document.getElementById("teamLogoModalPreview");
  const inputTeamName = document.getElementById("inputTeamName");
  const inputCaptainName = document.getElementById("inputCaptainName");
  const inputViceCaptainName = document.getElementById("inputViceCaptainName");
  const teamModalTitle = document.getElementById("teamModalTitle");

  function openTeamModal(isEdit = false) {
    const team = getTeamData() || {
      teamName: "",
      teamLogo: "",
      captainName: localStorage.getItem("cricYuvaProfileName") || "",
      viceCaptainName: "",
      players: []
    };

    if (teamModalTitle) {
      teamModalTitle.textContent = isEdit ? "Edit Team Details" : "Create Team";
    }

    if (inputTeamName) inputTeamName.value = team.teamName || "";
    if (inputCaptainName) inputCaptainName.value = team.captainName || localStorage.getItem("cricYuvaProfileName") || "";
    if (inputViceCaptainName) inputViceCaptainName.value = team.viceCaptainName || "";

    tempTeamLogoDataUrl = team.teamLogo || "";
    if (teamLogoModalPreview) {
      if (tempTeamLogoDataUrl) {
        teamLogoModalPreview.innerHTML = `<img src="${tempTeamLogoDataUrl}" alt="Preview">`;
      } else {
        teamLogoModalPreview.innerHTML = `<i class="fa-solid fa-shield-halved"></i>`;
      }
    }

    if (teamModal) teamModal.style.display = "flex";
  }

  if (btnCreateTeamOpen) btnCreateTeamOpen.addEventListener("click", () => openTeamModal(false));
  if (btnEditTeamOpen) btnEditTeamOpen.addEventListener("click", () => openTeamModal(true));
  if (teamTopActionBtn) teamTopActionBtn.addEventListener("click", () => openTeamModal(true));

  if (teamModalCloseBtn && teamModal) {
    teamModalCloseBtn.addEventListener("click", () => teamModal.style.display = "none");
    teamModal.addEventListener("click", (e) => {
      if (e.target === teamModal) teamModal.style.display = "none";
    });
  }

  // Team Logo Picker Click
  if (teamLogoPickerBox && teamLogoFileInput) {
    teamLogoPickerBox.addEventListener("click", () => teamLogoFileInput.click());
    teamLogoFileInput.addEventListener("change", function (e) {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function (evt) {
          tempTeamLogoDataUrl = evt.target.result;
          if (teamLogoModalPreview) {
            teamLogoModalPreview.innerHTML = `<img src="${tempTeamLogoDataUrl}" alt="Preview">`;
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Team Form Submit
  if (teamForm) {
    teamForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const name = inputTeamName.value.trim();
      const capName = inputCaptainName.value.trim();
      const vcName = inputViceCaptainName.value.trim();

      if (!name) {
        alert("Please enter a team name.");
        return;
      }

      let team = getTeamData();
      if (!team) {
        team = initDefaultTeam();
      }

      team.teamName = name;
      team.teamLogo = tempTeamLogoDataUrl || team.teamLogo || "";
      team.captainName = capName;
      team.viceCaptainName = vcName;

      // Update captaincy flags on players
      if (capName && team.players.length > 0) {
        let capFound = false;
        team.players.forEach(p => {
          if (p.name.toLowerCase() === capName.toLowerCase()) {
            p.isCaptain = true;
            p.isViceCaptain = false;
            capFound = true;
          } else {
            p.isCaptain = false;
          }
        });
        // If captain not found in players list, promote first or add
        if (!capFound && team.players.length > 0) {
          team.players[0].name = capName;
          team.players[0].isCaptain = true;
        }
      }

      // Update vice captaincy flag
      if (vcName && team.players.length > 1) {
        team.players.forEach(p => {
          if (p.name.toLowerCase() === vcName.toLowerCase()) {
            p.isViceCaptain = true;
            p.isCaptain = false;
          }
        });
      }

      saveTeamData(team);
      if (teamModal) teamModal.style.display = "none";
      renderMyTeamPage(currentRoleFilter);
      alert("Team details saved successfully!");
    });
  }

  // ==========================================
  // ADD / EDIT PLAYER MODAL
  // ==========================================

  const playerModal = document.getElementById("playerModal");
  const playerModalCloseBtn = document.getElementById("playerModalCloseBtn");
  const playerForm = document.getElementById("playerForm");
  const btnAddPlayerOpen = document.getElementById("btnAddPlayerOpen");
  const playerPhotoFileInput = document.getElementById("playerPhotoFileInput");
  const playerPhotoPickerBox = document.getElementById("playerPhotoPickerBox");
  const playerPhotoModalPreview = document.getElementById("playerPhotoModalPreview");
  const inputPlayerName = document.getElementById("inputPlayerName");
  const selectPlayerRole = document.getElementById("selectPlayerRole");
  const inputPlayerJersey = document.getElementById("inputPlayerJersey");
  const checkIsCaptain = document.getElementById("checkIsCaptain");
  const checkIsViceCaptain = document.getElementById("checkIsViceCaptain");
  const editPlayerId = document.getElementById("editPlayerId");
  const playerModalTitle = document.getElementById("playerModalTitle");

  function openAddPlayerModal() {
    if (playerModalTitle) playerModalTitle.textContent = "Add Squad Player";
    if (editPlayerId) editPlayerId.value = "";
    if (inputPlayerName) inputPlayerName.value = "";
    if (selectPlayerRole) selectPlayerRole.value = "Batsman";
    if (inputPlayerJersey) inputPlayerJersey.value = "";
    if (checkIsCaptain) checkIsCaptain.checked = false;
    if (checkIsViceCaptain) checkIsViceCaptain.checked = false;

    tempPlayerPhotoDataUrl = "";
    if (playerPhotoModalPreview) {
      playerPhotoModalPreview.innerHTML = `<i class="fa-regular fa-user"></i>`;
    }

    if (playerModal) playerModal.style.display = "flex";
  }

  function openEditPlayerModal(id) {
    const team = getTeamData();
    if (!team || !team.players) return;
    const player = team.players.find(p => p.id === id);
    if (!player) return;

    if (playerModalTitle) playerModalTitle.textContent = "Edit Squad Player";
    if (editPlayerId) editPlayerId.value = player.id;
    if (inputPlayerName) inputPlayerName.value = player.name || "";
    if (selectPlayerRole) selectPlayerRole.value = player.role || "Batsman";
    if (inputPlayerJersey) inputPlayerJersey.value = player.jersey || "";
    if (checkIsCaptain) checkIsCaptain.checked = !!player.isCaptain;
    if (checkIsViceCaptain) checkIsViceCaptain.checked = !!player.isViceCaptain;

    tempPlayerPhotoDataUrl = player.photo || "";
    if (playerPhotoModalPreview) {
      if (tempPlayerPhotoDataUrl) {
        playerPhotoModalPreview.innerHTML = `<img src="${tempPlayerPhotoDataUrl}" alt="Preview">`;
      } else {
        playerPhotoModalPreview.innerHTML = `<i class="fa-regular fa-user"></i>`;
      }
    }

    if (playerModal) playerModal.style.display = "flex";
  }

  if (btnAddPlayerOpen) btnAddPlayerOpen.addEventListener("click", openAddPlayerModal);

  if (playerModalCloseBtn && playerModal) {
    playerModalCloseBtn.addEventListener("click", () => playerModal.style.display = "none");
    playerModal.addEventListener("click", (e) => {
      if (e.target === playerModal) playerModal.style.display = "none";
    });
  }

  // Mutually exclusive Captain & Vice-Captain checkboxes
  if (checkIsCaptain && checkIsViceCaptain) {
    checkIsCaptain.addEventListener("change", function () {
      if (this.checked) checkIsViceCaptain.checked = false;
    });
    checkIsViceCaptain.addEventListener("change", function () {
      if (this.checked) checkIsCaptain.checked = false;
    });
  }

  // Player Photo Picker Click
  if (playerPhotoPickerBox && playerPhotoFileInput) {
    playerPhotoPickerBox.addEventListener("click", () => playerPhotoFileInput.click());
    playerPhotoFileInput.addEventListener("change", function (e) {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function (evt) {
          tempPlayerPhotoDataUrl = evt.target.result;
          if (playerPhotoModalPreview) {
            playerPhotoModalPreview.innerHTML = `<img src="${tempPlayerPhotoDataUrl}" alt="Preview">`;
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Player Form Submit
  if (playerForm) {
    playerForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const pName = inputPlayerName.value.trim();
      const pRole = selectPlayerRole.value;
      const pJersey = inputPlayerJersey.value.trim();
      const isCap = checkIsCaptain.checked;
      const isVC = checkIsViceCaptain.checked;
      const targetId = editPlayerId.value;

      if (!pName) {
        alert("Please enter the player's name.");
        return;
      }

      let team = getTeamData();
      if (!team) team = initDefaultTeam();
      if (!team.players) team.players = [];

      // If new player is designated Captain, remove captaincy from others
      if (isCap) {
        team.players.forEach(p => p.isCaptain = false);
        team.captainName = pName;
      }

      // If new player is designated Vice-Captain, remove vice-captaincy from others
      if (isVC) {
        team.players.forEach(p => p.isViceCaptain = false);
        team.viceCaptainName = pName;
      }

      if (targetId) {
        // Edit existing player
        const player = team.players.find(p => p.id === targetId);
        if (player) {
          player.name = pName;
          player.role = pRole;
          player.jersey = pJersey;
          player.isCaptain = isCap;
          player.isViceCaptain = isVC;
          if (tempPlayerPhotoDataUrl) player.photo = tempPlayerPhotoDataUrl;
        }
      } else {
        // Add new player
        const newPlayer = {
          id: "p_" + Date.now(),
          name: pName,
          role: pRole,
          jersey: pJersey,
          isCaptain: isCap,
          isViceCaptain: isVC,
          photo: tempPlayerPhotoDataUrl || ""
        };
        team.players.push(newPlayer);
      }

      saveTeamData(team);
      if (playerModal) playerModal.style.display = "none";
      renderMyTeamPage(currentRoleFilter);
      alert(`${pName} saved to squad!`);
    });
  }

  // Reset Team Button
  const btnResetTeam = document.getElementById("btnResetTeam");
  if (btnResetTeam) {
    btnResetTeam.addEventListener("click", function () {
      const confirmReset = confirm("Clear this squad? Real registered players can be added again.");
      if (confirmReset) {
        removeUserStorage(TEAM_STORAGE_KEY);
        renderMyTeamPage("all");
        alert("Squad cleared. No demo players were added.");
      }
    });
  }


  // ==========================================
  // SCREEN 7 & 8 — START MATCH SETUP & SCORING (STEP 4)
  // ==========================================

  const MATCH_STORAGE_KEY = "cricYuvaActiveMatch";

  // Opponent Team Squad Presets
  // No demo opponent squads. Match rosters come only from registered teams.
  const OPPONENT_PRESETS = {};

  // State Variables for Setup Wizard
  let currentWizardStep = 1;
  let activeSquadTab = "teamA"; // 'teamA' or 'teamB'
  let teamASquadList = [];
  let teamBSquadList = [];
  let selectedPlayingXiTeamA = [];
  let selectedPlayingXiTeamB = [];
  let selectedOversCount = 20;

  // DOM Elements - Start Match Page
  const startMatchBackButton = document.getElementById("startMatchBackButton");
  const stepIndicator1 = document.getElementById("stepIndicator1");
  const stepIndicator2 = document.getElementById("stepIndicator2");
  const stepIndicator3 = document.getElementById("stepIndicator3");
  const stepLine1 = document.getElementById("stepLine1");
  const stepLine2 = document.getElementById("stepLine2");
  const matchStepCounterPill = document.getElementById("matchStepCounterPill");

  const wizardStep1 = document.getElementById("wizardStep1");
  const wizardStep2 = document.getElementById("wizardStep2");
  const wizardStep3 = document.getElementById("wizardStep3");

  const selectTeamA = document.getElementById("selectTeamA");
  const selectTeamB = document.getElementById("selectTeamB");
  const inputCustomTeamA = document.getElementById("inputCustomTeamA");
  const inputCustomTeamB = document.getElementById("inputCustomTeamB");
  const inputMatchTitle = document.getElementById("inputMatchTitle");
  const selectTournament = document.getElementById("selectTournament");
  const inputCustomTournament = document.getElementById("inputCustomTournament");
  const tournamentSelectGroup = document.getElementById("tournamentSelectGroup");
  const inputCustomOvers = document.getElementById("inputCustomOvers");
  const inputGroundName = document.getElementById("inputGroundName");
  const inputMatchDate = document.getElementById("inputMatchDate");
  const inputMatchTime = document.getElementById("inputMatchTime");
  const oversChips = document.querySelectorAll(".overs-chip");

  const btnGoToStep2 = document.getElementById("btnGoToStep2");
  const btnBackToStep1 = document.getElementById("btnBackToStep1");
  const btnGoToStep3 = document.getElementById("btnGoToStep3");
  const btnBackToStep2 = document.getElementById("btnBackToStep2");
  const btnFinalStartMatch = document.getElementById("btnFinalStartMatch");

  const tabSquadTeamA = document.getElementById("tabSquadTeamA");
  const tabSquadTeamB = document.getElementById("tabSquadTeamB");
  const tabTeamANameDisplay = document.getElementById("tabTeamANameDisplay");
  const tabTeamBNameDisplay = document.getElementById("tabTeamBNameDisplay");
  const badgeCountTeamA = document.getElementById("badgeCountTeamA");
  const badgeCountTeamB = document.getElementById("badgeCountTeamB");
  const squadSelectionStatusText = document.getElementById("squadSelectionStatusText");
  const playingXiListContainer = document.getElementById("playingXiListContainer");
  const trayCountDisplay = document.getElementById("trayCountDisplay");
  const trayChipsContainer = document.getElementById("trayChipsContainer");
  const btnSelectAllSquad = document.getElementById("btnSelectAllSquad");
  const btnClearSquad = document.getElementById("btnClearSquad");

  const btnFlipCoin = document.getElementById("btnFlipCoin");
  const tossCoin = document.getElementById("tossCoin");
  const tossResultBanner = document.getElementById("tossResultBanner");
  const tossWinnerTeamA = document.getElementById("tossWinnerTeamA");
  const tossWinnerTeamB = document.getElementById("tossWinnerTeamB");
  const tossLabelTeamA = document.getElementById("tossLabelTeamA");
  const tossLabelTeamB = document.getElementById("tossLabelTeamB");
  const tossOfficialCallout = document.getElementById("tossOfficialCallout");
  const tossCalloutSentence = document.getElementById("tossCalloutSentence");
  const sumFixture = document.getElementById("sumFixture");
  const sumFormat = document.getElementById("sumFormat");
  const sumVenue = document.getElementById("sumVenue");
  const sumBattingFirst = document.getElementById("sumBattingFirst");

  // DOM Elements - Screen 8 Live Scoring
  const liveScoreBackButton = document.getElementById("liveScoreBackButton");
  const btnLiveBackHome = document.getElementById("btnLiveBackHome");
  const btnLiveViewTeam = document.getElementById("btnLiveViewTeam");
  const btnLiveEditSetup = document.getElementById("btnLiveEditSetup");
  const liveScoreTournamentTag = document.getElementById("liveScoreTournamentTag");
  const liveScoreVenueTag = document.getElementById("liveScoreVenueTag");
  const liveScoreBattingTeam = document.getElementById("liveScoreBattingTeam");
  const liveScoreBowlingTeam = document.getElementById("liveScoreBowlingTeam");
  const liveScoreBattingLogo = document.getElementById("liveScoreBattingLogo");
  const liveScoreBowlingLogo = document.getElementById("liveScoreBowlingLogo");
  const liveScoreRunsWickets = document.getElementById("liveScoreRunsWickets");
  const liveScoreOversText = document.getElementById("liveScoreOversText");
  const liveScoreCrrValue = document.getElementById("liveScoreCrrValue");
  const liveScoreTossBannerText = document.getElementById("liveScoreTossBannerText");
  const liveStrikerName = document.getElementById("liveStrikerName");
  const liveNonStrikerName = document.getElementById("liveNonStrikerName");
  const liveBowlerName = document.getElementById("liveBowlerName");
  const liveSummaryTeamAName = document.getElementById("liveSummaryTeamAName");
  const liveSummaryTeamBName = document.getElementById("liveSummaryTeamBName");
  const liveSummaryTeamAPlayers = document.getElementById("liveSummaryTeamAPlayers");
  const liveSummaryTeamBPlayers = document.getElementById("liveSummaryTeamBPlayers");


  // Helper: Get Resolved Team Name
  function getResolvedTeamName(teamSide) {
    if (teamSide === "teamA") {
      const val = selectTeamA.value;
      if (val === "my_team") {
        const teamData = getTeamData() || initDefaultTeam();
        return teamData.teamName || "";
      } else if (val === "custom") {
        return inputCustomTeamA.value.trim() || "";
      } else {
        return val;
      }
    } else {
      const val = selectTeamB.value;
      if (val === "my_team") {
        const teamData = getTeamData() || initDefaultTeam();
        return teamData.teamName || "";
      } else if (val === "custom") {
        return inputCustomTeamB.value.trim() || "";
      } else {
        return val;
      }
    }
  }

  // Helper: Get Squad Roster for a given team name
  function getRosterForTeam(teamName, isMyTeam = false) {
    if (isMyTeam) {
      const teamData = getTeamData() || initDefaultTeam();
      return (teamData.players && teamData.players.length > 0) ? teamData.players : [];
    }
    // 1. Check if club exists in custom clubs or tournament squads
    try {
      if (typeof getAvailableClubsList === "function") {
        if (format === "Group Stage") {
        const teamCount = wizardSelectedTeams.length;
        const minTeams = groupCount * 3;
        const maxTeams = groupCount * 5;

        if (teamCount < minTeams || teamCount > maxTeams) {
          showToast(`For ${groupCount} groups, select ${minTeams}-${maxTeams} teams (3-5 teams per group).`);
          if (typeof goToWizardStep === "function") goToWizardStep(2);
          return;
        }
      }

      const allClubs = getAvailableClubsList();
        const found = allClubs.find(c => c.name && c.name.toLowerCase() === teamName.toLowerCase());
        if (found && found.players && found.players.length > 0) {
          return JSON.parse(JSON.stringify(found.players));
        }
      }
      const tId = window.activeLinkedTourneyId || (typeof activeTournamentId !== "undefined" ? activeTournamentId : null);
      if (tId && typeof getTournamentById === "function") {
        const tourney = getTournamentById(tId);
        if (tourney && tourney.teams) {
          const tm = tourney.teams.find(t => t.name && t.name.toLowerCase() === teamName.toLowerCase());
          if (tm && tm.players && tm.players.length > 0) {
            return JSON.parse(JSON.stringify(tm.players));
          }
        }
      }
    } catch (e) {
      console.warn("Roster lookup fallback:", e);
    }
    if (OPPONENT_PRESETS[teamName]) {
      return JSON.parse(JSON.stringify(OPPONENT_PRESETS[teamName]));
    }
    // Generate custom 11 players for custom opponent team
    const customPlayers = [];
    const roles = ["Batsman", "Batsman", "Batsman", "Batsman", "All-Rounder", "All-Rounder", "Wicketkeeper", "Bowler", "Bowler", "Bowler", "Bowler"];
    for (let i = 1; i <= 11; i++) {
      customPlayers.push({
        id: "custom_" + i + "_" + Date.now(),
        name: `${teamName} Player ${i}`,
        role: roles[i - 1] || "Batsman",
        isCaptain: i === 1,
        isViceCaptain: i === 2,
        jersey: String(i)
      });
    }
    return customPlayers;
  }

  // Helper: Set Step in Wizard
  function setWizardStep(stepNum) {
    currentWizardStep = stepNum;

    // Stepper header
    if (matchStepCounterPill) matchStepCounterPill.textContent = `Step ${stepNum}/3`;

    [stepIndicator1, stepIndicator2, stepIndicator3].forEach((ind, index) => {
      if (!ind) return;
      ind.classList.remove("active", "completed");
      if (index + 1 === stepNum) {
        ind.classList.add("active");
      } else if (index + 1 < stepNum) {
        ind.classList.add("completed");
      }
    });

    if (stepLine1) {
      if (stepNum > 1) stepLine1.classList.add("completed");
      else stepLine1.classList.remove("completed");
    }
    if (stepLine2) {
      if (stepNum > 2) stepLine2.classList.add("completed");
      else stepLine2.classList.remove("completed");
    }

    // View toggles
    if (wizardStep1) wizardStep1.style.display = stepNum === 1 ? "flex" : "none";
    if (wizardStep2) wizardStep2.style.display = stepNum === 2 ? "flex" : "none";
    if (wizardStep3) wizardStep3.style.display = stepNum === 3 ? "flex" : "none";

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Open Start Match Setup Wizard
  function openStartMatchSetup(opts) {
    setWizardStep(1);

    // Sync dynamic tournaments into selectTournament dropdown
    if (selectTournament) {
      try {
        const currentVal = selectTournament.value;
        const allTourneys = typeof getTournamentsList === "function" ? getTournamentsList() : [];
        const existingOpts = Array.from(selectTournament.options).map(o => o.value);
        allTourneys.forEach(t => {
          if (t && t.name && !existingOpts.includes(t.name)) {
            const opt = document.createElement("option");
            opt.value = t.name;
            opt.textContent = `🏆 ${t.name}`;
            selectTournament.appendChild(opt);
          }
        });
      } catch (e) {}
    }

    // Sync Team A dropdown with saved team name
    const teamData = getTeamData() || initDefaultTeam();
    const myTeamName = teamData.teamName || "";
    if (selectTeamA && selectTeamA.options[0]) {
      selectTeamA.options[0].text = `🏏 ${myTeamName} (My Team)`;
    }

    // Pre-populate Date (Today) & Time (Now)
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    if (inputMatchDate) {
      inputMatchDate.value = (opts && opts.date) ? opts.date : `${yyyy}-${mm}-${dd}`;
    }

    const hh = String(today.getHours()).padStart(2, "0");
    const min = String(today.getMinutes()).padStart(2, "0");
    if (inputMatchTime) {
      inputMatchTime.value = (opts && opts.time) ? opts.time : `${hh}:${min}`;
    }

    if (opts) {
      if (opts.tournament && selectTournament) {
        let optFound = false;
        for (let i = 0; i < selectTournament.options.length; i++) {
          if (selectTournament.options[i].value.toLowerCase() === opts.tournament.toLowerCase()) {
            selectTournament.selectedIndex = i;
            optFound = true;
            break;
          }
        }
        if (!optFound) {
          const newOpt = document.createElement("option");
          newOpt.value = opts.tournament;
          newOpt.textContent = `🏆 ${opts.tournament}`;
          selectTournament.appendChild(newOpt);
          selectTournament.value = opts.tournament;
        }
      }
      if (opts.ground && inputGroundName) {
        inputGroundName.value = opts.ground;
      }
      if (opts.overs && oversChips) {
        let chipMatched = false;
        const targetOvers = parseInt(opts.overs, 10);
        oversChips.forEach(c => {
          if (parseInt(c.dataset.overs, 10) === targetOvers) {
            oversChips.forEach(ch => ch.classList.remove("active"));
            c.classList.add("active");
            selectedOversCount = targetOvers;
            chipMatched = true;
          }
        });
        if (!chipMatched && targetOvers > 0) {
          oversChips.forEach(ch => ch.classList.remove("active"));
          selectedOversCount = targetOvers;
          const customChip = Array.from(oversChips).find(c => c.dataset.overs === "custom");
          if (customChip) customChip.classList.add("active");
          if (inputCustomOvers) {
            inputCustomOvers.style.display = "block";
            inputCustomOvers.value = targetOvers;
          }
        }
      }
      if (opts.teamA && selectTeamA) {
        let matchA = false;
        for (let i = 0; i < selectTeamA.options.length; i++) {
          if (selectTeamA.options[i].text.toLowerCase().includes(opts.teamA.toLowerCase())) {
            selectTeamA.selectedIndex = i;
            matchA = true;
            break;
          }
        }
        if (!matchA) {
          selectTeamA.value = "custom";
          if (inputCustomTeamA) {
            inputCustomTeamA.style.display = "block";
            inputCustomTeamA.value = opts.teamA;
          }
        }
      }
      if (opts.teamB && selectTeamB) {
        let matchB = false;
        for (let i = 0; i < selectTeamB.options.length; i++) {
          if (selectTeamB.options[i].text.toLowerCase().includes(opts.teamB.toLowerCase())) {
            selectTeamB.selectedIndex = i;
            matchB = true;
            break;
          }
        }
        if (!matchB) {
          selectTeamB.value = "custom";
          if (inputCustomTeamB) {
            inputCustomTeamB.style.display = "block";
            inputCustomTeamB.value = opts.teamB;
          }
        }
      }
      if (opts.fixtureId) {
        window.activeLinkedFixtureId = opts.fixtureId;
        window.activeLinkedTourneyId = opts.tourneyId;
      }
    }

    showScreen("screen7");
  }

  // Team Selection Change Listeners
  if (selectTeamA) {
    selectTeamA.addEventListener("change", function () {
      if (selectTeamA.value === "custom") {
        inputCustomTeamA.style.display = "block";
      } else {
        inputCustomTeamA.style.display = "none";
      }
    });
  }

  if (selectTeamB) {
    selectTeamB.addEventListener("change", function () {
      if (selectTeamB.value === "custom") {
        inputCustomTeamB.style.display = "block";
      } else {
        inputCustomTeamB.style.display = "none";
      }
    });
  }

  // Tournament Selection Change
  if (selectTournament) {
    selectTournament.addEventListener("change", function () {
      if (selectTournament.value === "Custom") {
        inputCustomTournament.style.display = "block";
      } else {
        inputCustomTournament.style.display = "none";
      }
    });
  }

  // Match Type Radio Change (Tournament vs Practice)
  const matchTypeRadios = document.querySelectorAll('input[name="matchTypeRadio"]');
  matchTypeRadios.forEach(radio => {
    radio.addEventListener("change", function () {
      if (tournamentSelectGroup) {
        if (this.value === "Practice Match") {
          tournamentSelectGroup.style.opacity = "0.4";
        } else {
          tournamentSelectGroup.style.opacity = "1";
        }
      }
    });
  });

  // Overs Quick Chips
  oversChips.forEach(chip => {
    chip.addEventListener("click", function () {
      oversChips.forEach(c => c.classList.remove("active"));
      this.classList.add("active");
      const val = parseInt(this.getAttribute("data-overs"), 10);
      selectedOversCount = val;
      if (inputCustomOvers) inputCustomOvers.value = val;
    });
  });

  if (inputCustomOvers) {
    inputCustomOvers.addEventListener("input", function () {
      const val = parseInt(this.value, 10);
      if (val > 0) {
        selectedOversCount = val;
        oversChips.forEach(c => {
          if (parseInt(c.getAttribute("data-overs"), 10) === val) {
            c.classList.add("active");
          } else {
            c.classList.remove("active");
          }
        });
      }
    });
  }

  // Render Step 2: Playing XI Roster
  function renderPlayingXiList() {
    if (!playingXiListContainer) return;
    playingXiListContainer.innerHTML = "";

    const isTeamA = activeSquadTab === "teamA";
    const squadList = isTeamA ? teamASquadList : teamBSquadList;
    const selectedList = isTeamA ? selectedPlayingXiTeamA : selectedPlayingXiTeamB;
    const teamName = getResolvedTeamName(isTeamA ? "teamA" : "teamB");

    if (squadSelectionStatusText) {
      squadSelectionStatusText.textContent = `Selecting Playing XI for ${teamName} (${selectedList.length}/${squadList.length} Selected)`;
    }

    if (badgeCountTeamA) badgeCountTeamA.textContent = `${selectedPlayingXiTeamA.length} Selected`;
    if (badgeCountTeamB) badgeCountTeamB.textContent = `${selectedPlayingXiTeamB.length} Selected`;
    if (trayCountDisplay) trayCountDisplay.textContent = selectedList.length;

    squadList.forEach(player => {
      const isSelected = selectedList.some(p => p.id === player.id || p.name === player.name);

      const item = document.createElement("div");
      item.className = "playing-xi-item" + (isSelected ? " selected" : "");

      const roleIcon = player.role === "Batsman" ? "🏏" : player.role === "Bowler" ? "🎯" : player.role === "All-Rounder" ? "⚡" : "🧤";
      const desigTag = player.isCaptain ? " 👑 (C)" : player.isViceCaptain ? " 🎖️ (VC)" : "";

      item.innerHTML = `
        <div class="playing-xi-item-left">
          <div class="player-checkbox-custom">
            <i class="fa-solid fa-check"></i>
          </div>
          <div class="playing-xi-avatar">
            ${player.photo ? `<img src="${player.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : (player.name ? player.name.charAt(0).toUpperCase() : "P")}
          </div>
          <div>
            <div class="playing-xi-name">${player.name}${desigTag}</div>
            <span class="playing-xi-role-pill">${roleIcon} ${player.role} ${player.jersey ? `• #${player.jersey}` : ""}</span>
          </div>
        </div>
      `;

      item.addEventListener("click", function () {
        togglePlayerPlayingXi(player, isTeamA);
      });

      playingXiListContainer.appendChild(item);
    });

    renderSelectedTrayChips();
  }

  // Toggle Player in/out of Playing XI
  function togglePlayerPlayingXi(player, isTeamA) {
    let selectedList = isTeamA ? selectedPlayingXiTeamA : selectedPlayingXiTeamB;
    const existingIndex = selectedList.findIndex(p => p.id === player.id || p.name === player.name);

    if (existingIndex > -1) {
      selectedList.splice(existingIndex, 1);
    } else {
      // Prevent duplicate
      if (!selectedList.some(p => p.id === player.id || p.name === player.name)) {
        selectedList.push(player);
      }
    }

    if (isTeamA) selectedPlayingXiTeamA = selectedList;
    else selectedPlayingXiTeamB = selectedList;

    renderPlayingXiList();
  }

  // Render Selected Tray Chips
  function renderSelectedTrayChips() {
    if (!trayChipsContainer) return;
    trayChipsContainer.innerHTML = "";

    const isTeamA = activeSquadTab === "teamA";
    const selectedList = isTeamA ? selectedPlayingXiTeamA : selectedPlayingXiTeamB;

    if (selectedList.length === 0) {
      trayChipsContainer.innerHTML = `<span style="font-size:11px; color:#7d8597;">No players selected yet. Tap players above to select.</span>`;
      return;
    }

    selectedList.forEach(player => {
      const chip = document.createElement("span");
      chip.className = "tray-chip";
      const desig = player.isCaptain ? "(C)" : player.isViceCaptain ? "(VC)" : "";
      chip.innerHTML = `<span>${player.name} ${desig}</span>`;
      trayChipsContainer.appendChild(chip);
    });
  }

  // Step 2 Tab Buttons
  if (tabSquadTeamA) {
    tabSquadTeamA.addEventListener("click", function () {
      activeSquadTab = "teamA";
      tabSquadTeamA.classList.add("active");
      tabSquadTeamB.classList.remove("active");
      renderPlayingXiList();
    });
  }

  if (tabSquadTeamB) {
    tabSquadTeamB.addEventListener("click", function () {
      activeSquadTab = "teamB";
      tabSquadTeamB.classList.add("active");
      tabSquadTeamA.classList.remove("active");
      renderPlayingXiList();
    });
  }

  // Step 2 Quick Tools (Select All & Reset)
  if (btnSelectAllSquad) {
    btnSelectAllSquad.addEventListener("click", function () {
      const isTeamA = activeSquadTab === "teamA";
      if (isTeamA) {
        selectedPlayingXiTeamA = [...teamASquadList];
      } else {
        selectedPlayingXiTeamB = [...teamBSquadList];
      }
      renderPlayingXiList();
    });
  }

  if (btnClearSquad) {
    btnClearSquad.addEventListener("click", function () {
      const isTeamA = activeSquadTab === "teamA";
      if (isTeamA) {
        selectedPlayingXiTeamA = [];
      } else {
        selectedPlayingXiTeamB = [];
      }
      renderPlayingXiList();
    });
  }

  // STEP 1 -> STEP 2 (Proceed to Playing XI)
  if (btnGoToStep2) {
    btnGoToStep2.addEventListener("click", function () {
      const teamAName = getResolvedTeamName("teamA");
      const teamBName = getResolvedTeamName("teamB");

      if (!teamAName) {
        alert("Please select or enter Team A name.");
        return;
      }
      if (!teamBName) {
        alert("Please select or enter Team B name.");
        return;
      }
      if (teamAName.trim().toLowerCase() === teamBName.trim().toLowerCase()) {
        alert("Team A and Team B cannot be the exact same team. Please choose different competing teams.");
        return;
      }
      if (!inputMatchTitle.value.trim()) {
        alert("Please enter a match title.");
        return;
      }
      if (!inputGroundName.value.trim()) {
        alert("Please enter the ground name & location.");
        return;
      }
      if (!inputMatchDate.value || !inputMatchTime.value) {
        alert("Please select match date and time.");
        return;
      }

      // Populate rosters
      const isTeamAMyTeam = selectTeamA.value === "my_team";
      const isTeamBMyTeam = selectTeamB.value === "my_team";
      teamASquadList = getRosterForTeam(teamAName, isTeamAMyTeam);
      teamBSquadList = getRosterForTeam(teamBName, isTeamBMyTeam);

      // Auto-select all by default if not previously chosen
      if (selectedPlayingXiTeamA.length === 0) {
        selectedPlayingXiTeamA = [...teamASquadList];
      }
      if (selectedPlayingXiTeamB.length === 0) {
        selectedPlayingXiTeamB = [...teamBSquadList];
      }

      if (tabTeamANameDisplay) tabTeamANameDisplay.textContent = teamAName;
      if (tabTeamBNameDisplay) tabTeamBNameDisplay.textContent = teamBName;

      activeSquadTab = "teamA";
      if (tabSquadTeamA) tabSquadTeamA.classList.add("active");
      if (tabSquadTeamB) tabSquadTeamB.classList.remove("active");

      setWizardStep(2);
      renderPlayingXiList();
    });
  }

  // STEP 2 -> STEP 1 (Back to Match Setup)
  if (btnBackToStep1) {
    btnBackToStep1.addEventListener("click", function () {
      setWizardStep(1);
    });
  }

  // STEP 2 -> STEP 3 (Proceed to Toss)
  if (btnGoToStep3) {
    btnGoToStep3.addEventListener("click", function () {
      const teamAName = getResolvedTeamName("teamA");
      const teamBName = getResolvedTeamName("teamB");

      if (selectedPlayingXiTeamA.length < 2) {
        alert(`Please select at least 2 playing players for ${teamAName} (11 recommended).`);
        return;
      }
      if (selectedPlayingXiTeamB.length < 2) {
        alert(`Please select at least 2 playing players for ${teamBName} (11 recommended).`);
        return;
      }

      // Update Step 3 Toss Labels & Summary
      if (tossLabelTeamA) tossLabelTeamA.textContent = teamAName;
      if (tossLabelTeamB) tossLabelTeamB.textContent = teamBName;

      updateTossSummaryUI();
      setWizardStep(3);
    });
  }

  // STEP 3 -> STEP 2 (Back to Playing XI)
  if (btnBackToStep2) {
    btnBackToStep2.addEventListener("click", function () {
      setWizardStep(2);
    });
  }

  // Update Toss Summary UI
  function updateTossSummaryUI() {
    const teamAName = getResolvedTeamName("teamA");
    const teamBName = getResolvedTeamName("teamB");
    const isWinnerTeamA = tossWinnerTeamA && tossWinnerTeamA.checked;
    const winnerName = isWinnerTeamA ? teamAName : teamBName;
    const loserName = isWinnerTeamA ? teamBName : teamAName;

    const decisionRadio = document.querySelector('input[name="tossDecisionRadio"]:checked');
    const decision = decisionRadio ? decisionRadio.value : "Bat";

    if (tossCalloutSentence) {
      tossCalloutSentence.textContent = `${winnerName} won the toss and elected to ${decision.toUpperCase()} first.`;
    }

    const battingFirst = decision === "Bat" ? winnerName : loserName;

    if (sumFixture) sumFixture.textContent = `${teamAName} vs ${teamBName}`;
    if (sumFormat) sumFormat.textContent = `${selectedOversCount} Overs • ${document.querySelector('input[name="matchTypeRadio"]:checked')?.value || "Match"}`;
    if (sumVenue) sumVenue.textContent = inputGroundName.value.trim() || "Wankhede Stadium";
    if (sumBattingFirst) sumBattingFirst.textContent = `Batting 1st: ${battingFirst}`;
  }

  // Toss Winner & Decision Change Listeners
  if (tossWinnerTeamA) tossWinnerTeamA.addEventListener("change", updateTossSummaryUI);
  if (tossWinnerTeamB) tossWinnerTeamB.addEventListener("change", updateTossSummaryUI);
  const tossDecisionRadios = document.querySelectorAll('input[name="tossDecisionRadio"]');
  tossDecisionRadios.forEach(r => r.addEventListener("change", updateTossSummaryUI));

  // Flip Coin Button Click Simulation
  if (btnFlipCoin && tossCoin) {
    btnFlipCoin.addEventListener("click", function () {
      tossCoin.classList.remove("flipping");
      void tossCoin.offsetWidth; // force reflow
      tossCoin.classList.add("flipping");
      if (tossResultBanner) tossResultBanner.innerHTML = `<span>Spinning coin in the air...</span>`;

      setTimeout(() => {
        const isHeads = Math.random() >= 0.5;
        const resultSide = isHeads ? "HEADS" : "TAILS";
        const teamAName = getResolvedTeamName("teamA");
        const teamBName = getResolvedTeamName("teamB");
        const randomWinner = Math.random() >= 0.5 ? "teamA" : "teamB";

        if (randomWinner === "teamA" && tossWinnerTeamA) {
          tossWinnerTeamA.checked = true;
        } else if (tossWinnerTeamB) {
          tossWinnerTeamB.checked = true;
        }

        const winnerTeamName = randomWinner === "teamA" ? teamAName : teamBName;
        if (tossResultBanner) {
          tossResultBanner.innerHTML = `<span>🪙 Result: <strong>${resultSide}</strong>! Suggested Winner: <strong>${winnerTeamName}</strong></span>`;
        }

        updateTossSummaryUI();
      }, 1400);
    });
  }

  // START MATCH (FINAL LAUNCH)
  if (btnFinalStartMatch) {
    btnFinalStartMatch.addEventListener("click", function () {
      const teamAName = getResolvedTeamName("teamA");
      const teamBName = getResolvedTeamName("teamB");
      const matchTitle = inputMatchTitle.value.trim() || "T20 Match";
      const ground = inputGroundName.value.trim() || "Main Cricket Ground";
      const date = inputMatchDate.value;
      const time = inputMatchTime.value;
      const matchType = document.querySelector('input[name="matchTypeRadio"]:checked')?.value || "Tournament Match";
      let tournament = selectTournament.value;
      if (tournament === "Custom") tournament = inputCustomTournament.value.trim() || "Cric Yuva Series";

      const isWinnerTeamA = tossWinnerTeamA && tossWinnerTeamA.checked;
      const tossWinnerName = isWinnerTeamA ? teamAName : teamBName;
      const tossDecision = document.querySelector('input[name="tossDecisionRadio"]:checked')?.value || "Bat";
      const battingFirstName = tossDecision === "Bat" ? tossWinnerName : (isWinnerTeamA ? teamBName : teamAName);
      const bowlingFirstName = battingFirstName === teamAName ? teamBName : teamAName;

      const battingPlayingXi = battingFirstName === teamAName ? selectedPlayingXiTeamA : selectedPlayingXiTeamB;
      const bowlingPlayingXi = bowlingFirstName === teamAName ? selectedPlayingXiTeamA : selectedPlayingXiTeamB;

      // Build Innings 1 State
      const innings1State = createInningsStructure(battingFirstName, bowlingFirstName, battingPlayingXi, bowlingPlayingXi);

      // Construct Complete Active Match Structure
      const activeMatch = {
        matchId: "match_" + Date.now(),
        title: matchTitle,
        type: matchType,
        tournament: tournament,
        fixtureId: window.activeLinkedFixtureId || null,
        tourneyId: window.activeLinkedTourneyId || null,
        overs: selectedOversCount,
        ground: ground,
        date: date,
        time: time,
        teamA: {
          name: teamAName,
          playingXi: selectedPlayingXiTeamA
        },
        teamB: {
          name: teamBName,
          playingXi: selectedPlayingXiTeamB
        },
        toss: {
          winner: tossWinnerName,
          decision: tossDecision,
          battingFirst: battingFirstName,
          bowlingFirst: bowlingFirstName
        },
        currentInningIndex: 1,
        innings1: innings1State,
        innings2: null,
        status: "LIVE",
        historyStack: [],
        createdAt: new Date().toISOString()
      };

      // Save to localStorage
      saveActiveMatchState(activeMatch);

      // Render Screen 8 Live Scoring Page
      renderLiveScoringPage(activeMatch);
      showScreen("screen8");
    });
  }

  // ==========================================
  // STEP 5: LIVE SCORING ENGINE & STATE HELPERS
  // ==========================================

  function createInningsStructure(battingTeamName, bowlingTeamName, battingPlayingXi, bowlingPlayingXi) {
    const battingPlayers = (battingPlayingXi || []).map((p, idx) => ({
      id: p.id || null,
      name: p.name,
      role: p.role,
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      isOut: false,
      dismissal: "",
      isAtCrease: idx < 2,
      isStriker: idx === 0
    }));

    const openingBowler = (bowlingPlayingXi || []).find(p => p.role === "Bowler") || bowlingPlayingXi[bowlingPlayingXi.length - 1] || { name: "Opening Bowler", role: "Bowler" };

    const bowlingPlayers = (bowlingPlayingXi || []).map(p => ({
      id: p.id || null,
      name: p.name,
      role: p.role,
      overs: 0,
      balls: 0,
      maidens: 0,
      runs: 0,
      wickets: 0,
      isCurrentBowler: p.name === openingBowler.name,
      lastOverBowled: -1
    }));

    return {
      battingTeam: battingTeamName,
      bowlingTeam: bowlingTeamName,
      totalRuns: 0,
      wickets: 0,
      overs: 0,
      balls: 0,
      extras: { wide: 0, noBall: 0, bye: 0, legBye: 0, penalty: 0, total: 0 },
      batting: battingPlayers,
      bowling: bowlingPlayers,
      currentOverDeliveries: [],
      allDeliveries: [],
      commentary: [],
      fallOfWickets: []
    };
  }

  function getActiveMatch() {
    try {
      const saved = getUserStorage(MATCH_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Error reading active match:", e);
    }
    return null;
  }

  function saveActiveMatchState(match) {
    if (!match) return;
    try {
      setUserStorage(MATCH_STORAGE_KEY, JSON.stringify(match));
      if (typeof PublicLiveScoreService !== "undefined" && PublicLiveScoreService.emitLiveUpdate) {
        PublicLiveScoreService.emitLiveUpdate(match);
      }
      updateHomeLiveScoreboard(match);
    } catch (e) {
      console.error("Error saving active match:", e);
    }
  }

  function updateHomeLiveScoreboard(m) {
    const match = m || getActiveMatch();
    if (!match) return;

    const teamAName = match.teamA?.name || match.teamA || "Team A";
    const teamBName = match.teamB?.name || match.teamB || "Team B";

    const isLive = match.status === "LIVE" || match.status === "IN_PROGRESS";
    const currInn = getCurrentInnings(match) || match.innings1;
    if (!currInn) return;

    const battingTeam = currInn.battingTeamName || teamAName;

    // Status Pill
    const statusPill = document.querySelector(".hero-live-section .live-status-pill span:last-child");
    if (statusPill) {
      statusPill.textContent = match.status === "COMPLETED" ? "MATCH COMPLETED" : (isLive ? "MATCH IN PLAY" : "UPCOMING MATCH");
    }

    // Video stream title
    const streamTitle = document.querySelector(".hero-live-section .stream-title");
    if (streamTitle) {
      const tourneyLabel = match.tournament || `${match.overs || 20} Ov Match`;
      streamTitle.textContent = `${teamAName} vs ${teamBName} (${tourneyLabel})`;
    }

    // Ticker Patti
    const tickerTeamScore = document.querySelector(".hero-live-section .ticker-team-score");
    if (tickerTeamScore) {
      tickerTeamScore.innerHTML = `
        <b>${battingTeam.toUpperCase()}</b>
        <span class="ticker-score">${currInn.runs || 0}/${currInn.wickets || 0} <small>(${currInn.completedOvers || 0}.${currInn.ballsThisOver || 0} Ov)</small></span>
      `;
    }

    const tickerRateInfo = document.querySelector(".hero-live-section .ticker-rate-info");
    if (tickerRateInfo) {
      const totalLegalBalls = ((currInn.completedOvers || 0) * 6) + (currInn.ballsThisOver || 0);
      const crr = totalLegalBalls > 0 ? (((currInn.runs || 0) / totalLegalBalls) * 6).toFixed(2) : "0.00";

      let chaseHtml = "";
      if (match.currentInningIndex === 2 && match.innings1) {
        const target = (match.innings1.runs || 0) + 1;
        const runsNeeded = Math.max(0, target - (currInn.runs || 0));
        const totalMatchBalls = (match.overs || 20) * 6;
        const ballsLeft = Math.max(0, totalMatchBalls - totalLegalBalls);
        chaseHtml = `<span>Target: <b>${target}</b> <small>(Req: ${runsNeeded} off ${ballsLeft})</small></span>`;
      } else {
        chaseHtml = `<span>Projected: <b>${Math.round(parseFloat(crr) * (match.overs || 20))}</b></span>`;
      }
      tickerRateInfo.innerHTML = `<span>CRR: <b>${crr}</b></span> ${chaseHtml}`;
    }

    // Scorecard Fallback Container
    const scTag = document.querySelector("#liveScorecardContainer .tournament-tag");
    if (scTag) {
      scTag.textContent = `${(match.tournament || 'CRIC YUVA PREMIER CUP').toUpperCase()} • ${match.status === 'COMPLETED' ? 'RESULT' : (isLive ? 'LIVE' : 'UPCOMING')}`;
    }
    const venueText = document.querySelector("#liveScorecardContainer .venue-text");
    if (venueText) {
      venueText.textContent = match.ground || "Yuva Cricket Stadium";
    }

    // Team columns
    const teamCols = document.querySelectorAll("#liveScorecardContainer .score-team-col");
    if (teamCols.length >= 2) {
      const inn1 = match.innings1 || {};
      const inn2 = match.innings2 || {};
      const team1Score = (match.innings1?.battingTeamName === teamAName) ? inn1 : inn2;
      const team2Score = (match.innings1?.battingTeamName === teamBName) ? inn1 : inn2;

      // Col 1 (Team A)
      const t1Init = teamCols[0].querySelector(".team-initial-circle");
      if (t1Init) t1Init.textContent = getInitials(teamAName);
      const t1Name = teamCols[0].querySelector(".team-name");
      if (t1Name) t1Name.textContent = teamAName;
      const t1Score = teamCols[0].querySelector(".team-score-big");
      if (t1Score) t1Score.textContent = `${team1Score.runs || 0}/${team1Score.wickets || 0}`;
      const t1Ov = teamCols[0].querySelector(".team-overs");
      if (t1Ov) t1Ov.textContent = `${team1Score.completedOvers || 0}.${team1Score.ballsThisOver || 0} / ${match.overs || 20} ov`;

      // Col 2 (Team B)
      const t2Init = teamCols[1].querySelector(".team-initial-circle");
      if (t2Init) t2Init.textContent = getInitials(teamBName);
      const t2Name = teamCols[1].querySelector(".team-name");
      if (t2Name) t2Name.textContent = teamBName;
      const t2Score = teamCols[1].querySelector(".team-score-big");
      if (t2Score) t2Score.textContent = `${team2Score.runs || 0}/${team2Score.wickets || 0}`;
      const t2Ov = teamCols[1].querySelector(".team-overs");
      if (t2Ov) t2Ov.textContent = `${team2Score.completedOvers || 0}.${team2Score.ballsThisOver || 0} / ${match.overs || 20} ov`;
    }

    // Equation
    const eqEl = document.querySelector("#liveScorecardContainer .chase-equation");
    if (eqEl) {
      if (match.status === "COMPLETED") {
        eqEl.textContent = match.result || "Match Ended";
      } else if (match.currentInningIndex === 2 && match.innings1) {
        const target = (match.innings1.runs || 0) + 1;
        const runsNeeded = Math.max(0, target - (currInn.runs || 0));
        const totalMatchBalls = (match.overs || 20) * 6;
        const ballsLeft = Math.max(0, totalMatchBalls - (((currInn.completedOvers || 0) * 6) + (currInn.ballsThisOver || 0)));
        eqEl.innerHTML = `Need ${runsNeeded} runs<br>in ${ballsLeft} balls`;
      } else {
        eqEl.innerHTML = `1st Innings<br>in progress`;
      }
    }

    // Current batsmen
    const batsmenStats = document.querySelectorAll("#liveScorecardContainer .batsman-stat");
    if (batsmenStats.length >= 2) {
      const s1 = currInn.strikers?.striker || { name: "Striker", runs: 0, balls: 0 };
      const s2 = currInn.strikers?.nonStriker || { name: "Non-Striker", runs: 0, balls: 0 };

      const nameEl1 = batsmenStats[0].querySelector(".stat-name");
      const figEl1 = batsmenStats[0].querySelector(".stat-fig");
      if (nameEl1) nameEl1.textContent = `🏏 ${s1.name} *`;
      if (figEl1) figEl1.textContent = `${s1.runs || 0} (${s1.balls || 0}b)`;

      const nameEl2 = batsmenStats[1].querySelector(".stat-name");
      const figEl2 = batsmenStats[1].querySelector(".stat-fig");
      if (nameEl2) nameEl2.textContent = `🏏 ${s2.name}`;
      if (figEl2) figEl2.textContent = `${s2.runs || 0} (${s2.balls || 0}b)`;
    }

    // Current over balls
    const overBallsContainer = document.querySelector("#liveScorecardContainer .over-balls");
    if (overBallsContainer) {
      const balls = currInn.currentOverBalls || [];
      if (balls.length === 0) {
        overBallsContainer.innerHTML = `<span class="ball-dot" style="opacity:0.4;">-</span>`;
      } else {
        overBallsContainer.innerHTML = balls.map(b => {
          let cls = "ball-dot";
          let txt = String(b.runs !== undefined ? b.runs : b);
          if (b.isWicket || txt === "W") cls += " wicket";
          else if (b.runs === 4 || txt === "4") cls += " four";
          else if (b.runs === 6 || txt === "6") cls += " six";
          return `<span class="${cls}">${txt}</span>`;
        }).join("");
      }
    }
  }

  function getCurrentInnings(match) {
    if (!match) return null;
    return match.currentInningIndex === 2 ? match.innings2 : match.innings1;
  }

  function saveMatchHistorySnapshot(match) {
    if (!match) return;
    if (!match.historyStack) match.historyStack = [];
    // Keep last 30 snapshots for robust memory usage
    if (match.historyStack.length > 30) match.historyStack.shift();
    
    // Create snapshot clone without circular historyStack
    const snapshot = {
      currentInningIndex: match.currentInningIndex,
      status: match.status,
      innings1: JSON.parse(JSON.stringify(match.innings1)),
      innings2: match.innings2 ? JSON.parse(JSON.stringify(match.innings2)) : null
    };
    match.historyStack.push(snapshot);
  }

  // ==========================================
  // RENDER LIVE SCORING PAGE & SCOREBOARDS
  // ==========================================

  function renderLiveScoringPage(match) {
    if (!match) match = getActiveMatch();
    if (!match) return;

    const innings = getCurrentInnings(match);
    if (!innings) return;

    // Header Tags
    const liveScoreTournamentTag = document.getElementById("liveScoreTournamentTag");
    const liveScoreVenueTag = document.getElementById("liveScoreVenueTag");
    if (liveScoreTournamentTag) liveScoreTournamentTag.textContent = `🏆 ${match.tournament}`;
    if (liveScoreVenueTag) liveScoreVenueTag.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${match.ground}`;

    // Batting & Bowling Team Names & Crests
    const liveScoreBattingTeam = document.getElementById("liveScoreBattingTeam");
    const liveScoreBowlingTeam = document.getElementById("liveScoreBowlingTeam");
    const liveScoreBattingLogo = document.getElementById("liveScoreBattingLogo");
    const liveScoreBowlingLogo = document.getElementById("liveScoreBowlingLogo");
    const liveInningStatusPill = document.getElementById("liveInningStatusPill");

    if (liveScoreBattingTeam) liveScoreBattingTeam.textContent = innings.battingTeam;
    if (liveScoreBowlingTeam) liveScoreBowlingTeam.textContent = innings.bowlingTeam;

    if (liveScoreBattingLogo) {
      const initials = innings.battingTeam.split(" ").map(w => w.charAt(0)).join("").substring(0, 2).toUpperCase() || "BA";
      liveScoreBattingLogo.textContent = initials;
    }
    if (liveScoreBowlingLogo) {
      const initials = innings.bowlingTeam.split(" ").map(w => w.charAt(0)).join("").substring(0, 2).toUpperCase() || "BO";
      liveScoreBowlingLogo.textContent = initials;
    }

    if (liveInningStatusPill) {
      liveInningStatusPill.textContent = match.currentInningIndex === 2 ? "2nd Inning • Chasing" : "1st Inning • Batting";
    }

    // Score & Overs Display
    const liveScoreRunsWickets = document.getElementById("liveScoreRunsWickets");
    const liveScoreOversText = document.getElementById("liveScoreOversText");
    const liveScoreCrrValue = document.getElementById("liveScoreCrrValue");

    if (liveScoreRunsWickets) liveScoreRunsWickets.textContent = `${innings.totalRuns}/${innings.wickets}`;
    if (liveScoreOversText) liveScoreOversText.textContent = `(${innings.overs}.${innings.balls} / ${match.overs} Ov)`;

    // Calculate CRR (Current Run Rate)
    const totalDeliveries = (innings.overs * 6) + innings.balls;
    const crr = totalDeliveries > 0 ? ((innings.totalRuns / totalDeliveries) * 6).toFixed(2) : "0.00";
    if (liveScoreCrrValue) liveScoreCrrValue.textContent = crr;

    // 2nd Innings Target & Situation Equation Banner
    const liveTargetBanner = document.getElementById("liveTargetBanner");
    const liveTargetRuns = document.getElementById("liveTargetRuns");
    const liveTargetEquation = document.getElementById("liveTargetEquation");

    if (match.currentInningIndex === 2 && match.innings1) {
      if (liveTargetBanner) liveTargetBanner.style.display = "flex";
      const target = match.innings1.totalRuns + 1;
      const runsNeeded = target - innings.totalRuns;
      const maxBalls = match.overs * 6;
      const ballsRemaining = Math.max(0, maxBalls - totalDeliveries);
      const rrr = ballsRemaining > 0 ? Math.max(0, (runsNeeded / ballsRemaining) * 6).toFixed(2) : "0.00";

      if (liveTargetRuns) liveTargetRuns.textContent = target;
      if (liveTargetEquation) {
        if (runsNeeded <= 0) {
          liveTargetEquation.innerHTML = `<span style="color:#34d399;font-weight:900;">🎉 TARGET ACHIEVED! ${innings.battingTeam} won!</span>`;
        } else {
          liveTargetEquation.textContent = `Need ${runsNeeded} runs in ${ballsRemaining} balls • RRR: ${rrr}`;
        }
      }
    } else {
      if (liveTargetBanner) liveTargetBanner.style.display = "none";
    }

    // Toss Banner
    const liveScoreTossBannerText = document.getElementById("liveScoreTossBannerText");
    if (liveScoreTossBannerText && match.toss) {
      liveScoreTossBannerText.textContent = `${match.toss.winner} won the toss and elected to ${match.toss.decision.toLowerCase()} first.`;
    }

    // Batters at Crease Table
    renderCreaseBattersTable(innings);

    // Current Bowler Table
    renderCurrentBowlerTable(innings);

    // This Over Delivery Bubbles & Extras Strip
    renderThisOverStrip(innings);

    // Commentary Feed
    renderCommentaryFeed(innings);

    // Full Scorecard
    renderFullScorecardTab(match);

    // Squads Tab
    renderSquadsTab(match);

    // MATCH COMPLETION LOCK & BANNER
    const isCompleted = (match.status === "COMPLETED" || match.status === "TIED" || match.status === "ABANDONED");
    const controlPanel = document.querySelector(".scoring-control-panel");
    const oldLockBanner = document.getElementById("matchCompletedLockBanner");

    if (isCompleted) {
      if (controlPanel) {
        controlPanel.style.opacity = "0.38";
        controlPanel.style.pointerEvents = "none";
        controlPanel.setAttribute("aria-disabled", "true");
      }
      if (!oldLockBanner && controlPanel && controlPanel.parentNode) {
        const lockBanner = document.createElement("div");
        lockBanner.id = "matchCompletedLockBanner";
        lockBanner.style.cssText = "background: linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.06)); border: 1px solid rgba(34,197,94,0.5); border-radius: 12px; padding: 14px 16px; margin: 12px 0; text-align: center;";
        lockBanner.innerHTML = `
          <div style="font-size: 24px; margin-bottom: 2px;">🏆</div>
          <div style="font-size: 16px; font-weight: 900; color: #4ade80; text-transform: uppercase;">MATCH COMPLETED</div>
          <div style="font-size: 14px; font-weight: 700; color: #ffffff; margin: 4px 0 8px;">${match.result || "Match Finished"}</div>
          ${match.playerOfTheMatch ? `<div style="font-size: 12px; color: #facc15; margin-bottom: 10px;">⭐ Player of the Match: <strong>${match.playerOfTheMatch}</strong></div>` : ""}
          <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
            <button type="button" id="btnScorecardFromLock" style="background: #ff5a00; color: #fff; border: none; padding: 8px 14px; border-radius: 8px; font-weight: 800; font-size: 12px; cursor: pointer;"><i class="fa-solid fa-chart-column"></i> View Scorecard</button>
            <button type="button" id="btnTourneyFromLock" style="background: #262626; color: #fff; border: 1px solid #444; padding: 8px 14px; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer;"><i class="fa-solid fa-trophy"></i> Back to Tournament</button>
          </div>
        `;
        controlPanel.parentNode.insertBefore(lockBanner, controlPanel);
        document.getElementById("btnScorecardFromLock")?.addEventListener("click", () => {
          document.getElementById("tabLiveScorecard")?.click();
        });
        document.getElementById("btnTourneyFromLock")?.addEventListener("click", () => {
          const tId = match.tourneyId || window.activeLinkedTourneyId || (typeof activeTournamentId !== "undefined" ? activeTournamentId : null);
          if (tId && typeof openTournamentDetails === "function") openTournamentDetails(tId);
          else if (typeof openTournamentScreen === "function") openTournamentScreen();
          else showScreen("screen5");
        });
      } else if (oldLockBanner) {
        oldLockBanner.style.display = "block";
      }
    } else {
      if (controlPanel) {
        controlPanel.style.opacity = "1";
        controlPanel.style.pointerEvents = "auto";
        controlPanel.removeAttribute("aria-disabled");
      }
      if (oldLockBanner) {
        oldLockBanner.style.display = "none";
      }
    }
  }

  function renderCreaseBattersTable(innings) {
    const tableBody = document.getElementById("liveScoreBattersTable");
    if (!tableBody) return;

    const creaseBatters = (innings.batting || []).filter(b => b.isAtCrease);
    tableBody.innerHTML = "";

    if (creaseBatters.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;">No batters at crease</td></tr>`;
      return;
    }

    creaseBatters.forEach(batter => {
      const sr = batter.balls > 0 ? ((batter.runs / batter.balls) * 100).toFixed(1) : "0.0";
      const tr = document.createElement("tr");
      if (batter.isStriker) tr.className = "striker-highlight-row";

      tr.innerHTML = `
        <td>
          <strong>${batter.name}</strong>
          ${batter.isStriker ? '<span class="striker-indicator-dot" title="On Strike">*</span>' : ''}
        </td>
        <td><strong>${batter.runs}</strong></td>
        <td>${batter.balls}</td>
        <td>${batter.fours || 0}</td>
        <td>${batter.sixes || 0}</td>
        <td>${sr}</td>
      `;
      tableBody.appendChild(tr);
    });
  }

  function renderCurrentBowlerTable(innings) {
    const tableBody = document.getElementById("liveScoreBowlerTable");
    if (!tableBody) return;

    const currentBowler = (innings.bowling || []).find(b => b.isCurrentBowler) || innings.bowling[0];
    tableBody.innerHTML = "";

    if (!currentBowler) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;">No bowler assigned</td></tr>`;
      return;
    }

    const totalBowlerBalls = (currentBowler.overs * 6) + currentBowler.balls;
    const econ = totalBowlerBalls > 0 ? ((currentBowler.runs / totalBowlerBalls) * 6).toFixed(2) : "0.00";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${currentBowler.name}</strong></td>
      <td>${currentBowler.overs}.${currentBowler.balls}</td>
      <td>${currentBowler.maidens || 0}</td>
      <td>${currentBowler.runs || 0}</td>
      <td><strong>${currentBowler.wickets || 0}</strong></td>
      <td>${econ}</td>
    `;
    tableBody.appendChild(tr);
  }

  function renderThisOverStrip(innings) {
    const badge = document.getElementById("liveCurrentOverBadge");
    const extrasPill = document.getElementById("liveExtrasSummaryPill");
    const container = document.getElementById("liveRecentBallsContainer");

    if (badge) badge.textContent = `Over ${innings.overs}.${innings.balls}`;

    const ex = innings.extras || { wide: 0, noBall: 0, bye: 0, legBye: 0, total: 0 };
    if (extrasPill) {
      extrasPill.textContent = `Extras: ${ex.total || 0} (wd ${ex.wide || 0}, nb ${ex.noBall || 0}, b ${ex.bye || 0}, lb ${ex.legBye || 0})`;
    }

    if (!container) return;
    container.innerHTML = "";

    if (!innings.currentOverDeliveries || innings.currentOverDeliveries.length === 0) {
      container.innerHTML = `<span class="empty-balls-text">Over starting...</span>`;
      return;
    }

    innings.currentOverDeliveries.forEach(del => {
      const bubble = document.createElement("div");
      bubble.className = `ball-bubble ${del.typeClass || 'runs'}`;
      bubble.textContent = del.label;
      if (del.direction) bubble.title = `Shot Direction: ${del.direction}`;
      container.appendChild(bubble);
    });
  }

  function renderCommentaryFeed(innings) {
    const list = document.getElementById("liveCommentaryList");
    if (!list) return;

    list.innerHTML = "";
    const comms = innings.commentary || [];

    if (comms.length === 0) {
      list.innerHTML = `
        <div style="text-align:center;padding:24px 0;color:#64748b;font-size:12px;">
          <i class="fa-solid fa-microphone-lines" style="font-size:24px;margin-bottom:8px;display:block;"></i>
          No commentary yet. Deliveries will appear here in real-time.
        </div>
      `;
      return;
    }

    // Show most recent commentary at top
    comms.slice().reverse().forEach(item => {
      const card = document.createElement("div");
      card.className = "commentary-item-card";

      let pillClass = "four";
      if (item.event === "SIX") pillClass = "six";
      else if (item.event === "WICKET") pillClass = "wicket";
      else if (["WIDE", "NO BALL", "BYE", "LEG BYE", "PENALTY"].includes(item.event)) pillClass = "extra";

      const dirHtml = item.direction ? `<span class="comm-direction-badge"><i class="fa-solid fa-compass"></i> ${item.direction}</span>` : "";

      card.innerHTML = `
        <div class="commentary-meta-row">
          <span class="comm-over-tag">Over ${item.over}</span>
          <span class="comm-event-pill ${pillClass}">${item.badge || item.event}</span>
        </div>
        <div class="comm-desc-text">
          ${dirHtml}
          <span>${item.text}</span>
        </div>
      `;
      list.appendChild(card);
    });
  }

  let activeScorecardInningsView = "all"; // 'all', '1', '2'

  function renderFullScorecardTab(match) {
    const container = document.getElementById("liveFullScorecardContainer");
    if (!container) return;
    if (!match) match = getActiveMatch();
    if (!match || !match.innings1) {
      container.innerHTML = `<div style="text-align:center;padding:24px;color:#64748b;font-size:12px;">No active match scorecard data found.</div>`;
      return;
    }

    const inn1 = match.innings1;
    const inn2 = match.innings2;
    const currentInningIdx = match.currentInningIndex || 1;

    // Build Match Information Header
    let matchResultHtml = "";
    if (match.status === "COMPLETED" && match.result) {
      matchResultHtml = `
        <div class="scorecard-result-banner">
          <i class="fa-solid fa-trophy" style="font-size:16px;"></i>
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.85;">Match Finished • Result</div>
            <div style="font-size:13px;font-weight:900;">${match.result}</div>
          </div>
        </div>
      `;
    } else if (currentInningIdx === 2 && inn1 && inn2) {
      const target = inn1.totalRuns + 1;
      const needed = target - inn2.totalRuns;
      const totalBallsBowled = (inn2.overs * 6) + inn2.balls;
      const ballsRem = Math.max(0, (match.overs * 6) - totalBallsBowled);
      const rrr = ballsRem > 0 ? ((needed / ballsRem) * 6).toFixed(2) : "0.00";
      matchResultHtml = `
        <div class="scorecard-result-banner live-status">
          <i class="fa-solid fa-circle-dot" style="font-size:14px;color:#ef4444;"></i>
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">LIVE • 2nd Innings</div>
            <div style="font-size:12px;font-weight:800;">
              ${needed <= 0 ? `Target Reached! ${inn2.battingTeam} won!` : `${inn2.battingTeam} need ${needed} runs from ${ballsRem} balls (RRR: ${rrr})`}
            </div>
          </div>
        </div>
      `;
    } else {
      matchResultHtml = `
        <div class="scorecard-result-banner live-status">
          <i class="fa-solid fa-circle-dot" style="font-size:14px;color:#ef4444;"></i>
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">LIVE • 1st Innings</div>
            <div style="font-size:12px;font-weight:800;">${inn1.battingTeam} batting first • (${match.overs} Overs Match)</div>
          </div>
        </div>
      `;
    }

    const tossText = match.toss ? `${match.toss.winner} won the toss and elected to ${match.toss.decision.toLowerCase()} first` : "Toss information not available";

    let html = `
      <div class="scorecard-header-card">
        <div class="scorecard-meta-top">
          <span class="scorecard-tourney-badge"><i class="fa-solid fa-trophy"></i> ${match.tournament || "Cric Yuva Match"}</span>
          <span class="scorecard-venue-badge"><i class="fa-solid fa-location-dot"></i> ${match.ground || "Ground"}</span>
        </div>
        <div class="scorecard-match-title">
          <span>${match.teamA.name}</span>
          <span style="color:var(--orange);font-size:12px;">VS</span>
          <span>${match.teamB.name}</span>
          <span style="font-size:11px;color:#94a3b8;font-weight:600;margin-left:auto;">${match.overs} Ov</span>
        </div>
        <div class="scorecard-toss-info">
          <i class="fa-solid fa-coins" style="color:var(--orange);margin-right:4px;"></i> ${tossText}
        </div>
        ${matchResultHtml}
      </div>
    `;

    // Innings Tabs Selector (if Innings 2 exists)
    if (inn2) {
      html += `
        <div class="scorecard-innings-nav">
          <button type="button" class="scorecard-nav-tab ${activeScorecardInningsView === 'all' ? 'active' : ''}" data-view="all">
            <i class="fa-solid fa-list-check"></i> Full Match (Both)
          </button>
          <button type="button" class="scorecard-nav-tab ${activeScorecardInningsView === '1' ? 'active' : ''}" data-view="1">
            1st Inning (${inn1.battingTeam} ${inn1.totalRuns}/${inn1.wickets})
          </button>
          <button type="button" class="scorecard-nav-tab ${activeScorecardInningsView === '2' ? 'active' : ''}" data-view="2">
            2nd Inning (${inn2.battingTeam} ${inn2.totalRuns}/${inn2.wickets})
          </button>
        </div>
      `;
    }

    // Helper to generate scorecard for a single innings
    function buildInningsScorecardHtml(innings, inningsNumber, isCurrent) {
      if (!innings) return "";
      const totalBalls = (innings.overs * 6) + innings.balls;
      const crr = totalBalls > 0 ? ((innings.totalRuns / totalBalls) * 6).toFixed(2) : "0.00";
      const ext = innings.extras || { wide: 0, noBall: 0, bye: 0, legBye: 0, penalty: 0, total: 0 };

      let innHtml = `
        <div class="scorecard-innings-box">
          <div class="scorecard-innings-title-row">
            <div class="scorecard-team-heading">
              <span style="background:var(--orange);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:900;">${inningsNumber === 1 ? '1st INNING' : '2nd INNING'}</span>
              <span>${innings.battingTeam}</span>
            </div>
            <div class="scorecard-team-total">
              ${innings.totalRuns}/${innings.wickets} <span style="font-size:11px;color:#94a3b8;font-weight:700;">(${innings.overs}.${innings.balls}/${match.overs} Ov)</span>
            </div>
          </div>

          <!-- BATTING TABLE -->
          <div class="scorecard-section-label">
            <i class="fa-solid fa-baseball-bat-ball"></i> Batting Card
          </div>
          <div class="scorecard-table-wrapper">
            <table class="scorecard-full-table">
              <thead>
                <tr>
                  <th>Batter</th>
                  <th>R</th>
                  <th>B</th>
                  <th>4s</th>
                  <th>6s</th>
                  <th>SR</th>
                </tr>
              </thead>
              <tbody>
      `;

      (innings.batting || []).forEach(b => {
        const sr = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : "0.0";
        let statusBadge = "";
        let rowClass = "";

        if (b.isOut) {
          statusBadge = `<div class="batter-dismissal out">${b.dismissal || 'Out'}</div>`;
        } else if (b.isAtCrease && isCurrent) {
          rowClass = "active-batter-row";
          if (b.isStriker) {
            statusBadge = `<div class="batter-dismissal not-out"><span class="active-crease-tag striker">On Strike *</span> not out</div>`;
          } else {
            statusBadge = `<div class="batter-dismissal not-out"><span class="active-crease-tag non-striker">Batting</span> not out</div>`;
          }
        } else if (b.balls > 0 || b.runs > 0) {
          statusBadge = `<div class="batter-dismissal not-out">not out *</div>`;
        } else {
          statusBadge = `<div class="batter-dismissal yet-to-bat">yet to bat</div>`;
        }

        innHtml += `
          <tr class="${rowClass}">
            <td class="batter-name-cell">
              <div class="batter-title">
                ${b.name}
                ${b.role && b.role !== 'Player' ? `<span style="font-size:9px;color:#94a3b8;font-weight:normal;">[${b.role}]</span>` : ''}
              </div>
              ${statusBadge}
            </td>
            <td><strong style="color:${b.runs >= 50 ? '#fbbf24' : '#fff'};font-size:12px;">${b.runs}</strong></td>
            <td>${b.balls}</td>
            <td>${b.fours || 0}</td>
            <td>${b.sixes || 0}</td>
            <td>${sr}</td>
          </tr>
        `;
      });

      innHtml += `
              </tbody>
            </table>
          </div>

          <!-- EXTRAS ROW -->
          <div class="scorecard-extras-row">
            <div>
              <span class="scorecard-extras-label">Extras: </span>
              <span class="scorecard-extras-breakdown">(b ${ext.bye || 0}, lb ${ext.legBye || 0}, w ${ext.wide || 0}, nb ${ext.noBall || 0}, p ${ext.penalty || 0})</span>
            </div>
            <div class="scorecard-extras-val">${ext.total || 0}</div>
          </div>

          <!-- TOTAL & RUN RATE ROW -->
          <div class="scorecard-total-row">
            <div>
              <span>TOTAL </span>
              <span style="font-size:10px;color:#94a3b8;font-weight:normal;">(${innings.overs}.${innings.balls} Ov, CRR: ${crr})</span>
            </div>
            <div class="scorecard-total-score">${innings.totalRuns}/${innings.wickets}</div>
          </div>
      `;

      // Did Not Bat Players
      const didNotBat = (innings.batting || []).filter(b => !b.isOut && !b.isAtCrease && b.balls === 0);
      if (didNotBat.length > 0) {
        innHtml += `
          <div class="scorecard-did-not-bat">
            <span style="font-weight:700;color:#94a3b8;">Yet to bat: </span>
            <span class="scorecard-dnb-names">${didNotBat.map(p => p.name).join(", ")}</span>
          </div>
        `;
      }

      // Fall of Wickets (FOW)
      const fows = innings.fallOfWickets || [];
      innHtml += `
        <div class="scorecard-fow-box">
          <div class="scorecard-fow-header"><i class="fa-solid fa-arrow-down-wide-short"></i> Fall of Wickets</div>
          <div class="scorecard-fow-list">
      `;
      if (fows.length === 0) {
        innHtml += `<span style="color:#64748b;font-size:10px;">No wickets have fallen yet.</span>`;
      } else {
        fows.forEach(f => {
          innHtml += `<span class="scorecard-fow-item"><strong>${f.wicketNum}-${f.score}</strong> (${f.batter}, ${f.over} ov)</span>`;
        });
      }
      innHtml += `
          </div>
        </div>
      `;

      // BOWLING TABLE
      innHtml += `
        <div class="scorecard-section-label" style="color:#38bdf8;">
          <i class="fa-solid fa-bullseye"></i> Bowling Card (${innings.bowlingTeam})
        </div>
        <div class="scorecard-table-wrapper">
          <table class="scorecard-full-table">
            <thead>
              <tr>
                <th>Bowler</th>
                <th>O</th>
                <th>M</th>
                <th>R</th>
                <th>W</th>
                <th>ECON</th>
              </tr>
            </thead>
            <tbody>
      `;

      const bowlersToShow = (innings.bowling || []).filter(b => b.overs > 0 || b.balls > 0 || (isCurrent && b.isCurrentBowler));
      if (bowlersToShow.length === 0) {
        innHtml += `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:12px;">No bowling stats recorded yet.</td></tr>`;
      } else {
        bowlersToShow.forEach(b => {
          const bTotalDeliveries = (b.overs * 6) + b.balls;
          const econ = bTotalDeliveries > 0 ? ((b.runs / bTotalDeliveries) * 6).toFixed(2) : "0.00";
          const isBowlerActive = isCurrent && b.isCurrentBowler;
          const bRowClass = isBowlerActive ? "active-bowler-row" : "";

          innHtml += `
            <tr class="${bRowClass}">
              <td>
                <div class="batter-title">
                  ${b.name}
                  ${isBowlerActive ? '<span style="color:var(--orange);font-size:10px;font-weight:900;margin-left:4px;">* 🎯</span>' : ''}
                </div>
                <div style="font-size:9px;color:#64748b;">${b.role || 'Bowler'}</div>
              </td>
              <td>${b.overs}.${b.balls}</td>
              <td>${b.maidens || 0}</td>
              <td>${b.runs || 0}</td>
              <td><strong style="color:${b.wickets >= 3 ? '#fbbf24' : '#38bdf8'};font-size:12px;">${b.wickets || 0}</strong></td>
              <td>${econ}</td>
            </tr>
          `;
        });
      }

      innHtml += `
            </tbody>
          </table>
        </div>
      </div>
      `;

      return innHtml;
    }

    // Render Innings based on selected tab
    if (activeScorecardInningsView === "1" || !inn2) {
      html += buildInningsScorecardHtml(inn1, 1, currentInningIdx === 1);
    } else if (activeScorecardInningsView === "2" && inn2) {
      html += buildInningsScorecardHtml(inn2, 2, currentInningIdx === 2);
    } else {
      // Both Innings View
      html += buildInningsScorecardHtml(inn1, 1, currentInningIdx === 1);
      if (inn2) {
        html += buildInningsScorecardHtml(inn2, 2, currentInningIdx === 2);
      }
    }

    container.innerHTML = html;

    // Attach Event Listeners to Innings Nav Tabs
    container.querySelectorAll(".scorecard-nav-tab").forEach(tabBtn => {
      tabBtn.addEventListener("click", function () {
        activeScorecardInningsView = tabBtn.dataset.view;
        renderFullScorecardTab(match);
      });
    });
  }

  function renderSquadsTab(match) {
    const squadAName = document.getElementById("liveSummaryTeamAName");
    const squadBName = document.getElementById("liveSummaryTeamBName");
    const squadAPlayers = document.getElementById("liveSummaryTeamAPlayers");
    const squadBPlayers = document.getElementById("liveSummaryTeamBPlayers");

    if (squadAName) squadAName.textContent = `${match.teamA.name} (${match.teamA.playingXi?.length || 11})`;
    if (squadBName) squadBName.textContent = `${match.teamB.name} (${match.teamB.playingXi?.length || 11})`;

    if (squadAPlayers && match.teamA.playingXi) {
      squadAPlayers.innerHTML = "";
      match.teamA.playingXi.forEach(p => {
        const li = document.createElement("li");
        li.textContent = `• ${p.name} ${p.isCaptain ? '(C)' : p.isViceCaptain ? '(VC)' : ''} [${p.role}]`;
        squadAPlayers.appendChild(li);
      });
    }

    if (squadBPlayers && match.teamB.playingXi) {
      squadBPlayers.innerHTML = "";
      match.teamB.playingXi.forEach(p => {
        const li = document.createElement("li");
        li.textContent = `• ${p.name} ${p.isCaptain ? '(C)' : p.isViceCaptain ? '(VC)' : ''} [${p.role}]`;
        squadBPlayers.appendChild(li);
      });
    }
  }

  // ==========================================
  // SCORING LOGIC & CRICKET DELIVERY ENGINE
  // ==========================================

  let pendingBoundary = null; // Stores { runs: 4 or 6, direction: "Cover" }

  function handleRunDelivery(runsScored, direction = "") {
  const match = getActiveMatch();
  if (!match) return;
  if (["COMPLETED","TIED","ABANDONED"].includes(match.status)) return;

  const innings = getCurrentInnings(match);
  if (!innings) return;

  const maxOvers = match.overs || 20;
  const maxWkts = match.isSuperOver ? 2 : 10;

  if (innings.overs >= maxOvers || innings.wickets >= maxWkts) {
    checkInningsCompletionStatus(match, innings);
    return;
  }

  if (match.currentInningIndex === 2 && match.innings1) {
    const target = (match.innings1.totalRuns || 0) + 1;
    if (innings.totalRuns >= target) {
      checkInningsCompletionStatus(match, innings);
      return;
    }
  }

  saveMatchHistorySnapshot(match);

  const striker = innings.batting.find(b => b.isAtCrease && b.isStriker);
  const bowler = innings.bowling.find(b => b.isCurrentBowler) || innings.bowling[0];

  if (!striker || !bowler) {
    alert("Please ensure striker and bowler are assigned.");
    return;
  }

  innings.totalRuns += runsScored;
  striker.runs += runsScored;
  striker.balls += 1;

  if (runsScored === 4) striker.fours = (striker.fours || 0) + 1;
  if (runsScored === 6) striker.sixes = (striker.sixes || 0) + 1;

  bowler.runs += runsScored;

  // Every normal scoring button = one legal ball.
  innings.balls = (innings.balls || 0) + 1;
  bowler.balls = (bowler.balls || 0) + 1;

  const overCoord = `${innings.overs}.${innings.balls}`;
  const label = String(runsScored);
  const typeClass =
    runsScored === 0 ? "dot" :
    runsScored === 4 ? "four" :
    runsScored === 6 ? "six" : "runs";

  const eventName =
    runsScored === 0 ? "DOT BALL" :
    runsScored === 4 ? "FOUR" :
    runsScored === 6 ? "SIX" : `${runsScored} RUNS`;

  if (!Array.isArray(innings.currentOverDeliveries)) {
    innings.currentOverDeliveries = [];
  }

  innings.currentOverDeliveries.push({
    label,
    typeClass,
    runs: runsScored,
    direction,
    ballNumber: innings.balls
  });

  let commText = "";
  if (runsScored === 0) {
    commText = `${bowler.name} to ${striker.name}, no run, solid defensive shot.`;
  } else if (runsScored === 4) {
    const dirText = direction ? ` through ${direction}` : "";
    commText = `🏏 FOUR! ${striker.name} cracks a crisp boundary${dirText} off ${bowler.name}!`;
  } else if (runsScored === 6) {
    const dirText = direction ? ` over ${direction}` : "";
    commText = `🚀 SIX! Massive hit! ${striker.name} lofts it high and handsome${dirText} into the stands!`;
  } else {
    commText = `${bowler.name} to ${striker.name}, ${runsScored} run${runsScored > 1 ? "s" : ""} taken with good running between wickets.`;
  }

  innings.commentary.push({
    over: overCoord,
    event: eventName,
    badge: runsScored === 0 ? "•" : label,
    text: commText,
    direction,
    runs: runsScored
  });

  if (runsScored % 2 !== 0) {
    rotateStrike(innings);
  }

  let targetAchievedIn2nd = false;
  if (match.currentInningIndex === 2 && match.innings1) {
    const target = (match.innings1.totalRuns || 0) + 1;
    targetAchievedIn2nd = innings.totalRuns >= target;
  }

  // The 6th legal ball is recorded FIRST, then the over is completed.
  if (innings.balls >= 6) {
    if (!targetAchievedIn2nd) {
      completeOver(innings, bowler, match);
    }
  }

  checkInningsCompletionStatus(match, innings);
  saveActiveMatchState(match);
  renderLiveScoringPage(match);
}

function rotateStrike(innings) {
    const creaseBatters = innings.batting.filter(b => b.isAtCrease);
    if (creaseBatters.length === 2) {
      creaseBatters.forEach(b => {
        b.isStriker = !b.isStriker;
      });
    }
  }

  function completeOver(innings, bowler, match) {
    innings.overs += 1;
    innings.balls = 0;
    bowler.overs += 1;
    bowler.balls = 0;
    bowler.lastOverBowled = innings.overs;

    // Check for Maiden Over (0 runs scored from bowler this over)
    const runsThisOver = (innings.currentOverDeliveries || []).reduce((sum, d) => sum + (d.runs || 0), 0);
    if (runsThisOver === 0 && (innings.currentOverDeliveries || []).length === 6) {
      bowler.maidens = (bowler.maidens || 0) + 1;
    }

    // End of Over: Strike automatically swaps (if match still live)
    const maxOvers = match.overs || 20;
    const maxWkts = match.isSuperOver ? 2 : 10;
    if (innings.overs < maxOvers && innings.wickets < maxWkts) {
      rotateStrike(innings);
    }

    // Over Commentary Summary
    innings.commentary.push({
      over: `${innings.overs}.0`,
      event: "END OF OVER",
      badge: "OV",
      text: `End of Over ${innings.overs} • Score: ${innings.totalRuns}/${innings.wickets} • (${bowler.name}: ${bowler.overs}-${bowler.maidens || 0}-${bowler.runs}-${bowler.wickets})`
    });

    // Clear current over strip
    innings.currentOverDeliveries = [];

    // Prompt for Bowler Change ONLY if innings not finished and match not completed
    if (innings.overs < maxOvers && innings.wickets < maxWkts) {
      if (match.currentInningIndex === 2 && match.innings1) {
        const target = (match.innings1.totalRuns || 0) + 1;
        if (innings.totalRuns >= target) return;
      }
      setTimeout(() => {
        const currentM = getActiveMatch();
        if (currentM && currentM.status !== "COMPLETED" && currentM.status !== "TIED" && currentM.status !== "ABANDONED") {
          openChangeBowlerModal();
        }
      }, 500);
    }
  }

  // ==========================================
  // MATCH FLOW: INNINGS COMPLETION, BREAK & RESULTS
  // ==========================================

  function checkInningsCompletionStatus(match, innings) {
    if (!match || !innings) return;
    const maxOvers = match.overs || 20;
    const maxWkts = match.isSuperOver ? 2 : 10;
    const isAllOut = innings.wickets >= maxWkts;
    const isOversFinished = innings.overs >= maxOvers;

    // SUPER OVER 1ST INNINGS
    if (match.isSuperOver && match.currentInningIndex === 1) {
      if (isAllOut || isOversFinished) {
        showInningsBreakModal(match);
      }
      return;
    }

    // SUPER OVER 2ND INNINGS
    if (match.isSuperOver && match.currentInningIndex === 2) {
      const soTarget = (match.innings1?.totalRuns || 0) + 1;
      if (innings.totalRuns >= soTarget) {
        const wktsRem = Math.max(0, 2 - innings.wickets);
        const winResult = `${innings.battingTeam} won the Super Over by ${wktsRem} wicket${wktsRem === 1 ? "" : "s"}!`;
        match.status = "COMPLETED";
        match.result = winResult;
        saveActiveMatchState(match);
        saveMatchToHistoryStorage(match);
        if (typeof syncMatchToTournament === "function") syncMatchToTournament(match);
        renderLiveScoringPage(match);
        showFinalMatchHub(match, winResult);
      } else if (isAllOut || isOversFinished) {
        let winResult = "";
        if (innings.totalRuns === match.innings1.totalRuns) {
          // Boundary countback tie-breaker
          const fours1 = (match.innings1.batting || []).reduce((s, b) => s + (b.fours || 0), 0);
          const sixes1 = (match.innings1.batting || []).reduce((s, b) => s + (b.sixes || 0), 0);
          const fours2 = (innings.batting || []).reduce((s, b) => s + (b.fours || 0), 0);
          const sixes2 = (innings.batting || []).reduce((s, b) => s + (b.sixes || 0), 0);
          const boundaries1 = fours1 + sixes1;
          const boundaries2 = fours2 + sixes2;

          if (boundaries2 > boundaries1) {
            winResult = `${innings.battingTeam} won Super Over on Boundary Countback (${boundaries2} vs ${boundaries1})!`;
          } else if (boundaries1 > boundaries2) {
            winResult = `${match.innings1.battingTeam} won Super Over on Boundary Countback (${boundaries1} vs ${boundaries2})!`;
          } else {
            winResult = `Super Over Tied! Joint Winners!`;
          }
        } else {
          const margin = match.innings1.totalRuns - innings.totalRuns;
          winResult = `${match.innings1.battingTeam} won the Super Over by ${margin} run${margin === 1 ? "" : "s"}!`;
        }
        match.status = "COMPLETED";
        match.result = winResult;
        saveActiveMatchState(match);
        saveMatchToHistoryStorage(match);
        if (typeof syncMatchToTournament === "function") syncMatchToTournament(match);
        renderLiveScoringPage(match);
        showFinalMatchHub(match, winResult);
      }
      return;
    }

    // REGULAR 1ST INNINGS COMPLETION
    if (match.currentInningIndex === 1) {
      if (isAllOut || isOversFinished) {
        // Enforce exact overs display if overs completed
        if (isOversFinished) {
          innings.overs = maxOvers;
          innings.balls = 0;
        }
        showInningsBreakModal(match);
      }
    } 
    // REGULAR 2ND INNINGS COMPLETION
    else if (match.currentInningIndex === 2) {
      const target = (match.innings1?.totalRuns || 0) + 1;
      
      // Target Achieved by Chasing Team
      if (innings.totalRuns >= target) {
        const wktsRem = Math.max(0, 10 - innings.wickets);
        const totalBallsBowled = (innings.overs * 6) + innings.balls;
        const ballsRem = Math.max(0, (maxOvers * 6) - totalBallsBowled);
        const winResult = `${innings.battingTeam} won by ${wktsRem} wicket${wktsRem === 1 ? "" : "s"}${ballsRem > 0 ? ` (${ballsRem} balls remaining)` : ""}`;
        
        match.status = "COMPLETED";
        match.result = winResult;
        saveActiveMatchState(match);
        saveMatchToHistoryStorage(match);
        if (typeof syncMatchToTournament === "function") syncMatchToTournament(match);
        renderLiveScoringPage(match);
        showFinalMatchHub(match, winResult);
      } 
      // Chasing Team All Out or Overs Finished
      else if (isAllOut || isOversFinished) {
        if (isOversFinished) {
          innings.overs = maxOvers;
          innings.balls = 0;
        }
        const margin = target - innings.totalRuns - 1;
        let winResult = "";

        if (margin === 0) {
          winResult = "Match Tied";
          match.status = "TIED";
          match.result = winResult;
          saveActiveMatchState(match);
          saveMatchToHistoryStorage(match);
          if (typeof syncMatchToTournament === "function") syncMatchToTournament(match);
          renderLiveScoringPage(match);
          // Show Super Over prompt if available
          openSuperOverModal(match);
        } else {
          winResult = `${match.innings1.battingTeam} won by ${margin} run${margin === 1 ? "" : "s"}`;
          match.status = "COMPLETED";
          match.result = winResult;
          saveActiveMatchState(match);
          saveMatchToHistoryStorage(match);
          if (typeof syncMatchToTournament === "function") syncMatchToTournament(match);
          renderLiveScoringPage(match);
          showFinalMatchHub(match, winResult);
        }
      }
    }
  }

  // ----------------------------------------------------
  // 1. INNINGS BREAK MODAL
  // ----------------------------------------------------

  function showInningsBreakModal(match) {
    if (!match) match = getActiveMatch();
    if (!match || !match.innings1) return;

    const modal = document.getElementById("inningsBreakModal");
    const inn1 = match.innings1;
    const nextBattingTeam = inn1.bowlingTeam;
    const target = inn1.totalRuns + 1;
    const totalDeliveries = (inn1.overs * 6) + inn1.balls;
    const crr = totalDeliveries > 0 ? ((inn1.totalRuns / totalDeliveries) * 6).toFixed(2) : "0.00";
    const rrr = match.overs > 0 ? (target / match.overs).toFixed(2) : "0.00";

    // Set 1st Innings Data
    const teamTitle = document.getElementById("break1stInningsTeam");
    const scoreElem = document.getElementById("break1stInningsScore");
    const oversElem = document.getElementById("break1stInningsOvers");
    const crrElem = document.getElementById("break1stInningsCrr");

    if (teamTitle) teamTitle.textContent = `${inn1.battingTeam} Batting Summary (${match.isSuperOver ? 'Super Over' : '1st Innings'})`;
    if (scoreElem) scoreElem.textContent = `${inn1.totalRuns}/${inn1.wickets}`;
    if (oversElem) oversElem.textContent = `(${inn1.overs}.${inn1.balls} / ${match.overs} Ov)`;
    if (crrElem) crrElem.textContent = `CRR: ${crr}`;

    // Top Batsman in 1st Innings
    const batters = [...(inn1.batting || [])].sort((a, b) => b.runs - a.runs);
    const topBatter = batters[0] || { name: "Batter", runs: 0, balls: 0, fours: 0, sixes: 0 };
    const topBatterName = document.getElementById("breakTopBatterName");
    const topBatterStat = document.getElementById("breakTopBatterStat");
    if (topBatterName) topBatterName.textContent = topBatter.name;
    if (topBatterStat) topBatterStat.textContent = `${topBatter.runs} (${topBatter.balls}b, ${topBatter.fours || 0}x4, ${topBatter.sixes || 0}x6)`;

    // Best Bowler in 1st Innings
    const bowlers = [...(inn1.bowling || [])].filter(b => b.overs > 0 || b.balls > 0).sort((a, b) => {
      if (b.wickets !== a.wickets) return b.wickets - a.wickets;
      return a.runs - b.runs;
    });
    const bestBowler = bowlers[0] || { name: "Bowler", wickets: 0, runs: 0, overs: 0, balls: 0 };
    const topBowlerName = document.getElementById("breakTopBowlerName");
    const topBowlerStat = document.getElementById("breakTopBowlerStat");
    if (topBowlerName) topBowlerName.textContent = bestBowler.name;
    if (topBowlerStat) topBowlerStat.textContent = `${bestBowler.wickets}/${bestBowler.runs} (${bestBowler.overs}.${bestBowler.balls} ov)`;

    // Target Equation
    const targetRuns = document.getElementById("breakTargetRuns");
    const targetEquation = document.getElementById("breakTargetEquation");
    const chasingTeam = document.getElementById("breakChasingTeam");

    if (targetRuns) targetRuns.textContent = `Target: ${target} Runs`;
    if (chasingTeam) chasingTeam.textContent = nextBattingTeam;
    if (targetEquation) {
      targetEquation.innerHTML = `<strong>${nextBattingTeam}</strong> need <strong>${target} runs</strong> in ${match.overs}.0 overs (Required Run Rate: ${rrr} RPO)`;
    }

    if (modal) modal.style.display = "flex";
  }

  // ----------------------------------------------------
  // 2. SECOND INNINGS OPENERS & START ENGINE
  // ----------------------------------------------------

  function open2ndInningsOpenersModal(match) {
    if (!match) match = getActiveMatch();
    if (!match || !match.innings1) return;

    const modal = document.getElementById("secondInningsOpenersModal");
    const battingSecondTeam = match.innings1.bowlingTeam;
    const bowlingSecondTeam = match.innings1.battingTeam;

    const battingSecondXi = battingSecondTeam === match.teamA.name ? match.teamA.playingXi : match.teamB.playingXi;
    const bowlingSecondXi = bowlingSecondTeam === match.teamA.name ? match.teamA.playingXi : match.teamB.playingXi;

    const selectStriker = document.getElementById("select2ndStriker");
    const selectNonStriker = document.getElementById("select2ndNonStriker");
    const selectBowler = document.getElementById("select2ndBowler");
    const hint = document.getElementById("secondInningsBattingHint");

    if (hint) {
      hint.innerHTML = `Chasing Team: <strong style="color:var(--orange);">${battingSecondTeam}</strong> • Target: <strong>${match.innings1.totalRuns + 1}</strong>`;
    }

    // Populate Batsmen
    if (selectStriker && selectNonStriker) {
      selectStriker.innerHTML = "";
      selectNonStriker.innerHTML = "";
      (battingSecondXi || []).forEach((p, idx) => {
        const opt1 = new Option(`${p.name} (${p.role || 'Player'})`, p.name);
        const opt2 = new Option(`${p.name} (${p.role || 'Player'})`, p.name);
        selectStriker.add(opt1);
        selectNonStriker.add(opt2);
      });
      if (selectStriker.options.length > 0) selectStriker.selectedIndex = 0;
      if (selectNonStriker.options.length > 1) selectNonStriker.selectedIndex = 1;
    }

    // Populate Bowler
    if (selectBowler) {
      selectBowler.innerHTML = "";
      (bowlingSecondXi || []).forEach(p => {
        const opt = new Option(`${p.name} (${p.role || 'Bowler'})`, p.name);
        selectBowler.add(opt);
      });
      const bowlerIdx = (bowlingSecondXi || []).findIndex(p => p.role === "Bowler");
      if (bowlerIdx >= 0) selectBowler.selectedIndex = bowlerIdx;
    }

    if (modal) modal.style.display = "flex";
  }

  function startSecondInnings(match, customStriker, customNonStriker, customBowler) {
    if (!match) match = getActiveMatch();
    if (!match || !match.innings1) return;

    const battingSecondTeam = match.innings1.bowlingTeam;
    const bowlingSecondTeam = match.innings1.battingTeam;

    const battingSecondXi = battingSecondTeam === match.teamA.name ? match.teamA.playingXi : match.teamB.playingXi;
    const bowlingSecondXi = bowlingSecondTeam === match.teamA.name ? match.teamA.playingXi : match.teamB.playingXi;

    match.currentInningIndex = 2;
    match.innings2 = createInningsStructure(battingSecondTeam, bowlingSecondTeam, battingSecondXi, bowlingSecondXi);

    // Apply custom striker & non-striker if provided
    if (customStriker && customNonStriker) {
      match.innings2.batting.forEach(b => {
        if (b.name === customStriker) {
          b.isAtCrease = true;
          b.isStriker = true;
        } else if (b.name === customNonStriker) {
          b.isAtCrease = true;
          b.isStriker = false;
        } else {
          b.isAtCrease = false;
          b.isStriker = false;
        }
      });
    }

    // Apply custom opening bowler if provided
    if (customBowler) {
      match.innings2.bowling.forEach(b => {
        b.isCurrentBowler = (b.name === customBowler);
      });
    }

    saveActiveMatchState(match);
    renderLiveScoringPage(match);
    showToast(`2nd Innings Started! ${battingSecondTeam} chasing ${match.innings1.totalRuns + 1} runs.`);
  }

  // ----------------------------------------------------
  // 3. MATCH AWARDS CALCULATION
  // ----------------------------------------------------

  function calculateMatchAwards(match) {
    if (!match) return null;
    const playerStats = {};

    function recordBatter(b, teamName) {
      if (!b || !b.name) return;
      if (!playerStats[b.name]) {
        playerStats[b.name] = { name: b.name, team: teamName, runs: 0, balls: 0, fours: 0, sixes: 0, wickets: 0, runsConceded: 0, ballsBowled: 0, maidens: 0 };
      }
      playerStats[b.name].runs += (b.runs || 0);
      playerStats[b.name].balls += (b.balls || 0);
      playerStats[b.name].fours += (b.fours || 0);
      playerStats[b.name].sixes += (b.sixes || 0);
    }

    function recordBowler(bw, teamName) {
      if (!bw || !bw.name) return;
      if (!playerStats[bw.name]) {
        playerStats[bw.name] = { name: bw.name, team: teamName, runs: 0, balls: 0, fours: 0, sixes: 0, wickets: 0, runsConceded: 0, ballsBowled: 0, maidens: 0 };
      }
      playerStats[bw.name].wickets += (bw.wickets || 0);
      playerStats[bw.name].runsConceded += (bw.runs || 0);
      playerStats[bw.name].ballsBowled += ((bw.overs || 0) * 6 + (bw.balls || 0));
      playerStats[bw.name].maidens += (bw.maidens || 0);
    }

    // Scan Innings 1
    if (match.innings1) {
      (match.innings1.batting || []).forEach(b => recordBatter(b, match.innings1.battingTeam));
      (match.innings1.bowling || []).forEach(bw => recordBowler(bw, match.innings1.bowlingTeam));
    }

    // Scan Innings 2
    if (match.innings2) {
      (match.innings2.batting || []).forEach(b => recordBatter(b, match.innings2.battingTeam));
      (match.innings2.bowling || []).forEach(bw => recordBowler(bw, match.innings2.bowlingTeam));
    }

    const playersList = Object.values(playerStats);
    if (playersList.length === 0) return null;

    // Best Batsman: Highest runs, tie-breaker boundaries
    const sortedBatters = [...playersList].sort((a, b) => {
      if (b.runs !== a.runs) return b.runs - a.runs;
      return (b.fours + b.sixes) - (a.fours + a.sixes);
    });
    const bestBatter = sortedBatters[0] || { name: "Top Batter", team: match.teamA.name, runs: 0, balls: 0 };

    // Best Bowler: Most wickets, tie-breaker lowest runs conceded
    const sortedBowlers = [...playersList].filter(p => p.ballsBowled > 0).sort((a, b) => {
      if (b.wickets !== a.wickets) return b.wickets - a.wickets;
      if (a.runsConceded !== b.runsConceded) return a.runsConceded - b.runsConceded;
      return b.maidens - a.maidens;
    });
    const bestBowler = sortedBowlers[0] || sortedBatters[0] || { name: "Top Bowler", team: match.teamB.name, wickets: 0, runsConceded: 0 };

    // Player of the Match: Impact formula
    const winningTeam = match.result && match.result.includes("won") ? (match.result.includes(match.teamA.name) ? match.teamA.name : match.teamB.name) : "";
    const scoredPlayers = playersList.map(p => {
      let impact = (p.runs * 1) + (p.sixes * 2.5) + (p.fours * 1.5) + (p.wickets * 25) + (p.maidens * 12);
      if (p.balls > 0 && (p.runs / p.balls) >= 1.5 && p.runs >= 20) impact += 10;
      if (p.ballsBowled >= 6 && (p.runsConceded / (p.ballsBowled / 6)) <= 6.0) impact += 10;
      if (winningTeam && p.team === winningTeam) impact += 12;
      return { ...p, impact };
    });

    scoredPlayers.sort((a, b) => b.impact - a.impact);
    const potm = scoredPlayers[0] || bestBatter;

    return { potm, bestBatter, bestBowler };
  }

  // ----------------------------------------------------
  // 4. FINAL MATCH PAGE & HUB
  // ----------------------------------------------------

  function showFinalMatchHub(match, resultText) {
    if (!match) match = getActiveMatch();
    if (!match) return;

    const modal = document.getElementById("finalMatchModal");
    const tourneyBadge = document.getElementById("finalTourneyBadge");
    const headerTitle = document.getElementById("finalMatchHeaderTitle");
    const bannerText = document.getElementById("finalResultBannerText");
    const venueDate = document.getElementById("finalMatchVenueDate");

    if (tourneyBadge) tourneyBadge.textContent = match.tournament || "Cric Yuva Match";
    if (headerTitle) headerTitle.innerHTML = `<i class="fa-solid fa-trophy text-orange"></i> Match Concluded`;
    if (bannerText) bannerText.textContent = resultText || match.result || "Match Completed";
    if (venueDate) venueDate.textContent = `${match.ground} • ${match.overs} Overs Match`;

    if (window.NotificationService && window.NotificationService.addNotification) {
      window.NotificationService.addNotification({
        title: "Match Completed!",
        message: `${match.teamA.name} vs ${match.teamB.name}: ${resultText || match.result || "Match concluded"}`,
        type: "match"
      });
    }

    // 1st & 2nd Innings Summaries
    const inn1Row = document.getElementById("finalInn1Summary");
    const inn2Row = document.getElementById("finalInn2Summary");

    if (inn1Row && match.innings1) {
      inn1Row.innerHTML = `
        <span class="final-inn-team">${match.innings1.battingTeam}</span>
        <span class="final-inn-score">${match.innings1.totalRuns}/${match.innings1.wickets} <span style="font-size:10px;color:#94a3b8;">(${match.innings1.overs}.${match.innings1.balls} Ov)</span></span>
      `;
    }
    if (inn2Row && match.innings2) {
      inn2Row.innerHTML = `
        <span class="final-inn-team">${match.innings2.battingTeam}</span>
        <span class="final-inn-score">${match.innings2.totalRuns}/${match.innings2.wickets} <span style="font-size:10px;color:#94a3b8;">(${match.innings2.overs}.${match.innings2.balls} Ov)</span></span>
      `;
    }

    // Compute Awards
    const awards = calculateMatchAwards(match);
    if (awards) {
      const potmName = document.getElementById("potmWinnerName");
      const potmTeam = document.getElementById("potmWinnerTeam");
      const potmStat = document.getElementById("potmWinnerStat");

      if (potmName) potmName.textContent = awards.potm.name;
      if (potmTeam) potmTeam.textContent = awards.potm.team;
      if (potmStat) {
        const potmStatsList = [];
        if (awards.potm.runs > 0) potmStatsList.push(`${awards.potm.runs} runs (${awards.potm.balls}b)`);
        if (awards.potm.wickets > 0) potmStatsList.push(`${awards.potm.wickets} wkts`);
        potmStat.textContent = potmStatsList.join(" & ") || "Top Impact Match Performer";
      }

      const bestBatName = document.getElementById("bestBatterName");
      const bestBatTeam = document.getElementById("bestBatterTeam");
      const bestBatStat = document.getElementById("bestBatterStat");
      if (bestBatName) bestBatName.textContent = awards.bestBatter.name;
      if (bestBatTeam) bestBatTeam.textContent = awards.bestBatter.team;
      if (bestBatStat) bestBatStat.textContent = `${awards.bestBatter.runs} runs (${awards.bestBatter.balls}b, ${awards.bestBatter.fours}x4, ${awards.bestBatter.sixes}x6)`;

      const bestBowlName = document.getElementById("bestBowlerName");
      const bestBowlTeam = document.getElementById("bestBowlerTeam");
      const bestBowlStat = document.getElementById("bestBowlerStat");
      if (bestBowlName) bestBowlName.textContent = awards.bestBowler.name;
      if (bestBowlTeam) bestBowlTeam.textContent = awards.bestBowler.team;
      if (bestBowlStat) {
        const oversFloat = (awards.bestBowler.ballsBowled / 6).toFixed(1);
        bestBowlStat.textContent = `${awards.bestBowler.wickets}/${awards.bestBowler.runsConceded} (${oversFloat} ov)`;
      }
    }

    // Automatically save completed match to Match History in localStorage
    try {
      saveMatchToHistoryStorage(match);
      if (typeof syncMatchToTournament === "function") {
        syncMatchToTournament(match);
      }
    } catch (e) {
      console.error("Auto-save to history failed:", e);
    }

    // Configure Tournament Navigation Section if linked to a tournament
    const tourneySection = document.getElementById("finalTourneyNavSection");
    const tourneyNameEl = document.getElementById("finalTourneyNavName");
    const linkedTourneyId = match.tourneyId || window.activeLinkedTourneyId || (match.tournament ? (getTournamentsList().find(t => t.name.toLowerCase() === match.tournament.toLowerCase())?.id) : null);

    if (tourneySection) {
      if (linkedTourneyId) {
        tourneySection.style.display = "block";
        const tObj = typeof getTournamentById === "function" ? getTournamentById(linkedTourneyId) : null;
        if (tourneyNameEl) tourneyNameEl.textContent = tObj ? tObj.name : (match.tournament || "Tournament");
      } else {
        tourneySection.style.display = "none";
      }
    }

    if (modal) modal.style.display = "flex";
  }

  // ----------------------------------------------------
  // 5. SUPER OVER SETUP & ENGINE
  // ----------------------------------------------------

  function openSuperOverModal(match) {
    if (!match) match = getActiveMatch();
    const modal = document.getElementById("superOverModal");
    const select = document.getElementById("selectSuperOverBattingFirst");
    if (select && match) {
      select.innerHTML = "";
      select.add(new Option(match.teamA.name, match.teamA.name));
      select.add(new Option(match.teamB.name, match.teamB.name));
    }
    if (modal) modal.style.display = "flex";
  }

  function launchSuperOver(match, battingFirstTeam) {
    if (!match) match = getActiveMatch();
    if (!match) return;

    const team1Name = battingFirstTeam || match.teamA.name;
    const team2Name = team1Name === match.teamA.name ? match.teamB.name : match.teamA.name;

    const xi1 = team1Name === match.teamA.name ? match.teamA.playingXi : match.teamB.playingXi;
    const xi2 = team2Name === match.teamA.name ? match.teamA.playingXi : match.teamB.playingXi;

    // Backup regular match innings
    match.regularInnings1 = match.innings1;
    match.regularInnings2 = match.innings2;

    match.isSuperOver = true;
    match.overs = 1; // 1 Over Super Over
    match.currentInningIndex = 1;
    match.innings1 = createInningsStructure(team1Name, team2Name, xi1, xi2);
    match.innings2 = null;
    match.status = "LIVE";
    match.result = "Super Over in Progress";

    saveActiveMatchState(match);
    renderLiveScoringPage(match);
    showToast(`⚡ Super Over Initialized! 1 Over • Max 2 Wickets.`);
  }


  // ----------------------------------------------------
  // 7. EVENT LISTENERS FOR MATCH FLOW MODALS & BUTTONS
  // ----------------------------------------------------

  // Innings Break Modal Controls
  const inningsBreakCloseBtn = document.getElementById("inningsBreakCloseBtn");
  if (inningsBreakCloseBtn) {
    inningsBreakCloseBtn.addEventListener("click", () => {
      document.getElementById("inningsBreakModal").style.display = "none";
    });
  }

  const btnStartSecondInningsAction = document.getElementById("btnStartSecondInningsAction");
  if (btnStartSecondInningsAction) {
    btnStartSecondInningsAction.addEventListener("click", () => {
      document.getElementById("inningsBreakModal").style.display = "none";
      const match = getActiveMatch();
      if (match && match.isSuperOver && match.currentInningIndex === 1) {
        startSecondInnings(match);
      } else {
        open2ndInningsOpenersModal(match);
      }
    });
  }

  const btnView1stInningsScorecard = document.getElementById("btnView1stInningsScorecard");
  if (btnView1stInningsScorecard) {
    btnView1stInningsScorecard.addEventListener("click", () => {
      document.getElementById("inningsBreakModal").style.display = "none";
      const tabScorecard = document.getElementById("tabLiveScorecard");
      if (tabScorecard) tabScorecard.click();
    });
  }

  // 2nd Innings Openers Form Submit
  const secondOpenersForm = document.getElementById("secondOpenersForm");
  if (secondOpenersForm) {
    secondOpenersForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const striker = document.getElementById("select2ndStriker")?.value;
      const nonStriker = document.getElementById("select2ndNonStriker")?.value;
      const bowler = document.getElementById("select2ndBowler")?.value;

      if (striker && nonStriker && striker === nonStriker) {
        alert("Striker and Non-Striker cannot be the same player!");
        return;
      }

      document.getElementById("secondInningsOpenersModal").style.display = "none";
      startSecondInnings(getActiveMatch(), striker, nonStriker, bowler);
    });
  }

  const secondOpenersCloseBtn = document.getElementById("secondOpenersCloseBtn");
  if (secondOpenersCloseBtn) {
    secondOpenersCloseBtn.addEventListener("click", () => {
      document.getElementById("secondInningsOpenersModal").style.display = "none";
    });
  }

  // Super Over Controls
  const superOverCloseBtn = document.getElementById("superOverCloseBtn");
  if (superOverCloseBtn) {
    superOverCloseBtn.addEventListener("click", () => {
      document.getElementById("superOverModal").style.display = "none";
    });
  }

  const btnLaunchSuperOver = document.getElementById("btnLaunchSuperOver");
  if (btnLaunchSuperOver) {
    btnLaunchSuperOver.addEventListener("click", () => {
      const battingFirst = document.getElementById("selectSuperOverBattingFirst")?.value;
      document.getElementById("superOverModal").style.display = "none";
      launchSuperOver(getActiveMatch(), battingFirst);
    });
  }

  const btnKeepMatchTied = document.getElementById("btnKeepMatchTied");
  if (btnKeepMatchTied) {
    btnKeepMatchTied.addEventListener("click", () => {
      const match = getActiveMatch();
      if (!match) return;

      match.status = "TIED";
      match.result = "Match Tied";
      document.getElementById("superOverModal").style.display = "none";

      saveActiveMatchState(match);
      saveMatchToHistoryStorage(match);
      if (typeof syncMatchToTournament === "function") syncMatchToTournament(match);

      renderLiveScoringPage(match);
      showFinalMatchHub(match, "Match Tied");
    });
  }

  // Final Match Hub Controls
  const finalMatchCloseBtn = document.getElementById("finalMatchCloseBtn");
  if (finalMatchCloseBtn) {
    finalMatchCloseBtn.addEventListener("click", () => {
      document.getElementById("finalMatchModal").style.display = "none";
    });
  }

  const btnFinalViewScorecard = document.getElementById("btnFinalViewScorecard");
  if (btnFinalViewScorecard) {
    btnFinalViewScorecard.addEventListener("click", () => {
      document.getElementById("finalMatchModal").style.display = "none";
      const tabScorecard = document.getElementById("tabLiveScorecard");
      if (tabScorecard) tabScorecard.click();
    });
  }

  const btnFinalViewCommentary = document.getElementById("btnFinalViewCommentary");
  if (btnFinalViewCommentary) {
    btnFinalViewCommentary.addEventListener("click", () => {
      document.getElementById("finalMatchModal").style.display = "none";
      const tabCommentary = document.getElementById("tabLiveCommentary");
      if (tabCommentary) tabCommentary.click();
    });
  }

  const btnFinalShareMatch = document.getElementById("btnFinalShareMatch");
  if (btnFinalShareMatch) {
    btnFinalShareMatch.addEventListener("click", () => {
      const match = getActiveMatch();
      if (!match) return;
      const inn1 = match.innings1 ? `${match.innings1.battingTeam}: ${match.innings1.totalRuns}/${match.innings1.wickets} (${match.innings1.overs}.${match.innings1.balls} ov)` : "";
      const inn2 = match.innings2 ? `${match.innings2.battingTeam}: ${match.innings2.totalRuns}/${match.innings2.wickets} (${match.innings2.overs}.${match.innings2.balls} ov)` : "";
      const shareText = `🏏 CRIC YUVA MATCH RESULT 🏏\n${match.title} (${match.tournament})\n${match.teamA.name} vs ${match.teamB.name}\n\n📊 SCORES:\n${inn1}\n${inn2}\n\n🏆 RESULT: ${match.result}\n📍 Venue: ${match.ground}\n\nScored live on Cric Yuva App!`;

      if (navigator.share) {
        navigator.share({
          title: match.title,
          text: shareText
        }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(shareText).then(() => {
          showToast("Match summary copied to clipboard!");
        });
      } else {
        showToast("Match Result: " + match.result);
      }
    });
  }

  const btnFinalSaveHistory = document.getElementById("btnFinalSaveHistory");
  if (btnFinalSaveHistory) {
    btnFinalSaveHistory.addEventListener("click", () => {
      const match = getActiveMatch();
      if (!match) return;

      try {
        let history = [];
        const savedHist = getUserStorage("cricYuvaMatchHistory", "[]");
        if (savedHist) history = JSON.parse(savedHist);
        
        // Check if already in history
        const existingIdx = history.findIndex(m => m.matchId === match.matchId);
        if (existingIdx >= 0) {
          history[existingIdx] = match;
        } else {
          history.unshift(match);
        }

        setUserStorage("cricYuvaMatchHistory", JSON.stringify(history));
        showToast("Match successfully saved to History!");
      } catch (err) {
        console.error("Error saving match to history:", err);
        showToast("Saved to history!");
      }
    });
  }

  const btnFinalHome = document.getElementById("btnFinalHome");
  if (btnFinalHome) {
    btnFinalHome.addEventListener("click", () => {
      document.getElementById("finalMatchModal").style.display = "none";
      showScreen("screen5");
    });
  }

  // Tournament Deep-Navigation Event Listeners in Match Finish Modal
  const btnFinalBackToTourney = document.getElementById("btnFinalBackToTourney");
  if (btnFinalBackToTourney) {
    btnFinalBackToTourney.addEventListener("click", () => {
      document.getElementById("finalMatchModal").style.display = "none";
      const match = getActiveMatch();
      const tId = match?.tourneyId || window.activeLinkedTourneyId || activeTournamentId;
      if (tId) {
        openTournamentDetails(tId, "overview");
      } else {
        openTournamentScreen();
      }
    });
  }

  const btnFinalTourneyPoints = document.getElementById("btnFinalTourneyPoints");
  if (btnFinalTourneyPoints) {
    btnFinalTourneyPoints.addEventListener("click", () => {
      document.getElementById("finalMatchModal").style.display = "none";
      const match = getActiveMatch();
      const tId = match?.tourneyId || window.activeLinkedTourneyId || activeTournamentId;
      if (tId) {
        openTournamentDetails(tId, "points");
      } else {
        openTournamentScreen();
      }
    });
  }

  const btnFinalTourneyFixtures = document.getElementById("btnFinalTourneyFixtures");
  if (btnFinalTourneyFixtures) {
    btnFinalTourneyFixtures.addEventListener("click", () => {
      document.getElementById("finalMatchModal").style.display = "none";
      const match = getActiveMatch();
      const tId = match?.tourneyId || window.activeLinkedTourneyId || activeTournamentId;
      if (tId) {
        openTournamentDetails(tId, "fixtures");
      } else {
        openTournamentScreen();
      }
    });
  }

  const btnFinalTourneyStats = document.getElementById("btnFinalTourneyStats");
  if (btnFinalTourneyStats) {
    btnFinalTourneyStats.addEventListener("click", () => {
      document.getElementById("finalMatchModal").style.display = "none";
      const match = getActiveMatch();
      const tId = match?.tourneyId || window.activeLinkedTourneyId || activeTournamentId;
      if (tId) {
        openTournamentDetails(tId, "stats");
      } else {
        openTournamentScreen();
      }
    });
  }

  // ==========================================
  // BALL DIRECTION MODAL & GROUND INTERACTION
  // ==========================================

  let selectedDirection = "Cover";

  function openBallDirectionModal(runs) {
    pendingBoundary = { runs: runs, direction: selectedDirection };
    const modal = document.getElementById("ballDirectionModal");
    const badge = document.getElementById("directionBoundaryBadge");
    const title = document.getElementById("directionModalTitle");
    const btnText = document.getElementById("btnConfirmDirectionText");

    if (badge) {
      badge.textContent = runs === 4 ? "FOUR 4" : "SIX 6";
      badge.className = `shot-boundary-pill ${runs === 6 ? 'six' : ''}`;
    }
    if (title) title.textContent = `Select Shot Direction (${runs === 4 ? 'FOUR' : 'SIX'})`;
    if (btnText) btnText.textContent = `CONFIRM ${runs === 4 ? 'FOUR' : 'SIX'} THROUGH ${selectedDirection.toUpperCase()}`;

    // Select default sector on field
    highlightDirectionOnGround(selectedDirection);

    if (modal) modal.style.display = "flex";
  }

  function highlightDirectionOnGround(direction) {
    selectedDirection = direction;
    const label = document.getElementById("selectedDirectionLabel");
    const btnText = document.getElementById("btnConfirmDirectionText");
    if (label) label.textContent = direction;
    if (btnText && pendingBoundary) {
      btnText.textContent = `CONFIRM ${pendingBoundary.runs === 4 ? 'FOUR' : 'SIX'} THROUGH ${direction.toUpperCase()}`;
    }

    // Highlight sector buttons on circular ground
    document.querySelectorAll(".ground-sector-zone").forEach(sec => {
      sec.classList.toggle("active", sec.dataset.direction === direction);
    });

    // Highlight chips
    document.querySelectorAll(".dir-chip").forEach(chip => {
      chip.classList.toggle("active", chip.dataset.direction === direction);
    });
  }

  // Bind Ground Sector Clicks
  document.querySelectorAll(".ground-sector-zone").forEach(sec => {
    sec.addEventListener("click", function () {
      highlightDirectionOnGround(this.dataset.direction);
    });
  });

  // Bind Quick Chips Clicks
  document.querySelectorAll(".dir-chip").forEach(chip => {
    chip.addEventListener("click", function () {
      highlightDirectionOnGround(this.dataset.direction);
    });
  });

  const btnConfirmDirection = document.getElementById("btnConfirmDirection");
  if (btnConfirmDirection) {
    btnConfirmDirection.addEventListener("click", function () {
      const modal = document.getElementById("ballDirectionModal");
      if (modal) modal.style.display = "none";

      if (pendingBoundary) {
        handleRunDelivery(pendingBoundary.runs, selectedDirection);
        pendingBoundary = null;
      }
    });
  }

  const directionModalCloseBtn = document.getElementById("directionModalCloseBtn");
  if (directionModalCloseBtn) {
    directionModalCloseBtn.addEventListener("click", function () {
      const modal = document.getElementById("ballDirectionModal");
      if (modal) modal.style.display = "none";
      if (pendingBoundary) {
        handleRunDelivery(pendingBoundary.runs, selectedDirection);
        pendingBoundary = null;
      }
    });
  }

  // ==========================================
  // SCORING BUTTONS BINDINGS (0-6, OUT, EXTRAS)
  // ==========================================

  // Runs 0, 1, 2, 3, 5
  [0, 1, 2, 3, 5].forEach(r => {
    const btn = document.getElementById(`btnScore${r}`);
    if (btn) {
      btn.addEventListener("click", function () {
        handleRunDelivery(r, "");
      });
    }
  });

  // Boundaries 4 & 6 -> Open Ball Direction Modal
  const btnScore4 = document.getElementById("btnScore4");
  if (btnScore4) {
    btnScore4.addEventListener("click", function () {
      openBallDirectionModal(4);
    });
  }

  const btnScore6 = document.getElementById("btnScore6");
  if (btnScore6) {
    btnScore6.addEventListener("click", function () {
      openBallDirectionModal(6);
    });
  }

  // OUT / WKT Button
  const btnScoreOut = document.getElementById("btnScoreOut");
  if (btnScoreOut) {
    btnScoreOut.addEventListener("click", function () {
      openWicketModal();
    });
  }

  // WIDE, NO BALL, BYE, LEG BYE, PENALTY Buttons
  const btnScoreWide = document.getElementById("btnScoreWide");
  if (btnScoreWide) btnScoreWide.addEventListener("click", () => openExtrasModal("WIDE"));

  const btnScoreNoBall = document.getElementById("btnScoreNoBall");
  if (btnScoreNoBall) btnScoreNoBall.addEventListener("click", () => openExtrasModal("NO BALL"));

  const btnScoreBye = document.getElementById("btnScoreBye");
  if (btnScoreBye) btnScoreBye.addEventListener("click", () => openExtrasModal("BYE"));

  const btnScoreLegBye = document.getElementById("btnScoreLegBye");
  if (btnScoreLegBye) btnScoreLegBye.addEventListener("click", () => openExtrasModal("LEG BYE"));

  const btnScorePenalty = document.getElementById("btnScorePenalty");
  if (btnScorePenalty) btnScorePenalty.addEventListener("click", () => openExtrasModal("PENALTY"));

  // ==========================================
  // WICKET MODAL & SUBMIT
  // ==========================================

  function openWicketModal() {
    const match = getActiveMatch();
    if (!match || match.status === "COMPLETED" || match.status === "TIED" || match.status === "ABANDONED") return;
    const innings = getCurrentInnings(match);
    if (!innings) return;

    const modal = document.getElementById("wicketModal");
    const striker = innings.batting.find(b => b.isAtCrease && b.isStriker);
    const nonStriker = innings.batting.find(b => b.isAtCrease && !b.isStriker);

    const labelOutStriker = document.getElementById("labelOutStriker");
    const labelOutNonStriker = document.getElementById("labelOutNonStriker");
    if (labelOutStriker) labelOutStriker.textContent = striker ? `${striker.name} (Striker)` : "Striker";
    if (labelOutNonStriker) labelOutNonStriker.textContent = nonStriker ? `${nonStriker.name} (Non-Striker)` : "Non-Striker";

    // Setup Fielder Selection (Populated ONLY with Fielding Team Playing XI)
    const groupFielder = document.getElementById("groupFielderInvolved");
    const labelFielder = document.getElementById("labelFielderInvolved");
    const selectFielder = document.getElementById("selectFielderName");
    const selectWicketType = document.getElementById("selectWicketType");
    const bowler = innings.bowling.find(b => b.isCurrentBowler) || innings.bowling[0];

    // Determine Fielding Team Playing XI
    const fieldingTeamName = innings.bowlingTeam;
    let fieldingXi = [];
    if (match.teamA && (match.teamA.name === fieldingTeamName || match.innings1?.bowlingTeam === match.teamA.name) && match.teamA.playingXi?.length > 0) {
      fieldingXi = match.teamA.playingXi;
    } else if (match.teamB && (match.teamB.name === fieldingTeamName || match.innings2?.bowlingTeam === match.teamB.name) && match.teamB.playingXi?.length > 0) {
      fieldingXi = match.teamB.playingXi;
    } else {
      // Fallback from bowling array
      fieldingXi = (innings.bowling || []).map(b => ({ name: b.name, role: b.role || "Player" }));
    }

    function updateFielderDropdown(wType) {
      if (!selectFielder || !groupFielder) return;
      selectFielder.innerHTML = "";

      if (wType === "Caught") {
        groupFielder.style.display = "block";
        if (labelFielder) labelFielder.innerHTML = `Select Catcher (${fieldingTeamName}) <span class="req">*</span>`;
        
        // Option 1: Caught & Bowled
        const optCb = document.createElement("option");
        optCb.value = `${bowler?.name || 'Bowler'} (c & b)`;
        optCb.textContent = `${bowler?.name || 'Bowler'} (Caught & Bowled)`;
        selectFielder.appendChild(optCb);

        // Options: Fielding Team XI
        fieldingXi.forEach(p => {
          if (p.name !== bowler?.name) {
            const opt = document.createElement("option");
            opt.value = p.name;
            opt.textContent = `${p.name} ${p.role ? `(${p.role})` : ''}`;
            selectFielder.appendChild(opt);
          }
        });
      } else if (wType === "Run Out") {
        groupFielder.style.display = "block";
        if (labelFielder) labelFielder.innerHTML = `Select Fielder (Run Out By - ${fieldingTeamName}) <span class="req">*</span>`;
        
        const optDh = document.createElement("option");
        optDh.value = "Direct Hit";
        optDh.textContent = "Direct Hit (No specific fielder)";
        selectFielder.appendChild(optDh);

        fieldingXi.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.name;
          opt.textContent = `${p.name} ${p.role ? `(${p.role})` : ''}`;
          selectFielder.appendChild(opt);
        });
      } else if (wType === "Stumped") {
        groupFielder.style.display = "block";
        if (labelFielder) labelFielder.innerHTML = `Select Wicketkeeper (${fieldingTeamName}) <span class="req">*</span>`;
        
        fieldingXi.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.name;
          opt.textContent = `${p.name} ${p.role ? `(${p.role})` : ''}`;
          if (p.role && p.role.toLowerCase().includes("keeper")) opt.selected = true;
          selectFielder.appendChild(opt);
        });
      } else {
        // Bowled, LBW, Hit Wicket, Retired Hurt, etc. -> No fielder input needed
        groupFielder.style.display = "none";
      }
    }

    if (selectWicketType) {
      updateFielderDropdown(selectWicketType.value);
      selectWicketType.onchange = () => updateFielderDropdown(selectWicketType.value);
    }

    // Populate Next Batter Dropdown (Scorer MUST manually select; default is placeholder)
    const selectNext = document.getElementById("selectNextBatter");
    const groupNext = document.getElementById("groupNextBatter");
    if (selectNext) {
      selectNext.innerHTML = "";
      const unbatted = (innings.batting || []).filter(b => !b.isAtCrease && !b.isOut);
      const maxWickets = match.isSuperOver ? 2 : 10;
      const willBeAllOut = (innings.wickets + 1) >= maxWickets;

      if (unbatted.length === 0 || willBeAllOut) {
        if (groupNext) groupNext.style.display = "none";
        selectNext.required = false;
      } else {
        if (groupNext) groupNext.style.display = "block";
        selectNext.required = true;

        const placeholderOpt = document.createElement("option");
        placeholderOpt.value = "";
        placeholderOpt.textContent = "— Select Next Batter —";
        placeholderOpt.disabled = true;
        placeholderOpt.selected = true;
        selectNext.appendChild(placeholderOpt);

        unbatted.forEach(b => {
          const opt = document.createElement("option");
          opt.value = b.name;
          opt.textContent = `${b.name} (${b.role || 'Batter'})`;
          selectNext.appendChild(opt);
        });
      }
    }

    if (modal) modal.style.display = "flex";
  }

  const wicketForm = document.getElementById("wicketForm");
  if (wicketForm) {
    wicketForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const match = getActiveMatch();
      if (!match || match.status === "COMPLETED" || match.status === "TIED" || match.status === "ABANDONED") {
        const modal = document.getElementById("wicketModal");
        if (modal) modal.style.display = "none";
        return;
      }
      const innings = getCurrentInnings(match);
      if (!innings) return;

      const wicketType = document.getElementById("selectWicketType")?.value || "Bowled";
      const outTarget = document.querySelector('input[name="outBatterRadio"]:checked')?.value || "striker";
      const selectFielder = document.getElementById("selectFielderName");
      const fielderName = selectFielder?.value?.trim() || "";
      const nextBatterName = document.getElementById("selectNextBatter")?.value?.trim() || "";

      const striker = innings.batting.find(b => b.isAtCrease && b.isStriker);
      const nonStriker = innings.batting.find(b => b.isAtCrease && !b.isStriker);
      const dismissedBatter = outTarget === "striker" ? striker : nonStriker;
      const bowler = innings.bowling.find(b => b.isCurrentBowler) || innings.bowling[0];

      if (!dismissedBatter) {
        alert("Dismissed batter could not be identified.");
        return;
      }

      if (!bowler) {
        alert("Active bowler not found.");
        return;
      }

      const maxWkts = match.isSuperOver ? 2 : 10;
      const willBeAllOut = (innings.wickets + 1) >= maxWkts;
      const unbatted = (innings.batting || []).filter(b => !b.isAtCrease && !b.isOut && b.name !== dismissedBatter.name);

      // Validation: Scorer MUST manually choose next batter if unbatted players remain
      if (!willBeAllOut && unbatted.length > 0) {
        if (!nextBatterName || nextBatterName === "") {
          alert("Please select the next incoming batter before confirming the wicket.");
          return;
        }
      }

      if (wicketType === "Caught" && (!fielderName || fielderName === "")) {
        alert("Please select the catcher.");
        return;
      }

      if (wicketType === "Stumped" && (!fielderName || fielderName === "")) {
        alert("Please select the wicketkeeper.");
        return;
      }

      // Validations passed: Save snapshot for undo
      saveMatchHistorySnapshot(match);

      // 1. Mark Dismissal
      dismissedBatter.isOut = true;
      dismissedBatter.isAtCrease = false;
      dismissedBatter.balls += 1;

      let dismissalStr = "";
      if (wicketType === "Bowled") {
        dismissalStr = `b ${bowler.name}`;
      } else if (wicketType === "Caught") {
        if (fielderName.includes("(c & b)") || fielderName === bowler.name) {
          dismissalStr = `c & b ${bowler.name}`;
        } else {
          dismissalStr = fielderName ? `c ${fielderName} b ${bowler.name}` : `c & b ${bowler.name}`;
        }
      } else if (wicketType === "LBW") {
        dismissalStr = `lbw b ${bowler.name}`;
      } else if (wicketType === "Hit Wicket") {
        dismissalStr = `hit wicket b ${bowler.name}`;
      } else if (wicketType === "Run Out") {
        dismissalStr = (fielderName && fielderName !== "Direct Hit") ? `run out (${fielderName})` : `run out`;
      } else if (wicketType === "Stumped") {
        dismissalStr = fielderName ? `st ${fielderName} b ${bowler.name}` : `st b ${bowler.name}`;
      } else if (wicketType === "Retired Hurt") {
        dismissalStr = `retired hurt`;
      } else {
        dismissalStr = wicketType;
      }

      dismissedBatter.dismissal = dismissalStr;

      // 2. Update Wickets & Bowler Stats
      innings.wickets += 1;
      innings.balls += 1;
      bowler.balls += 1;
      if (["Bowled", "Caught", "LBW", "Stumped", "Hit Wicket"].includes(wicketType)) {
        bowler.wickets += 1;
      }

      // Record Fall of Wickets
      if (!innings.fallOfWickets) innings.fallOfWickets = [];
      innings.fallOfWickets.push({
        wicketNum: innings.wickets,
        score: innings.totalRuns,
        over: `${innings.overs}.${innings.balls}`,
        batter: dismissedBatter.name
      });

      // 3. Bring Next Batter to Crease (if available and not all out)
      if (!willBeAllOut && nextBatterName) {
        const nextBatter = innings.batting.find(b => b.name === nextBatterName);
        if (nextBatter) {
          nextBatter.isAtCrease = true;
          nextBatter.isStriker = (outTarget === "striker");
        }
      }

      // 4. Over Bubble & Commentary
      innings.currentOverDeliveries.push({
        label: "W",
        typeClass: "wicket",
        runs: 0,
        ballNumber: innings.balls
      });

      innings.commentary.push({
        over: `${innings.overs}.${innings.balls}`,
        event: "WICKET",
        badge: "W",
        text: `🔴 OUT! ${dismissedBatter.name} ${dismissalStr}. Score: ${innings.totalRuns}/${innings.wickets}`
      });

      // 5. Over Completion Check
      if (innings.balls >= 6) {
        completeOver(innings, bowler, match);
      }

      // 6. Check Innings Finished
      checkInningsCompletionStatus(match, innings);

      // Close modal & update UI
      document.getElementById("wicketModal").style.display = "none";
      saveActiveMatchState(match);
      if (window.PublicLiveScoreService) window.PublicLiveScoreService.emitLiveUpdate(match);
      renderLiveScoringPage(match);
    });
  }

  const wicketModalCloseBtn = document.getElementById("wicketModalCloseBtn");
  if (wicketModalCloseBtn) {
    wicketModalCloseBtn.addEventListener("click", () => {
      document.getElementById("wicketModal").style.display = "none";
    });
  }

  // ==========================================
  // EXTRAS MODAL & HANDLERS
  // ==========================================

  let currentExtraType = "WIDE";
  let selectedExtraValue = 0; // Additional runs / extra option

  function openExtrasModal(type) {
    currentExtraType = type;
    const modal = document.getElementById("extrasModal");
    const title = document.getElementById("extrasModalTitle");
    const hint = document.getElementById("extrasRuleHint");
    const inputRuns = document.getElementById("inputCustomExtraRuns");
    const grid = document.getElementById("extrasOptionsGrid");

    if (title) title.textContent = `Record ${type}`;

    if (hint) {
      if (type === "WIDE") {
        hint.textContent = `Wide extra is 1 run + additional runs scored. Wide does NOT count as a legal ball.`;
      } else if (type === "NO BALL") {
        hint.textContent = `No Ball penalty is 1 run + runs off bat. No Ball does NOT count as a legal ball.`;
      } else if (type === "BYE" || type === "LEG BYE") {
        hint.textContent = `${type} counts as a legal ball (+1 ball to over). Extra runs added to team total.`;
      } else {
        hint.textContent = `Penalty runs added directly to team total without bowling a legal ball.`;
      }
    }

    if (grid) {
      grid.innerHTML = "";
      let runOptions = [];

      if (type === "WIDE") {
        // Automatic Wide = 1 run. Options: Wide +0 (1 total), Wide +1 (2 total), Wide +2 (3 total), Wide +3 (4 total), Wide +4 (5 total)
        runOptions = [
          { val: 0, title: "WIDE +0", sub: "1 Total Run" },
          { val: 1, title: "WIDE +1", sub: "2 Total Runs" },
          { val: 2, title: "WIDE +2", sub: "3 Total Runs" },
          { val: 3, title: "WIDE +3", sub: "4 Total Runs" },
          { val: 4, title: "WIDE +4", sub: "5 Total Runs" }
        ];
        selectedExtraValue = 0;
        if (inputRuns) inputRuns.value = 0;
      } else if (type === "NO BALL") {
        // Automatic No Ball = 1 run. Options: NB +0 (1 total), NB +1 (2 total), NB +2 (3 total), NB +3 (4 total), NB +4 (5 total), NB +6 (7 total)
        runOptions = [
          { val: 0, title: "NO BALL +0", sub: "1 Total Run" },
          { val: 1, title: "NO BALL +1", sub: "2 Total Runs" },
          { val: 2, title: "NO BALL +2", sub: "3 Total Runs" },
          { val: 3, title: "NO BALL +3", sub: "4 Total Runs" },
          { val: 4, title: "NO BALL +4", sub: "5 Total Runs" },
          { val: 6, title: "NO BALL +6", sub: "7 Total Runs" }
        ];
        selectedExtraValue = 0;
        if (inputRuns) inputRuns.value = 0;
      } else if (type === "BYE" || type === "LEG BYE") {
        runOptions = [
          { val: 1, title: "+1", sub: "1 Run" },
          { val: 2, title: "+2", sub: "2 Runs" },
          { val: 3, title: "+3", sub: "3 Runs" },
          { val: 4, title: "+4", sub: "4 Runs" }
        ];
        selectedExtraValue = 1;
        if (inputRuns) inputRuns.value = 1;
      } else if (type === "PENALTY") {
        runOptions = [
          { val: 5, title: "+5", sub: "5 Penalty Runs" },
          { val: 10, title: "+10", sub: "10 Penalty Runs" }
        ];
        selectedExtraValue = 5;
        if (inputRuns) inputRuns.value = 5;
      }

      runOptions.forEach((opt, idx) => {
        const card = document.createElement("div");
        card.className = `extra-option-card ${idx === 0 ? 'active' : ''}`;
        card.innerHTML = `<span class="extra-opt-title">${opt.title}</span><span class="extra-opt-sub">${opt.sub}</span>`;
        card.addEventListener("click", () => {
          document.querySelectorAll(".extra-option-card").forEach(c => c.classList.remove("active"));
          card.classList.add("active");
          selectedExtraValue = opt.val;
          if (inputRuns) inputRuns.value = opt.val;
        });
        grid.appendChild(card);
      });
    }

    if (modal) modal.style.display = "flex";
  }

  const btnConfirmExtras = document.getElementById("btnConfirmExtras");
  if (btnConfirmExtras) {
    btnConfirmExtras.addEventListener("click", function () {
      const match = getActiveMatch();
      if (!match || match.status === "COMPLETED" || match.status === "TIED" || match.status === "ABANDONED") {
        const modal = document.getElementById("extrasModal");
        if (modal) modal.style.display = "none";
        return;
      }
      const innings = getCurrentInnings(match);
      if (!innings) return;

      saveMatchHistorySnapshot(match);

      const bowler = innings.bowling.find(b => b.isCurrentBowler) || innings.bowling[0];
      const striker = innings.batting.find(b => b.isAtCrease && b.isStriker);

      if (!innings.extras) innings.extras = { wide: 0, noBall: 0, bye: 0, legBye: 0, penalty: 0, total: 0 };

      if (currentExtraType === "WIDE") {
        // Automatic 1 wide extra + additional runs
        const additionalRuns = selectedExtraValue;
        const totalWideRuns = 1 + additionalRuns;

        innings.totalRuns += totalWideRuns;
        bowler.runs += totalWideRuns;
        innings.extras.wide += totalWideRuns;
        innings.extras.total += totalWideRuns;

        // Wide does NOT count as a legal ball: innings.balls and bowler.balls are NOT incremented

        const bubbleLabel = additionalRuns === 0 ? "Wd" : `${totalWideRuns}Wd`;
        innings.currentOverDeliveries.push({
          label: bubbleLabel,
          typeClass: "extra",
          runs: totalWideRuns
        });

        innings.commentary.push({
          over: `${innings.overs}.${innings.balls}`,
          event: "WIDE",
          badge: "Wd",
          text: `Wide ball bowled by ${bowler.name}. ${totalWideRuns} run${totalWideRuns > 1 ? 's' : ''} added (1 wide extra + ${additionalRuns} run${additionalRuns !== 1 ? 's' : ''}).`
        });

        // Rotate strike if odd additional runs were physically run by batsmen
        if (additionalRuns % 2 !== 0) {
          rotateStrike(innings);
        }
      } else if (currentExtraType === "NO BALL") {
        // Automatic 1 no-ball extra + runs off bat
        const batRuns = selectedExtraValue;
        const totalNoBallRuns = 1 + batRuns;

        innings.totalRuns += totalNoBallRuns;
        bowler.runs += totalNoBallRuns;
        innings.extras.noBall += 1;
        innings.extras.total += 1;

        if (batRuns > 0 && striker) {
          striker.runs += batRuns;
          striker.balls += 1;
          if (batRuns === 4) striker.fours = (striker.fours || 0) + 1;
          if (batRuns === 6) striker.sixes = (striker.sixes || 0) + 1;
        }

        // No Ball does NOT count as a legal ball: innings.balls and bowler.balls are NOT incremented

        const bubbleLabel = batRuns === 0 ? "Nb" : `${totalNoBallRuns}Nb`;
        innings.currentOverDeliveries.push({
          label: bubbleLabel,
          typeClass: "extra",
          runs: totalNoBallRuns
        });

        innings.commentary.push({
          over: `${innings.overs}.${innings.balls}`,
          event: "NO BALL",
          badge: "Nb",
          text: `No ball bowled by ${bowler.name}! Free hit awarded. ${totalNoBallRuns} run${totalNoBallRuns > 1 ? 's' : ''} added (1 nb extra + ${batRuns} off bat).`
        });

        // Rotate strike if odd runs scored off bat
        if (batRuns % 2 !== 0) {
          rotateStrike(innings);
        }
      } else if (currentExtraType === "BYE" || currentExtraType === "LEG BYE") {
        const extraRuns = selectedExtraValue || 1;
        innings.totalRuns += extraRuns;
        if (striker) striker.balls += 1;
        innings.balls += 1;
        bowler.balls += 1;

        if (currentExtraType === "BYE") innings.extras.bye += extraRuns;
        else innings.extras.legBye += extraRuns;
        innings.extras.total += extraRuns;

        innings.currentOverDeliveries.push({
          label: `${extraRuns}${currentExtraType === "BYE" ? 'B' : 'Lb'}`,
          typeClass: "extra",
          runs: extraRuns,
          ballNumber: innings.balls
        });

        innings.commentary.push({
          over: `${innings.overs}.${innings.balls}`,
          event: currentExtraType,
          badge: currentExtraType === "BYE" ? "B" : "Lb",
          text: `${currentExtraType} signaled by the umpire. +${extraRuns} run${extraRuns > 1 ? 's' : ''}.`
        });

        if (extraRuns % 2 !== 0) rotateStrike(innings);
        if (innings.balls >= 6) completeOver(innings, bowler, match);
      } else if (currentExtraType === "PENALTY") {
        const extraRuns = selectedExtraValue || 5;
        innings.totalRuns += extraRuns;
        innings.extras.penalty += extraRuns;
        innings.extras.total += extraRuns;

        innings.commentary.push({
          over: `${innings.overs}.${innings.balls}`,
          event: "PENALTY",
          badge: "P",
          text: `Penalty runs awarded to batting side: +${extraRuns} runs.`
        });
      }

      checkInningsCompletionStatus(match, innings);

      document.getElementById("extrasModal").style.display = "none";
      saveActiveMatchState(match);
      if (window.PublicLiveScoreService) window.PublicLiveScoreService.emitLiveUpdate(match);
      renderLiveScoringPage(match);
    });
  }

  const extrasModalCloseBtn = document.getElementById("extrasModalCloseBtn");
  if (extrasModalCloseBtn) {
    extrasModalCloseBtn.addEventListener("click", () => {
      document.getElementById("extrasModal").style.display = "none";
    });
  }

  // ==========================================
  // CHANGE BOWLER MODAL & ASSIGNMENT
  // ==========================================

  function openChangeBowlerModal() {
    const match = getActiveMatch();
    if (!match || match.status === "COMPLETED" || match.status === "TIED" || match.status === "ABANDONED") return;
    const innings = getCurrentInnings(match);
    if (!innings) return;

    const modal = document.getElementById("changeBowlerModal");
    const container = document.getElementById("bowlersListContainer");
    if (!container) return;

    container.innerHTML = "";
    const currentBowler = innings.bowling.find(b => b.isCurrentBowler);

    innings.bowling.forEach(b => {
      const isConsecutive = (b.lastOverBowled === innings.overs && innings.balls === 0);
      const card = document.createElement("div");
      card.className = `bowler-select-card ${b.isCurrentBowler ? 'active' : ''}`;
      if (isConsecutive) card.style.opacity = "0.5";

      card.innerHTML = `
        <div>
          <div class="bowler-card-name">${b.name} ${b.isCurrentBowler ? '<span style="color:var(--orange);font-size:10px;">(Current)</span>' : ''}</div>
          <div class="bowler-card-stats">${b.overs}.${b.balls} Ov • ${b.runs} R • ${b.wickets} W • Maidens: ${b.maidens || 0}</div>
        </div>
        <span class="bowler-card-role">${b.role}</span>
      `;

      card.addEventListener("click", function () {
        if (isConsecutive && innings.bowling.length > 1) {
          alert("According to cricket rules, the same bowler cannot bowl consecutive overs.");
          return;
        }

        innings.bowling.forEach(bow => bow.isCurrentBowler = false);
        b.isCurrentBowler = true;

        innings.commentary.push({
          over: `${innings.overs}.${innings.balls}`,
          event: "BOWLER CHANGE",
          badge: "BOW",
          text: `🔄 ${b.name} comes into the attack to bowl over ${innings.overs + 1}.`
        });

        if (modal) modal.style.display = "none";
        saveActiveMatchState(match);
        renderLiveScoringPage(match);
      });

      container.appendChild(card);
    });

    if (modal) modal.style.display = "flex";
  }

  const btnScorerChangeBowler = document.getElementById("btnScorerChangeBowler");
  if (btnScorerChangeBowler) btnScorerChangeBowler.addEventListener("click", openChangeBowlerModal);

  const btnChangeBowlerTop = document.getElementById("btnChangeBowlerTop");
  if (btnChangeBowlerTop) btnChangeBowlerTop.addEventListener("click", openChangeBowlerModal);

  const changeBowlerCloseBtn = document.getElementById("changeBowlerCloseBtn");
  if (changeBowlerCloseBtn) {
    changeBowlerCloseBtn.addEventListener("click", () => {
      document.getElementById("changeBowlerModal").style.display = "none";
    });
  }

  // ==========================================
  // SWAP STRIKE BUTTONS
  // ==========================================

  function handleSwapStrikeAction() {
    const match = getActiveMatch();
    if (!match || match.status === "COMPLETED" || match.status === "TIED" || match.status === "ABANDONED") return;
    const innings = getCurrentInnings(match);
    if (!innings) return;

    saveMatchHistorySnapshot(match);
    rotateStrike(innings);

    saveActiveMatchState(match);
    renderLiveScoringPage(match);
  }

  const btnScorerSwapStrike = document.getElementById("btnScorerSwapStrike");
  if (btnScorerSwapStrike) btnScorerSwapStrike.addEventListener("click", handleSwapStrikeAction);

  const btnSwapStrikeTop = document.getElementById("btnSwapStrikeTop");
  if (btnSwapStrikeTop) btnSwapStrikeTop.addEventListener("click", handleSwapStrikeAction);

  // ==========================================
  // UNDO DELIVERY (MULTI-LEVEL REVERT)
  // ==========================================

  function handleUndoAction() {
    const match = getActiveMatch();
    if (!match || !match.historyStack || match.historyStack.length === 0) {
      alert("No previous scoring actions to undo.");
      return;
    }

    const previousSnapshot = match.historyStack.pop();
    match.currentInningIndex = previousSnapshot.currentInningIndex;
    match.status = previousSnapshot.status;
    match.innings1 = previousSnapshot.innings1;
    match.innings2 = previousSnapshot.innings2;

    saveActiveMatchState(match);
    renderLiveScoringPage(match);
  }

  const btnScorerUndo = document.getElementById("btnScorerUndo");
  if (btnScorerUndo) btnScorerUndo.addEventListener("click", handleUndoAction);

  const btnQuickUndo = document.getElementById("btnQuickUndo");
  if (btnQuickUndo) btnQuickUndo.addEventListener("click", handleUndoAction);

  // ==========================================
  // EDIT / CORRECT SCORE MODAL
  // ==========================================

  function openEditScoreModal() {
    const match = getActiveMatch();
    if (!match || match.status === "COMPLETED" || match.status === "TIED" || match.status === "ABANDONED") return;
    const innings = getCurrentInnings(match);
    if (!innings) return;

    const modal = document.getElementById("editScoreModal");
    const runsInput = document.getElementById("editScoreRuns");
    const wktsInput = document.getElementById("editScoreWickets");
    const oversInput = document.getElementById("editScoreOvers");
    const ballsInput = document.getElementById("editScoreBalls");

    if (runsInput) runsInput.value = innings.totalRuns;
    if (wktsInput) wktsInput.value = innings.wickets;
    if (oversInput) oversInput.value = innings.overs;
    if (ballsInput) ballsInput.value = innings.balls;

    // Populate Striker, Non-Striker, Bowler dropdowns
    const selectStriker = document.getElementById("editSelectStriker");
    const selectNonStriker = document.getElementById("editSelectNonStriker");
    const selectBowler = document.getElementById("editSelectBowler");

    if (selectStriker && selectNonStriker) {
      selectStriker.innerHTML = "";
      selectNonStriker.innerHTML = "";
      (innings.batting || []).forEach(b => {
        const opt1 = document.createElement("option");
        opt1.value = b.name;
        opt1.textContent = `${b.name} (${b.role})`;
        if (b.isAtCrease && b.isStriker) opt1.selected = true;
        selectStriker.appendChild(opt1);

        const opt2 = document.createElement("option");
        opt2.value = b.name;
        opt2.textContent = `${b.name} (${b.role})`;
        if (b.isAtCrease && !b.isStriker) opt2.selected = true;
        selectNonStriker.appendChild(opt2);
      });
    }

    if (selectBowler) {
      selectBowler.innerHTML = "";
      (innings.bowling || []).forEach(b => {
        const opt = document.createElement("option");
        opt.value = b.name;
        opt.textContent = `${b.name} (${b.role})`;
        if (b.isCurrentBowler) opt.selected = true;
        selectBowler.appendChild(opt);
      });
    }

    if (modal) modal.style.display = "flex";
  }

  const editScoreForm = document.getElementById("editScoreForm");
  if (editScoreForm) {
    editScoreForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const match = getActiveMatch();
      if (!match) return;
      const innings = getCurrentInnings(match);
      if (!innings) return;

      saveMatchHistorySnapshot(match);

      innings.totalRuns = parseInt(document.getElementById("editScoreRuns").value) || 0;
      innings.wickets = parseInt(document.getElementById("editScoreWickets").value) || 0;
      innings.overs = parseInt(document.getElementById("editScoreOvers").value) || 0;
      innings.balls = parseInt(document.getElementById("editScoreBalls").value) || 0;

      const chosenStriker = document.getElementById("editSelectStriker").value;
      const chosenNonStriker = document.getElementById("editSelectNonStriker").value;
      const chosenBowler = document.getElementById("editSelectBowler").value;

      innings.batting.forEach(b => {
        b.isAtCrease = (b.name === chosenStriker || b.name === chosenNonStriker);
        b.isStriker = (b.name === chosenStriker);
      });

      innings.bowling.forEach(b => {
        b.isCurrentBowler = (b.name === chosenBowler);
      });

      innings.commentary.push({
        over: `${innings.overs}.${innings.balls}`,
        event: "SCORE CORRECTED",
        badge: "EDIT",
        text: `Score manually adjusted to ${innings.totalRuns}/${innings.wickets} (${innings.overs}.${innings.balls} Ov).`
      });

      document.getElementById("editScoreModal").style.display = "none";
      saveActiveMatchState(match);
      renderLiveScoringPage(match);
    });
  }

  const btnScorerEditScore = document.getElementById("btnScorerEditScore");
  if (btnScorerEditScore) btnScorerEditScore.addEventListener("click", openEditScoreModal);

  const btnQuickEditScore = document.getElementById("btnQuickEditScore");
  if (btnQuickEditScore) btnQuickEditScore.addEventListener("click", openEditScoreModal);

  const editScoreCloseBtn = document.getElementById("editScoreCloseBtn");
  if (editScoreCloseBtn) {
    editScoreCloseBtn.addEventListener("click", () => {
      document.getElementById("editScoreModal").style.display = "none";
    });
  }

  // ==========================================
  // MATCH STATUS CELEBRATION MODAL
  // ==========================================

  let matchStatusCallback = null;

  function showMatchStatusModal(heading, desc, btnText, callback) {
    const modal = document.getElementById("matchStatusModal");
    const h = document.getElementById("matchStatusHeading");
    const d = document.getElementById("matchStatusDesc");
    const btn = document.getElementById("btnActionMatchStatus");

    if (h) h.textContent = heading;
    if (d) d.textContent = desc;
    if (btn) btn.innerHTML = `<i class="fa-solid fa-play"></i> ${btnText}`;

    matchStatusCallback = callback;
    if (modal) modal.style.display = "flex";
  }

  const btnActionMatchStatus = document.getElementById("btnActionMatchStatus");
  if (btnActionMatchStatus) {
    btnActionMatchStatus.addEventListener("click", function () {
      document.getElementById("matchStatusModal").style.display = "none";
      if (typeof matchStatusCallback === "function") matchStatusCallback();
    });
  }

  const matchStatusCloseBtn = document.getElementById("matchStatusCloseBtn");
  if (matchStatusCloseBtn) {
    matchStatusCloseBtn.addEventListener("click", () => {
      document.getElementById("matchStatusModal").style.display = "none";
    });
  }

  // ==========================================
  // MATCH TABS SWITCHING (COMMENTARY, SCORECARD, SQUADS)
  // ==========================================

  const tabLiveCommentary = document.getElementById("tabLiveCommentary");
  const tabLiveScorecard = document.getElementById("tabLiveScorecard");
  const tabLiveSquads = document.getElementById("tabLiveSquads");

  const paneLiveCommentary = document.getElementById("paneLiveCommentary");
  const paneLiveScorecard = document.getElementById("paneLiveScorecard");
  const paneLiveSquads = document.getElementById("paneLiveSquads");

  function switchMatchTab(tab) {
    [tabLiveCommentary, tabLiveScorecard, tabLiveSquads].forEach(t => t?.classList.remove("active"));
    [paneLiveCommentary, paneLiveScorecard, paneLiveSquads].forEach(p => {
      if (p) p.style.display = "none";
    });

    if (tab === "commentary") {
      if (tabLiveCommentary) tabLiveCommentary.classList.add("active");
      if (paneLiveCommentary) paneLiveCommentary.style.display = "block";
    } else if (tab === "scorecard") {
      if (tabLiveScorecard) tabLiveScorecard.classList.add("active");
      if (paneLiveScorecard) paneLiveScorecard.style.display = "block";
      renderFullScorecardTab(getActiveMatch());
    } else if (tab === "squads") {
      if (tabLiveSquads) tabLiveSquads.classList.add("active");
      if (paneLiveSquads) paneLiveSquads.style.display = "block";
      renderSquadsTab(getActiveMatch());
    }
  }

  if (tabLiveCommentary) tabLiveCommentary.addEventListener("click", () => switchMatchTab("commentary"));
  if (tabLiveScorecard) tabLiveScorecard.addEventListener("click", () => switchMatchTab("scorecard"));
  if (tabLiveSquads) tabLiveSquads.addEventListener("click", () => switchMatchTab("squads"));

  // ==========================================
  // LIVE SCREEN NAVIGATION BUTTONS
  // ==========================================

  if (startMatchBackButton) {
    startMatchBackButton.addEventListener("click", function () {
      showScreen("screen5");
    });
  }

  if (liveScoreBackButton) {
    liveScoreBackButton.addEventListener("click", function () {
      showScreen("screen5");
    });
  }

  if (btnLiveBackHome) {
    btnLiveBackHome.addEventListener("click", function () {
      showScreen("screen5");
    });
  }

  if (btnLiveViewTeam) {
    btnLiveViewTeam.addEventListener("click", function () {
      renderMyTeamPage();
      showScreen("screen6");
    });
  }

  if (btnLiveEditSetup) {
    btnLiveEditSetup.addEventListener("click", function () {
      openStartMatchSetup();
    });
  }

  const btnLiveScoreSocialLive = document.getElementById("btnLiveScoreSocialLive");
  const btnLiveStartSocialStream = document.getElementById("btnLiveStartSocialStream");

  function openCurrentMatchBroadcastModal() {
    const activeMatch = getActiveMatch();
    if (activeMatch && activeMatch.tournament && typeof getTournamentsList === "function") {
      const tourneys = getTournamentsList() || [];
      const matchingTourney = tourneys.find(t => t.name === activeMatch.tournament);
      if (matchingTourney) {
        if (typeof openBroadcastCenterModal === "function") {
          openBroadcastCenterModal("TOURNAMENT", matchingTourney.id, null, activeMatch.matchId);
          return;
        }
      }
    }
    if (typeof openBroadcastCenterModal === "function") {
      openBroadcastCenterModal("SINGLE_MATCH", activeMatch ? activeMatch.matchId : null);
    }
  }

  if (btnLiveScoreSocialLive) {
    btnLiveScoreSocialLive.addEventListener("click", openCurrentMatchBroadcastModal);
  }
  if (btnLiveStartSocialStream) {
    btnLiveStartSocialStream.addEventListener("click", openCurrentMatchBroadcastModal);
  }

  // AUTO-RESUME ACTIVE MATCH ON INITIAL APP LOAD (IF PERSISTED)
  const savedActiveMatch = getActiveMatch();
  if (savedActiveMatch && savedActiveMatch.status === "LIVE") {
    renderLiveScoringPage(savedActiveMatch);
  }

  // ==========================================
  // MATCH HISTORY SYSTEM (SCREEN 9 & STORAGE)
  // ==========================================

  const HISTORY_STORAGE_KEY = "cricYuvaMatchHistory";
  let activeHistoryFilter = "all"; // 'all', 'won', 'lost', 'tied'
  let activeHistorySort = "newest"; // 'newest', 'oldest'
  let pendingDeleteMatchId = null;
  let isDeleteAllAction = false;

  // Initialize sample history if none exists to ensure rich immediate experience
  function getMatchHistoryList() {
    try {
      const data = getUserStorage(HISTORY_STORAGE_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.error("Error reading match history:", e);
    }
    return [];
  }

  function saveMatchToHistoryStorage(match) {
    if (!match) return;
    try {
      const history = getMatchHistoryList();
      const existingIdx = history.findIndex(m => m.matchId === match.matchId);
      if (existingIdx >= 0) {
        history[existingIdx] = match;
      } else {
        history.unshift(match);
      }
      setUserStorage(HISTORY_STORAGE_KEY, JSON.stringify(history));

      // Synchronize match result with tournament system if linked
      if (typeof syncMatchToTournament === "function") {
        syncMatchToTournament(match);
      }
    } catch (e) {
      console.error("Error saving match to history storage:", e);
    }
  }

  // Check if sample history matches need to be seeded on first load
  function seedDefaultHistoryIfEmpty() {
    // Deliberately empty: match history is created only by real scored matches.
    return;
  }


  // Render the Match History Cards List
  function renderMatchHistoryScreen() {
    seedDefaultHistoryIfEmpty();
    const container = document.getElementById("historyCardsList");
    const emptyState = document.getElementById("historyEmptyState");
    const searchInput = document.getElementById("historySearchInput");
    const clearSearchBtn = document.getElementById("historyClearSearchBtn");

    if (!container) return;

    const allHistory = getMatchHistoryList();
    const query = (searchInput?.value || "").toLowerCase().trim();

    if (clearSearchBtn) {
      clearSearchBtn.style.display = query ? "block" : "none";
    }

    // Filter by counts for filter chips
    let countAll = allHistory.length;
    let countWon = 0;
    let countLost = 0;
    let countTied = 0;

    allHistory.forEach(m => {
      const res = (m.result || "").toLowerCase();
      if (res.includes("won")) {
        // Check if teamA won or teamB won
        countWon++;
      } else if (res.includes("lost")) {
        countLost++;
      } else if (res.includes("tie") || m.status === "TIED") {
        countTied++;
      } else {
        countWon++;
      }
    });

    const elCountAll = document.getElementById("historyCountAll");
    const elCountWon = document.getElementById("historyCountWon");
    const elCountLost = document.getElementById("historyCountLost");
    const elCountTied = document.getElementById("historyCountTied");

    if (elCountAll) elCountAll.textContent = countAll;
    if (elCountWon) elCountWon.textContent = countWon;
    if (elCountLost) elCountLost.textContent = countLost;
    if (elCountTied) elCountTied.textContent = countTied;

    // Apply Filter & Search
    let filtered = allHistory.filter(match => {
      // Search matching
      const t1 = (match.teamA?.name || "").toLowerCase();
      const t2 = (match.teamB?.name || "").toLowerCase();
      const tourney = (match.tournament || "").toLowerCase();
      const venue = (match.ground || "").toLowerCase();
      const res = (match.result || "").toLowerCase();

      const matchesQuery = !query || t1.includes(query) || t2.includes(query) || tourney.includes(query) || venue.includes(query) || res.includes(query);
      if (!matchesQuery) return false;

      // Filter matching
      if (activeHistoryFilter === "won") {
        return res.includes("won");
      } else if (activeHistoryFilter === "lost") {
        return res.includes("lost");
      } else if (activeHistoryFilter === "tied") {
        return res.includes("tie") || match.status === "TIED";
      }
      return true;
    });

    // Apply Sorting
    if (activeHistorySort === "oldest") {
      filtered.reverse();
    }

    // Render Cards
    container.innerHTML = "";

    if (filtered.length === 0) {
      if (emptyState) emptyState.style.display = "flex";
      container.style.display = "none";
      return;
    }

    if (emptyState) emptyState.style.display = "none";
    container.style.display = "flex";

    filtered.forEach((match, idx) => {
      const card = document.createElement("div");
      card.className = "history-match-card";
      card.dataset.matchId = match.matchId || `match_${idx}`;

      const tourneyName = match.tournament || "Cric Yuva Match";
      const dateText = match.matchDate || match.date || "Completed";
      const teamAName = match.teamA?.name || "Team A";
      const teamBName = match.teamB?.name || "Team B";

      const inn1 = match.innings1 || { totalRuns: 0, wickets: 0, overs: 0, balls: 0, battingTeam: teamAName };
      const inn2 = match.innings2 || { totalRuns: 0, wickets: 0, overs: 0, balls: 0, battingTeam: teamBName };

      const scoreA = inn1.battingTeam === teamAName 
        ? `${inn1.totalRuns}/${inn1.wickets} <small>(${inn1.overs}.${inn1.balls})</small>`
        : `${inn2.totalRuns}/${inn2.wickets} <small>(${inn2.overs}.${inn2.balls})</small>`;

      const scoreB = inn2.battingTeam === teamBName
        ? `${inn2.totalRuns}/${inn2.wickets} <small>(${inn2.overs}.${inn2.balls})</small>`
        : `${inn1.totalRuns}/${inn1.wickets} <small>(${inn1.overs}.${inn1.balls})</small>`;

      const resultText = match.result || "Match Concluded";
      const isWinnerA = resultText.toLowerCase().includes(teamAName.toLowerCase()) && resultText.toLowerCase().includes("won");
      const isWinnerB = resultText.toLowerCase().includes(teamBName.toLowerCase()) && resultText.toLowerCase().includes("won");

      const initialsA = teamAName.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase() || "TA";
      const initialsB = teamBName.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase() || "TB";

      card.innerHTML = `
        <div class="h-card-header">
          <span class="h-card-tourney"><i class="fa-solid fa-trophy"></i> ${tourneyName}</span>
          <span class="h-card-date">${dateText}</span>
        </div>

        <div class="h-card-body">
          <!-- TEAM A ROW -->
          <div class="h-team-row ${isWinnerA ? 'winner-row' : ''}">
            <div class="h-team-info">
              <div class="h-team-badge ${isWinnerA ? 'winner-badge' : ''}">${initialsA}</div>
              <span class="h-team-name-text">${teamAName} ${isWinnerA ? '👑' : ''}</span>
            </div>
            <div class="h-team-score-text">${scoreA}</div>
          </div>

          <!-- TEAM B ROW -->
          <div class="h-team-row ${isWinnerB ? 'winner-row' : ''}">
            <div class="h-team-info">
              <div class="h-team-badge ${isWinnerB ? 'winner-badge' : ''}">${initialsB}</div>
              <span class="h-team-name-text">${teamBName} ${isWinnerB ? '👑' : ''}</span>
            </div>
            <div class="h-team-score-text">${scoreB}</div>
          </div>
        </div>

        <div class="h-card-footer">
          <span class="h-card-result">${resultText}</span>
          <div class="h-card-actions">
            <button type="button" class="btn-card-mini-action btn-view-history-detail" data-id="${match.matchId}">
              <i class="fa-solid fa-eye"></i> Details
            </button>
            <button type="button" class="btn-card-delete btn-delete-single-history" data-id="${match.matchId}" title="Delete Match">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      `;

      // Tap card or Details button to open Match Details modal
      card.addEventListener("click", (e) => {
        if (e.target.closest(".btn-delete-single-history")) {
          e.stopPropagation();
          const mId = e.target.closest(".btn-delete-single-history").dataset.id;
          promptDeleteMatch(mId, false);
          return;
        }
        openHistoryMatchDetailsModal(match);
      });

      container.appendChild(card);
    });
  }

  // Open Full Match Details Modal
  function openHistoryMatchDetailsModal(match) {
    if (!match) return;

    const modal = document.getElementById("historyDetailsModal");
    const tourneyBadge = document.getElementById("historyModalTourney");
    const dateTop = document.getElementById("historyModalDate");
    const resultText = document.getElementById("historyModalResult");
    const venueOvers = document.getElementById("historyModalVenueOvers");

    const teamAName = document.getElementById("historyTeamAName");
    const teamARuns = document.getElementById("historyTeamARuns");
    const teamBName = document.getElementById("historyTeamBName");
    const teamBRuns = document.getElementById("historyTeamBRuns");

    const teamACard = document.getElementById("historyTeamACard");
    const teamBCard = document.getElementById("historyTeamBCard");

    if (tourneyBadge) tourneyBadge.textContent = match.tournament || "Cric Yuva Match";
    if (dateTop) dateTop.textContent = match.matchDate || match.date || "Completed Match";
    if (resultText) resultText.textContent = match.result || "Match Finished";
    if (venueOvers) venueOvers.textContent = `${match.ground || "Ground"} • ${match.overs || 20} Overs Match`;

    const inn1 = match.innings1 || { battingTeam: match.teamA?.name || "Team A", bowlingTeam: match.teamB?.name || "Team B", totalRuns: 0, wickets: 0, overs: 0, balls: 0 };
    const inn2 = match.innings2 || { battingTeam: match.teamB?.name || "Team B", bowlingTeam: match.teamA?.name || "Team A", totalRuns: 0, wickets: 0, overs: 0, balls: 0 };

    const tANameStr = inn1.battingTeam;
    const tBNameStr = inn2.battingTeam;

    if (teamAName) teamAName.textContent = tANameStr;
    if (teamARuns) teamARuns.innerHTML = `${inn1.totalRuns}/${inn1.wickets} <small>(${inn1.overs}.${inn1.balls} Ov)</small>`;
    if (teamBName) teamBName.textContent = tBNameStr;
    if (teamBRuns) teamBRuns.innerHTML = `${inn2.totalRuns}/${inn2.wickets} <small>(${inn2.overs}.${inn2.balls} Ov)</small>`;

    const resLower = (match.result || "").toLowerCase();
    const isWinnerA = resLower.includes(tANameStr.toLowerCase()) && resLower.includes("won");
    const isWinnerB = resLower.includes(tBNameStr.toLowerCase()) && resLower.includes("won");

    if (teamACard) teamACard.classList.toggle("winner-card", isWinnerA);
    if (teamBCard) teamBCard.classList.toggle("winner-card", isWinnerB);

    // Track active team filter in details modal ('all', 'teamA', 'teamB')
    let activeTeamFilter = 'all';

    function renderFilteredHistoryScorecard() {
      const scorecardContainer = document.getElementById("historyModalScorecardContainer");
      if (!scorecardContainer) return;
      scorecardContainer.innerHTML = "";

      function buildHistoryInnTable(innings, innNum) {
        if (!innings) return "";
        const ext = innings.extras || { wide: 0, noBall: 0, bye: 0, legBye: 0, penalty: 0, total: 0 };
        const totalBalls = (innings.overs * 6) + innings.balls;
        const crr = totalBalls > 0 ? ((innings.totalRuns / totalBalls) * 6).toFixed(2) : "0.00";

        let innHtml = `
          <div class="scorecard-innings-box" style="margin-bottom:14px;">
            <div class="scorecard-innings-title-row">
              <div class="scorecard-team-heading">
                <span style="background:var(--orange);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:900;">${innNum === 1 ? '1st INNING' : '2nd INNING'}</span>
                <span>${innings.battingTeam}</span>
              </div>
              <div class="scorecard-team-total">
                ${innings.totalRuns}/${innings.wickets} <span style="font-size:11px;color:#94a3b8;">(${innings.overs}.${innings.balls} Ov, CRR: ${crr})</span>
              </div>
            </div>

            <!-- BATTING -->
            <div class="scorecard-section-label"><i class="fa-solid fa-baseball-bat-ball"></i> Batting (${innings.battingTeam})</div>
            <div class="scorecard-table-wrapper">
              <table class="scorecard-full-table">
                <thead>
                  <tr>
                    <th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th>
                  </tr>
                </thead>
                <tbody>
        `;

        (innings.batting || []).forEach(b => {
          const sr = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : "0.0";
          innHtml += `
            <tr style="cursor:pointer;" onclick="openPlayerStatsModal('${b.name.replace(/'/g, "\\'")}')" title="View ${b.name} Career Stats">
              <td>
                <div class="batter-title">${b.name} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:9px;color:#f97316;opacity:0.8;margin-left:3px;"></i></div>
                <div class="batter-dismissal ${b.isOut ? 'out' : 'not-out'}">${b.isOut ? (b.dismissal || 'Out') : 'not out *'}</div>
              </td>
              <td><strong style="color:${b.runs >= 50 ? '#fbbf24' : '#fff'};">${b.runs}</strong></td>
              <td>${b.balls}</td>
              <td>${b.fours || 0}</td>
              <td>${b.sixes || 0}</td>
              <td>${sr}</td>
            </tr>
          `;
        });

        innHtml += `
                </tbody>
              </table>
            </div>

            <div class="scorecard-extras-row">
              <div><span class="scorecard-extras-label">Extras: </span><span class="scorecard-extras-breakdown">(b ${ext.bye || 0}, lb ${ext.legBye || 0}, w ${ext.wide || 0}, nb ${ext.noBall || 0})</span></div>
              <div class="scorecard-extras-val">${ext.total || 0}</div>
            </div>

            <!-- BOWLING -->
            <div class="scorecard-section-label" style="color:#38bdf8;margin-top:10px;"><i class="fa-solid fa-bullseye"></i> Bowling (${innings.bowlingTeam})</div>
            <div class="scorecard-table-wrapper">
              <table class="scorecard-full-table">
                <thead>
                  <tr>
                    <th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>ECON</th>
                  </tr>
                </thead>
                <tbody>
        `;

        (innings.bowling || []).forEach(b => {
          const bBalls = (b.overs * 6) + b.balls;
          const econ = bBalls > 0 ? ((b.runs / bBalls) * 6).toFixed(2) : "0.00";
          innHtml += `
            <tr style="cursor:pointer;" onclick="openPlayerStatsModal('${b.name.replace(/'/g, "\\'")}')" title="View ${b.name} Career Stats">
              <td><div class="batter-title">${b.name} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:9px;color:#38bdf8;opacity:0.8;margin-left:3px;"></i></div></td>
              <td>${b.overs}.${b.balls}</td>
              <td>${b.maidens || 0}</td>
              <td>${b.runs || 0}</td>
              <td><strong style="color:#38bdf8;">${b.wickets || 0}</strong></td>
              <td>${econ}</td>
            </tr>
          `;
        });

        innHtml += `
                </tbody>
              </table>
            </div>
          </div>
        `;

        return innHtml;
      }

      let scHtml = "";
      if (activeTeamFilter === "teamA") {
        // Show ONLY Team A: Team A's batting innings (inn1) and Team A's bowling spell in inn2
        scHtml += buildHistoryInnTable(inn1, 1);
      } else if (activeTeamFilter === "teamB") {
        // Show ONLY Team B: Team B's batting innings (inn2) and Team B's bowling spell in inn1
        if (inn2) scHtml += buildHistoryInnTable(inn2, 2);
      } else {
        // Show Both Teams
        scHtml += buildHistoryInnTable(inn1, 1);
        if (inn2) scHtml += buildHistoryInnTable(inn2, 2);
      }

      scorecardContainer.innerHTML = scHtml;
    }

    // Attach click listeners to team score cards for immediate filtering
    if (teamACard) {
      teamACard.onclick = () => {
        if (activeTeamFilter === "teamA") {
          activeTeamFilter = "all";
          teamACard.classList.remove("active-team-selected");
          if (resultText) resultText.textContent = match.result || "Match Finished";
        } else {
          activeTeamFilter = "teamA";
          teamACard.classList.add("active-team-selected");
          if (teamBCard) teamBCard.classList.remove("active-team-selected");
          if (resultText) {
            resultText.innerHTML = `<span style="color:${isWinnerA ? '#4ade80' : '#cbd5e1'}; font-weight:800;">${tANameStr}: ${isWinnerA ? '🏆 WINNER' : 'RUNNER-UP'} (${inn1.totalRuns}/${inn1.wickets})</span>`;
          }
        }
        renderFilteredHistoryScorecard();
      };
    }

    if (teamBCard) {
      teamBCard.onclick = () => {
        if (activeTeamFilter === "teamB") {
          activeTeamFilter = "all";
          teamBCard.classList.remove("active-team-selected");
          if (resultText) resultText.textContent = match.result || "Match Finished";
        } else {
          activeTeamFilter = "teamB";
          teamBCard.classList.add("active-team-selected");
          if (teamACard) teamACard.classList.remove("active-team-selected");
          if (resultText) {
            resultText.innerHTML = `<span style="color:${isWinnerB ? '#4ade80' : '#cbd5e1'}; font-weight:800;">${tBNameStr}: ${isWinnerB ? '🏆 WINNER' : 'RUNNER-UP'} (${inn2.totalRuns}/${inn2.wickets})</span>`;
          }
        }
        renderFilteredHistoryScorecard();
      };
    }

    // Populate Info tab
    const tossEl = document.getElementById("hModalTossText");
    const venueEl = document.getElementById("hModalVenueText");
    const dateEl = document.getElementById("hModalDateTimeText");

    if (tossEl) tossEl.textContent = match.toss ? `${match.toss.winner} won toss (${match.toss.decision})` : "Toss recorded";
    if (venueEl) venueEl.textContent = match.ground || "Yuva Cricket Arena";
    if (dateEl) dateEl.textContent = match.matchDate || match.date || "Completed";

    // Populate Awards
    const awardsContainer = document.getElementById("hModalAwardsContainer");
    if (awardsContainer) {
      const awards = calculateMatchAwards(match);
      if (awards) {
        awardsContainer.innerHTML = `
          <div class="award-card potm-card">
            <div class="award-badge-pill"><i class="fa-solid fa-crown"></i> PLAYER OF THE MATCH</div>
            <div class="award-player-name">${awards.potm.name}</div>
            <div class="award-team-name">${awards.potm.team}</div>
            <div class="award-stat-highlight">${awards.potm.runs > 0 ? `${awards.potm.runs} Runs` : ''} ${awards.potm.wickets > 0 ? `${awards.potm.wickets} Wickets` : ''}</div>
          </div>
          <div class="awards-secondary-grid">
            <div class="award-card mini-award">
              <div class="mini-award-label"><i class="fa-solid fa-baseball-bat-ball"></i> Best Batter</div>
              <div class="mini-award-name">${awards.bestBatter.name}</div>
              <div class="mini-award-stat">${awards.bestBatter.runs} runs (${awards.bestBatter.balls}b, ${awards.bestBatter.fours}x4, ${awards.bestBatter.sixes}x6)</div>
            </div>
            <div class="award-card mini-award">
              <div class="mini-award-label"><i class="fa-solid fa-bullseye"></i> Best Bowler</div>
              <div class="mini-award-name">${awards.bestBowler.name}</div>
              <div class="mini-award-stat">${awards.bestBowler.wickets} wkts for ${awards.bestBowler.runsConceded} runs</div>
            </div>
          </div>
        `;
      } else {
        awardsContainer.innerHTML = `<div style="color:#64748b;font-size:12px;text-align:center;padding:10px;">Awards data calculated upon match completion.</div>`;
      }
    }

    // Populate Initial Scorecard
    renderFilteredHistoryScorecard();

    // Populate Commentary in History Modal
    const commList = document.getElementById("historyModalCommentaryList");
    if (commList) {
      commList.innerHTML = "";
      const comm1 = inn1.commentary || [];
      const comm2 = inn2?.commentary || [];
      const allComms = [...comm2, ...comm1];

      if (allComms.length === 0) {
        commList.innerHTML = `<div style="text-align:center;padding:20px;color:#64748b;font-size:12px;">No commentary logged for this match.</div>`;
      } else {
        allComms.forEach(c => {
          const item = document.createElement("div");
          item.className = "commentary-item-card";
          let pillClass = "four";
          if (c.event === "SIX") pillClass = "six";
          else if (c.event === "WICKET") pillClass = "wicket";
          else if (["WIDE", "NO BALL", "BYE", "LEG BYE"].includes(c.event)) pillClass = "extra";

          const dirHtml = c.direction ? `<span class="comm-direction-badge"><i class="fa-solid fa-compass"></i> ${c.direction}</span>` : "";

          item.innerHTML = `
            <div class="commentary-meta-row">
              <span class="comm-over-tag">Over ${c.over}</span>
              <span class="comm-event-pill ${pillClass}">${c.badge || c.event}</span>
            </div>
            <div class="comm-desc-text">
              ${dirHtml}
              <span>${c.text}</span>
            </div>
          `;
          commList.appendChild(item);
        });
      }
    }

    // Setup Detail modal buttons
    const btnDelThis = document.getElementById("btnHistoryDeleteThisMatch");
    if (btnDelThis) {
      btnDelThis.onclick = () => {
        promptDeleteMatch(match.matchId, false);
      };
    }

    const btnShare = document.getElementById("btnHistoryShareMatch");
    if (btnShare) {
      btnShare.onclick = () => {
        const shareText = `🏏 Cric Yuva Match Result:\n${match.teamA?.name} vs ${match.teamB?.name}\n🏆 ${match.result}\nScore: ${inn1.battingTeam} ${inn1.totalRuns}/${inn1.wickets} vs ${inn2.battingTeam} ${inn2.totalRuns}/${inn2.wickets}`;
        if (navigator.share) {
          navigator.share({ title: "Cric Yuva Match Result", text: shareText }).catch(() => {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(shareText).then(() => {
            showToast("Match details copied to clipboard!");
          });
        } else {
          showToast(match.result);
        }
      };
    }

    // Default to summary tab
    switchHistoryDetailsTab("summary");
    if (modal) modal.style.display = "flex";
  }

  // Switch tabs in Details Modal
  function switchHistoryDetailsTab(tab) {
    const tabs = document.querySelectorAll(".h-nav-tab");
    tabs.forEach(t => {
      t.classList.toggle("active", t.dataset.htab === tab);
    });

    const pSummary = document.getElementById("hPaneSummary");
    const pScorecard = document.getElementById("hPaneScorecard");
    const pCommentary = document.getElementById("hPaneCommentary");

    if (pSummary) pSummary.style.display = tab === "summary" ? "block" : "none";
    if (pScorecard) pScorecard.style.display = tab === "scorecard" ? "block" : "none";
    if (pCommentary) pCommentary.style.display = tab === "commentary" ? "block" : "none";
  }

  // Delete Prompt
  function promptDeleteMatch(matchId, isAll) {
    pendingDeleteMatchId = matchId;
    isDeleteAllAction = isAll;

    const modal = document.getElementById("deleteConfirmModal");
    const title = document.getElementById("deleteConfirmTitle");
    const msg = document.getElementById("deleteConfirmMessage");

    if (isAll) {
      if (title) title.textContent = "Clear All Match History?";
      if (msg) msg.textContent = "This will permanently remove all saved match records from history. Active/Live match data will NOT be affected.";
    } else {
      if (title) title.textContent = "Delete This Match?";
      if (msg) msg.textContent = "Are you sure you want to remove this match from your history? This action cannot be undone.";
    }

    if (modal) modal.style.display = "flex";
  }

  // Perform Deletion
  function executeHistoryDeletion() {
    try {
      if (isDeleteAllAction) {
        removeUserStorage(HISTORY_STORAGE_KEY);
        showToast("All match history cleared.");
      } else if (pendingDeleteMatchId) {
        let history = getMatchHistoryList();
        history = history.filter(m => m.matchId !== pendingDeleteMatchId);
        setUserStorage(HISTORY_STORAGE_KEY, JSON.stringify(history));
        showToast("Match removed from history.");
      }
    } catch (e) {
      console.error("Deletion error:", e);
    }

    // Close modals
    const delModal = document.getElementById("deleteConfirmModal");
    const detModal = document.getElementById("historyDetailsModal");
    if (delModal) delModal.style.display = "none";
    if (detModal) detModal.style.display = "none";

    renderMatchHistoryScreen();
  }

  // Event Listeners for Match History Screen & Modals
  const historyBackButton = document.getElementById("historyBackButton");
  if (historyBackButton) {
    historyBackButton.addEventListener("click", () => showScreen("screen5"));
  }

  const historyDetailsCloseBtn = document.getElementById("historyDetailsCloseBtn");
  if (historyDetailsCloseBtn) {
    historyDetailsCloseBtn.addEventListener("click", () => {
      document.getElementById("historyDetailsModal").style.display = "none";
    });
  }

  const deleteConfirmCloseBtn = document.getElementById("deleteConfirmCloseBtn");
  const btnCancelDeleteAction = document.getElementById("btnCancelDeleteAction");
  if (deleteConfirmCloseBtn) {
    deleteConfirmCloseBtn.addEventListener("click", () => {
      document.getElementById("deleteConfirmModal").style.display = "none";
    });
  }
  if (btnCancelDeleteAction) {
    btnCancelDeleteAction.addEventListener("click", () => {
      document.getElementById("deleteConfirmModal").style.display = "none";
    });
  }

  const btnConfirmDeleteAction = document.getElementById("btnConfirmDeleteAction");
  if (btnConfirmDeleteAction) {
    btnConfirmDeleteAction.addEventListener("click", executeHistoryDeletion);
  }

  const btnClearAllHistoryBtn = document.getElementById("btnClearAllHistoryBtn");
  if (btnClearAllHistoryBtn) {
    btnClearAllHistoryBtn.addEventListener("click", () => {
      promptDeleteMatch(null, true);
    });
  }

  // Search field listener
  const historySearchInput = document.getElementById("historySearchInput");
  if (historySearchInput) {
    historySearchInput.addEventListener("input", renderMatchHistoryScreen);
  }

  const historyClearSearchBtn = document.getElementById("historyClearSearchBtn");
  if (historyClearSearchBtn) {
    historyClearSearchBtn.addEventListener("click", () => {
      if (historySearchInput) historySearchInput.value = "";
      renderMatchHistoryScreen();
    });
  }

  // Filter chips
  const filterChips = document.querySelectorAll(".history-filter-chip");
  filterChips.forEach(chip => {
    chip.addEventListener("click", () => {
      filterChips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeHistoryFilter = chip.dataset.filter || "all";
      renderMatchHistoryScreen();
    });
  });

  // Sort select
  const historySortSelect = document.getElementById("historySortSelect");
  if (historySortSelect) {
    historySortSelect.addEventListener("change", (e) => {
      activeHistorySort = e.target.value;
      renderMatchHistoryScreen();
    });
  }

  // History details tab switches
  const hTabs = document.querySelectorAll(".h-nav-tab");
  hTabs.forEach(t => {
    t.addEventListener("click", () => {
      switchHistoryDetailsTab(t.dataset.htab);
    });
  });

  // Empty state buttons
  const btnEmptyStateStartMatch = document.getElementById("btnEmptyStateStartMatch");
  if (btnEmptyStateStartMatch) {
    btnEmptyStateStartMatch.addEventListener("click", () => {
      openStartMatchSetup();
    });
  }

  const btnEmptyStateGoHome = document.getElementById("btnEmptyStateGoHome");
  if (btnEmptyStateGoHome) {
    btnEmptyStateGoHome.addEventListener("click", () => {
      showScreen("screen5");
    });
  }

  // Navigations to Match History from Bottom Nav & Home Page Cards
  const navHomeFromHistory = document.getElementById("navHomeFromHistory");
  if (navHomeFromHistory) {
    navHomeFromHistory.addEventListener("click", () => showScreen("screen5"));
  }

  const navMatchesFromHistory = document.getElementById("navMatchesFromHistory");
  if (navMatchesFromHistory) {
    navMatchesFromHistory.addEventListener("click", () => {
      renderMatchHistoryScreen();
    });
  }

  const centerPlusBtnHistory = document.getElementById("centerPlusBtnHistory");
  if (centerPlusBtnHistory) {
    centerPlusBtnHistory.addEventListener("click", () => {
      openStartMatchSetup();
    });
  }

  // Connect Past Matches Tab in Screen 5 to History Modal
  const pastMatchesCards = document.querySelectorAll("#pastMatchesContainer .view-scorecard-btn");
  if (pastMatchesCards && pastMatchesCards.length > 0) {
    pastMatchesCards.forEach((btn, idx) => {
      btn.addEventListener("click", () => {
        const history = getMatchHistoryList();
        if (history[idx]) {
          openHistoryMatchDetailsModal(history[idx]);
        } else if (history.length > 0) {
          openHistoryMatchDetailsModal(history[0]);
        } else {
          renderMatchHistoryScreen();
          showScreen("screen9");
        }
      });
    });
  }

  // ==========================================
  // PLAYER STATISTICS & LEADERBOARDS MODULE (SCREEN 10)
  // ==========================================

  let activeStatsScope = "all"; // 'all', 'recent'
  let activeStatsTournament = "all"; // 'all' or specific tournament
  let activeStatsCategory = "rankings"; // 'rankings', 'batting', 'bowling', 'fielding', 'directory'
  let activeStatsSort = "default";
  let statsSearchQuery = "";
  let activePlayerDetailTab = "overview";
  let currentViewingPlayer = null;

  // Helper to extract initials
  function getPlayerInitials(name) {
    if (!name) return "P";
    const parts = name.trim().split(" ");
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // Calculate comprehensive player statistics across match history & squad
  function calculateAllPlayerStats(scope = activeStatsScope, tourneyFilter = activeStatsTournament) {
    const rawMatches = getMatchHistoryList();
    let matches = [...rawMatches];

    // Filter by Tournament if requested
    if (tourneyFilter && tourneyFilter !== "all") {
      matches = matches.filter(m => (m.tournament || "").toLowerCase().trim() === tourneyFilter.toLowerCase().trim());
    }

    // Filter by Scope (Recent = last 5 matches)
    if (scope === "recent") {
      matches = matches.slice(0, 5);
    }

    const playerMap = new Map();

    // Helper to get or create player entry
    function getOrCreatePlayer(name, teamName = "Yuva XI") {
      if (!name || typeof name !== "string") return null;
      const cleanName = name.trim();
      if (!cleanName) return null;

      const normKey = cleanName.toLowerCase();
      if (!playerMap.has(normKey)) {
        // Resolve stable playerId across team and directory
        let resolvedId = null;
        let pRole = "Batter";
        let pPhoto = "";
        let pJersey = "#" + (Math.floor(Math.random() * 88) + 10);
        let pBatStyle = "Right-hand Bat";
        let pBowlStyle = "Right-arm Medium";

        const team = (typeof getTeamData === "function") ? getTeamData() : null;
        if (team && Array.isArray(team.players)) {
          const tp = team.players.find(p => (p.name || "").toLowerCase().trim() === normKey);
          if (tp) {
            resolvedId = tp.id;
            if (tp.role) pRole = tp.role;
            if (tp.photo) pPhoto = tp.photo;
            if (tp.jersey) pJersey = `#${tp.jersey}`;
            if (tp.batStyle) pBatStyle = tp.batStyle;
            if (tp.bowlStyle) pBowlStyle = tp.bowlStyle;
          }
        }
        if (!resolvedId && typeof getMasterPlayersDirectory === "function") {
          const mp = getMasterPlayersDirectory().find(p => (p.name || "").toLowerCase().trim() === normKey);
          if (mp) {
            resolvedId = mp.id;
            if (mp.role) pRole = mp.role;
            if (mp.avatar) pPhoto = mp.avatar;
            if (mp.jersey) pJersey = `#${mp.jersey}`;
          }
        }
        if (!resolvedId) {
          resolvedId = `CY2026-${cleanName.replace(/\s+/g, "").toUpperCase().slice(0, 4)}-${Math.abs(normKey.split("").reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0) % 9000 + 1000)}`;
        }

        playerMap.set(normKey, {
          id: resolvedId,
          playerId: resolvedId,
          name: cleanName,
          team: teamName || "Team",
          role: pRole,
          jersey: pJersey,
          battingStyle: pBatStyle,
          bowlingStyle: pBowlStyle,
          photo: pPhoto,

          // Batting Metrics
          matchIds: new Set(),
          innings: 0,
          runs: 0,
          balls: 0,
          fours: 0,
          sixes: 0,
          highestScore: 0,
          isHighestScoreNotOut: false,
          dismissals: 0,
          notOuts: 0,
          ducks: 0,
          fifties: 0,
          hundreds: 0,

          // Bowling Metrics
          matchesBowledIds: new Set(),
          ballsBowled: 0,
          maidens: 0,
          runsConceded: 0,
          wickets: 0,
          bestBowlingWkts: 0,
          bestBowlingRuns: 999,
          threeWkts: 0,
          fiveWkts: 0,

          // Fielding Metrics
          catches: 0,
          runOuts: 0,
          stumpings: 0,

          // Awards & Match Logs
          potmCount: 0,
          bestBatterCount: 0,
          bestBowlerCount: 0,
          matchLogs: []
        });
      }

      const p = playerMap.get(normKey);
      if (teamName && (p.team === "Yuva XI" || p.team === "Team")) {
        p.team = teamName;
      }
      return p;
    }

    // Seed squad players from My Team so all roster members appear in directory
    try {
      const myTeam = getMyTeamData();
      if (myTeam && myTeam.players) {
        myTeam.players.forEach(sp => {
          const entry = getOrCreatePlayer(sp.name, myTeam.teamName || "Unassigned Team");
          if (entry) {
            entry.role = sp.role || entry.role;
            entry.jersey = sp.jersey ? `#${sp.jersey}` : entry.jersey;
            entry.battingStyle = sp.battingStyle || entry.battingStyle;
            entry.bowlingStyle = sp.bowlingStyle || entry.bowlingStyle;
            if (sp.photo) entry.photo = sp.photo;
          }
        });
      }
    } catch (e) {
      console.warn("Could not read squad players:", e);
    }

    // Process every completed match in the filtered list
    matches.forEach(match => {
      const mId = match.matchId || `m_${Math.random()}`;
      const tA = match.teamA?.name || "Team A";
      const tB = match.teamB?.name || "Team B";
      const tourneyName = match.tournament || "Cric Yuva Trophy";
      const matchDate = match.matchDate || match.date || "Recent Match";
      const ground = match.ground || "Yuva Stadium";
      const resultText = match.result || "Match Concluded";

      const awards = calculateMatchAwards(match);

      // Track individual player performance in this specific match
      const currentMatchPerfs = new Map();

      function getMatchPerf(playerName, playerTeam) {
        const pObj = getOrCreatePlayer(playerName, playerTeam);
        if (!pObj) return null;
        const normKey = playerName.toLowerCase().trim();
        if (!currentMatchPerfs.has(normKey)) {
          currentMatchPerfs.set(normKey, {
            player: pObj,
            batting: null,
            bowling: null,
            catches: 0,
            runOuts: 0,
            stumpings: 0
          });
        }
        return currentMatchPerfs.get(normKey);
      }

      // Process Innings 1 and Innings 2
      const inningsList = [
        { inn: match.innings1, batTeam: match.innings1?.battingTeam || tA, bowlTeam: match.innings1?.bowlingTeam || tB },
        { inn: match.innings2, batTeam: match.innings2?.battingTeam || tB, bowlTeam: match.innings2?.bowlingTeam || tA }
      ];

      inningsList.forEach(({ inn, batTeam, bowlTeam }) => {
        if (!inn) return;

        // Process Batters
        (inn.batting || []).forEach(b => {
          if (!b.name) return;
          const p = getOrCreatePlayer(b.name, batTeam);
          if (!p) return;

          p.matchIds.add(mId);
          p.innings += 1;

          const bRuns = Number(b.runs) || 0;
          const bBalls = Number(b.balls) || 0;
          const bFours = Number(b.fours) || 0;
          const bSixes = Number(b.sixes) || 0;

          p.runs += bRuns;
          p.balls += bBalls;
          p.fours += bFours;
          p.sixes += bSixes;

          if (b.isOut) {
            p.dismissals += 1;
            if (bRuns === 0) p.ducks += 1;
          } else {
            p.notOuts += 1;
          }

          if (bRuns >= 100) p.hundreds += 1;
          else if (bRuns >= 50) p.fifties += 1;

          if (bRuns > p.highestScore || (bRuns === p.highestScore && !b.isOut)) {
            p.highestScore = bRuns;
            p.isHighestScoreNotOut = !b.isOut;
          }

          const mPerf = getMatchPerf(b.name, batTeam);
          if (mPerf) {
            mPerf.batting = {
              runs: bRuns,
              balls: bBalls,
              fours: bFours,
              sixes: bSixes,
              isOut: !!b.isOut,
              dismissal: b.dismissal || (b.isOut ? "Out" : "not out *"),
              sr: bBalls > 0 ? ((bRuns / bBalls) * 100).toFixed(1) : "0.0"
            };
          }

          // Parse dismissal text for fielding credits
          if (b.isOut && b.dismissal) {
            const dis = b.dismissal.toLowerCase();
            if (dis.includes("c & b ") || dis.includes("c&b ")) {
              const bowlerName = b.dismissal.replace(/c\s*&\s*b\s*/i, "").trim();
              if (bowlerName) {
                const fP = getOrCreatePlayer(bowlerName, bowlTeam);
                if (fP) {
                  fP.catches += 1;
                  fP.matchIds.add(mId);
                  const fPerf = getMatchPerf(bowlerName, bowlTeam);
                  if (fPerf) fPerf.catches += 1;
                }
              }
            } else if (dis.startsWith("c ") && dis.includes(" b ")) {
              const parts = b.dismissal.split(/\s+b\s+/i);
              const catcherName = parts[0].replace(/^c\s+/i, "").replace(/^sub\s*\(/i, "").replace(/\)$/, "").trim();
              if (catcherName && !catcherName.toLowerCase().includes("sub")) {
                const fP = getOrCreatePlayer(catcherName, bowlTeam);
                if (fP) {
                  fP.catches += 1;
                  fP.matchIds.add(mId);
                  const fPerf = getMatchPerf(catcherName, bowlTeam);
                  if (fPerf) fPerf.catches += 1;
                }
              }
            } else if (dis.startsWith("st ") && dis.includes(" b ")) {
              const parts = b.dismissal.split(/\s+b\s+/i);
              const keeperName = parts[0].replace(/^st\s+/i, "").trim();
              if (keeperName) {
                const fP = getOrCreatePlayer(keeperName, bowlTeam);
                if (fP) {
                  fP.stumpings += 1;
                  fP.matchIds.add(mId);
                  const fPerf = getMatchPerf(keeperName, bowlTeam);
                  if (fPerf) fPerf.stumpings += 1;
                }
              }
            } else if (dis.includes("run out")) {
              const matchFielder = b.dismissal.match(/\(([^)]+)\)/);
              if (matchFielder && matchFielder[1]) {
                const fielderNames = matchFielder[1].split("/");
                fielderNames.forEach(fn => {
                  const cleanFn = fn.trim();
                  if (cleanFn) {
                    const fP = getOrCreatePlayer(cleanFn, bowlTeam);
                    if (fP) {
                      fP.runOuts += 1;
                      fP.matchIds.add(mId);
                      const fPerf = getMatchPerf(cleanFn, bowlTeam);
                      if (fPerf) fPerf.runOuts += 1;
                    }
                  }
                });
              }
            }
          }
        });

        // Process Bowlers
        (inn.bowling || []).forEach(bw => {
          if (!bw.name) return;
          const p = getOrCreatePlayer(bw.name, bowlTeam);
          if (!p) return;

          p.matchIds.add(mId);
          p.matchesBowledIds.add(mId);

          const bwOvers = Number(bw.overs) || 0;
          const bwBalls = Number(bw.balls) || 0;
          const totalBalls = (bwOvers * 6) + bwBalls;
          const bwRuns = Number(bw.runs) || 0;
          const bwWkts = Number(bw.wickets) || 0;
          const bwMaidens = Number(bw.maidens) || 0;

          p.ballsBowled += totalBalls;
          p.maidens += bwMaidens;
          p.runsConceded += bwRuns;
          p.wickets += bwWkts;

          if (bwWkts >= 5) p.fiveWkts += 1;
          else if (bwWkts >= 3) p.threeWkts += 1;

          // Check best bowling figures
          if (bwWkts > p.bestBowlingWkts || (bwWkts === p.bestBowlingWkts && bwRuns < p.bestBowlingRuns && bwWkts > 0)) {
            p.bestBowlingWkts = bwWkts;
            p.bestBowlingRuns = bwRuns;
          }

          const mPerf = getMatchPerf(bw.name, bowlTeam);
          if (mPerf) {
            mPerf.bowling = {
              overs: `${bwOvers}.${bwBalls}`,
              maidens: bwMaidens,
              runs: bwRuns,
              wickets: bwWkts,
              econ: totalBalls > 0 ? ((bwRuns / totalBalls) * 6).toFixed(2) : "0.00"
            };
          }
        });
      });

      // Award tracking
      if (awards) {
        if (awards.potm?.name) {
          const p = getOrCreatePlayer(awards.potm.name, awards.potm.team);
          if (p) p.potmCount += 1;
        }
        if (awards.bestBatter?.name) {
          const p = getOrCreatePlayer(awards.bestBatter.name, awards.bestBatter.team);
          if (p) p.bestBatterCount += 1;
        }
        if (awards.bestBowler?.name) {
          const p = getOrCreatePlayer(awards.bestBowler.name, awards.bestBowler.team);
          if (p) p.bestBowlerCount += 1;
        }
      }

      // Compile match snapshot log for each participating player
      currentMatchPerfs.forEach((perf, key) => {
        const pObj = perf.player;
        const isPotm = awards?.potm?.name && awards.potm.name.toLowerCase().trim() === pObj.name.toLowerCase().trim();
        const isBestBatter = awards?.bestBatter?.name && awards.bestBatter.name.toLowerCase().trim() === pObj.name.toLowerCase().trim();
        const isBestBowler = awards?.bestBowler?.name && awards.bestBowler.name.toLowerCase().trim() === pObj.name.toLowerCase().trim();

        pObj.matchLogs.unshift({
          matchId: mId,
          tournament: tourneyName,
          ground: ground,
          date: matchDate,
          teams: `${tA} vs ${tB}`,
          result: resultText,
          batting: perf.batting,
          bowling: perf.bowling,
          fielding: {
            catches: perf.catches,
            runOuts: perf.runOuts,
            stumpings: perf.stumpings
          },
          isPotm: !!isPotm,
          isBestBatter: !!isBestBatter,
          isBestBowler: !!isBestBowler
        });
      });
    });

    // Compute derived rates for all players
    const results = [];
    playerMap.forEach(p => {
      const matchesPlayed = p.matchIds.size;
      const matchesBowled = p.matchesBowledIds.size;

      // Batting calculations
      const batAvg = p.dismissals > 0 
        ? (p.runs / p.dismissals).toFixed(2) 
        : (p.runs > 0 ? `${p.runs.toFixed(2)}*` : "0.00");
      const batAvgNum = p.dismissals > 0 ? (p.runs / p.dismissals) : p.runs;
      const strikeRate = p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(2) : "0.00";
      const strikeRateNum = p.balls > 0 ? (p.runs / p.balls) * 100 : 0;
      const hsDisplay = p.highestScore > 0 ? `${p.highestScore}${p.isHighestScoreNotOut ? '*' : ''}` : "0";
      const boundaryPct = p.runs > 0 ? (((p.fours * 4 + p.sixes * 6) / p.runs) * 100).toFixed(1) + "%" : "0%";

      // Bowling calculations
      const oversInt = Math.floor(p.ballsBowled / 6);
      const oversRem = p.ballsBowled % 6;
      const oversDisplay = `${oversInt}.${oversRem}`;
      const economy = p.ballsBowled > 0 ? ((p.runsConceded / p.ballsBowled) * 6).toFixed(2) : "0.00";
      const economyNum = p.ballsBowled > 0 ? (p.runsConceded / p.ballsBowled) * 6 : 999;
      const bowlAvg = p.wickets > 0 ? (p.runsConceded / p.wickets).toFixed(2) : (p.runsConceded > 0 ? "—" : "0.00");
      const bowlAvgNum = p.wickets > 0 ? (p.runsConceded / p.wickets) : 999;
      const bbiDisplay = p.bestBowlingWkts > 0 ? `${p.bestBowlingWkts}/${p.bestBowlingRuns}` : "-";

      // Fielding totals
      const totalDismissals = p.catches + p.runOuts + p.stumpings;

      // Auto-assign role if default
      if (p.role === "Batter" || !p.role) {
        if (p.wickets >= 3 && p.runs >= 30) p.role = "All-Rounder";
        else if (p.wickets >= 3) p.role = "Bowler";
        else if (p.stumpings >= 1) p.role = "Wicket Keeper";
        else p.role = "Batsman";
      }

      results.push({
        ...p,
        matchesPlayed,
        matchesBowled,
        batAvg,
        batAvgNum,
        strikeRate,
        strikeRateNum,
        hsDisplay,
        boundaryPct,
        oversDisplay,
        economy,
        economyNum,
        bowlAvg,
        bowlAvgNum,
        bbiDisplay,
        totalDismissals
      });
    });

    return results;
  }

  // Populate Tournament Select Dropdown
  function populateStatsTournamentsDropdown() {
    const select = document.getElementById("statsTournamentSelect");
    if (!select) return;

    const history = getMatchHistoryList();
    const tourneys = new Set();
    history.forEach(m => {
      if (m.tournament && m.tournament.trim()) {
        tourneys.add(m.tournament.trim());
      }
    });

    const currentVal = select.value || "all";
    let html = `<option value="all" ${currentVal === "all" ? "selected" : ""}>All Tournaments</option>`;
    tourneys.forEach(t => {
      html += `<option value="${t}" ${currentVal === t ? "selected" : ""}>${t}</option>`;
    });

    select.innerHTML = html;
  }

  // Populate dynamic sort dropdown options based on active category
  function updateStatsSortOptions() {
    const sortSelect = document.getElementById("statsSortSelect");
    if (!sortSelect) return;

    let options = [];
    if (activeStatsCategory === "rankings") {
      options = [
        { val: "default", label: "Overview Rankings" },
        { val: "runs", label: "Most Runs" },
        { val: "wickets", label: "Most Wickets" },
        { val: "sixes", label: "Most Sixes" }
      ];
    } else if (activeStatsCategory === "batting") {
      options = [
        { val: "runs", label: "Total Runs (High to Low)" },
        { val: "avg", label: "Batting Average" },
        { val: "sr", label: "Strike Rate" },
        { val: "hs", label: "Highest Score" },
        { val: "sixes", label: "Most 6s" },
        { val: "fours", label: "Most 4s" },
        { val: "inns", label: "Innings Played" }
      ];
    } else if (activeStatsCategory === "bowling") {
      options = [
        { val: "wickets", label: "Most Wickets (High to Low)" },
        { val: "economy", label: "Best Economy (Low to High)" },
        { val: "avg", label: "Best Bowling Avg" },
        { val: "overs", label: "Overs Bowled" },
        { val: "maidens", label: "Most Maidens" }
      ];
    } else if (activeStatsCategory === "fielding") {
      options = [
        { val: "total", label: "Total Dismissals" },
        { val: "catches", label: "Most Catches" },
        { val: "runOuts", label: "Most Run Outs" },
        { val: "stumpings", label: "Most Stumpings" }
      ];
    } else {
      options = [
        { val: "name", label: "Player Name (A-Z)" },
        { val: "runs", label: "Most Runs" },
        { val: "wickets", label: "Most Wickets" },
        { val: "matches", label: "Matches Played" }
      ];
    }

    sortSelect.innerHTML = options.map(o => `
      <option value="${o.val}" ${activeStatsSort === o.val ? "selected" : ""}>${o.label}</option>
    `).join("");
  }

  // Render Podium Layout for Top 3 Players
  function renderPodiumHtml(top3Players, isBowling = false) {
    if (!top3Players || top3Players.length === 0) {
      return `<div style="grid-column:1/-1;text-align:center;color:#64748b;font-size:12px;padding:12px;">No leaderboard players recorded yet.</div>`;
    }

    const first = top3Players[0];
    const second = top3Players[1] || null;
    const third = top3Players[2] || null;

    function renderCard(p, rank, badgeClass, crownIcon) {
      if (!p) {
        return `
          <div class="podium-card" style="opacity:0.4;">
            <span class="podium-rank-badge ${badgeClass}">#${rank}</span>
            <div class="podium-avatar-wrapper"><div class="podium-avatar">-</div></div>
            <div class="podium-player-name">--</div>
            <div class="podium-metric-box"><span class="podium-metric-val">--</span></div>
          </div>
        `;
      }

      const inits = getPlayerInitials(p.name);
      const metricVal = isBowling 
        ? `${p.wickets} <small style="font-size:10px;">wkts</small>` 
        : `${p.runs} <small style="font-size:10px;">runs</small>`;
      const subMetric = isBowling 
        ? `Econ: ${p.economy}` 
        : `SR: ${p.strikeRate}`;

      const pIdentifier = p.id || p.playerId || p.name;
      return `
        <div class="podium-card ${rank === 1 ? 'podium-rank-1' : ''}" data-player-id="${p.id || p.playerId || ''}" data-player-name="${p.name.replace(/'/g, "\\'")}" onclick="openPlayerProfileDetailModal('${pIdentifier.replace(/'/g, "\\'")}')" style="cursor:pointer;" title="Click to view Rank ${rank} ${p.name}'s profile">
          <span class="podium-rank-badge ${badgeClass}">#${rank}</span>
          <div class="podium-avatar-wrapper">
            <div class="podium-avatar">${inits}</div>
            ${crownIcon ? `<span class="podium-cap-crown">${crownIcon}</span>` : ''}
          </div>
          <div class="podium-player-name" title="${p.name}">${p.name}</div>
          <div class="podium-player-team">${p.team}</div>
          <div class="podium-metric-box">
            <div class="podium-metric-val ${isBowling ? 'purple-metric-val' : ''}">${metricVal}</div>
            <span class="podium-metric-sub">${subMetric}</span>
          </div>
        </div>
      `;
    }

    // Render Order: #2 on left, #1 in center, #3 on right
    let html = "";
    html += renderCard(second, 2, "badge-silver", "");
    html += renderCard(first, 1, "badge-gold", isBowling ? "⚡" : "👑");
    html += renderCard(third, 3, "badge-bronze", "");

    return html;
  }

  // Render Mini List for Ranks 4 to 10
  function renderMiniListHtml(rankedList, isBowling = false) {
    if (!rankedList || rankedList.length <= 3) {
      return "";
    }

    const subList = rankedList.slice(3, 10);
    return subList.map((p, idx) => {
      const rank = idx + 4;
      const inits = getPlayerInitials(p.name);
      const mainVal = isBowling ? `${p.wickets} Wkts` : `${p.runs} Runs`;
      const subVal = isBowling ? `Econ: ${p.economy} • BBI: ${p.bbiDisplay}` : `Avg: ${p.batAvg} • SR: ${p.strikeRate}`;

      const currUser = (localStorage.getItem("cricYuvaProfileName") || "").toLowerCase().trim();
      const isMe = currUser && p.name.toLowerCase().trim() === currUser;
      return `
        <div class="ranking-row-item ${isMe ? 'user-highlight-row' : ''}" onclick="openPlayerStatsModal('${p.name.replace(/'/g, "\\'")}')">
          <div class="rank-item-left">
            <span class="rank-number-chip">#${rank}</span>
            <div class="rank-player-avatar">${inits}</div>
            <div class="rank-player-meta">
              <div class="rank-player-name">${p.name}</div>
              <div class="rank-player-team-role">${p.team} • ${p.role}</div>
            </div>
          </div>
          <div class="rank-item-right">
            <div class="rank-main-val ${isBowling ? 'purple-text' : 'text-orange'}">${mainVal}</div>
            <div class="rank-sub-val">${subVal}</div>
          </div>
        </div>
      `;
    }).join("");
  }

  // Render Specialized Ranking list (Sixes, Fours, Avg, Economy)
  function renderSpecialListHtml(list, metricKey, isAsc = false, suffix = "") {
    if (!list || list.length === 0) {
      return `<div style="text-align:center;color:#64748b;font-size:11px;padding:6px;">No data</div>`;
    }

    return list.slice(0, 4).map((p, idx) => `
      <div class="special-list-row" onclick="openPlayerStatsModal('${p.name.replace(/'/g, "\\'")}')">
        <div class="special-player-info">
          <span class="special-rank-num">#${idx + 1}</span>
          <span class="special-player-text" title="${p.name}">${p.name}</span>
        </div>
        <span class="special-val-badge">${p[metricKey]}${suffix}</span>
      </div>
    `).join("");
  }

  // Render Pane 1: Rankings & Leaderboards
  function renderStatsRankingsPane(players) {
    const batPodium = document.getElementById("battingPodiumContainer");
    const batList = document.getElementById("battingRankingsList");
    const bowlPodium = document.getElementById("bowlingPodiumContainer");
    const bowlList = document.getElementById("bowlingRankingsList");

    const sixesListEl = document.getElementById("mostSixesList");
    const foursListEl = document.getElementById("mostFoursList");
    const avgListEl = document.getElementById("bestAvgList");
    const econListEl = document.getElementById("bestEconList");

    // 1. Top Run Scorers (Orange Cap)
    const runScorers = [...players].sort((a, b) => b.runs - a.runs || b.strikeRateNum - a.strikeRateNum);
    if (batPodium) batPodium.innerHTML = renderPodiumHtml(runScorers.slice(0, 3), false);
    if (batList) batList.innerHTML = renderMiniListHtml(runScorers, false);

    // 2. Top Wicket Takers (Purple Cap)
    const wicketTakers = [...players].sort((a, b) => b.wickets - a.wickets || a.economyNum - b.economyNum);
    if (bowlPodium) bowlPodium.innerHTML = renderPodiumHtml(wicketTakers.slice(0, 3), true);
    if (bowlList) bowlList.innerHTML = renderMiniListHtml(wicketTakers, true);

    // 3. Most Sixes
    const sixHitters = [...players].filter(p => p.sixes > 0).sort((a, b) => b.sixes - a.sixes || b.runs - a.runs);
    if (sixesListEl) sixesListEl.innerHTML = renderSpecialListHtml(sixHitters, "sixes", false, " 6s");

    // 4. Most Fours
    const fourHitters = [...players].filter(p => p.fours > 0).sort((a, b) => b.fours - a.fours || b.runs - a.runs);
    if (foursListEl) foursListEl.innerHTML = renderSpecialListHtml(fourHitters, "fours", false, " 4s");

    // 5. Best Batting Average (Min 1 innings)
    const bestAvg = [...players].filter(p => p.innings > 0).sort((a, b) => b.batAvgNum - a.batAvgNum || b.runs - a.runs);
    if (avgListEl) avgListEl.innerHTML = renderSpecialListHtml(bestAvg, "batAvg", false, "");

    // 6. Best Economy (Min 1 over bowled)
    const bestEcon = [...players].filter(p => p.ballsBowled >= 6).sort((a, b) => a.economyNum - b.economyNum || b.wickets - a.wickets);
    if (econListEl) econListEl.innerHTML = renderSpecialListHtml(bestEcon, "economy", true, "");
  }

  // Render Pane 2: Full Batting Stats Table
  function renderStatsBattingPane(players) {
    const tableBody = document.getElementById("battingTableBody");
    const countEl = document.getElementById("battingPlayersCount");
    if (!tableBody) return;

    let sorted = [...players];
    if (activeStatsSort === "avg") sorted.sort((a, b) => b.batAvgNum - a.batAvgNum);
    else if (activeStatsSort === "sr") sorted.sort((a, b) => b.strikeRateNum - a.strikeRateNum);
    else if (activeStatsSort === "hs") sorted.sort((a, b) => b.highestScore - a.highestScore);
    else if (activeStatsSort === "sixes") sorted.sort((a, b) => b.sixes - a.sixes);
    else if (activeStatsSort === "fours") sorted.sort((a, b) => b.fours - a.fours);
    else if (activeStatsSort === "inns") sorted.sort((a, b) => b.innings - a.innings);
    else sorted.sort((a, b) => b.runs - a.runs || b.strikeRateNum - a.strikeRateNum);

    if (countEl) countEl.textContent = `${sorted.length} Players`;

    if (sorted.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:24px;color:#64748b;">No batting statistics found.</td></tr>`;
      return;
    }

    const currUserBat = (localStorage.getItem("cricYuvaProfileName") || "").toLowerCase().trim();
    tableBody.innerHTML = sorted.map(p => {
      const isMe = currUserBat && p.name.toLowerCase().trim() === currUserBat;
      return `
      <tr class="${isMe ? 'user-highlight-row' : ''}" onclick="openPlayerStatsModal('${p.name.replace(/'/g, "\\'")}')">
        <td class="sticky-col">
          <div class="table-player-cell">
            <div class="table-player-avatar">${getPlayerInitials(p.name)}</div>
            <span class="table-player-name">${p.name}</span>
          </div>
        </td>
        <td style="text-align:left;color:#94a3b8;">${p.team}</td>
        <td>${p.matchesPlayed}</td>
        <td>${p.innings}</td>
        <td><strong class="text-orange" style="font-size:13px;">${p.runs}</strong></td>
        <td>${p.hsDisplay}</td>
        <td>${p.balls}</td>
        <td>${p.fours}</td>
        <td>${p.sixes}</td>
        <td>${p.batAvg}</td>
        <td>${p.strikeRate}</td>
        <td style="color:${p.ducks > 0 ? '#ef4444' : '#94a3b8'};">${p.ducks}</td>
      </tr>
    `}).join("");
  }

  // Render Pane 3: Full Bowling Stats Table
  function renderStatsBowlingPane(players) {
    const tableBody = document.getElementById("bowlingTableBody");
    const countEl = document.getElementById("bowlingPlayersCount");
    if (!tableBody) return;

    let sorted = [...players];
    if (activeStatsSort === "economy") sorted.sort((a, b) => a.economyNum - b.economyNum);
    else if (activeStatsSort === "avg") sorted.sort((a, b) => a.bowlAvgNum - b.bowlAvgNum);
    else if (activeStatsSort === "overs") sorted.sort((a, b) => b.ballsBowled - a.ballsBowled);
    else if (activeStatsSort === "maidens") sorted.sort((a, b) => b.maidens - a.maidens);
    else sorted.sort((a, b) => b.wickets - a.wickets || a.economyNum - b.economyNum);

    if (countEl) countEl.textContent = `${sorted.length} Players`;

    if (sorted.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:#64748b;">No bowling statistics found.</td></tr>`;
      return;
    }

    tableBody.innerHTML = sorted.map(p => `
      <tr onclick="openPlayerStatsModal('${p.name.replace(/'/g, "\\'")}')">
        <td class="sticky-col">
          <div class="table-player-cell">
            <div class="table-player-avatar">${getPlayerInitials(p.name)}</div>
            <span class="table-player-name">${p.name}</span>
          </div>
        </td>
        <td style="text-align:left;color:#94a3b8;">${p.team}</td>
        <td>${p.matchesPlayed}</td>
        <td>${p.oversDisplay}</td>
        <td>${p.maidens}</td>
        <td>${p.runsConceded}</td>
        <td><strong class="purple-text" style="font-size:13px;">${p.wickets}</strong></td>
        <td>${p.bbiDisplay}</td>
        <td>${p.economy}</td>
        <td>${p.bowlAvg}</td>
      </tr>
    `).join("");
  }

  // Render Pane 4: Full Fielding Stats Table
  function renderStatsFieldingPane(players) {
    const tableBody = document.getElementById("fieldingTableBody");
    const countEl = document.getElementById("fieldingPlayersCount");
    if (!tableBody) return;

    let sorted = [...players];
    if (activeStatsSort === "catches") sorted.sort((a, b) => b.catches - a.catches);
    else if (activeStatsSort === "runOuts") sorted.sort((a, b) => b.runOuts - a.runOuts);
    else if (activeStatsSort === "stumpings") sorted.sort((a, b) => b.stumpings - a.stumpings);
    else sorted.sort((a, b) => b.totalDismissals - a.totalDismissals);

    if (countEl) countEl.textContent = `${sorted.length} Players`;

    if (sorted.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#64748b;">No fielding statistics found.</td></tr>`;
      return;
    }

    tableBody.innerHTML = sorted.map(p => `
      <tr onclick="openPlayerStatsModal('${p.name.replace(/'/g, "\\'")}')">
        <td class="sticky-col">
          <div class="table-player-cell">
            <div class="table-player-avatar">${getPlayerInitials(p.name)}</div>
            <span class="table-player-name">${p.name}</span>
          </div>
        </td>
        <td style="text-align:left;color:#94a3b8;">${p.team}</td>
        <td>${p.matchesPlayed}</td>
        <td>${p.catches}</td>
        <td>${p.runOuts}</td>
        <td>${p.stumpings}</td>
        <td><strong class="text-orange">${p.totalDismissals}</strong></td>
      </tr>
    `).join("");
  }

  // Render Pane 5: Players Directory Grid
  function renderStatsDirectoryPane(players) {
    const grid = document.getElementById("playersDirectoryGrid");
    if (!grid) return;

    let sorted = [...players];
    if (activeStatsSort === "runs") sorted.sort((a, b) => b.runs - a.runs);
    else if (activeStatsSort === "wickets") sorted.sort((a, b) => b.wickets - a.wickets);
    else if (activeStatsSort === "matches") sorted.sort((a, b) => b.matchesPlayed - a.matchesPlayed);
    else sorted.sort((a, b) => a.name.localeCompare(b.name));

    if (sorted.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#64748b;padding:30px;">No players found in directory.</div>`;
      return;
    }

    grid.innerHTML = sorted.map(p => `
      <div class="player-dir-card" onclick="openPlayerStatsModal('${p.name.replace(/'/g, "\\'")}')">
        <div class="player-dir-top">
          <div class="player-dir-avatar">${getPlayerInitials(p.name)}</div>
          <div class="player-dir-info">
            <div class="player-dir-name" title="${p.name}">${p.name}</div>
            <div class="player-dir-role">${p.role}</div>
            <div class="player-dir-team">${p.team}</div>
          </div>
        </div>
        <div class="player-dir-stats-pills">
          <div class="dir-pill-item">
            <span class="dir-pill-lbl">Runs</span>
            <span class="dir-pill-val text-orange">${p.runs}</span>
          </div>
          <div class="dir-pill-item">
            <span class="dir-pill-lbl">Wkts</span>
            <span class="dir-pill-val purple-text">${p.wickets}</span>
          </div>
        </div>
      </div>
    `).join("");
  }

  // ==========================================
  // DYNAMIC "MY RANK" LEADERBOARD CARD
  // ==========================================
  function renderUserMyRankCard(allPlayers, currentCategory) {
    const cardEl = document.getElementById("myRankCard");
    if (!cardEl) return;

    const userName = (localStorage.getItem("cricYuvaProfileName") || "Player").trim();
    const userPhoto = localStorage.getItem("cricYuvaProfilePhoto");
    let userTeam = "No Team";
    try {
      const savedTeam = JSON.parse(localStorage.getItem("cricYuvaTeamData") || "null");
      if (savedTeam && savedTeam.name) userTeam = savedTeam.name;
    } catch (e) {}

    const avatarEl = document.getElementById("myRankAvatar");
    const nameEl = document.getElementById("myRankUserName");
    const teamEl = document.getElementById("myRankTeamName");
    const numEl = document.getElementById("myRankNumber");
    const valBadgeEl = document.getElementById("myRankStatValue");
    const catLabelEl = document.getElementById("myRankCategoryLabel");
    const crownBadgeEl = document.getElementById("myRankCrownBadge");

    if (nameEl) nameEl.textContent = userName;
    if (teamEl) teamEl.textContent = userTeam;

    if (avatarEl) {
      if (userPhoto && userPhoto.startsWith("data:image")) {
        avatarEl.innerHTML = `<img src="${userPhoto}" alt="${userName}">`;
      } else {
        avatarEl.innerHTML = `<span id="myRankAvatarInitial">${getPlayerInitials(userName)}</span>`;
      }
    }

    let userStats = allPlayers.find(p => p.name.toLowerCase().trim() === userName.toLowerCase().trim());
    if (!userStats) {
      userStats = {
        name: userName,
        team: userTeam,
        runs: 0,
        wickets: 0,
        catches: 0,
        strikeRateNum: 0,
        economyNum: 0,
        batAvgNum: 0
      };
    }

    let rank = 1;
    let statDisplay = "";
    let categoryDisplay = (currentCategory || "rankings").toUpperCase();

    if (currentCategory === "batting") {
      const sorted = [...allPlayers].sort((a, b) => (b.runs || 0) - (a.runs || 0) || (b.strikeRateNum || 0) - (a.strikeRateNum || 0));
      const idx = sorted.findIndex(p => p.name.toLowerCase().trim() === userName.toLowerCase().trim());
      rank = idx >= 0 ? idx + 1 : sorted.length + 1;
      statDisplay = `${userStats.runs || 0} Runs`;
      categoryDisplay = "BATTING";
    } else if (currentCategory === "bowling") {
      const sorted = [...allPlayers].sort((a, b) => (b.wickets || 0) - (a.wickets || 0) || (a.economyNum || 0) - (b.economyNum || 0));
      const idx = sorted.findIndex(p => p.name.toLowerCase().trim() === userName.toLowerCase().trim());
      rank = idx >= 0 ? idx + 1 : sorted.length + 1;
      statDisplay = `${userStats.wickets || 0} Wkts`;
      categoryDisplay = "BOWLING";
    } else if (currentCategory === "fielding") {
      const sorted = [...allPlayers].sort((a, b) => (b.catches || 0) - (a.catches || 0));
      const idx = sorted.findIndex(p => p.name.toLowerCase().trim() === userName.toLowerCase().trim());
      rank = idx >= 0 ? idx + 1 : sorted.length + 1;
      statDisplay = `${userStats.catches || 0} Catches`;
      categoryDisplay = "FIELDING";
    } else {
      const sorted = [...allPlayers].sort((a, b) => {
        const scoreB = (b.runs || 0) + (b.wickets || 0) * 20;
        const scoreA = (a.runs || 0) + (a.wickets || 0) * 20;
        return scoreB - scoreA;
      });
      const idx = sorted.findIndex(p => p.name.toLowerCase().trim() === userName.toLowerCase().trim());
      rank = idx >= 0 ? idx + 1 : (sorted.length > 0 ? sorted.length + 1 : 1);
      const overallScore = (userStats.runs || 0) + (userStats.wickets || 0) * 20;
      statDisplay = `${overallScore} Pts`;
      categoryDisplay = "RANKINGS";
    }

    if (numEl) numEl.textContent = `#${rank}`;
    if (valBadgeEl) valBadgeEl.textContent = statDisplay;
    if (catLabelEl) catLabelEl.textContent = categoryDisplay;

    if (crownBadgeEl) {
      crownBadgeEl.classList.remove("gold", "silver", "bronze");
      if (rank === 1) {
        crownBadgeEl.style.display = "flex";
        crownBadgeEl.classList.add("gold");
        crownBadgeEl.innerHTML = '<i class="fa-solid fa-crown"></i>';
      } else if (rank === 2) {
        crownBadgeEl.style.display = "flex";
        crownBadgeEl.classList.add("silver");
        crownBadgeEl.innerHTML = '<i class="fa-solid fa-medal"></i>';
      } else if (rank === 3) {
        crownBadgeEl.style.display = "flex";
        crownBadgeEl.classList.add("bronze");
        crownBadgeEl.innerHTML = '<i class="fa-solid fa-award"></i>';
      } else {
        crownBadgeEl.style.display = "none";
      }
    }
  }

  // Master Render Function for Player Statistics Screen
  function renderPlayerStatsScreen() {
    populateStatsTournamentsDropdown();
    updateStatsSortOptions();

    const allPlayers = calculateAllPlayerStats(activeStatsScope, activeStatsTournament);
    renderUserMyRankCard(allPlayers, activeStatsCategory);

    // Apply Search Filter
    let filtered = allPlayers;
    if (statsSearchQuery) {
      const q = statsSearchQuery.toLowerCase();
      filtered = allPlayers.filter(p => p.name.toLowerCase().includes(q) || (p.team && p.team.toLowerCase().includes(q)));
    }

    // Toggle Panes
    const paneRankings = document.getElementById("statsPaneRankings");
    const paneBatting = document.getElementById("statsPaneBatting");
    const paneBowling = document.getElementById("statsPaneBowling");
    const paneFielding = document.getElementById("statsPaneFielding");
    const paneDirectory = document.getElementById("statsPaneDirectory");
    const emptyState = document.getElementById("statsEmptyState");

    [paneRankings, paneBatting, paneBowling, paneFielding, paneDirectory].forEach(el => {
      if (el) el.style.display = "none";
    });

    if (filtered.length === 0 && allPlayers.length > 0) {
      if (emptyState) emptyState.style.display = "block";
    } else {
      if (emptyState) emptyState.style.display = "none";

      if (activeStatsCategory === "rankings") {
        if (paneRankings) paneRankings.style.display = "block";
        renderStatsRankingsPane(filtered);
      } else if (activeStatsCategory === "batting") {
        if (paneBatting) paneBatting.style.display = "block";
        renderStatsBattingPane(filtered);
      } else if (activeStatsCategory === "bowling") {
        if (paneBowling) paneBowling.style.display = "block";
        renderStatsBowlingPane(filtered);
      } else if (activeStatsCategory === "fielding") {
        if (paneFielding) paneFielding.style.display = "block";
        renderStatsFieldingPane(filtered);
      } else if (activeStatsCategory === "directory") {
        if (paneDirectory) paneDirectory.style.display = "grid";
        renderStatsDirectoryPane(filtered);
      }
    }
  }

  // Open Complete Player Statistics Modal
  window.openPlayerStatsModal = function (playerNameOrObj) {
    let pName = typeof playerNameOrObj === "string" ? playerNameOrObj : playerNameOrObj?.name;
    if (!pName) return;

    const allStats = calculateAllPlayerStats("all", "all");
    let p = allStats.find(item => item.name.toLowerCase().trim() === pName.toLowerCase().trim());

    if (!p) {
      // Create ad-hoc profile
      p = {
        name: pName,
        team: "Yuva XI",
        role: "Player",
        jersey: "#18",
        battingStyle: "Right-hand Bat",
        bowlingStyle: "Right-arm Medium",
        matchesPlayed: 0,
        innings: 0,
        runs: 0,
        highestScore: 0,
        hsDisplay: "0",
        balls: 0,
        fours: 0,
        sixes: 0,
        batAvg: "0.00",
        strikeRate: "0.00",
        ducks: 0,
        fifties: 0,
        hundreds: 0,
        boundaryPct: "0%",
        matchesBowled: 0,
        oversDisplay: "0.0",
        maidens: 0,
        runsConceded: 0,
        wickets: 0,
        bbiDisplay: "-",
        economy: "0.00",
        bowlAvg: "0.00",
        catches: 0,
        runOuts: 0,
        stumpings: 0,
        totalDismissals: 0,
        matchLogs: []
      };
    }

    currentViewingPlayer = p;
    const modal = document.getElementById("playerStatsDetailModal");
    if (!modal) return;

    // Header & Hero
    const headerRole = document.getElementById("pStatsHeaderRole");
    const headerName = document.getElementById("pStatsHeaderName");
    const avatarEl = document.getElementById("pStatsAvatar");
    const jerseyEl = document.getElementById("pStatsJersey");
    const nameEl = document.getElementById("pStatsName");
    const teamEl = document.getElementById("pStatsTeam");
    const roleEl = document.getElementById("pStatsRole");
    const stylesEl = document.getElementById("pStatsStyles");

    if (headerRole) headerRole.textContent = p.role ? p.role.toUpperCase() : "PLAYER PROFILE";
    if (headerName) headerName.innerHTML = `<i class="fa-solid fa-id-card text-orange"></i> ${p.name}`;
    if (avatarEl) avatarEl.textContent = getPlayerInitials(p.name);
    if (jerseyEl) jerseyEl.textContent = p.jersey || "#18";
    if (nameEl) nameEl.textContent = p.name;
    if (teamEl) teamEl.textContent = p.team;
    if (roleEl) roleEl.textContent = p.role;
    if (stylesEl) stylesEl.textContent = `${p.battingStyle} • ${p.bowlingStyle}`;

    // Quick Metrics
    const qMat = document.getElementById("pStatsQuickMat");
    const qRuns = document.getElementById("pStatsQuickRuns");
    const qWkts = document.getElementById("pStatsQuickWkts");
    const qCatches = document.getElementById("pStatsQuickCatches");

    if (qMat) qMat.textContent = p.matchesPlayed;
    if (qRuns) qRuns.textContent = p.runs;
    if (qWkts) qWkts.textContent = p.wickets;
    if (qCatches) qCatches.textContent = p.catches;

    // 1. Batting Statistics Box
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt("pStatBatMat", p.matchesPlayed);
    setTxt("pStatBatInns", p.innings);
    setTxt("pStatBatRuns", p.runs);
    setTxt("pStatBatHS", p.hsDisplay);
    setTxt("pStatBatBF", p.balls);
    setTxt("pStatBat4s", p.fours);
    setTxt("pStatBat6s", p.sixes);
    setTxt("pStatBatAvg", p.batAvg);
    setTxt("pStatBatSR", p.strikeRate);
    setTxt("pStatBatDucks", p.ducks);
    setTxt("pStatBatMilestones", `${p.fifties} / ${p.hundreds}`);
    setTxt("pStatBatBoundaryPct", p.boundaryPct);

    // 2. Bowling Statistics Box
    setTxt("pStatBowlMat", p.matchesBowled);
    setTxt("pStatBowlOvers", p.oversDisplay);
    setTxt("pStatBowlMaidens", p.maidens);
    setTxt("pStatBowlRuns", p.runsConceded);
    setTxt("pStatBowlWkts", p.wickets);
    setTxt("pStatBowlBBI", p.bbiDisplay);
    setTxt("pStatBowlEcon", p.economy);
    setTxt("pStatBowlAvg", p.bowlAvg);

    // 3. Fielding Statistics Box
    setTxt("pStatFieldCatches", p.catches);
    setTxt("pStatFieldRunOuts", p.runOuts);
    setTxt("pStatFieldStumpings", p.stumpings);
    setTxt("pStatFieldTotal", p.totalDismissals);

    // 4. Match-by-Match Logs Tab
    const matchLogsList = document.getElementById("pStatsMatchLogsList");
    if (matchLogsList) {
      if (!p.matchLogs || p.matchLogs.length === 0) {
        matchLogsList.innerHTML = `
          <div style="text-align:center;padding:24px;color:#64748b;font-size:12px;">
            No match performances logged for this player yet.
          </div>
        `;
      } else {
        matchLogsList.innerHTML = p.matchLogs.map(m => {
          let batSnippet = "";
          if (m.batting) {
            batSnippet = `
              <div class="perf-chip perf-chip-bat">
                <i class="fa-solid fa-baseball-bat-ball"></i>
                <span>${m.batting.runs} (${m.batting.balls}b, ${m.batting.fours}x4, ${m.batting.sixes}x6) • ${m.batting.dismissal}</span>
              </div>
            `;
          }

          let bowlSnippet = "";
          if (m.bowling) {
            bowlSnippet = `
              <div class="perf-chip perf-chip-bowl">
                <i class="fa-solid fa-bullseye"></i>
                <span>${m.bowling.overs} ov, ${m.bowling.maidens}M, ${m.bowling.runs}R, ${m.bowling.wickets}W (Econ: ${m.bowling.econ})</span>
              </div>
            `;
          }

          let fieldSnippet = "";
          if (m.fielding && (m.fielding.catches > 0 || m.fielding.runOuts > 0 || m.fielding.stumpings > 0)) {
            const parts = [];
            if (m.fielding.catches > 0) parts.push(`${m.fielding.catches} Catch`);
            if (m.fielding.runOuts > 0) parts.push(`${m.fielding.runOuts} RO`);
            if (m.fielding.stumpings > 0) parts.push(`${m.fielding.stumpings} St`);
            fieldSnippet = `
              <div class="perf-chip perf-chip-field">
                <i class="fa-solid fa-hands"></i>
                <span>${parts.join(", ")}</span>
              </div>
            `;
          }

          return `
            <div class="p-match-log-card">
              <div class="p-match-log-top">
                <div class="p-match-opp">${m.teams} <small style="color:#94a3b8;">(${m.tournament})</small></div>
                <div class="p-match-date">${m.date}</div>
              </div>
              <div class="p-match-perf-row">
                ${batSnippet}
                ${bowlSnippet}
                ${fieldSnippet}
                ${m.isPotm ? '<span class="perf-potm-tag"><i class="fa-solid fa-crown"></i> POTM</span>' : ''}
              </div>
              <div style="font-size:10.5px;color:#94a3b8;margin-top:2px;">
                <i class="fa-solid fa-trophy" style="font-size:9.5px;color:#f59e0b;"></i> ${m.result}
              </div>
            </div>
          `;
        }).join("");
      }
    }

    // Default to Overview Tab
    activePlayerDetailTab = "overview";
    document.querySelectorAll(".pstats-tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.ptab === "overview");
    });
    const pPaneOverview = document.getElementById("pPaneOverview");
    const pPaneMatches = document.getElementById("pPaneMatches");
    if (pPaneOverview) pPaneOverview.style.display = "block";
    if (pPaneMatches) pPaneMatches.style.display = "none";

    modal.style.display = "flex";
  };

  // Close Player Stats Modal
  function closePlayerStatsModal() {
    const modal = document.getElementById("playerStatsDetailModal");
    if (modal) modal.style.display = "none";
  }

  const playerStatsDetailCloseBtn = document.getElementById("playerStatsDetailCloseBtn");
  if (playerStatsDetailCloseBtn) {
    playerStatsDetailCloseBtn.addEventListener("click", closePlayerStatsModal);
  }

  const btnClosePlayerProfile = document.getElementById("btnClosePlayerProfile");
  if (btnClosePlayerProfile) {
    btnClosePlayerProfile.addEventListener("click", closePlayerStatsModal);
  }

  const playerStatsDetailModal = document.getElementById("playerStatsDetailModal");
  if (playerStatsDetailModal) {
    playerStatsDetailModal.addEventListener("click", (e) => {
      if (e.target === playerStatsDetailModal) closePlayerStatsModal();
    });
  }

  // Modal Detail Tabs Switching
  const pstatsTabBtns = document.querySelectorAll(".pstats-tab-btn");
  pstatsTabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      pstatsTabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.ptab;
      const pPaneOverview = document.getElementById("pPaneOverview");
      const pPaneMatches = document.getElementById("pPaneMatches");

      if (tab === "overview") {
        if (pPaneOverview) pPaneOverview.style.display = "block";
        if (pPaneMatches) pPaneMatches.style.display = "none";
      } else {
        if (pPaneOverview) pPaneOverview.style.display = "none";
        if (pPaneMatches) pPaneMatches.style.display = "block";
      }
    });
  });

  // Share Player Profile Button
  const btnSharePlayerProfile = document.getElementById("btnSharePlayerProfile");
  if (btnSharePlayerProfile) {
    btnSharePlayerProfile.addEventListener("click", () => {
      if (!currentViewingPlayer) return;
      const p = currentViewingPlayer;
      const shareText = `🏏 CRIC YUVA PLAYER PROFILE 🏏\n${p.name} (${p.team})\nRole: ${p.role}\nMatches: ${p.matchesPlayed} | Runs: ${p.runs} (HS: ${p.hsDisplay}, Avg: ${p.batAvg}, SR: ${p.strikeRate})\nWickets: ${p.wickets} (BBI: ${p.bbiDisplay}, Econ: ${p.economy})\nCatches: ${p.catches}\n\nTracked via Cric Yuva Cricket App.`;

      if (navigator.share) {
        navigator.share({
          title: `${p.name} - Cric Yuva Stats`,
          text: shareText
        }).catch(() => {});
      } else {
        navigator.clipboard.writeText(shareText).then(() => {
          alert(`Player profile copied to clipboard:\n\n${shareText}`);
        });
      }
    });
  }

  // Back Button from Screen 10
  const statsBackButton = document.getElementById("statsBackButton");
  if (statsBackButton) {
    statsBackButton.addEventListener("click", () => {
      showScreen("screen5");
    });
  }

  // Refresh Stats Button
  const btnRefreshStats = document.getElementById("btnRefreshStats");
  if (btnRefreshStats) {
    btnRefreshStats.addEventListener("click", () => {
      const icon = btnRefreshStats.querySelector("i");
      if (icon) icon.classList.add("fa-spin");
      setTimeout(() => {
        if (icon) icon.classList.remove("fa-spin");
        renderPlayerStatsScreen();
      }, 350);
    });
  }

  // Category Tabs Clicking on Screen 10
  const statsCatTabs = document.querySelectorAll(".stats-cat-tab");
  statsCatTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      statsCatTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      activeStatsCategory = tab.dataset.cat;
      activeStatsSort = "default";
      renderPlayerStatsScreen();
    });
  });

  // Scope Chips (All Time / Recent)
  const statsScopeChips = document.querySelectorAll(".stats-scope-chip");
  statsScopeChips.forEach(chip => {
    chip.addEventListener("click", () => {
      statsScopeChips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeStatsScope = chip.dataset.scope || "all";
      renderPlayerStatsScreen();
    });
  });

  // Tournament Select Dropdown Change
  const statsTournamentSelect = document.getElementById("statsTournamentSelect");
  if (statsTournamentSelect) {
    statsTournamentSelect.addEventListener("change", () => {
      activeStatsTournament = statsTournamentSelect.value || "all";
      renderPlayerStatsScreen();
    });
  }

  // Sort Dropdown Change
  const statsSortSelect = document.getElementById("statsSortSelect");
  if (statsSortSelect) {
    statsSortSelect.addEventListener("change", () => {
      activeStatsSort = statsSortSelect.value || "default";
      renderPlayerStatsScreen();
    });
  }

  // Search Field Input & Clear
  const statsSearchInput = document.getElementById("statsSearchInput");
  const statsClearSearchBtn = document.getElementById("statsClearSearchBtn");

  if (statsSearchInput) {
    statsSearchInput.addEventListener("input", () => {
      statsSearchQuery = statsSearchInput.value.trim();
      if (statsClearSearchBtn) {
        statsClearSearchBtn.style.display = statsSearchQuery ? "block" : "none";
      }
      renderPlayerStatsScreen();
    });
  }

  if (statsClearSearchBtn) {
    statsClearSearchBtn.addEventListener("click", () => {
      if (statsSearchInput) statsSearchInput.value = "";
      statsSearchQuery = "";
      statsClearSearchBtn.style.display = "none";
      renderPlayerStatsScreen();
    });
  }

  // Reset Filters Button on Empty State
  const btnStatsResetFilters = document.getElementById("btnStatsResetFilters");
  if (btnStatsResetFilters) {
    btnStatsResetFilters.addEventListener("click", () => {
      statsSearchQuery = "";
      if (statsSearchInput) statsSearchInput.value = "";
      if (statsClearSearchBtn) statsClearSearchBtn.style.display = "none";
      activeStatsScope = "all";
      activeStatsTournament = "all";
      statsScopeChips.forEach(c => c.classList.toggle("active", c.dataset.scope === "all"));
      if (statsTournamentSelect) statsTournamentSelect.value = "all";
      renderPlayerStatsScreen();
    });
  }

  // Bottom Navigation Bar on Screen 10
  const navHomeFromStats = document.getElementById("navHomeFromStats");
  if (navHomeFromStats) {
    navHomeFromStats.addEventListener("click", () => showScreen("screen5"));
  }

  const navMatchesFromStats = document.getElementById("navMatchesFromStats");
  if (navMatchesFromStats) {
    navMatchesFromStats.addEventListener("click", () => {
      renderMatchHistoryScreen();
      showScreen("screen9");
    });
  }

  const centerPlusBtnStats = document.getElementById("centerPlusBtnStats");
  if (centerPlusBtnStats) {
    centerPlusBtnStats.addEventListener("click", () => {
      openStartMatchSetup();
    });
  }

  const navMenuFromStats = document.getElementById("navMenuFromStats");
  if (navMenuFromStats) {
    navMenuFromStats.addEventListener("click", openMenuDrawer);
  }

  // Connect player click in My Team to Player Stats Profile modal
  const teamPlayersContainer = document.getElementById("playersListContainer");
  if (teamPlayersContainer) {
    teamPlayersContainer.addEventListener("click", (e) => {
      const card = e.target.closest(".player-card-item");
      if (card && !e.target.closest(".player-action-icon-btn")) {
        const pId = card.dataset.playerId;
        const myTeam = getMyTeamData();
        const player = myTeam.players.find(p => p.id === pId);
        if (player) {
          openPlayerStatsModal(player.name);
        }
      }
    });
  }

  // =========================================================================
  // TOURNAMENT MANAGEMENT SYSTEM ENGINE & CONTROLLERS (SCREEN 11)
  // =========================================================================

  const TOURNAMENT_STORAGE_KEY = "cricYuvaTournaments";
  let activeTournamentId = null;
  let activeTourneyFilterStatus = "all";
  let activeTourneyFilterFormat = "all";
  let activeTourneySearchQuery = "";
  let activeTourneyDetailTab = "tOverview";
  let activeTourneyStatsCategory = "batting";
  let activeTourneyFixtureFilter = "all";
  let activeTourneyGroupTab = "all";
  let wizardSelectedTeams = [];

  // 1. STORAGE ACCESSORS & DATA SEEDING
  function getTournamentsList() {
    try {
      const data = getUserStorage(TOURNAMENT_STORAGE_KEY);
      if (data !== null && data !== undefined) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          const blockedIds = new Set(["tourney_ypl_2026", "tourney_champions_2026", "tourney_knockout_2026"]);
          const seen = new Set();
          const clean = parsed.filter(t => t && t.id && !blockedIds.has(t.id) && !seen.has(t.id) && (seen.add(t.id), true));
          if (clean.length !== parsed.length) { try { setUserStorage(TOURNAMENT_STORAGE_KEY, JSON.stringify(clean)); } catch (e) {} }
          return clean;
        }
      }
    } catch (e) {
      console.error("Error reading tournaments from storage:", e);
    }
    // New installs start clean. Real tournaments are created by the user.
    return [];
  }

  function saveTournamentsList(list) {
    try {
      setUserStorage(TOURNAMENT_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.error("Error writing tournaments to storage:", e);
    }
  }

  function getTournamentById(id) {
    const list = getTournamentsList();
    return list.find(t => t.id === id) || null;
  }

  function saveTournament(tourney) {
    if (!tourney || !tourney.id) return;
    const list = getTournamentsList();
    const idx = list.findIndex(t => t.id === tourney.id);
    const isNew = idx < 0;
    if (idx >= 0) {
      list[idx] = tourney;
    } else {
      list.unshift(tourney);
    }
    saveTournamentsList(list);
    if (window.CricYuvaCloud) {
      window.CricYuvaCloud.request("/api/tournaments", { method: "POST", body: JSON.stringify(tourney) }).catch(() => {});
    }

    if (isNew && window.NotificationService && window.NotificationService.addNotification) {
      window.NotificationService.addNotification({
        title: "Tournament Created",
        message: `${tourney.name} (${tourney.format || 'T20'}) has been created and registered.`,
        type: "tournament"
      });
    }
  }

  // Helper to retrieve custom clubs database
  function getCustomClubsList() {
    try {
      const stored = localStorage.getItem("cric_yuva_custom_clubs");
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }

  function saveCustomClub(club) {
    try {
      const list = getCustomClubsList();
      const existingIdx = list.findIndex(c => c.name === club.name || c.id === club.id);
      if (existingIdx >= 0) {
        list[existingIdx] = club;
      } else {
        list.push(club);
      }
      localStorage.setItem("cric_yuva_custom_clubs", JSON.stringify(list));
      if (window.CricYuvaCloud && club && club.name) {
        window.CricYuvaCloud.request("/api/teams", { method: "POST", body: JSON.stringify({
          id: club.id || ("team_" + Date.now()), name: club.name, logo: club.logo || "", players: club.players || [],
          captainName: club.captain || club.captainName || "", viceCaptainName: club.viceCaptain || club.viceCaptainName || ""
        }) }).catch(() => {});
      }
    } catch (e) {
      console.error("Error saving custom club:", e);
    }
  }

  // Generate a standard balanced 11-15 player squad with roles
  function generateDefaultSquadForClub(clubName, captainName, vcName) {
    // Demo squads are intentionally disabled. Teams must contain real registered players.
    return [];
  }


  // Helper to retrieve club teams database (built-in + user-created)
  function getAvailableClubsList() {
    const clubs = [];
    const seen = new Set();
    const addClub = (club) => {
      if (!club || !club.name) return;
      const key = club.name.trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      clubs.push(club);
    };

    const myTeam = getTeamData();
    if (myTeam && myTeam.teamName) addClub(myTeam);

    getCustomClubsList().forEach(addClub);
    return clubs;
  }

  // 2. SEED DEFAULT RICH TOURNAMENTS
  function seedDefaultTournaments() {
    // Deliberately empty: new installs contain no demo tournaments.
    return [];
  }


  // 3. COMPUTATION ENGINE: POINTS TABLE & NET RUN RATE (NRR)
  function parseCricketScoreForNRR(scoreStr, maxAllottedOvers = 20) {
    if (!scoreStr || scoreStr === "-" || typeof scoreStr !== "string") {
      return { runs: 0, oversDecimal: 0, wickets: 0, isAllOut: false, hasData: false };
    }

    let runs = 0;
    let wickets = 0;
    let overs = maxAllottedOvers;
    let isAllOut = false;

    // Extract runs and wickets (e.g. "184/5 (20.0)", "165/10 (18.4 ov)", "150 (18.0)")
    const slashParts = scoreStr.split("/");
    if (slashParts.length > 1) {
      runs = parseInt(slashParts[0]) || 0;
      const afterSlash = slashParts[1].trim();
      wickets = parseInt(afterSlash) || 0;
      if (wickets >= 10) isAllOut = true;
    } else {
      runs = parseInt(scoreStr) || 0;
    }

    // Extract overs from parenthesis if present
    if (scoreStr.includes("(") && scoreStr.includes(")")) {
      const insideParen = scoreStr.substring(scoreStr.indexOf("(") + 1, scoreStr.indexOf(")"));
      const matchOv = insideParen.match(/(\d+(\.\d+)?)/);
      if (matchOv) {
        const rawOv = matchOv[0];
        if (rawOv.includes(".")) {
          const [wOv, bPart] = rawOv.split(".");
          const balls = parseInt(bPart) || 0;
          overs = (parseInt(wOv) || 0) + (balls / 6);
        } else {
          overs = parseFloat(rawOv) || maxAllottedOvers;
        }
      }
    }

    // Standard ICC rule: If a team is bowled out, their overs faced counts as full quota of overs allocated
    if (isAllOut && overs < maxAllottedOvers) {
      overs = maxAllottedOvers;
    }

    const actualOversDecimal = overs > 0 ? overs : maxAllottedOvers;
    const nrrOversFaced = isAllOut && actualOversDecimal < maxAllottedOvers
      ? maxAllottedOvers
      : actualOversDecimal;
    return {
      runs,
      oversDecimal: nrrOversFaced,
      actualOversDecimal,
      wickets,
      isAllOut,
      hasData: true
    };
  }

  function computePointsTable(tourney, teamList) {
    const teams = teamList || tourney.teams || [];
    const maxOvers = tourney.overs || 20;

    // Configurable points system with default standards: Win=2, Tie=1, NR=1, Loss=0
    const ptsWin = (tourney.rules && typeof tourney.rules.ptsWin === "number") ? tourney.rules.ptsWin : 2;
    const ptsTie = (tourney.rules && typeof tourney.rules.ptsTie === "number") ? tourney.rules.ptsTie : 1;
    const ptsNR = (tourney.rules && typeof tourney.rules.ptsNR === "number") ? tourney.rules.ptsNR : 1;
    const ptsLoss = (tourney.rules && typeof tourney.rules.ptsLoss === "number") ? tourney.rules.ptsLoss : 0;

    // Initialize standings table map for every team in tournament
    const table = teams.map(t => {
      const teamName = typeof t === "string" ? t : (t.name || "Team");
      const teamLogo = (typeof t === "object" && t.logo) ? t.logo : "🏏";
      return {
        team: teamName,
        logo: teamLogo,
        p: 0,
        w: 0,
        l: 0,
        t: 0,
        nr: 0,
        pts: 0,
        runsScored: 0,
        oversFaced: 0,
        runsConceded: 0,
        oversBowled: 0,
        nrr: 0.000,
        form: []
      };
    });

    // Parse all non-playoff completed matches
    const completedMatches = (tourney.fixtures || []).filter(f => f.status === "COMPLETED" && !f.isPlayoff);

    completedMatches.forEach(f => {
      const rowA = table.find(r => r.team === f.teamA);
      const rowB = table.find(r => r.team === f.teamB);
      if (!rowA && !rowB) return;

      const sA = parseCricketScoreForNRR(f.scoreA, maxOvers);
      const sB = parseCricketScoreForNRR(f.scoreB, maxOvers);

      const resLower = (f.resultText || "").toLowerCase();
      const isNoResult = f.status === "NO_RESULT" || resLower.includes("no result") || resLower.includes("abandoned") || resLower.includes("washout");
      const isTied = f.winner === "Tied" || resLower.includes("match tie") || resLower.includes("tied");
      const isWinA = f.winner === f.teamA || (resLower.includes(f.teamA.toLowerCase()) && resLower.includes("won"));
      const isWinB = f.winner === f.teamB || (resLower.includes(f.teamB.toLowerCase()) && resLower.includes("won"));

      if (rowA) {
        rowA.p += 1;
        if (sA.hasData && sB.hasData) {
          rowA.runsScored += sA.runs;
          rowA.oversFaced += sA.oversDecimal;
          rowA.runsConceded += sB.runs;
          rowA.oversBowled += sB.oversDecimal;
        }

        if (isNoResult) {
          rowA.nr += 1;
          rowA.pts += ptsNR;
          rowA.form.push("NR");
        } else if (isTied) {
          rowA.t += 1;
          rowA.pts += ptsTie;
          rowA.form.push("T");
        } else if (isWinA) {
          rowA.w += 1;
          rowA.pts += ptsWin;
          rowA.form.push("W");
        } else if (isWinB) {
          rowA.l += 1;
          rowA.pts += ptsLoss;
          rowA.form.push("L");
        }
      }

      if (rowB) {
        rowB.p += 1;
        if (sA.hasData && sB.hasData) {
          rowB.runsScored += sB.runs;
          rowB.oversFaced += sB.oversDecimal;
          rowB.runsConceded += sA.runs;
          rowB.oversBowled += sA.oversDecimal;
        }

        if (isNoResult) {
          rowB.nr += 1;
          rowB.pts += ptsNR;
          rowB.form.push("NR");
        } else if (isTied) {
          rowB.t += 1;
          rowB.pts += ptsTie;
          rowB.form.push("T");
        } else if (isWinB) {
          rowB.w += 1;
          rowB.pts += ptsWin;
          rowB.form.push("W");
        } else if (isWinA) {
          rowB.l += 1;
          rowB.pts += ptsLoss;
          rowB.form.push("L");
        }
      }
    });

    // Compute Net Run Rate (NRR) = (Runs Scored / Overs Faced) - (Runs Conceded / Overs Bowled)
    table.forEach(r => {
      if (r.oversFaced > 0 && r.oversBowled > 0) {
        const forRate = r.runsScored / r.oversFaced;
        const againstRate = r.runsConceded / r.oversBowled;
        r.nrr = parseFloat((forRate - againstRate).toFixed(3));
      } else {
        r.nrr = 0.000;
      }
    });

    // Sort table by: 1. Points DESC, 2. NRR DESC, 3. Won DESC, 4. Runs Scored DESC, 5. Alphabetical
    table.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (Math.abs(b.nrr - a.nrr) > 0.0001) return b.nrr - a.nrr;
      if (b.w !== a.w) return b.w - a.w;
      if (b.runsScored !== a.runsScored) return b.runsScored - a.runsScored;
      return a.team.localeCompare(b.team);
    });

    return table;
  }

  // 4. GENERATE FIXTURES ON TOURNAMENT CREATION
  function generateTournamentFixtures(format, teams, grounds, overs, startDateStr, tournamentGroups = []) {
    const fixtures = [];
    const teamNames = teams.map(t => typeof t === "string" ? t : t.name);
    const venues = (grounds && grounds.length > 0) ? grounds : ["Yuva Cricket Ground"];
    let currDate = new Date(startDateStr || Date.now());
    let matchCounter = 1;

    const addDays = (d, days) => {
      const copy = new Date(d);
      copy.setDate(copy.getDate() + days);
      return copy;
    };

    const formatDateStr = (d) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

    if (format === "League" || format === "League + Playoffs") {
      // Round robin pairing
      for (let i = 0; i < teamNames.length; i++) {
        for (let j = i + 1; j < teamNames.length; j++) {
          fixtures.push({
            id: `fx_gen_${matchCounter}`,
            stage: `League • Match ${matchCounter}`,
            teamA: teamNames[i],
            teamB: teamNames[j],
            date: formatDateStr(currDate),
            time: matchCounter % 2 === 1 ? "19:30" : "15:30",
            ground: venues[(matchCounter - 1) % venues.length],
            status: "UPCOMING",
            scoreA: "-",
            scoreB: "-",
            winner: null,
            resultText: "Scheduled",
            isPlayoff: false
          });
          currDate = addDays(currDate, 2);
          matchCounter++;
        }
      }

      if (format === "League + Playoffs") {
        currDate = addDays(currDate, 3);
        fixtures.push({
          id: `fx_gen_q1`,
          stage: "Qualifier 1 (Rank 1 vs Rank 2)",
          teamA: "Rank 1 TBD",
          teamB: "Rank 2 TBD",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Winner qualifies for Final",
          isPlayoff: true
        });

        currDate = addDays(currDate, 2);
        fixtures.push({
          id: `fx_gen_el`,
          stage: "Eliminator (Rank 3 vs Rank 4)",
          teamA: "Rank 3 TBD",
          teamB: "Rank 4 TBD",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[venues.length > 1 ? 1 : 0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Winner advances to Qualifier 2",
          isPlayoff: true
        });

        currDate = addDays(currDate, 2);
        fixtures.push({
          id: `fx_gen_q2`,
          stage: "Qualifier 2 (Loser Q1 vs Winner Elim)",
          teamA: "Loser Q1 TBD",
          teamB: "Winner Elim TBD",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Winner qualifies for Final",
          isPlayoff: true
        });

        currDate = addDays(currDate, 3);
        fixtures.push({
          id: `fx_gen_fn`,
          stage: "Grand Final (Winner Q1 vs Winner Q2)",
          teamA: "Winner Q1 TBD",
          teamB: "Winner Q2 TBD",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Championship Final",
          isPlayoff: true
        });
      }
    } else if (format === "Group Stage") {
      // Multi-group stage: use tournament groups when available.
      // Each group plays a round-robin. Top 2 from every group qualify.
      const configuredGroups = Array.isArray(tournamentGroups)
        ? tournamentGroups
        : [];

      let groups = configuredGroups
        .map((g, i) => ({
          id: g.id || String.fromCharCode(65 + i),
          name: g.name || `Group ${String.fromCharCode(65 + i)}`,
          teams: Array.isArray(g.teams)
            ? g.teams.map(t => typeof t === "string" ? t : (t.name || t.teamName)).filter(Boolean)
            : []
        }))
        .filter(g => g.teams.length >= 2);

      // Fallback for older tournaments that don't have configured groups.
      if (!groups.length) {
        const mid = Math.ceil(teamNames.length / 2);
        groups = [
          { id: "A", name: "Group A", teams: teamNames.slice(0, mid) },
          { id: "B", name: "Group B", teams: teamNames.slice(mid) }
        ].filter(g => g.teams.length >= 2);
      }

      groups.forEach(group => {
        group.teams.forEach((tA, idx) => {
          for (let j = idx + 1; j < group.teams.length; j++) {
            fixtures.push({
              id: `fx_gen_g${String(group.id).toLowerCase()}_${matchCounter}`,
              stage: `${group.name} • Match ${matchCounter}`,
              group: group.id,
              teamA: tA,
              teamB: group.teams[j],
              date: formatDateStr(currDate),
              time: matchCounter % 2 === 1 ? "19:30" : "15:30",
              ground: venues[(matchCounter - 1) % venues.length],
              status: "UPCOMING",
              scoreA: "-",
              scoreB: "-",
              winner: null,
              resultText: "Scheduled",
              isPlayoff: false
            });
            currDate = addDays(currDate, 1);
            matchCounter++;
          }
        });
      });

      // Qualification fixtures are generated dynamically after group standings.
      // The bracket is:
      // 2 groups: A1-B2, B1-A2
      // 4 groups: A1-B2, B1-A2 and C1-D2, D1-C2 -> 2 SFs -> Final
      // 3 groups: best 2 overall receive byes; remaining 4 play cross-group QFs.
      if (groups.length === 2) {
        currDate = addDays(currDate, 2);
        fixtures.push({
          id: "fx_gen_qg1",
          stage: "Qualifier 1 (Group A #1 vs Group B #2)",
          teamA: "Group A #1",
          teamB: "Group B #2",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Qualifier",
          isPlayoff: true
        });
        currDate = addDays(currDate, 1);
        fixtures.push({
          id: "fx_gen_qg2",
          stage: "Qualifier 2 (Group B #1 vs Group A #2)",
          teamA: "Group B #1",
          teamB: "Group A #2",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[venues.length > 1 ? 1 : 0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Qualifier",
          isPlayoff: true
        });
        currDate = addDays(currDate, 1);
        fixtures.push({
          id: "fx_gen_fn",
          stage: "Grand Final",
          teamA: "Winner Qualifier 1",
          teamB: "Winner Qualifier 2",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Grand Final",
          isPlayoff: true
        });
      } else if (groups.length === 4) {
        currDate = addDays(currDate, 2);
        const pairs = [
          ["A", "B", 1],
          ["C", "D", 2]
        ];

        pairs.forEach(([g1, g2, n]) => {
          fixtures.push({
            id: `fx_gen_q${n}a`,
            stage: `Qualifier ${n}A (${g1} #1 vs ${g2} #2)`,
            teamA: `Group ${g1} #1`,
            teamB: `Group ${g2} #2`,
            date: formatDateStr(currDate),
            time: "19:30",
            ground: venues[(n - 1) % venues.length],
            status: "UPCOMING",
            scoreA: "-",
            scoreB: "-",
            winner: null,
            resultText: "Qualifier",
            isPlayoff: true
          });
          currDate = addDays(currDate, 1);

          fixtures.push({
            id: `fx_gen_q${n}b`,
            stage: `Qualifier ${n}B (${g2} #1 vs ${g1} #2)`,
            teamA: `Group ${g2} #1`,
            teamB: `Group ${g1} #2`,
            date: formatDateStr(currDate),
            time: "19:30",
            ground: venues[(n - 1) % venues.length],
            status: "UPCOMING",
            scoreA: "-",
            scoreB: "-",
            winner: null,
            resultText: "Qualifier",
            isPlayoff: true
          });
          currDate = addDays(currDate, 1);
        });

        fixtures.push({
          id: "fx_gen_sf1",
          stage: "Semi-Final 1",
          teamA: "Winner Qualifier 1A",
          teamB: "Winner Qualifier 1B",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Semi-Final",
          isPlayoff: true
        });
        currDate = addDays(currDate, 1);

        fixtures.push({
          id: "fx_gen_sf2",
          stage: "Semi-Final 2",
          teamA: "Winner Qualifier 2A",
          teamB: "Winner Qualifier 2B",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[venues.length > 1 ? 1 : 0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Semi-Final",
          isPlayoff: true
        });
        currDate = addDays(currDate, 1);

        fixtures.push({
          id: "fx_gen_fn",
          stage: "Grand Final",
          teamA: "Winner Semi-Final 1",
          teamB: "Winner Semi-Final 2",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Grand Final",
          isPlayoff: true
        });
      } else if (groups.length === 3) {
        // 6 qualified teams: overall best 2 get direct Semi-Final byes.
        currDate = addDays(currDate, 2);

        fixtures.push({
          id: "fx_gen_q1",
          stage: "Qualifier 1 (Best #3 vs Best #6)",
          teamA: "Overall Qualified #3",
          teamB: "Overall Qualified #6",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Qualifier",
          isPlayoff: true
        });
        currDate = addDays(currDate, 1);

        fixtures.push({
          id: "fx_gen_q2",
          stage: "Qualifier 2 (Best #4 vs Best #5)",
          teamA: "Overall Qualified #4",
          teamB: "Overall Qualified #5",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[venues.length > 1 ? 1 : 0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Qualifier",
          isPlayoff: true
        });
        currDate = addDays(currDate, 1);

        fixtures.push({
          id: "fx_gen_sf1",
          stage: "Semi-Final 1",
          teamA: "Overall Qualified #1",
          teamB: "Winner Qualifier 2",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Semi-Final",
          isPlayoff: true
        });
        currDate = addDays(currDate, 1);

        fixtures.push({
          id: "fx_gen_sf2",
          stage: "Semi-Final 2",
          teamA: "Overall Qualified #2",
          teamB: "Winner Qualifier 1",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[venues.length > 1 ? 1 : 0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Semi-Final",
          isPlayoff: true
        });
        currDate = addDays(currDate, 1);

        fixtures.push({
          id: "fx_gen_fn",
          stage: "Grand Final",
          teamA: "Winner Semi-Final 1",
          teamB: "Winner Semi-Final 2",
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[0],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: "Grand Final",
          isPlayoff: true
        });
      }

    } else if (groups.length >= 5) {
      // 5+ groups: top 2 from every group qualify; automatic Top-8 playoff.
      currDate = addDays(currDate, 2);
      for (let i = 0; i < 4; i++) {
        fixtures.push({
          id: `fx_gen_auto_qf${i + 1}`,
          stage: `Quarter-Final ${i + 1}`,
          teamA: `Overall Qualified #${i + 1}`,
          teamB: `Overall Qualified #${8 - i}`,
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[i % venues.length],
          status: "UPCOMING", scoreA: "-", scoreB: "-", winner: null,
          resultText: "Quarter-Final", isPlayoff: true
        });
        currDate = addDays(currDate, 1);
      }
      fixtures.push({
        id: "fx_gen_auto_sf1", stage: "Semi-Final 1",
        teamA: "Winner Quarter-Final 1", teamB: "Winner Quarter-Final 2",
        date: formatDateStr(currDate), time: "19:30", ground: venues[0],
        status: "UPCOMING", scoreA: "-", scoreB: "-", winner: null,
        resultText: "Semi-Final", isPlayoff: true
      });
      currDate = addDays(currDate, 1);
      fixtures.push({
        id: "fx_gen_auto_sf2", stage: "Semi-Final 2",
        teamA: "Winner Quarter-Final 3", teamB: "Winner Quarter-Final 4",
        date: formatDateStr(currDate), time: "19:30",
        ground: venues[venues.length > 1 ? 1 : 0],
        status: "UPCOMING", scoreA: "-", scoreB: "-", winner: null,
        resultText: "Semi-Final", isPlayoff: true
      });
      currDate = addDays(currDate, 1);
      fixtures.push({
        id: "fx_gen_auto_fn", stage: "Grand Final",
        teamA: "Winner Semi-Final 1", teamB: "Winner Semi-Final 2",
        date: formatDateStr(currDate), time: "19:30", ground: venues[0],
        status: "UPCOMING", scoreA: "-", scoreB: "-", winner: null,
        resultText: "Grand Final", isPlayoff: true
      });
    } else if (format === "Knockout") {
      // Quarter-Finals or First Round
      for (let i = 0; i < teamNames.length; i += 2) {
        const t1 = teamNames[i];
        const t2 = teamNames[i + 1] || "Bye / Seed";
        fixtures.push({
          id: `fx_ko_qf_${matchCounter}`,
          stage: `Quarter-Final ${matchCounter}`,
          teamA: t1,
          teamB: t2,
          date: formatDateStr(currDate),
          time: "19:30",
          ground: venues[(matchCounter - 1) % venues.length],
          status: "UPCOMING",
          scoreA: "-",
          scoreB: "-",
          winner: null,
          resultText: `Knockout QF ${matchCounter}`,
          isPlayoff: true
        });
        currDate = addDays(currDate, 1);
        matchCounter++;
      }

      currDate = addDays(currDate, 2);
      fixtures.push({
        id: `fx_ko_sf1`,
        stage: "Semi-Final 1",
        teamA: "Winner QF 1",
        teamB: "Winner QF 2",
        date: formatDateStr(currDate),
        time: "19:30",
        ground: venues[0],
        status: "UPCOMING",
        scoreA: "-",
        scoreB: "-",
        winner: null,
        resultText: "Knockout Semi-Final",
        isPlayoff: true
      });

      currDate = addDays(currDate, 1);
      fixtures.push({
        id: `fx_ko_sf2`,
        stage: "Semi-Final 2",
        teamA: "Winner QF 3",
        teamB: "Winner QF 4",
        date: formatDateStr(currDate),
        time: "19:30",
        ground: venues[0],
        status: "UPCOMING",
        scoreA: "-",
        scoreB: "-",
        winner: null,
        resultText: "Knockout Semi-Final",
        isPlayoff: true
      });

      currDate = addDays(currDate, 3);
      fixtures.push({
        id: `fx_ko_fn`,
        stage: "Grand Final",
        teamA: "Winner SF 1",
        teamB: "Winner SF 2",
        date: formatDateStr(currDate),
        time: "19:30",
        ground: venues[0],
        status: "UPCOMING",
        scoreA: "-",
        scoreB: "-",
        winner: null,
        resultText: "Championship Final",
        isPlayoff: true
      });
    }

    return fixtures;
  }

  // 4.4 PLAYOFF PROGRESSION & ADVANCEMENT ENGINE
  function updatePlayoffBrackets(tourney) {
    if (!tourney || !tourney.fixtures) return;
    const fixtures = tourney.fixtures;
    const table = computePointsTable(tourney);

    // League + Playoffs Format
    if (tourney.format === "League + Playoffs" || tourney.format === "League") {
      const q1 = fixtures.find(f => f.stage && (f.stage.includes("Qualifier 1") || (f.id && f.id.includes("_q1"))));
      const el = fixtures.find(f => f.stage && (f.stage.includes("Eliminator") || (f.id && f.id.includes("_el"))));
      const q2 = fixtures.find(f => f.stage && (f.stage.includes("Qualifier 2") || (f.id && f.id.includes("_q2"))));
      const fn = fixtures.find(f => f.stage && (f.stage.includes("Grand Final") || f.stage.includes("Final") || (f.id && f.id.includes("_fn"))) && !f.stage.includes("Semi") && !f.stage.includes("Quarter"));

      // Seed teams into Q1 and Eliminator from Table
      if (table.length >= 4) {
        if (q1 && q1.status !== "COMPLETED") {
          q1.teamA = table[0].team;
          q1.teamB = table[1].team;
        }
        if (el && el.status !== "COMPLETED") {
          el.teamA = table[2].team;
          el.teamB = table[3].team;
        }
      } else if (table.length >= 2 && fn && !q1 && fn.status !== "COMPLETED") {
        fn.teamA = table[0].team;
        fn.teamB = table[1].team;
      }

      // If Q1 is completed, loser goes to Q2, winner goes to Final
      if (q1 && q1.status === "COMPLETED" && q1.winner) {
        const loserQ1 = q1.winner === q1.teamA ? q1.teamB : q1.teamA;
        if (q2 && q2.status !== "COMPLETED") {
          q2.teamA = loserQ1;
        }
        if (fn && fn.status !== "COMPLETED") {
          fn.teamA = q1.winner;
        }
      }

      // If Eliminator is completed, winner goes to Q2
      if (el && el.status === "COMPLETED" && el.winner) {
        if (q2 && q2.status !== "COMPLETED") {
          q2.teamB = el.winner;
        }
      }

      // If Q2 is completed, winner goes to Final
      if (q2 && q2.status === "COMPLETED" && q2.winner) {
        if (fn && fn.status !== "COMPLETED") {
          fn.teamB = q2.winner;
        }
      }

      // If Final is completed, crown Champion
      if (fn && fn.status === "COMPLETED" && fn.winner) {
        tourney.winner = fn.winner;
        tourney.status = "COMPLETED";
      }
    } else if (tourney.format === "Group Stage") {
      const groups = Array.isArray(tourney.groups)
        ? tourney.groups.filter(g => Array.isArray(g.teams) && g.teams.length >= 2)
        : [];

      const getFixture = (id) => fixtures.find(f => f.id === id);
      const winnerOf = (fixture) =>
        fixture && fixture.status === "COMPLETED" ? fixture.winner : null;

      const qualified = [];

      groups.forEach(group => {
        const teamList = group.teams || [];
        const groupTable = computePointsTable(tourney, teamList);

        if (groupTable.length >= 2) {
          qualified.push({
            group,
            top1: groupTable[0].team,
            top2: groupTable[1].team
          });
        }
      });

      // 2 Groups:
      // A1 vs B2
      // B1 vs A2
      // Winners -> Final
      if (qualified.length === 2) {
        const a = qualified[0];
        const b = qualified[1];

        const q1 = getFixture("fx_gen_qg1");
        const q2 = getFixture("fx_gen_qg2");
        const fn = getFixture("fx_gen_fn");

        if (q1 && q1.status !== "COMPLETED") {
          q1.teamA = a.top1;
          q1.teamB = b.top2;
        }

        if (q2 && q2.status !== "COMPLETED") {
          q2.teamA = b.top1;
          q2.teamB = a.top2;
        }

        if (q1 && q1.status === "COMPLETED" && q1.winner &&
            fn && fn.status !== "COMPLETED") {
          fn.teamA = q1.winner;
        }

        if (q2 && q2.status === "COMPLETED" && q2.winner &&
            fn && fn.status !== "COMPLETED") {
          fn.teamB = q2.winner;
        }

        if (fn && fn.status === "COMPLETED" && fn.winner) {
          tourney.winner = fn.winner;
          tourney.status = "COMPLETED";
        }

      // 3 Groups:
      // Top 2 from each group = 6 qualified.
      // Overall #1 and #2 get direct Semi-Final byes.
      // Q1: #3 vs #6
      // Q2: #4 vs #5
      // SF1: #2 vs Q2 winner
      // SF2: #1 vs Q1 winner
      // Winners -> Final
      } else if (qualified.length === 3) {
        const allQualified = [];

        qualified.forEach(q => {
          const groupTable = computePointsTable(tourney, q.group.teams || []);

          groupTable.slice(0, 2).forEach(row => {
            allQualified.push({
              team: row.team,
              points: row.points || 0,
              nrr: row.nrr || 0,
              wins: row.wins || 0
            });
          });
        });

        allQualified.sort((x, y) =>
          (y.points - x.points) ||
          (y.nrr - x.nrr) ||
          (y.wins - x.wins) ||
          x.team.localeCompare(y.team)
        );

        if (allQualified.length >= 6) {
          const q1 = getFixture("fx_gen_q1");
          const q2 = getFixture("fx_gen_q2");
          const sf1 = getFixture("fx_gen_sf1");
          const sf2 = getFixture("fx_gen_sf2");
          const fn = getFixture("fx_gen_fn");

          if (q1 && q1.status !== "COMPLETED") {
            q1.teamA = allQualified[2].team;
            q1.teamB = allQualified[5].team;
          }

          if (q2 && q2.status !== "COMPLETED") {
            q2.teamA = allQualified[3].team;
            q2.teamB = allQualified[4].team;
          }

          if (q2 && q2.status === "COMPLETED" && q2.winner &&
              sf1 && sf1.status !== "COMPLETED") {
            sf1.teamA = allQualified[1].team;
            sf1.teamB = q2.winner;
          }

          if (q1 && q1.status === "COMPLETED" && q1.winner &&
              sf2 && sf2.status !== "COMPLETED") {
            sf2.teamA = allQualified[0].team;
            sf2.teamB = q1.winner;
          }

          if (sf1 && sf1.status === "COMPLETED" && sf1.winner &&
              fn && fn.status !== "COMPLETED") {
            fn.teamA = sf1.winner;
          }

          // Third-Place Playoff: losing Semi-Finalists play for 3rd place
          if (tourney.rules?.thirdPrize) {
            let third = getFixture("fx_gen_third");
            if (!third) {
              third = {
                id: "fx_gen_third",
                stage: "Third-Place Playoff",
                teamA: "Loser Semi-Final 1",
                teamB: "Loser Semi-Final 2",
                date: "",
                time: "19:30",
                ground: (tourney.grounds || ["Yuva Stadium, Mumbai"])[0],
                status: "UPCOMING",
                scoreA: "-",
                scoreB: "-",
                winner: null,
                resultText: "Third Place",
                isPlayoff: true
              };
              fixtures.push(third);
            }

            if (sf1 && sf1.status === "COMPLETED" && sf1.winner &&
                sf2 && sf2.status === "COMPLETED" && sf2.winner &&
                third.status !== "COMPLETED") {
              third.teamA = sf1.teamA === sf1.winner ? sf1.teamB : sf1.teamA;
              third.teamB = sf2.teamA === sf2.winner ? sf2.teamB : sf2.teamA;
            }
          }

          if (sf2 && sf2.status === "COMPLETED" && sf2.winner &&
              fn && fn.status !== "COMPLETED") {
            fn.teamB = sf2.winner;
          }

          if (fn && fn.status === "COMPLETED" && fn.winner) {
            tourney.winner = fn.winner;
            tourney.status = "COMPLETED";
          }
        }

      // 4 Groups:
      // A1-B2, B1-A2
      // C1-D2, D1-C2
      // 4 winners -> 2 Semi-Finals -> Final
      } else if (qualified.length === 4) {
        const q1a = getFixture("fx_gen_q1a");
        const q1b = getFixture("fx_gen_q1b");
        const q2a = getFixture("fx_gen_q2a");
        const q2b = getFixture("fx_gen_q2b");
        const sf1 = getFixture("fx_gen_sf1");
        const sf2 = getFixture("fx_gen_sf2");
        const fn = getFixture("fx_gen_fn");

        const g1 = qualified[0];
        const g2 = qualified[1];
        const g3 = qualified[2];
        const g4 = qualified[3];

        if (q1a && q1a.status !== "COMPLETED") {
          q1a.teamA = g1.top1;
          q1a.teamB = g2.top2;
        }

        if (q1b && q1b.status !== "COMPLETED") {
          q1b.teamA = g2.top1;
          q1b.teamB = g1.top2;
        }

        if (q2a && q2a.status !== "COMPLETED") {
          q2a.teamA = g3.top1;
          q2a.teamB = g4.top2;
        }

        if (q2b && q2b.status !== "COMPLETED") {
          q2b.teamA = g4.top1;
          q2b.teamB = g3.top2;
        }

        if (q1a && q1b &&
            q1a.status === "COMPLETED" &&
            q1b.status === "COMPLETED" &&
            sf1 && sf1.status !== "COMPLETED") {
          sf1.teamA = q1a.winner;
          sf1.teamB = q1b.winner;
        }

        if (q2a && q2b &&
            q2a.status === "COMPLETED" &&
            q2b.status === "COMPLETED" &&
            sf2 && sf2.status !== "COMPLETED") {
          sf2.teamA = q2a.winner;
          sf2.teamB = q2b.winner;
        }

        if (sf1 && sf1.status === "COMPLETED" && sf1.winner &&
            fn && fn.status !== "COMPLETED") {
          fn.teamA = sf1.winner;
        }

        // Third-Place Playoff: losing Semi-Finalists play for 3rd place
        if (tourney.rules?.thirdPrize) {
          let third = getFixture("fx_gen_third");
          if (!third) {
            third = {
              id: "fx_gen_third",
              stage: "Third-Place Playoff",
              teamA: "Loser Semi-Final 1",
              teamB: "Loser Semi-Final 2",
              date: "",
              time: "19:30",
              ground: (tourney.grounds || ["Yuva Stadium, Mumbai"])[0],
              status: "UPCOMING",
              scoreA: "-",
              scoreB: "-",
              winner: null,
              resultText: "Third Place",
              isPlayoff: true
            };
            fixtures.push(third);
          }

          if (sf1 && sf1.status === "COMPLETED" && sf1.winner &&
              sf2 && sf2.status === "COMPLETED" && sf2.winner &&
              third.status !== "COMPLETED") {
            third.teamA = sf1.teamA === sf1.winner ? sf1.teamB : sf1.teamA;
            third.teamB = sf2.teamA === sf2.winner ? sf2.teamB : sf2.teamA;
          }
        }

        if (sf2 && sf2.status === "COMPLETED" && sf2.winner &&
            fn && fn.status !== "COMPLETED") {
          fn.teamB = sf2.winner;
        }

        if (fn && fn.status === "COMPLETED" && fn.winner) {
          tourney.winner = fn.winner;
          tourney.status = "COMPLETED";
        }
      }

    else if (qualified.length >= 5) {
      // 5+ Groups: top 2 from every group qualify.
      // 6 qualified -> 6-team playoff.
      // 8 or more qualified -> top 8-team playoff.

      const allQualified = [];

      qualified.forEach(q => {
        const table = computePointsTable(tourney, q.group.teams || []);

        table.slice(0, 2).forEach(row => {
          allQualified.push({
            team: row.team,
            points: row.points || 0,
            nrr: row.nrr || 0,
            wins: row.wins || 0,
            group: q.group.id
          });
        });
      });

      allQualified.sort((a, b) =>
        (b.points - a.points) ||
        (b.nrr - a.nrr) ||
        (b.wins - a.wins) ||
        a.team.localeCompare(b.team)
      );

      const playoffSize = allQualified.length >= 8 ? 8 : 6;
      const selected = allQualified.slice(0, playoffSize);

      const autoFixture = (id, stage, teamA, teamB) => {
        let f = fixtures.find(x => x.id === id);

        if (!f) {
          f = {
            id,
            stage,
            teamA,
            teamB,
            date: "",
            time: "19:30",
            ground: (tourney.grounds || ["Yuva Stadium, Mumbai"])[0],
            status: "UPCOMING",
            scoreA: "-",
            scoreB: "-",
            winner: null,
            resultText: stage,
            isPlayoff: true
          };
          fixtures.push(f);
        }

        return f;
      };

      if (playoffSize === 6) {
        const q1 = autoFixture(
          "fx_gen_auto_q1",
          "Qualifier 1",
          selected[2].team,
          selected[5].team
        );

        const q2 = autoFixture(
          "fx_gen_auto_q2",
          "Qualifier 2",
          selected[3].team,
          selected[4].team
        );

        const sf1 = autoFixture(
          "fx_gen_auto_sf1",
          "Semi-Final 1",
          selected[0].team,
          "Winner Qualifier 2"
        );

        const sf2 = autoFixture(
          "fx_gen_auto_sf2",
          "Semi-Final 2",
          selected[1].team,
          "Winner Qualifier 1"
        );

        const fn = autoFixture(
          "fx_gen_auto_fn",
          "Grand Final",
          "Winner Semi-Final 1",
          "Winner Semi-Final 2"
        );

        if (q1.status === "COMPLETED" && q1.winner && sf2.status !== "COMPLETED")
          sf2.teamB = q1.winner;

        if (q2.status === "COMPLETED" && q2.winner && sf1.status !== "COMPLETED")
          sf1.teamB = q2.winner;

        if (sf1.status === "COMPLETED" && sf1.winner && fn.status !== "COMPLETED")
          fn.teamA = sf1.winner;

        if (sf2.status === "COMPLETED" && sf2.winner && fn.status !== "COMPLETED")
          fn.teamB = sf2.winner;

        if (tourney.rules?.thirdPrize) {
          const third = autoFixture(
            "fx_gen_auto_third",
            "Third-Place Playoff",
            "Loser Semi-Final 1",
            "Loser Semi-Final 2"
          );

          third.resultText = "Third Place";

          if (
            sf1.status === "COMPLETED" && sf1.winner &&
            sf2.status === "COMPLETED" && sf2.winner &&
            third.status !== "COMPLETED"
          ) {
            third.teamA =
              sf1.teamA === sf1.winner ? sf1.teamB : sf1.teamA;

            third.teamB =
              sf2.teamA === sf2.winner ? sf2.teamB : sf2.teamA;
          }
        }

        if (fn.status === "COMPLETED" && fn.winner) {
          tourney.winner = fn.winner;
          tourney.status = "COMPLETED";
        }

      } else {
        const qfs = [];

        for (let i = 0; i < 4; i++) {
          qfs.push(autoFixture(
            `fx_gen_auto_qf${i + 1}`,
            `Quarter-Final ${i + 1}`,
            selected[i].team,
            selected[7 - i].team
          ));
        }

        const sf1 = autoFixture(
          "fx_gen_auto_sf1",
          "Semi-Final 1",
          "Winner Quarter-Final 1",
          "Winner Quarter-Final 2"
        );

        const sf2 = autoFixture(
          "fx_gen_auto_sf2",
          "Semi-Final 2",
          "Winner Quarter-Final 3",
          "Winner Quarter-Final 4"
        );

        qfs.forEach((f, i) => {
          if (f.status === "COMPLETED" && f.winner) {
            if (i === 0 && sf1.status !== "COMPLETED") sf1.teamA = f.winner;
            if (i === 1 && sf1.status !== "COMPLETED") sf1.teamB = f.winner;
            if (i === 2 && sf2.status !== "COMPLETED") sf2.teamA = f.winner;
            if (i === 3 && sf2.status !== "COMPLETED") sf2.teamB = f.winner;
          }
        });

        const fn = autoFixture(
          "fx_gen_auto_fn",
          "Grand Final",
          "Winner Semi-Final 1",
          "Winner Semi-Final 2"
        );

        if (sf1.status === "COMPLETED" && sf1.winner && fn.status !== "COMPLETED")
          fn.teamA = sf1.winner;

        if (sf2.status === "COMPLETED" && sf2.winner && fn.status !== "COMPLETED")
          fn.teamB = sf2.winner;

        if (tourney.rules?.thirdPrize) {
          const third = autoFixture(
            "fx_gen_auto_third",
            "Third-Place Playoff",
            "Loser Semi-Final 1",
            "Loser Semi-Final 2"
          );

          third.resultText = "Third Place";

          if (
            sf1.status === "COMPLETED" && sf1.winner &&
            sf2.status === "COMPLETED" && sf2.winner &&
            third.status !== "COMPLETED"
          ) {
            third.teamA =
              sf1.teamA === sf1.winner ? sf1.teamB : sf1.teamA;

            third.teamB =
              sf2.teamA === sf2.winner ? sf2.teamB : sf2.teamA;
          }
        }

        if (fn.status === "COMPLETED" && fn.winner) {
          tourney.winner = fn.winner;
          tourney.status = "COMPLETED";
        }
      }
    } } else if (tourney.format === "Knockout" || tourney.format === "Knockout Cup") {
      const qf1 = fixtures.find(f => (f.id && f.id.includes("qf_1")) || (f.stage && f.stage.includes("Quarter-Final 1")));
      const qf2 = fixtures.find(f => (f.id && f.id.includes("qf_2")) || (f.stage && f.stage.includes("Quarter-Final 2")));
      const qf3 = fixtures.find(f => (f.id && f.id.includes("qf_3")) || (f.stage && f.stage.includes("Quarter-Final 3")));
      const qf4 = fixtures.find(f => (f.id && f.id.includes("qf_4")) || (f.stage && f.stage.includes("Quarter-Final 4")));

      const sf1 = fixtures.find(f => (f.id && f.id.includes("sf1")) || (f.stage && f.stage.includes("Semi-Final 1")));
      const sf2 = fixtures.find(f => (f.id && f.id.includes("sf2")) || (f.stage && f.stage.includes("Semi-Final 2")));
      const fn = fixtures.find(f => (f.id && f.id.includes("_fn")) || (f.stage && (f.stage.includes("Grand Final") || f.stage === "Final")));

      if (sf1 && sf1.status !== "COMPLETED") {
        if (qf1 && qf1.status === "COMPLETED" && qf1.winner) sf1.teamA = qf1.winner;
        if (qf2 && qf2.status === "COMPLETED" && qf2.winner) sf1.teamB = qf2.winner;
      }
      if (sf2 && sf2.status !== "COMPLETED") {
        if (qf3 && qf3.status === "COMPLETED" && qf3.winner) sf2.teamA = qf3.winner;
        if (qf4 && qf4.status === "COMPLETED" && qf4.winner) sf2.teamB = qf4.winner;
      }

      if (sf1 && sf1.status === "COMPLETED" && sf1.winner) {
        if (fn && fn.status !== "COMPLETED") fn.teamA = sf1.winner;
      }
      if (sf2 && sf2.status === "COMPLETED" && sf2.winner) {
        if (fn && fn.status !== "COMPLETED") fn.teamB = sf2.winner;
      }

      if (tourney.rules?.thirdPrize && sf1 && sf2) {
        let third = fixtures.find(f => f.id === "fx_ko_third");
        if (!third) {
          third = {
            id: "fx_ko_third",
            stage: "Third-Place Playoff",
            teamA: "Loser Semi-Final 1",
            teamB: "Loser Semi-Final 2",
            date: "",
            time: "19:30",
            ground: (tourney.grounds || ["Yuva Stadium, Mumbai"])[0],
            status: "UPCOMING",
            scoreA: "-",
            scoreB: "-",
            winner: null,
            resultText: "Third Place",
            isPlayoff: true
          };
          fixtures.push(third);
        }

        if (sf1.status === "COMPLETED" && sf1.winner &&
            sf2.status === "COMPLETED" && sf2.winner &&
            third.status !== "COMPLETED") {
          third.teamA = sf1.teamA === sf1.winner ? sf1.teamB : sf1.teamA;
          third.teamB = sf2.teamA === sf2.winner ? sf2.teamB : sf2.teamA;
        }
      }

      if (fn && fn.status === "COMPLETED" && fn.winner) {
        tourney.winner = fn.winner;
        tourney.status = "COMPLETED";
      }
    }
  }

  // 4.45 TOURNAMENT PLAYER STATS AGGREGATOR
  function aggregateTournamentPlayerStats(tourney) {
    if (!tourney) return;

    const teams = Array.isArray(tourney.teams) ? tourney.teams : [];
    const teamNames = new Map();
    const registeredPlayers = new Map();
    teams.forEach(team => {
      const teamName = String(typeof team === "string" ? team : (team?.name || "")).trim();
      if (!teamName) return;
      teamNames.set(teamName.toLowerCase(), teamName);
      (typeof team === "object" ? (team.players || []) : []).forEach(p => {
        if (!p || !p.name) return;
        const pid = String(p.id || "").trim();
        const nameKey = `${teamName.toLowerCase()}::${String(p.name).trim().toLowerCase()}`;
        registeredPlayers.set(pid ? `${teamName.toLowerCase()}::id:${pid}` : nameKey, true);
      });
    });

    const batsmenMap = {};
    const bowlersMap = {};
    let totalRuns = 0, totalWickets = 0, totalSixes = 0, totalFours = 0;

    let history = [];
    try { history = JSON.parse(getUserStorage("cricYuvaMatchHistory", "[]") || "[]"); } catch (e) { history = []; }

    const fixtureIds = new Set((tourney.fixtures || []).map(f => f && f.id).filter(Boolean));
    const normalizeTeam = value => String(value?.name || value || "").trim().toLowerCase();
    const isParticipatingTeam = value => teamNames.has(normalizeTeam(value));

    const tourneyMatches = history.filter(m => {
      if (!m) return false;
      const directIdMatch = (m.tourneyId && m.tourneyId === tourney.id) || (m.tournamentId && m.tournamentId === tourney.id);
      const fixtureMatch = (m.fixtureId && fixtureIds.has(m.fixtureId)) || (m.matchId && fixtureIds.has(m.matchId));
      if (!directIdMatch && !fixtureMatch) return false;

      const explicitTeams = [m.teamA, m.teamB, m.teamAName, m.teamBName,
        m.innings1?.battingTeam, m.innings1?.battingTeamName,
        m.innings2?.battingTeam, m.innings2?.battingTeamName,
        m.innings1?.bowlingTeam, m.innings1?.bowlingTeamName,
        m.innings2?.bowlingTeam, m.innings2?.bowlingTeamName]
        .map(normalizeTeam).filter(Boolean);
      if (explicitTeams.length && explicitTeams.some(name => !isParticipatingTeam(name))) return false;
      return explicitTeams.length === 0 || explicitTeams.some(isParticipatingTeam);
    });

    const allowPlayer = (player, teamName) => {
      if (!player || !player.name || !isParticipatingTeam(teamName)) return false;
      if (!registeredPlayers.size) return true;
      const pid = String(player.id || player.playerId || "").trim();
      const teamKey = normalizeTeam(teamName);
      return (pid && registeredPlayers.has(`${teamKey}::id:${pid}`)) || registeredPlayers.has(`${teamKey}::${String(player.name).trim().toLowerCase()}`);
    };

    tourneyMatches.forEach(match => {
      [match.innings1, match.innings2].forEach(inn => {
        if (!inn) return;
        const battingTeam = String(inn.battingTeamName || inn.battingTeam || "").trim();
        const bowlingTeam = String(inn.bowlingTeamName || inn.bowlingTeam || "").trim();
        const validBat = isParticipatingTeam(battingTeam);
        const validBowl = isParticipatingTeam(bowlingTeam);
        if (!validBat && !validBowl) return;

        totalRuns += Number(inn.totalRuns || 0);
        totalWickets += Number(inn.wickets || 0);

        if (validBat) (inn.batting || inn.batsmen || []).forEach(b => {
          if (!allowPlayer(b, battingTeam)) return;
          const pid = String(b.id || b.playerId || "").trim();
          const key = `${normalizeTeam(battingTeam)}::${pid ? `id:${pid}` : String(b.name).trim().toLowerCase()}`;
          if (!batsmenMap[key]) batsmenMap[key] = { id: pid, name: b.name, team: teamNames.get(normalizeTeam(battingTeam)) || battingTeam, runs: 0, balls: 0, fours: 0, sixes: 0, innings: 0, highestScore: 0, fifties: 0, hundreds: 0, isOutCount: 0 };
          const item = batsmenMap[key];
          item.innings += 1; item.runs += Number(b.runs || 0); item.balls += Number(b.balls || 0); item.fours += Number(b.fours || 0); item.sixes += Number(b.sixes || 0);
          totalFours += Number(b.fours || 0); totalSixes += Number(b.sixes || 0);
          if (b.isOut) item.isOutCount += 1;
          if (Number(b.runs || 0) > item.highestScore) item.highestScore = Number(b.runs || 0);
          if (Number(b.runs || 0) >= 100) item.hundreds += 1; else if (Number(b.runs || 0) >= 50) item.fifties += 1;
        });

        if (validBowl) (inn.bowling || inn.bowlers || []).forEach(bw => {
          if (!allowPlayer(bw, bowlingTeam)) return;
          const pid = String(bw.id || bw.playerId || "").trim();
          const key = `${normalizeTeam(bowlingTeam)}::${pid ? `id:${pid}` : String(bw.name).trim().toLowerCase()}`;
          const runsConceded = typeof bw.runsConceded === "number" ? bw.runsConceded : (typeof bw.runs === "number" ? bw.runs : 0);
          if (!bowlersMap[key]) bowlersMap[key] = { id: pid, name: bw.name, team: teamNames.get(normalizeTeam(bowlingTeam)) || bowlingTeam, wickets: 0, runsConceded: 0, ballsBowled: 0, maidens: 0, innings: 0, dots: 0, bestWickets: 0, bestRuns: 999 };
          const item = bowlersMap[key];
          item.innings += 1; item.wickets += Number(bw.wickets || 0); item.runsConceded += Number(runsConceded || 0);
          item.ballsBowled += (Number(bw.overs || 0) * 6) + Number(bw.balls || 0); item.maidens += Number(bw.maidens || 0); item.dots += Number(bw.dots || 0);
          if (Number(bw.wickets || 0) > item.bestWickets || (Number(bw.wickets || 0) === item.bestWickets && Number(runsConceded || 0) < item.bestRuns)) { item.bestWickets = Number(bw.wickets || 0); item.bestRuns = Number(runsConceded || 0); }
        });
      });
    });

    const topBatsmen = Object.values(batsmenMap).map(b => ({ id:b.id, name:b.name, team:b.team, runs:b.runs, balls:b.balls, innings:b.innings, hs:b.highestScore, avg:b.isOutCount > 0 ? (b.runs / b.isOutCount).toFixed(1) : (b.runs > 0 ? `${b.runs}.0` : "0.0"), sr:b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : "0.0", fours:b.fours, sixes:b.sixes, fifties:b.fifties, hundreds:b.hundreds })).sort((a,b)=>b.runs-a.runs || Number(b.sr)-Number(a.sr));
    const topBowlers = Object.values(bowlersMap).map(b => ({ id:b.id, name:b.name, team:b.team, wickets:b.wickets, overs:(b.ballsBowled/6).toFixed(1), runs:b.runsConceded, maidens:b.maidens, econ:b.ballsBowled > 0 ? ((b.runsConceded/b.ballsBowled)*6).toFixed(2) : "0.00", best:b.bestWickets > 0 ? `${b.bestWickets}/${b.bestRuns}` : "0/0", dots:b.dots })).sort((a,b)=>b.wickets-a.wickets || Number(a.econ)-Number(b.econ));

    tourney.stats = { totalRuns, totalWickets, totalSixes, totalFours, topBatsmen, topBowlers };
    return tourney.stats;
  }

  // 4.5 REAL-TIME MATCH TOURNAMENT SYNCHRONIZER
  function syncMatchToTournament(match) {
    if (!match) return;
    try {
      const tourneyList = getTournamentsList();
      let modified = false;

      tourneyList.forEach(t => {
        // A match belongs to a tournament only through an exact tournament/fixture ID.
        // Name fallback is allowed only when the name is exact AND both teams belong to this tournament.
        const directTourney = (match.tourneyId && match.tourneyId === t.id) || (match.tournamentId && match.tournamentId === t.id);
        const fixtureIds = new Set((t.fixtures || []).map(f => f && f.id).filter(Boolean));
        const directFixture = (match.fixtureId && fixtureIds.has(match.fixtureId)) || (match.matchId && fixtureIds.has(match.matchId));
        const mTeamA = String(match.teamA?.name || match.teamA || "").trim().toLowerCase();
        const mTeamB = String(match.teamB?.name || match.teamB || "").trim().toLowerCase();
        const tTeams = new Set((t.teams || []).map(tm => String(typeof tm === "string" ? tm : (tm?.name || "")).trim().toLowerCase()).filter(Boolean));
        const exactNameFallback = !directTourney && !directFixture && !!match.tournament && !!t.name && String(match.tournament).trim().toLowerCase() === String(t.name).trim().toLowerCase() && tTeams.has(mTeamA) && tTeams.has(mTeamB);
        if (!directTourney && !directFixture && !exactNameFallback) return;
        if ((mTeamA && !tTeams.has(mTeamA)) || (mTeamB && !tTeams.has(mTeamB))) return;

        let fix = null;
        if (match.fixtureId || match.matchId) {
          const targetId = match.fixtureId || match.matchId;
          fix = (t.fixtures || []).find(f => f.id === targetId);
        }
        if (!fix) {
          // Find fixture by matching team names and status
          fix = (t.fixtures || []).find(f => {
            const teamAName = match.teamA?.name || match.teamA;
            const teamBName = match.teamB?.name || match.teamB;
            const matchA = f.teamA === teamAName && f.teamB === teamBName;
            const matchB = f.teamA === teamBName && f.teamB === teamAName;
            return (matchA || matchB) && f.status !== "COMPLETED";
          });
        }

        if (fix) {
          const inn1 = match.innings1;
          const inn2 = match.innings2;

          // Compute accurate scores
          if (inn1) {
            const team1Runs = inn1.totalRuns || 0;
            const team1Wkts = inn1.wickets || 0;
            const team1Ovs = `${inn1.overs || 0}.${inn1.balls || 0}`;
            const team2Runs = inn2 ? (inn2.totalRuns || 0) : 0;
            const team2Wkts = inn2 ? (inn2.wickets || 0) : 0;
            const team2Ovs = inn2 ? `${inn2.overs || 0}.${inn2.balls || 0}` : "0.0";

            if (fix.teamA === inn1.battingTeam) {
              fix.scoreA = `${team1Runs}/${team1Wkts} (${team1Ovs} ov)`;
              fix.scoreB = inn2 && (inn2.totalRuns > 0 || inn2.overs > 0 || inn2.balls > 0 || inn2.wickets > 0)
                ? `${team2Runs}/${team2Wkts} (${team2Ovs} ov)` : "-";
            } else {
              fix.scoreB = `${team1Runs}/${team1Wkts} (${team1Ovs} ov)`;
              fix.scoreA = inn2 && (inn2.totalRuns > 0 || inn2.overs > 0 || inn2.balls > 0 || inn2.wickets > 0)
                ? `${team2Runs}/${team2Wkts} (${team2Ovs} ov)` : "-";
            }
          }

          // Determine real fixture status based on match lifecycle
          const isTied = match.status === "TIED";
          const isFinished = (match.status === "COMPLETED" || match.status === "FINISHED" || match.isMatchCompleted) && !isTied;
          const isInningsBreak = match.status === "INNINGS_BREAK" || (match.currentInnings === 2 && !inn2?.batting?.length && inn1?.totalRuns > 0);

          if (isFinished) {
            fix.status = "COMPLETED";
            fix.resultText = match.result || "Match Completed";
            if (match.result && match.result.includes(" won by ")) {
              fix.winner = match.result.split(" won by ")[0].trim();
            } else if (match.winner) {
              fix.winner = match.winner;
            }

            if (match.playerOfTheMatch || match.pom) {
              fix.pom = match.playerOfTheMatch || match.pom;
            }

            // Advance playoffs and compute player stats
            updatePlayoffBrackets(t);
            aggregateTournamentPlayerStats(t);

            // Update tournament status if all fixtures complete
            const allFixturesDone = (t.fixtures || []).every(f => f.status === "COMPLETED");
            if (allFixturesDone) {
              t.status = "COMPLETED";
              const finalFix = (t.fixtures || []).find(f => f.stage && f.stage.toLowerCase().includes("final") && !f.stage.toLowerCase().includes("semi"));
              if (finalFix && finalFix.winner) {
                t.winner = finalFix.winner;
              }
            } else {
              t.status = "ONGOING";
            }
          } else if (isTied) {
            fix.status = "TIED";
            fix.resultText = "Match Tied • Super Over Pending";
            t.status = "ONGOING";
          } else if (isInningsBreak) {
            fix.status = "LIVE";
            fix.resultText = "Innings Break";
            t.status = "ONGOING";
          } else {
            fix.status = "LIVE";
            fix.resultText = "Match Live";
            t.status = "ONGOING";
          }

          modified = true;
        }
      });

      if (modified) {
        saveTournamentsList(tourneyList);
        if (window.CricYuvaCloud) {
          tourneyList.forEach(t => {
            if (t && t.id && (t.id === activeTournamentId || t.fixtures?.some(f => f && (f.id === match.fixtureId || f.id === match.matchId)))) {
              window.CricYuvaCloud.request("/api/tournaments", { method: "POST", body: JSON.stringify(t) }).catch(() => {});
            }
          });
        }
        if (activeTournamentId) {
          openTournamentDetails(activeTournamentId);
        }
      }
    } catch (err) {
      console.error("Error in syncMatchToTournament:", err);
    }
  }

  // 5. RENDER TOURNAMENT LIST SCREEN (ORANGE BUTTON TARGET)
  function openTournamentScreen() {
    window.tourneyNavSource = "list";
    renderTournamentsList();
    showScreen("screen11");

    // Ensure list view is visible, detail view hidden
    const listView = document.getElementById("tournamentsListView");
    const detailView = document.getElementById("tournamentDetailView");
    if (listView) listView.style.display = "flex";
    if (detailView) detailView.style.display = "none";
  }

  // 5.1 OPEN TOURNAMENT OVERVIEW / STANDINGS (BLUE BUTTON TARGET)
  function openTournamentOverviewStandings(preferredTourneyId) {
    const list = getTournamentsList();
    if (!list || list.length === 0) {
      window.tourneyNavSource = "home";
      openTournamentScreen();
      showToast("No tournament found. Create one to get started!");
      return;
    }
    window.tourneyNavSource = "home";
    const targetId = preferredTourneyId || activeTournamentId || list[0].id;
    openTournamentDetails(targetId, "overview");
  }

  function renderTournamentsList() {
    const list = getTournamentsList();

    // 1. Summary Strip Metrics
    const totalCount = list.length;
    const ongoingCount = list.filter(t => t.status === "ONGOING").length;
    const upcomingCount = list.filter(t => t.status === "UPCOMING").length;
    const completedCount = list.filter(t => t.status === "COMPLETED").length;
    const totalMatches = list.reduce((acc, t) => acc + (t.fixtures ? t.fixtures.length : 0), 0);
    const teamsCount = list.reduce((acc, t) => acc + (t.teams ? t.teams.length : 0), 0);

    // Sync all metric elements across both ID schemes
    const elActive = document.getElementById("tourneyCountActive") || document.getElementById("tSummaryOngoingCount");
    const elTotal = document.getElementById("tourneyCountTotal") || document.getElementById("tSummaryTeamsCount");
    const elMatches = document.getElementById("tourneyMatchesTotal") || document.getElementById("tSummaryCompletedCount");

    if (elActive) elActive.textContent = ongoingCount;
    if (elTotal) elTotal.textContent = totalCount;
    if (elMatches) elMatches.textContent = totalMatches;

    // Filter Badges
    const cAll = document.getElementById("tCountAll");
    const cOngoing = document.getElementById("tCountOngoing");
    const cUpcoming = document.getElementById("tCountUpcoming");
    const cCompleted = document.getElementById("tCountCompleted");
    if (cAll) cAll.textContent = totalCount;
    if (cOngoing) cOngoing.textContent = ongoingCount;
    if (cUpcoming) cUpcoming.textContent = upcomingCount;
    if (cCompleted) cCompleted.textContent = completedCount;

    // 2. Filter & Search
    let filtered = list.filter(t => {
      // Status filter
      if (activeTourneyFilterStatus !== "all" && t.status !== activeTourneyFilterStatus) {
        return false;
      }
      // Format filter
      if (activeTourneyFilterFormat !== "all" && t.format !== activeTourneyFilterFormat) {
        return false;
      }
      // Search query
      if (activeTourneySearchQuery.trim().length > 0) {
        const q = activeTourneySearchQuery.toLowerCase();
        const inName = t.name.toLowerCase().includes(q);
        const inFormat = (t.format || "").toLowerCase().includes(q);
        const inGround = (t.grounds || []).some(g => g.toLowerCase().includes(q));
        if (!inName && !inFormat && !inGround) return false;
      }
      return true;
    });

    const container = document.getElementById("tournamentsListContainer");
    const emptyState = document.getElementById("tourneyListEmptyState") || document.getElementById("tournamentsEmptyState");
    if (!container) return;

    if (filtered.length === 0) {
      container.innerHTML = "";
      if (emptyState) emptyState.style.display = "flex";
      return;
    }

    if (emptyState) emptyState.style.display = "none";

    container.innerHTML = filtered.map(t => {
      const tMatches = (t.fixtures || []).length;
      const doneMatches = (t.fixtures || []).filter(f => f.status === "COMPLETED").length;
      const pct = tMatches > 0 ? Math.round((doneMatches / tMatches) * 100) : 0;
      const tTeamCount = (t.teams || []).length;

      const teamsAvatars = (t.teams || []).slice(0, 4).map(tm => {
        const logo = tm.logo || "🏏";
        return `<span class="t-card-team-avatar" title="${tm.name}">${logo}</span>`;
      }).join("");

      const extraTeams = tTeamCount > 4 ? `<span class="t-card-team-avatar">+${tTeamCount - 4}</span>` : "";

      return `
        <div class="tournament-card" data-tourney-id="${t.id}">
          <div class="t-card-top-row">
            <div class="t-card-logo-title">
              <div class="t-card-logo-badge">${t.logo || "🏆"}</div>
              <div class="t-card-info">
                <h3 class="t-card-name">${t.name}</h3>
                <div class="t-card-tags">
                  <span class="tourney-format-pill">${t.format}</span>
                  <span class="tourney-status-pill status-${t.status}">${t.status}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="t-card-details-grid">
            <div class="t-card-stat-item">
              <span class="t-card-stat-lbl"><i class="fa-solid fa-shield-halved"></i> Teams</span>
              <span class="t-card-stat-val">${tTeamCount} Clubs</span>
            </div>
            <div class="t-card-stat-item">
              <span class="t-card-stat-lbl"><i class="fa-solid fa-stopwatch"></i> Overs</span>
              <span class="t-card-stat-val">${t.overs || 20} Ov</span>
            </div>
            <div class="t-card-stat-item">
              <span class="t-card-stat-lbl"><i class="fa-solid fa-calendar-days"></i> Dates</span>
              <span class="t-card-stat-val">${t.startDate ? t.startDate.slice(5) : "2026"}</span>
            </div>
          </div>

          <div class="t-card-progress-bar-wrap">
            <div class="t-card-progress-labels">
              <span>Tournament Progress</span>
              <span>${doneMatches}/${tMatches} Matches (${pct}%)</span>
            </div>
            <div class="t-card-progress-track">
              <div class="t-card-progress-fill" style="width: ${pct}%"></div>
            </div>
          </div>

          <div class="t-card-footer-row">
            <div class="t-card-teams-preview">
              ${teamsAvatars}
              ${extraTeams}
            </div>
            <button type="button" class="t-card-action-btn btn-view-tourney" data-tourney-id="${t.id}">
              VIEW DETAILS <i class="fa-solid fa-arrow-right"></i>
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  // 6. RENDER TOURNAMENT DETAILS VIEW (7 TABS)
  function resolveTournamentOutcome(tourney) {
    if (!tourney) return null;
    const teams = new Set((tourney.teams || []).map(t => String(typeof t === "string" ? t : (t?.name || "")).trim()).filter(Boolean));
    const validTeam = name => name && teams.has(String(name).trim());
    const fixtures = tourney.fixtures || [];
    const finalFix = [...fixtures].reverse().find(f => f && f.status === "COMPLETED" && f.winner && /final/i.test(f.stage || "") && !/semi|quarter|third/i.test(f.stage || ""));
    if (finalFix && validTeam(finalFix.winner) && validTeam(finalFix.teamA) && validTeam(finalFix.teamB)) {
      const runnerUp = finalFix.winner === finalFix.teamA ? finalFix.teamB : finalFix.teamA;
      if (validTeam(runnerUp)) { tourney.winner = finalFix.winner; tourney.runnerUp = runnerUp; }
    } else if (tourney.winner && !validTeam(tourney.winner)) {
      tourney.winner = null;
      tourney.runnerUp = null;
    }
    return { winner: tourney.winner || null, runnerUp: tourney.runnerUp || null };
  }

  function openTournamentDetails(tourneyId, initialTab) {
    const tourney = getTournamentById(tourneyId);
    if (!tourney) return;

    activeTournamentId = tourneyId;

    if (typeof updatePlayoffBrackets === "function") updatePlayoffBrackets(tourney);
    if (typeof aggregateTournamentPlayerStats === "function") aggregateTournamentPlayerStats(tourney);
    resolveTournamentOutcome(tourney);

    const listView = document.getElementById("tournamentsListView");
    const detailView = document.getElementById("tournamentDetailView");
    if (listView) listView.style.display = "none";
    if (detailView) detailView.style.display = "flex";
    showScreen("screen11");

    // Set Header Title
    const hName = document.getElementById("tDetailHeaderName");
    if (hName) hName.textContent = tourney.name;

    // Render Hero Card
    const logoEl = document.getElementById("tHeroLogo");
    const nameEl = document.getElementById("tHeroName");
    const formatEl = document.getElementById("tHeroFormat") || document.getElementById("tHeroFormatPill");
    const statusEl = document.getElementById("tHeroStatus") || document.getElementById("tHeroStatusPill");
    const datesEl = document.getElementById("tHeroDates");
    const oversEl = document.getElementById("tHeroOvers");
    const groundsEl = document.getElementById("tHeroVenues") || document.getElementById("tHeroGrounds");
    const winnerBanner = document.getElementById("tHeroWinnerBanner") || document.getElementById("tWinnerBanner");
    const winnerTeamName = document.getElementById("tHeroWinnerName") || document.getElementById("tWinnerTeamName");
    const tabTeamsCount = document.getElementById("tTabTeamsCount");

    if (logoEl) logoEl.textContent = tourney.logo || "🏆";
    if (nameEl) nameEl.textContent = tourney.name;
    if (formatEl) formatEl.textContent = tourney.format;
    if (statusEl) {
      statusEl.textContent = tourney.status;
      statusEl.className = `tourney-status-pill status-${tourney.status}`;
    }
    if (datesEl) datesEl.textContent = `${tourney.startDate || "2026-03-01"} to ${tourney.endDate || "2026-04-01"}`;
    if (oversEl) oversEl.textContent = `${tourney.overs || 20} Overs Match`;
    if (groundsEl) {
      const gCount = (tourney.grounds || []).length;
      groundsEl.textContent = gCount > 1 ? `${tourney.grounds[0]} (+${gCount - 1} more)` : (tourney.grounds[0] || "Yuva Stadium");
    }

    if (tabTeamsCount) {
      tabTeamsCount.textContent = (tourney.teams || []).length;
    }

    // Toggle Auction Tab Navigation based on Tournament Type (REGULAR vs AUCTION)
    const auctionTabNav = document.getElementById("tTabAuctionNav");
    if (auctionTabNav) {
      auctionTabNav.style.display = tourney.type === "AUCTION" ? "inline-flex" : "none";
    }

    if (tourney.winner && winnerBanner && winnerTeamName) {
      winnerBanner.style.display = "flex";
      winnerTeamName.textContent = tourney.winner;
      const runnerEl = document.getElementById("tHeroRunnerUpName");
      if (runnerEl) runnerEl.textContent = tourney.runnerUp ? `Runner-Up: ${tourney.runnerUp}` : "Runner-Up: —";
    } else if (winnerBanner) {
      winnerBanner.style.display = "none";
    }

    // Progress Bar
    const totalMatches = (tourney.fixtures || []).length;
    const doneMatches = (tourney.fixtures || []).filter(f => f.status === "COMPLETED").length;
    const pct = totalMatches > 0 ? Math.round((doneMatches / totalMatches) * 100) : 0;
    const pFill = document.getElementById("tHeroProgressBar") || document.getElementById("tHeroProgressFill");
    const pMatches = document.getElementById("tHeroProgressLabel") || document.getElementById("tHeroProgressMatches");
    const pPct = document.getElementById("tHeroProgressPercent") || document.getElementById("tHeroProgressPct");
    if (pFill) pFill.style.width = `${pct}%`;
    if (pMatches) pMatches.textContent = `Matches: ${doneMatches} / ${totalMatches} Completed`;
    if (pPct) pPct.textContent = `${pct}%`;

    // Render Active Tab Content
    const curTab = initialTab || activeTourneyDetailTab.replace("tPane", "").toLowerCase() || "overview";
    switchTournamentTab(curTab);
  }

  function switchTournamentTab(tabKey) {
    // Normalize tabKey (e.g. 'overview', 'teams', 'fixtures', 'points', 'stats', 'rules', 'results', 'auction', 'chat')
    let normKey = tabKey.toLowerCase().replace("tpane", "");
    if (!normKey) normKey = "overview";
    activeTourneyDetailTab = normKey;

    const tourney = getTournamentById(activeTournamentId);
    if (!tourney) return;

    // Update Tab Navigation Buttons
    document.querySelectorAll(".t-nav-tab").forEach(tab => {
      const tKey = (tab.dataset.ttab || tab.dataset.tab || "").toLowerCase().replace("tpane", "");
      tab.classList.toggle("active", tKey === normKey);
    });

    // Hide all panes
    document.querySelectorAll(".tourney-tab-pane").forEach(pane => {
      pane.style.display = "none";
    });

    // Show active pane matching ID convention
    const capKey = normKey.charAt(0).toUpperCase() + normKey.slice(1);
    const targetPane = document.getElementById(`tPane${capKey}`) || document.getElementById(`pane_t${capKey}`) || document.getElementById(`pane_${normKey}`);
    if (targetPane) {
      targetPane.style.display = "block";
    }

    if (normKey === "overview") {
      renderOverviewTab(tourney);
    } else if (normKey === "teams") {
      renderTeamsTab(tourney);
    } else if (normKey === "fixtures") {
      renderFixturesTab(tourney);
    } else if (normKey === "points") {
      renderPointsTableTab(tourney);
    } else if (normKey === "stats") {
      renderStatsTab(tourney);
    } else if (normKey === "rules") {
      renderRulesTab(tourney);
    } else if (normKey === "results") {
      renderResultsTab(tourney);
    } else if (normKey === "auction") {
      renderAuctionTab(tourney);
    } else if (normKey === "chat") {
      renderTournamentChatTab(tourney);
    }
  }

  // TAB 1: OVERVIEW
  function renderOverviewTab(tourney) {
    // 0. Key Tournament Overview Dashboard Card Metrics
    const oLogo = document.getElementById("tOverviewLogo");
    const oName = document.getElementById("tOverviewName");
    const oFormat = document.getElementById("tOverviewFormat");
    const oFormatLbl = document.getElementById("tOverviewFormatLabel");
    const oStatus = document.getElementById("tOverviewStatus");
    const oTeams = document.getElementById("tOverviewTotalTeams");
    const oPlayers = document.getElementById("tOverviewTotalPlayers");
    const oMatches = document.getElementById("tOverviewTotalMatches");
    const oCompleted = document.getElementById("tOverviewCompletedMatches");
    const oUpcoming = document.getElementById("tOverviewUpcomingMatches");

    if (oLogo) oLogo.textContent = tourney.logo || "🏆";
    if (oName) oName.textContent = tourney.name || "Tournament Overview";
    if (oFormat) oFormat.textContent = tourney.format || "League";
    if (oFormatLbl) oFormatLbl.textContent = tourney.format || "League";

    if (oStatus) {
      oStatus.textContent = tourney.status || "UPCOMING";
      oStatus.className = `tourney-status-pill status-${tourney.status || 'UPCOMING'}`;
    }

    const teamCount = (tourney.teams || []).length;
    if (oTeams) oTeams.textContent = teamCount;

    const totalPlayersCount = (tourney.teams || []).reduce((acc, tm) => {
      if (tm.players && Array.isArray(tm.players) && tm.players.length > 0) return acc + tm.players.length;
      if (tm.playerCount) return acc + tm.playerCount;
      return acc + 11;
    }, 0);
    if (oPlayers) oPlayers.textContent = totalPlayersCount;

    const totalFixtures = (tourney.fixtures || []).length;
    const completedFixtures = (tourney.fixtures || []).filter(f => f.status === "COMPLETED").length;
    const upcomingFixtures = (tourney.fixtures || []).filter(f => f.status === "UPCOMING" || f.status === "SCHEDULED" || f.status === "LIVE").length;

    if (oMatches) oMatches.textContent = totalFixtures;
    if (oCompleted) oCompleted.textContent = completedFixtures;
    if (oUpcoming) oUpcoming.textContent = upcomingFixtures;

    // 1. Next / Live Match Spotlight
    const nextFixture = (tourney.fixtures || []).find(f => f.status === "LIVE") ||
                        (tourney.fixtures || []).find(f => f.status === "UPCOMING");
    const spotlightCard = document.getElementById("tSpotlightMatchCard") || document.getElementById("tSpotlightCard");

    if (spotlightCard) {
      if (nextFixture) {
        spotlightCard.style.display = "block";
        const isLive = nextFixture.status === "LIVE";
        spotlightCard.innerHTML = `
          <div class="spotlight-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <span class="spotlight-badge" style="background:#ff5a0022; color:#ff7a29; border:1px solid #ff5a0055; padding:4px 10px; border-radius:8px; font-size:12px; font-weight:800;">
              <i class="fa-solid ${isLive ? 'fa-tower-broadcast' : 'fa-fire'}"></i> ${isLive ? 'LIVE MATCH' : nextFixture.stage}
            </span>
            <span style="font-size:12px; color:#aaaaaa;"><i class="fa-solid fa-clock"></i> ${nextFixture.date} • ${nextFixture.time}</span>
          </div>
          <div class="spotlight-matchup" style="display:flex; align-items:center; justify-content:space-around; padding:12px 0;">
            <div class="spotlight-team" style="display:flex; flex-direction:column; align-items:center; gap:6px;">
              <div class="spotlight-team-logo" style="width:48px; height:48px; border-radius:14px; background:#242424; border:1px solid #333333; display:flex; align-items:center; justify-content:center; font-size:24px;">🏏</div>
              <span class="spotlight-team-name" style="font-size:14px; font-weight:800; color:#ffffff;">${nextFixture.teamA}</span>
              ${isLive ? `<span style="color:#ff7a29; font-weight:800; font-size:13px;">${nextFixture.scoreA || '0/0'}</span>` : ''}
            </div>
            <div class="spotlight-vs" style="font-size:16px; font-weight:900; color:#ff5a00; background:#1e1e1e; padding:6px 12px; border-radius:20px; border:1px solid #333333;">VS</div>
            <div class="spotlight-team" style="display:flex; flex-direction:column; align-items:center; gap:6px;">
              <div class="spotlight-team-logo" style="width:48px; height:48px; border-radius:14px; background:#242424; border:1px solid #333333; display:flex; align-items:center; justify-content:center; font-size:24px;">⚡</div>
              <span class="spotlight-team-name" style="font-size:14px; font-weight:800; color:#ffffff;">${nextFixture.teamB}</span>
              ${isLive ? `<span style="color:#ff7a29; font-weight:800; font-size:13px;">${nextFixture.scoreB || '0/0'}</span>` : ''}
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #222222; padding-top:10px; margin-top:8px;">
            <span style="font-size:12px; color:#888888;"><i class="fa-solid fa-location-dot text-orange"></i> ${nextFixture.ground}</span>
            ${isLive ? `
              <button type="button" class="fixture-action-btn btn-resume-live-match" data-fixture-id="${nextFixture.id}" style="background:#22c55e; color:#ffffff; border:none; padding:8px 16px; border-radius:8px; font-weight:800; cursor:pointer; font-size:12px;">
                <i class="fa-solid fa-play"></i> RESUME MATCH
              </button>
            ` : `
              <button type="button" class="fixture-action-btn btn-start-match btn-start-spotlight-match" data-fixture-id="${nextFixture.id}" style="background:#ff5a00; color:#ffffff; border:none; padding:8px 16px; border-radius:8px; font-weight:800; cursor:pointer; font-size:12px;">
                <i class="fa-solid fa-baseball-bat-ball"></i> START MATCH
              </button>
            `}
          </div>
        `;
      } else {
        spotlightCard.style.display = "none";
      }
    }

    // 2. Overview Stat Metrics
    const stRuns = document.getElementById("tOverviewTotalRuns") || document.getElementById("tStatTotalRuns");
    const stWkts = document.getElementById("tOverviewTotalWkts") || document.getElementById("tStatTotalWickets");
    const stTopScorer = document.getElementById("tOverviewTopScorer") || document.getElementById("tStatRunsLeader");
    const stTopBowler = document.getElementById("tOverviewTopBowler") || document.getElementById("tStatWicketsLeader");

    if (stRuns) stRuns.textContent = tourney.stats?.totalRuns || 0;
    if (stWkts) stWkts.textContent = tourney.stats?.totalWickets || 0;
    if (stTopScorer) {
      const topB = tourney.stats?.topBatsmen?.[0];
      stTopScorer.textContent = topB ? `${topB.name} (${topB.runs})` : "Awaiting Data";
    }
    if (stTopBowler) {
      const topW = tourney.stats?.topBowlers?.[0];
      stTopBowler.textContent = topW ? `${topW.name} (${topW.wickets}w)` : "Awaiting Data";
    }

    // 3. Mini Standings Preview
    const standingsPreview = document.getElementById("tOverviewStandingsPreview");
    if (standingsPreview) {
      const table = computePointsTable(tourney);
      if (table.length === 0) {
        standingsPreview.innerHTML = `<div style="text-align:center; padding:20px; color:#777777; font-size:12px;">No participating teams registered yet</div>`;
      } else {
        const top4 = table.slice(0, 4);
        standingsPreview.innerHTML = `
          <div class="points-table-card" style="border:none; border-radius:10px;">
            <table class="points-table" style="font-size:12px;">
              <thead>
                <tr>
                  <th style="padding:8px 6px; text-align:center; width:36px;">#</th>
                  <th style="padding:8px 10px; text-align:left;">TEAM</th>
                  <th style="padding:8px 6px; text-align:center;">P</th>
                  <th style="padding:8px 6px; text-align:center;">W</th>
                  <th style="padding:8px 6px; text-align:center;">L</th>
                  <th style="padding:8px 6px; text-align:center;">NRR</th>
                  <th style="padding:8px 6px; text-align:center; font-weight:800; color:#ff7a29;">PTS</th>
                </tr>
              </thead>
              <tbody>
                ${top4.map((r, i) => `
                  <tr>
                    <td style="padding:8px 6px; text-align:center;"><span class="pos-badge ${i < 2 ? 'qualify-q1' : (i < 4 ? 'qualify-el' : '')}">${i + 1}</span></td>
                    <td class="team-cell" style="padding:8px 10px;"><span>${r.logo || '🏏'}</span> <span style="font-weight:700; color:#ffffff;">${r.team}</span></td>
                    <td style="padding:8px 6px; text-align:center; color:#cccccc;">${r.p}</td>
                    <td style="padding:8px 6px; text-align:center; color:#4ade80; font-weight:700;">${r.w}</td>
                    <td style="padding:8px 6px; text-align:center; color:#f87171; font-weight:700;">${r.l}</td>
                    <td style="padding:8px 6px; text-align:center;" class="${r.nrr >= 0 ? 'nrr-pos' : 'nrr-neg'}">${r.nrr > 0 ? '+' : ''}${r.nrr.toFixed(3)}</td>
                    <td style="padding:8px 6px; text-align:center; font-weight:900; color:#ff7a29;" class="pts-cell">${r.pts}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;
      }
    }

    // 4. Matches Sections: Live, Upcoming, and Recent Completed (Separated cleanly)
    const fixturesPreview = document.getElementById("tOverviewFixturesPreview") || document.getElementById("tOverviewRecentMatches");
    if (fixturesPreview) {
      const allFixtures = tourney.fixtures || [];
      const liveMatches = allFixtures.filter(f => f.status === "LIVE");
      const upcomingMatches = allFixtures.filter(f => f.status === "UPCOMING");
      const completedMatches = allFixtures.filter(f => f.status === "COMPLETED");

      let html = "";

      // 4.1 LIVE MATCHES
      if (liveMatches.length > 0) {
        html += `
          <div class="overview-fixtures-header" style="display:flex; justify-content:space-between; align-items:center; margin:14px 0 8px 0;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="pulse-red-dot" style="width:10px; height:10px; border-radius:50%; background:#ef4444; display:inline-block;"></span>
              <h4 style="font-size:12px; font-weight:800; color:#ef4444; margin:0; text-transform:uppercase; letter-spacing:0.5px;">Live Matches (${liveMatches.length})</h4>
            </div>
            <button type="button" class="btn-jump-fixtures" style="background:none; border:none; color:#38bdf8; font-size:11px; font-weight:700; cursor:pointer;">View All <i class="fa-solid fa-arrow-right"></i></button>
          </div>
        `;
        html += liveMatches.map(f => `
          <div class="fixture-card is-live" style="background:#1a1a1a; border:1px solid #ef4444; border-radius:12px; padding:12px; margin-bottom:10px;">
            <div class="fixture-top-bar" style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:11px;">
              <span class="fixture-stage-pill" style="color:#ef4444; font-weight:800;"><i class="fa-solid fa-tower-broadcast"></i> ${f.stage}</span>
              <span class="fixture-venue-text" style="color:#888888;"><i class="fa-solid fa-location-dot"></i> ${f.ground}</span>
            </div>
            <div class="fixture-teams-body" style="display:flex; flex-direction:column; gap:6px;">
              <div class="fixture-team-row" style="display:flex; justify-content:space-between; align-items:center;">
                <div class="fixture-team-left" style="display:flex; align-items:center; gap:8px;">
                  <span class="fixture-team-avatar">🏏</span>
                  <span class="fixture-team-name" style="font-weight:700; color:#ffffff;">${f.teamA}</span>
                </div>
                <span class="fixture-score-text" style="font-weight:800; color:#ef4444;">${f.scoreA || '-'}</span>
              </div>
              <div class="fixture-team-row" style="display:flex; justify-content:space-between; align-items:center;">
                <div class="fixture-team-left" style="display:flex; align-items:center; gap:8px;">
                  <span class="fixture-team-avatar">⚡</span>
                  <span class="fixture-team-name" style="font-weight:700; color:#ffffff;">${f.teamB}</span>
                </div>
                <span class="fixture-score-text" style="font-weight:800; color:#ef4444;">${f.scoreB || '-'}</span>
              </div>
            </div>
            <div style="margin-top:8px; padding-top:8px; border-top:1px solid #262626; display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:11px; color:#ef4444; font-weight:700;">● MATCH IN PROGRESS</span>
              <button type="button" class="fixture-action-btn btn-public-live-watch" data-fixture-id="${f.id}" style="background:#ef4444; color:#ffffff; border:none; padding:5px 12px; border-radius:6px; font-weight:800; font-size:11px; cursor:pointer;">
                <i class="fa-solid fa-tower-broadcast"></i> Watch Live
              </button>
            </div>
          </div>
        `).join("");
      }

      // 4.2 UPCOMING MATCHES
      html += `
        <div class="overview-fixtures-header" style="display:flex; justify-content:space-between; align-items:center; margin:14px 0 8px 0;">
          <h4 style="font-size:12px; font-weight:800; color:#ff7a29; margin:0; text-transform:uppercase; letter-spacing:0.5px;">Upcoming Matches (${upcomingMatches.length})</h4>
          <button type="button" class="btn-jump-fixtures" style="background:none; border:none; color:#38bdf8; font-size:11px; font-weight:700; cursor:pointer;">View All <i class="fa-solid fa-arrow-right"></i></button>
        </div>
      `;
      if (upcomingMatches.length === 0) {
        html += `<div style="text-align:center; padding:12px; color:#777777; font-size:12px; background:#141414; border-radius:8px; margin-bottom:12px;">No upcoming fixtures scheduled.</div>`;
      } else {
        html += upcomingMatches.slice(0, 4).map(f => `
          <div class="fixture-card" style="background:#1a1a1a; border:1px solid #292929; border-radius:12px; padding:12px; margin-bottom:10px;">
            <div class="fixture-top-bar" style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:11px;">
              <span class="fixture-stage-pill" style="color:#ff7a29; font-weight:700;">${f.stage}</span>
              <span class="fixture-venue-text" style="color:#888888;"><i class="fa-solid fa-location-dot"></i> ${f.ground}</span>
            </div>
            <div class="fixture-teams-body" style="display:flex; flex-direction:column; gap:6px;">
              <div class="fixture-team-row" style="display:flex; justify-content:space-between; align-items:center;">
                <div class="fixture-team-left" style="display:flex; align-items:center; gap:8px;">
                  <span class="fixture-team-avatar">🏏</span>
                  <span class="fixture-team-name" style="font-weight:700; color:#ffffff;">${f.teamA}</span>
                </div>
                <span class="fixture-score-text" style="font-weight:800; color:#888888;">-</span>
              </div>
              <div class="fixture-team-row" style="display:flex; justify-content:space-between; align-items:center;">
                <div class="fixture-team-left" style="display:flex; align-items:center; gap:8px;">
                  <span class="fixture-team-avatar">⚡</span>
                  <span class="fixture-team-name" style="font-weight:700; color:#ffffff;">${f.teamB}</span>
                </div>
                <span class="fixture-score-text" style="font-weight:800; color:#888888;">-</span>
              </div>
            </div>
            <div style="margin-top:8px; padding-top:8px; border-top:1px solid #262626; display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:11px; color:#777777;"><i class="fa-solid fa-calendar-day"></i> ${f.date} at ${f.time || "19:30"}</span>
              <button type="button" class="btn-start-match" data-fixture-id="${f.id}" style="background:#ff5a00; color:#ffffff; border:none; padding:5px 12px; border-radius:6px; font-weight:800; font-size:11px; cursor:pointer;">
                <i class="fa-solid fa-baseball-bat-ball"></i> Start Match
              </button>
            </div>
          </div>
        `).join("");
      }

      // 4.3 RECENT RESULTS
      if (completedMatches.length > 0) {
        html += `
          <div class="overview-fixtures-header" style="display:flex; justify-content:space-between; align-items:center; margin:14px 0 8px 0;">
            <h4 style="font-size:12px; font-weight:800; color:#4ade80; margin:0; text-transform:uppercase; letter-spacing:0.5px;">Recent Results (${completedMatches.length})</h4>
            <button type="button" class="btn-jump-fixtures" style="background:none; border:none; color:#38bdf8; font-size:11px; font-weight:700; cursor:pointer;">View All <i class="fa-solid fa-arrow-right"></i></button>
          </div>
        `;
        html += completedMatches.slice(-4).reverse().map(f => `
          <div class="fixture-card" style="background:#1a1a1a; border:1px solid #292929; border-radius:12px; padding:12px; margin-bottom:10px;">
            <div class="fixture-top-bar" style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:11px;">
              <span class="fixture-stage-pill" style="color:#888888; font-weight:700;">${f.stage}</span>
              <span class="fixture-venue-text" style="color:#888888;"><i class="fa-solid fa-location-dot"></i> ${f.ground}</span>
            </div>
            <div class="fixture-teams-body" style="display:flex; flex-direction:column; gap:6px;">
              <div class="fixture-team-row" style="display:flex; justify-content:space-between; align-items:center;">
                <div class="fixture-team-left" style="display:flex; align-items:center; gap:8px;">
                  <span class="fixture-team-avatar">🏏</span>
                  <span class="fixture-team-name ${f.winner === f.teamA ? 'winner-text' : ''}" style="font-weight:700; color:#ffffff;">${f.teamA}</span>
                </div>
                <span class="fixture-score-text" style="font-weight:800; color:#ff7a29;">${f.scoreA || '-'}</span>
              </div>
              <div class="fixture-team-row" style="display:flex; justify-content:space-between; align-items:center;">
                <div class="fixture-team-left" style="display:flex; align-items:center; gap:8px;">
                  <span class="fixture-team-avatar">⚡</span>
                  <span class="fixture-team-name ${f.winner === f.teamB ? 'winner-text' : ''}" style="font-weight:700; color:#ffffff;">${f.teamB}</span>
                </div>
                <span class="fixture-score-text" style="font-weight:800; color:#ff7a29;">${f.scoreB || '-'}</span>
              </div>
            </div>
            <div class="fixture-result-bar" style="margin-top:8px; padding-top:8px; border-top:1px solid #262626; display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:11px; color:#4ade80; font-weight:700;"><i class="fa-solid fa-trophy text-orange"></i> ${f.resultText}</span>
              <button type="button" class="fixture-action-btn btn-view-scorecard" data-fixture-id="${f.id}" style="background:#222; color:#38bdf8; border:1px solid #38bdf8; padding:4px 10px; border-radius:6px; font-weight:700; font-size:11px; cursor:pointer;">
                <i class="fa-solid fa-chart-column"></i> Scorecard
              </button>
            </div>
          </div>
        `).join("");
      }

      fixturesPreview.innerHTML = html;
      fixturesPreview.querySelectorAll(".btn-jump-fixtures").forEach(btn => {
        btn.addEventListener("click", () => switchTournamentTab("fixtures"));
      });
    }
  }

  // Helper: Find assigned group for a team
  function getTeamAssignedGroup(tourney, teamName) {
    if (!tourney || !tourney.groups || !Array.isArray(tourney.groups)) return null;
    for (const g of tourney.groups) {
      if (g.teams && Array.isArray(g.teams)) {
        const found = g.teams.find(tm => (typeof tm === "string" ? tm : tm.name) === teamName);
        if (found) return g;
      }
    }
    return null;
  }

  // TAB 2: TEAMS & GROUP STAGES
  function renderTeamsTab(tourney) {
    const teams = tourney.teams || [];
    const countHeader = document.getElementById("tTeamsTotalHeader") || document.getElementById("tTeamsCountDisplay");
    const countTab = document.getElementById("tTabTeamsCount");
    const gridContainer = document.getElementById("tTeamsListGrid") || document.getElementById("tTeamsGridContainer");
    const groupContainer = document.getElementById("tGroupStageTeamsContainer");
    const regSubcount = document.getElementById("tRegisteredTeamsSubcount");

    if (countHeader) countHeader.textContent = `${teams.length} Teams`;
    if (countTab) countTab.textContent = teams.length;
    if (regSubcount) regSubcount.textContent = `(${teams.length})`;

    // Render Group Management Section
    if (groupContainer) {
      const groups = tourney.groups || [];
      if (groups.length > 0) {
        groupContainer.style.display = "grid";
        groupContainer.innerHTML = groups.map(g => {
          const grpTeams = g.teams || [];
          return `
            <div class="group-card-box" data-group-id="${g.id}">
              <div class="group-card-header">
                <div class="group-card-title-wrap">
                  <h4 class="group-card-title">
                    <i class="fa-solid fa-layer-group text-orange"></i>
                    <span>${g.name}</span>
                  </h4>
                  <span class="group-card-badge">${grpTeams.length} ${grpTeams.length === 1 ? 'Team' : 'Teams'}</span>
                </div>
                <div class="group-card-actions">
                  <button type="button" class="btn-group-header-action add-team btn-add-team-to-group" data-group-id="${g.id}" title="Add team to this group">
                    <i class="fa-solid fa-plus"></i> Add Team
                  </button>
                  <button type="button" class="btn-group-header-action btn-edit-group" data-group-id="${g.id}" title="Rename Group">
                    <i class="fa-solid fa-pen"></i>
                  </button>
                  <button type="button" class="btn-group-header-action danger btn-delete-group" data-group-id="${g.id}" title="Delete Group">
                    <i class="fa-solid fa-trash-can"></i>
                  </button>
                </div>
              </div>

              <div class="group-teams-list">
                ${grpTeams.length > 0 ? grpTeams.map(tm => {
                  const tName = typeof tm === "string" ? tm : tm.name;
                  const tLogo = (typeof tm === "object" && tm.logo) ? tm.logo : "🏏";
                  const tCap = (typeof tm === "object" && tm.captain) ? `Cap: ${tm.captain}` : "Squad Registered";

                  return `
                    <div class="group-team-item">
                      <div class="group-team-info-left">
                        <div class="group-team-logo">${tLogo}</div>
                        <div class="group-team-meta">
                          <div class="group-team-name">${tName}</div>
                          <div class="group-team-sub"><i class="fa-solid fa-users"></i> ${tCap}</div>
                        </div>
                      </div>
                      <div class="group-team-actions">
                        <button type="button" class="btn-team-group-action btn-move-team-group" data-team-name="${tName}" data-group-id="${g.id}" title="Move team to another group">
                          <i class="fa-solid fa-arrow-right-arrow-left text-orange"></i> Move
                        </button>
                        <button type="button" class="btn-team-group-action danger btn-remove-team-from-group" data-team-name="${tName}" data-group-id="${g.id}" title="Remove team from this group">
                          <i class="fa-solid fa-xmark"></i>
                        </button>
                      </div>
                    </div>
                  `;
                }).join("") : `
                  <div class="group-teams-empty">
                    <i class="fa-solid fa-users" style="font-size:18px; color:#555555;"></i>
                    <span>No teams in this group yet.</span>
                    <button type="button" class="btn-group-header-action add-team btn-add-team-to-group" data-group-id="${g.id}" style="margin-top:4px;">
                      <i class="fa-solid fa-plus"></i> Assign Team
                    </button>
                  </div>
                `}
              </div>
            </div>
          `;
        }).join("");
      } else {
        groupContainer.style.display = "none";
      }
    }

    if (!gridContainer) return;

    if (teams.length === 0) {
      gridContainer.innerHTML = `<div style="text-align:center; padding:30px; color:#777777;">No participating clubs registered</div>`;
      return;
    }

    gridContainer.innerHTML = teams.map(t => {
      const pCount = t.playerCount || (t.players ? t.players.length : 11);
      const cap = t.captain || (t.players && t.players.find(p => p.isCaptain)?.name) || "Squad Set";
      const vc = t.viceCaptain || (t.players && t.players.find(p => p.isVC)?.name) || "";
      const isMyTeam = t.name.toLowerCase().includes("yuva") || t.id === "club_my_team";
      const assignedGroup = getTeamAssignedGroup(tourney, t.name);
      const hasTourneyGroups = tourney.groups && tourney.groups.length > 0;
      const teamFixtures = (tourney.fixtures || []).filter(f => f.teamA === t.name || f.teamB === t.name);

      return `
        <div class="tourney-team-card" data-team-name="${t.name}" style="background:#151821; border:1px solid #232c42; border-radius:12px; padding:14px; margin-bottom:12px;">
          <div class="team-card-top" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
            <div class="team-card-left" style="display:flex; align-items:center; gap:10px;">
              <div class="team-card-logo-badge" style="font-size:24px;">${t.logo || "🏏"}</div>
              <div class="team-card-meta">
                <h4 class="team-card-title" style="margin:0; font-size:15px; font-weight:800; color:#fff;">
                  ${t.name} ${isMyTeam ? '<span style="color:#ff7a29; font-size:11px;">(My Team)</span>' : ''}
                </h4>
                <span class="team-card-sub" style="font-size:11px; color:#888; display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:3px;">
                  <span><i class="fa-solid fa-users"></i> ${pCount} Players</span> •
                  <span style="color:#facc15;"><i class="fa-solid fa-crown text-gold"></i> Cap: ${cap}</span>
                  ${vc ? `<span style="color:#60a5fa;">• <i class="fa-solid fa-star text-orange"></i> VC: ${vc}</span>` : ''}
                </span>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
              <button type="button" class="btn-manage-tourney-squad" data-team-name="${t.name}" style="background:#1e1e1e; border:1px solid #3a3a3a; color:#ff7a29; padding:5px 10px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
                <i class="fa-solid fa-users-gear"></i> Squad & Playing XI
              </button>
              ${hasTourneyGroups ? (
                assignedGroup ? `
                  <span class="team-card-group-pill" title="Assigned to ${assignedGroup.name}">
                    <i class="fa-solid fa-layer-group"></i> ${assignedGroup.name}
                  </span>
                ` : `
                  <span class="team-card-group-pill unassigned" title="Not assigned to any group">
                    <i class="fa-solid fa-circle-question"></i> Unassigned
                  </span>
                `
              ) : ''}
              <span class="team-card-badge-pill" style="background:#16a34a22; color:#4ade80; border:1px solid #16a34a55; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700;"><i class="fa-solid fa-check-circle"></i> Registered</span>
              ${tourney.status === "UPCOMING" ? `
                <button type="button" class="btn-remove-tourney-team" data-team-name="${t.name}" style="background:transparent; border:none; color:#f87171; cursor:pointer; padding:4px;" title="Remove Team">
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              ` : ''}
            </div>
          </div>

          <!-- REAL TEAM TOURNAMENT FIXTURES -->
          <div class="team-fixtures-accordion" style="background:#0e1017; border:1px solid #1c2233; border-radius:8px; padding:10px 12px; margin-top:8px;">
            <div style="font-size:11px; font-weight:800; color:#8892b0; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px; display:flex; justify-content:space-between;">
              <span><i class="fa-solid fa-calendar-days text-orange"></i> Tournament Matches (${teamFixtures.length})</span>
              <span style="color:#64748b;">${teamFixtures.filter(f => f.status === "COMPLETED").length} Completed</span>
            </div>
            ${teamFixtures.length === 0 ? `
              <div style="font-size:11px; color:#666; padding:4px 0;">No fixtures scheduled for this team in this tournament yet.</div>
            ` : `
              <div style="display:flex; flex-direction:column; gap:6px;">
                ${teamFixtures.map(f => {
                  const opp = f.teamA === t.name ? f.teamB : f.teamA;
                  const isCompleted = f.status === "COMPLETED";
                  const isLive = f.status === "LIVE";
                  return `
                    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; background:#161922; padding:7px 10px; border-radius:6px; font-size:11px; border:1px solid ${isLive ? '#ef4444' : '#232b3d'};">
                      <div style="display:flex; align-items:center; gap:8px; min-width:0;">
                        <span style="padding:2px 6px; border-radius:4px; font-weight:800; font-size:9px; ${isCompleted ? 'background:#14532d; color:#4ade80;' : (isLive ? 'background:#7f1d1d; color:#fca5a5;' : 'background:#27272a; color:#a1a1aa;')}">
                          ${isCompleted ? 'DONE' : (isLive ? 'LIVE' : 'UPCOMING')}
                        </span>
                        <span style="color:#fff; font-weight:700;">vs ${opp}</span>
                        <span style="color:#777; font-size:10px;">• ${f.stage}</span>
                      </div>
                      <div style="display:flex; align-items:center; gap:8px;">
                        ${isCompleted ? `
                          <span style="color:#ff7a29; font-weight:800;">${f.scoreA || '-'} vs ${f.scoreB || '-'}</span>
                          <button type="button" class="fixture-action-btn btn-view-scorecard" data-fixture-id="${f.id}" style="background:#222; color:#38bdf8; border:1px solid #38bdf8; padding:3px 8px; border-radius:5px; font-weight:700; font-size:10px; cursor:pointer;">
                            Scorecard
                          </button>
                        ` : (isLive ? `
                          <span style="color:#ef4444; font-weight:800;">LIVE</span>
                          <button type="button" class="fixture-action-btn btn-public-live-watch" data-fixture-id="${f.id}" style="background:#ef4444; color:#fff; border:none; padding:3px 8px; border-radius:5px; font-weight:700; font-size:10px; cursor:pointer;">
                            Watch Live
                          </button>
                        ` : `
                          <span style="color:#777; font-size:10px;">${f.date}</span>
                          <button type="button" class="fixture-action-btn btn-start-match" data-fixture-id="${f.id}" style="background:#ff5a00; color:#fff; border:none; padding:3px 8px; border-radius:5px; font-weight:700; font-size:10px; cursor:pointer;">
                            Start Match
                          </button>
                        `)}
                      </div>
                    </div>
                  `;
                }).join("")}
              </div>
            `}
          </div>
        </div>
      `;
    }).join("");
  }

  // TAB 3: FIXTURES & SCHEDULE
  function renderFixturesTab(tourney) {
    const fixtures = tourney.fixtures || [];
    const container = document.getElementById("tFixturesTimelineContainer") || document.getElementById("tFixturesListContainer");

    // Update Fixture Status Counts
    const allC = fixtures.length;
    const upC = fixtures.filter(f => f.status === "UPCOMING").length;
    const liveC = fixtures.filter(f => f.status === "LIVE").length;
    const doneC = fixtures.filter(f => f.status === "COMPLETED").length;

    const elAll = document.getElementById("tFixCountAll");
    const elUp = document.getElementById("tFixCountUpcoming");
    const elLive = document.getElementById("tFixCountLive");
    const elDone = document.getElementById("tFixCountCompleted");
    if (elAll) elAll.textContent = allC;
    if (elUp) elUp.textContent = upC;
    if (elLive) elLive.textContent = liveC;
    if (elDone) elDone.textContent = doneC;

    if (!container) return;

    let filtered = fixtures;
    if (activeTourneyFixtureFilter === "UPCOMING") {
      filtered = fixtures.filter(f => f.status === "UPCOMING");
    } else if (activeTourneyFixtureFilter === "LIVE") {
      filtered = fixtures.filter(f => f.status === "LIVE");
    } else if (activeTourneyFixtureFilter === "COMPLETED") {
      filtered = fixtures.filter(f => f.status === "COMPLETED");
    }

    if (filtered.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:30px; color:#777777;">No fixtures found in this view</div>`;
      return;
    }

    container.innerHTML = filtered.map(f => {
      const isDone = f.status === "COMPLETED";
      const isLive = f.status === "LIVE";

      return `
        <div class="fixture-card ${isLive ? 'is-live' : ''}" data-fixture-id="${f.id}">
          <div class="fixture-top-bar">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="fixture-stage-pill">${f.stage}</span>
              ${f.group ? `<span class="fixture-group-pill"><i class="fa-solid fa-layer-group"></i> Group ${f.group}</span>` : ''}
            </div>
            <span class="fixture-venue-text"><i class="fa-solid fa-location-dot"></i> ${f.ground}</span>
          </div>

          <div class="fixture-teams-body">
            <div class="fixture-team-row">
              <div class="fixture-team-left">
                <span class="fixture-team-avatar">🏏</span>
                <span class="fixture-team-name ${isDone && f.winner === f.teamA ? 'winner-text' : ''}">${f.teamA}</span>
              </div>
              <span class="fixture-score-text">${f.scoreA || '-'}</span>
            </div>

            <div class="fixture-team-row">
              <div class="fixture-team-left">
                <span class="fixture-team-avatar">⚡</span>
                <span class="fixture-team-name ${isDone && f.winner === f.teamB ? 'winner-text' : ''}">${f.teamB}</span>
              </div>
              <span class="fixture-score-text">${f.scoreB || '-'}</span>
            </div>
          </div>

          ${isDone ? `
            <div class="fixture-result-bar">
              <i class="fa-solid fa-trophy text-orange"></i> ${f.resultText} ${f.pom ? `• 🌟 MoM: ${f.pom}` : ''}
            </div>
          ` : ''}

          <div class="fixture-actions-row">
            <span class="fixture-schedule-time"><i class="fa-solid fa-calendar-day"></i> ${f.date} at ${f.time}</span>
            <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
              ${isLive ? `
                <button type="button" class="fixture-action-btn btn-public-live-watch" data-fixture-id="${f.id}" style="background:#ef4444; color:#ffffff; border-color:#ef4444; font-weight:800;">
                  <i class="fa-solid fa-tower-broadcast"></i> Watch Live
                </button>
              ` : ''}
              ${!isDone ? `
                <button type="button" class="fixture-action-btn btn-edit-fixture" data-fixture-id="${f.id}" title="Edit Schedule">
                  <i class="fa-solid fa-pen"></i> Edit
                </button>
                <button type="button" class="fixture-action-btn btn-delete-fixture" data-fixture-id="${f.id}" title="Delete Match" style="color:#ef4444;">
                  <i class="fa-solid fa-trash-can"></i>
                </button>
                <button type="button" class="fixture-action-btn btn-start-match" data-fixture-id="${f.id}">
                  <i class="fa-solid fa-baseball-bat-ball"></i> Start
                </button>
              ` : `
                <button type="button" class="fixture-action-btn btn-public-live-watch" data-fixture-id="${f.id}" title="Live Summary & Ball-by-ball">
                  <i class="fa-solid fa-tower-broadcast text-orange"></i> Live Summary
                </button>
                <button type="button" class="fixture-action-btn btn-edit-fixture" data-fixture-id="${f.id}" title="Edit Match">
                  <i class="fa-solid fa-pen"></i> Edit
                </button>
                <button type="button" class="fixture-action-btn btn-view-scorecard" data-fixture-id="${f.id}">
                  <i class="fa-solid fa-chart-column"></i> Scorecard
                </button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  // TAB 4: POINTS TABLE & NRR
  function renderPointsTableTab(tourney) {
    const groupTabsWrap = document.getElementById("tPointsGroupTabsRow") || document.getElementById("tPointsGroupTabs");
    const container = document.getElementById("tPointsTableContainer") || document.getElementById("tPointsTableBody");
    if (!container) return;

    const hasGroups = tourney.groups && Array.isArray(tourney.groups) && tourney.groups.length > 0;

    // Show/hide group tabs dynamically based on tournament groups
    if (groupTabsWrap) {
      if (hasGroups) {
        // Validate active group tab
        if (activeTourneyGroupTab !== "all" && !tourney.groups.some(g => g.id === activeTourneyGroupTab || g.name === activeTourneyGroupTab)) {
          activeTourneyGroupTab = "all";
        }

        groupTabsWrap.style.display = "flex";
        groupTabsWrap.innerHTML = `
          <button type="button" class="p-group-tab ${activeTourneyGroupTab === 'all' ? 'active' : ''}" data-ptgroup="all" data-group="all">All Groups</button>
          ${tourney.groups.map(g => `
            <button type="button" class="p-group-tab ${activeTourneyGroupTab === g.id ? 'active' : ''}" data-ptgroup="${g.id}" data-group="${g.id}">
              ${g.name} (${(g.teams || []).length})
            </button>
          `).join("")}
        `;
      } else {
        groupTabsWrap.style.display = "none";
        activeTourneyGroupTab = "all";
      }
    }

    let teamsToCompute = tourney.teams || [];
    let groupDisplayName = "";
    if (hasGroups && activeTourneyGroupTab !== "all") {
      const grp = tourney.groups.find(g => g.id === activeTourneyGroupTab || g.name === activeTourneyGroupTab);
      if (grp) {
        teamsToCompute = grp.teams || [];
        groupDisplayName = grp.name;
      }
    }

    const table = computePointsTable(tourney, teamsToCompute);
    const completedMatches = (tourney.fixtures || []).filter(f => f.status === "COMPLETED" && !f.isPlayoff);
    const qualifyLimit = hasGroups ? 2 : 4;

    const ptsWin = (tourney.rules && typeof tourney.rules.ptsWin === "number") ? tourney.rules.ptsWin : 2;
    const ptsTie = (tourney.rules && typeof tourney.rules.ptsTie === "number") ? tourney.rules.ptsTie : 1;
    const ptsNR = (tourney.rules && typeof tourney.rules.ptsNR === "number") ? tourney.rules.ptsNR : 1;
    const ptsLoss = (tourney.rules && typeof tourney.rules.ptsLoss === "number") ? tourney.rules.ptsLoss : 0;

    if (table.length === 0) {
      if (hasGroups && activeTourneyGroupTab !== "all") {
        container.innerHTML = `
          <div class="points-table-empty-box">
            <div class="points-table-empty-icon"><i class="fa-solid fa-layer-group"></i></div>
            <h4 style="font-size:15px; font-weight:800; color:#ffffff; margin:0;">No Teams in ${groupDisplayName || 'this Group'}</h4>
            <p style="font-size:12px; color:#888888; margin:0; max-width:320px;">Use the Teams tab to assign tournament clubs to this group to track group standings.</p>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="points-table-empty-box">
            <div class="points-table-empty-icon"><i class="fa-solid fa-table-list"></i></div>
            <h4 style="font-size:15px; font-weight:800; color:#ffffff; margin:0;">No Teams in Tournament</h4>
            <p style="font-size:12px; color:#888888; margin:0; max-width:320px;">Add participating clubs in the Teams tab to generate the league standings table and track team rankings.</p>
          </div>
        `;
      }
      return;
    }

    const pendingBannerHtml = completedMatches.length === 0 ? `
      <div class="points-table-pending-banner">
        <i class="fa-solid fa-circle-info text-orange" style="font-size:15px; flex-shrink:0;"></i>
        <span>League stage matches scheduled. Standings and Net Run Rate (NRR) will update in real-time as match results are recorded.</span>
      </div>
    ` : "";

    container.innerHTML = `
      ${pendingBannerHtml}
      <div class="points-table-card">
        <table class="points-table">
          <thead>
            <tr>
              <th style="padding:10px 8px; text-align:center; width:44px;">POS</th>
              <th style="padding:10px 12px; text-align:left;">TEAM</th>
              <th style="padding:10px 8px; text-align:center; width:40px;">P</th>
              <th style="padding:10px 8px; text-align:center; width:40px;">W</th>
              <th style="padding:10px 8px; text-align:center; width:40px;">L</th>
              <th style="padding:10px 8px; text-align:center; width:40px;">T</th>
              <th style="padding:10px 8px; text-align:center; width:40px;">NR</th>
              <th style="padding:10px 8px; text-align:center; width:52px; font-weight:800; color:#ff7a29;">PTS</th>
              <th style="padding:10px 8px; text-align:center; width:64px;">NRR</th>
              <th style="padding:10px 8px; text-align:center; width:100px;">FORM</th>
            </tr>
          </thead>
          <tbody>
            ${table.map((r, idx) => {
              const isTop2 = idx < 2;
              const isTop4 = idx < qualifyLimit;
              const badgeClass = isTop2 ? "qualify-q1" : (isTop4 ? "qualify-el" : "");

              const formHtml = r.form.length > 0 ? r.form.slice(-5).map(fm => {
                const cls = fm === "W" ? "form-w" : (fm === "L" ? "form-l" : (fm === "T" ? "form-t" : "form-nr"));
                return `<span class="form-pill ${cls}">${fm}</span>`;
              }).join("") : `<span style="color:#555555; font-size:11px;">-</span>`;

              return `
                <tr style="${isTop4 ? 'background:rgba(255,90,0,0.03);' : ''}">
                  <td style="padding:12px 8px; text-align:center;">
                    <span class="pos-badge ${badgeClass}">${idx + 1}</span>
                  </td>
                  <td class="team-cell" style="padding:12px 12px;">
                    <span style="font-size:16px;">${r.logo || '🏏'}</span>
                    <span style="font-weight:700; color:#ffffff;">${r.team}</span>
                  </td>
                  <td style="padding:12px 8px; text-align:center; color:#cccccc;">${r.p}</td>
                  <td style="padding:12px 8px; text-align:center; color:#4ade80; font-weight:700;">${r.w}</td>
                  <td style="padding:12px 8px; text-align:center; color:#f87171; font-weight:700;">${r.l}</td>
                  <td style="padding:12px 8px; text-align:center; color:#94a3b8;">${r.t}</td>
                  <td style="padding:12px 8px; text-align:center; color:#64748b;">${r.nr}</td>
                  <td style="padding:12px 8px; text-align:center; font-weight:900; color:#ff7a29; font-size:14px;" class="pts-cell">${r.pts}</td>
                  <td style="padding:12px 8px; text-align:center;" class="${r.nrr > 0 ? 'nrr-pos' : (r.nrr < 0 ? 'nrr-neg' : '')}">${r.nrr > 0 ? '+' : ''}${r.nrr.toFixed(3)}</td>
                  <td style="padding:12px 8px; text-align:center;">${formHtml}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>

      <div class="points-table-legend" style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; padding:12px 6px; font-size:11px; color:#888888; border-top:1px solid #222222; margin-top:10px;">
        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:12px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="pos-badge qualify-q1">1</span>
            <span>Top ${qualifyLimit} Qualify for ${hasGroups ? 'Knockouts' : 'Playoffs'}</span>
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <span class="form-pill form-w">W</span> Win (${ptsWin} pts)
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <span class="form-pill form-t">T</span> Tie (${ptsTie} pt)
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <span class="form-pill form-nr">NR</span> No Result (${ptsNR} pt)
          </div>
        </div>
        <div style="color:#666666; font-size:10px;">
          Tiebreaker: Points &gt; NRR &gt; Wins &gt; Runs
        </div>
      </div>
    `;
  }

  // TAB 5: STATS LEADERS
  function renderStatsTab(tourney) {
    const container = document.getElementById("tStatsLeaderboardContainer");
    if (!container) return;

    const category = activeTourneyStatsCategory || "batting";
    const stats = tourney.stats || {};
    const topB = stats.topBatsmen?.[0];
    const topW = stats.topBowlers?.[0];

    const norm = value => String(value || "").trim().toLowerCase();

    const getProfile = stat => {
      if (!stat) return { photo: "", logo: "" };

      const team = (tourney.teams || []).find(t =>
        norm(typeof t === "string" ? t : t?.name) === norm(stat.team)
      );

      const players = team && typeof team === "object" && Array.isArray(team.players)
        ? team.players
        : [];

      const player = players.find(p =>
        String(p?.id || "").trim() === String(stat.id || "").trim()
      ) || players.find(p => norm(p?.name) === norm(stat.name));

      return {
        photo: player?.photo || "",
        logo: typeof team === "object" ? (team.logo || team.teamLogo || "") : ""
      };
    };

    const profileHtml = (stat, borderColor) => {
      const profile = getProfile(stat);
      const photo = profile.photo;
      const logo = profile.logo;

      const playerPhoto = photo
        ? `<img src="${photo}" alt="${escapeHtml(stat.name || "Player")}" style="width:52px;height:52px;object-fit:cover;border-radius:50%;display:block;">`
        : `<div style="width:52px;height:52px;border-radius:50%;background:#292929;border:2px solid ${borderColor};display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:18px;font-weight:900;">${escapeHtml((stat.name || "P").charAt(0).toUpperCase())}</div>`;

      const teamLogo = logo
        ? (/^(data:image|https?:\/\/)/i.test(String(logo))
          ? `<img src="${logo}" alt="${escapeHtml(stat.team || "Team")}" style="width:24px;height:24px;object-fit:contain;border-radius:6px;background:#292929;">`
          : `<span style="font-size:22px;">${escapeHtml(String(logo))}</span>`)
        : `<span style="font-size:18px;">🏏</span>`;

      return `
        <div style="position:relative;flex-shrink:0;">
          ${playerPhoto}
          <div style="position:absolute;right:-5px;bottom:-4px;width:25px;height:25px;border-radius:7px;background:#181818;border:1px solid #444;display:flex;align-items:center;justify-content:center;overflow:hidden;">
            ${teamLogo}
          </div>
        </div>
      `;
    };

    let leaderHtml = "";
    let categoryTableHtml = "";

    if (category === "batting") {
      const list = stats.topBatsmen || [];

      leaderHtml = topB ? `
        <div style="background:#1e1e1e;border:2px solid #ff5a0044;border-radius:14px;padding:16px;margin-bottom:16px;">
          <span style="background:#ff5a0022;color:#ff7a29;font-size:11px;font-weight:800;padding:4px 9px;border-radius:6px;">🟠 TOP BATSMAN</span>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;">
            <div style="display:flex;align-items:center;gap:12px;min-width:0;">
              ${profileHtml(topB, "#ff5a00")}
              <div style="min-width:0;">
                <h4 style="font-size:16px;font-weight:800;color:#ffffff;margin:0 0 3px 0;">${escapeHtml(topB.name)}</h4>
                <span style="font-size:12px;color:#aaaaaa;">${escapeHtml(topB.team)}</span>
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:22px;font-weight:900;color:#ff7a29;">${topB.runs} <span style="font-size:12px;color:#888;">Runs</span></div>
              <span style="font-size:11px;color:#aaaaaa;">Avg: ${topB.avg} • SR: ${topB.sr}</span>
            </div>
          </div>
        </div>
      ` : "";

      categoryTableHtml = `
        <div style="overflow-x:auto;width:100%;-webkit-overflow-scrolling:touch;">
          <table class="table-custom" style="width:100%;min-width:680px;border-collapse:collapse;margin-top:0;">
            <thead>
              <tr style="border-bottom:2px solid #333;color:#aaa;font-size:12px;text-align:left;">
                <th style="padding:10px 8px;">Rank</th>
                <th style="padding:10px 8px;">Batsman</th>
                <th style="padding:10px 8px;text-align:center;">Mat</th>
                <th style="padding:10px 8px;text-align:center;color:#ff7a29;">Runs</th>
                <th style="padding:10px 8px;text-align:center;">HS</th>
                <th style="padding:10px 8px;text-align:center;">Avg</th>
                <th style="padding:10px 8px;text-align:center;">SR</th>
                <th style="padding:10px 8px;text-align:center;">6s</th>
              </tr>
            </thead>
            <tbody>
              ${list.map((b, i) => `
                <tr style="border-bottom:1px solid #222;">
                  <td style="padding:10px 8px;"><span class="pos-badge ${i === 0 ? "qualify-zone" : ""}">${i + 1}</span></td>
                  <td class="team-cell" style="padding:10px 8px;"><b style="color:#fff;">${escapeHtml(b.name)}</b><br><small style="color:#888;">${escapeHtml(b.team)}</small></td>
                  <td style="padding:10px 8px;text-align:center;color:#ccc;">${b.innings || 0}</td>
                  <td style="padding:10px 8px;text-align:center;font-weight:800;color:#ff7a29;">${b.runs}</td>
                  <td style="padding:10px 8px;text-align:center;color:#fff;">${b.hs}</td>
                  <td style="padding:10px 8px;text-align:center;color:#ccc;">${b.avg}</td>
                  <td style="padding:10px 8px;text-align:center;color:#ccc;">${b.sr}</td>
                  <td style="padding:10px 8px;text-align:center;font-weight:700;color:#ff5a00;">${b.sixes || 0}</td>
                </tr>
              `).join("") || `<tr><td colspan="8" style="padding:30px;text-align:center;color:#777;">No tournament batting stats logged yet</td></tr>`}
            </tbody>
          </table>
        </div>
      `;
    } else if (category === "bowling") {
      const list = stats.topBowlers || [];

      leaderHtml = topW ? `
        <div style="background:#1e1e1e;border:2px solid #a855f744;border-radius:14px;padding:16px;margin-bottom:16px;">
          <span style="background:#a855f722;color:#c084fc;font-size:11px;font-weight:800;padding:4px 9px;border-radius:6px;">🟣 TOP BOWLER</span>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;">
            <div style="display:flex;align-items:center;gap:12px;min-width:0;">
              ${profileHtml(topW, "#a855f7")}
              <div style="min-width:0;">
                <h4 style="font-size:16px;font-weight:800;color:#fff;margin:0 0 3px 0;">${escapeHtml(topW.name)}</h4>
                <span style="font-size:12px;color:#aaa;">${escapeHtml(topW.team)}</span>
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:22px;font-weight:900;color:#c084fc;">${topW.wickets} <span style="font-size:12px;color:#888;">Wkts</span></div>
              <span style="font-size:11px;color:#aaa;">Econ: ${topW.econ} • Best: ${topW.best}</span>
            </div>
          </div>
        </div>
      ` : "";

      categoryTableHtml = `
        <div style="overflow-x:auto;width:100%;-webkit-overflow-scrolling:touch;">
          <table class="table-custom" style="width:100%;min-width:680px;border-collapse:collapse;margin-top:0;">
            <thead>
              <tr style="border-bottom:2px solid #333;color:#aaa;font-size:12px;text-align:left;">
                <th style="padding:10px 8px;">Rank</th>
                <th style="padding:10px 8px;">Bowler</th>
                <th style="padding:10px 8px;text-align:center;">Mat</th>
                <th style="padding:10px 8px;text-align:center;color:#c084fc;">Wkts</th>
                <th style="padding:10px 8px;text-align:center;">Best</th>
                <th style="padding:10px 8px;text-align:center;">Econ</th>
                <th style="padding:10px 8px;text-align:center;">Dots</th>
              </tr>
            </thead>
            <tbody>
              ${list.map((w, i) => `
                <tr style="border-bottom:1px solid #222;">
                  <td style="padding:10px 8px;"><span class="pos-badge ${i === 0 ? "qualify-zone" : ""}">${i + 1}</span></td>
                  <td class="team-cell" style="padding:10px 8px;"><b style="color:#fff;">${escapeHtml(w.name)}</b><br><small style="color:#888;">${escapeHtml(w.team)}</small></td>
                  <td style="padding:10px 8px;text-align:center;color:#ccc;">${w.innings || 0}</td>
                  <td style="padding:10px 8px;text-align:center;font-weight:800;color:#c084fc;">${w.wickets}</td>
                  <td style="padding:10px 8px;text-align:center;color:#fff;">${w.best}</td>
                  <td style="padding:10px 8px;text-align:center;color:#ccc;">${w.econ}</td>
                  <td style="padding:10px 8px;text-align:center;color:#888;">${w.dots || 0}</td>
                </tr>
              `).join("") || `<tr><td colspan="7" style="padding:30px;text-align:center;color:#777;">No tournament bowling stats logged yet</td></tr>`}
            </tbody>
          </table>
        </div>
      `;
    } else {
      const list = stats.topBatsmen || [];
      const boundaryList = [...list].sort((a, b) =>
        (Number(b.sixes) || 0) - (Number(a.sixes) || 0) ||
        (Number(b.fours) || 0) - (Number(a.fours) || 0)
      );
      const leader = boundaryList[0];

      leaderHtml = leader ? `
        <div style="background:#1e1e1e;border:2px solid #ff7a2944;border-radius:14px;padding:16px;margin-bottom:16px;">
          <span style="background:#ff7a2922;color:#ff7a29;font-size:11px;font-weight:800;padding:4px 9px;border-radius:6px;">🔥 MOST SIXES & FOURS</span>
          <div style="display:flex;align-items:center;gap:12px;margin-top:14px;">
            ${profileHtml(leader, "#ff7a29")}
            <div style="min-width:0;">
              <h4 style="font-size:16px;font-weight:800;color:#fff;margin:0 0 3px 0;">${escapeHtml(leader.name)}</h4>
              <span style="font-size:12px;color:#aaa;">${escapeHtml(leader.team)}</span>
              <div style="font-size:12px;color:#ff7a29;font-weight:800;margin-top:5px;">4s: ${leader.fours || 0} • 6s: ${leader.sixes || 0}</div>
            </div>
          </div>
        </div>
      ` : "";

      categoryTableHtml = `
        <div style="overflow-x:auto;width:100%;-webkit-overflow-scrolling:touch;">
          <table class="table-custom" style="width:100%;min-width:680px;border-collapse:collapse;margin-top:0;">
            <thead>
              <tr style="border-bottom:2px solid #333;color:#aaa;font-size:12px;text-align:left;">
                <th style="padding:10px 8px;">Rank</th>
                <th style="padding:10px 8px;">Player</th>
                <th style="padding:10px 8px;">Team</th>
                <th style="padding:10px 8px;text-align:center;">Fours (4s)</th>
                <th style="padding:10px 8px;text-align:center;color:#ff5a00;">Sixes (6s)</th>
                <th style="padding:10px 8px;text-align:center;color:#ff7a29;">Boundary Runs</th>
              </tr>
            </thead>
            <tbody>
              ${boundaryList.map((b, i) => {
                const fours = Number(b.fours) || 0;
                const sixes = Number(b.sixes) || 0;
                return `
                  <tr style="border-bottom:1px solid #222;">
                    <td style="padding:10px 8px;"><span class="pos-badge">${i + 1}</span></td>
                    <td class="team-cell" style="padding:10px 8px;font-weight:700;color:#fff;">${escapeHtml(b.name)}</td>
                    <td style="padding:10px 8px;color:#aaa;">${escapeHtml(b.team)}</td>
                    <td style="padding:10px 8px;text-align:center;color:#ccc;">${fours}</td>
                    <td style="padding:10px 8px;text-align:center;color:#ff7a29;font-weight:800;">${sixes}</td>
                    <td style="padding:10px 8px;text-align:center;font-weight:800;color:#fff;">${(fours * 4) + (sixes * 6)}</td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="6" style="padding:30px;text-align:center;color:#777;">No boundary stats logged yet</td></tr>`}
            </tbody>
          </table>
        </div>
      `;
    }

    container.innerHTML = `
      ${leaderHtml}
      <div class="leaderboard-table-wrap" style="background:#1e1e1e;border:1px solid #333;border-radius:14px;padding:16px;">
        ${categoryTableHtml}
      </div>
    `;
  }

  // TAB 6: RULES
  function renderRulesTab(tourney) {
    const container = document.getElementById("tRulesContainer");
    if (!container) return;

    const r = tourney.rules || {};
    const ptsWin = typeof r.ptsWin === "number" ? r.ptsWin : 2;
    const ptsTie = typeof r.ptsTie === "number" ? r.ptsTie : 1;
    const ptsNR = typeof r.ptsNR === "number" ? r.ptsNR : 1;
    const maxOversBowler = typeof r.maxOversBowler === "number" ? r.maxOversBowler : Math.ceil((tourney.overs || 20) / 5);
    const superOver = r.superOver !== false;

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:14px;">
        <div class="rule-detail-card" style="background:#1e1e1e; border:1px solid #333333; border-radius:14px; padding:16px;">
          <h4 style="color:#ff7a29; margin:0 0 8px 0; font-size:15px; font-weight:800;"><i class="fa-solid fa-sitemap"></i> Tournament Format & Structure</h4>
          <p style="color:#cccccc; font-size:13px; line-height:1.6; margin:0;">
            This tournament follows the <b>${tourney.format}</b> format with <b>${tourney.overs || 20} overs</b> per innings. Teams compete in high-stakes matches to earn points and qualify for the championship playoffs.
          </p>
        </div>

        <!-- Interactive Editable Rules Form -->
        <div class="rule-detail-card" style="background:#1e1e1e; border:1px solid #333333; border-radius:14px; padding:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h4 style="color:#ff7a29; margin:0; font-size:15px; font-weight:800;"><i class="fa-solid fa-sliders"></i> Configurable Tournament Rules</h4>
            <span style="font-size:11px; color:#888888;"><i class="fa-solid fa-pen-to-square"></i> Editable</span>
          </div>

          <form id="formTourneyRulesEdit" style="display:flex; flex-direction:column; gap:12px;">
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:10px;">
              <div class="form-group">
                <label style="font-size:11px; color:#aaaaaa; display:block; margin-bottom:4px;">Overs / Innings</label>
                <input type="number" id="ruleInputOvers" min="1" max="50" value="${tourney.overs || 20}" style="width:100%; background:#262626; border:1px solid #444; color:#fff; padding:8px 10px; border-radius:8px; font-weight:700; font-size:13px;" required>
              </div>
              <div class="form-group">
                <label style="font-size:11px; color:#aaaaaa; display:block; margin-bottom:4px;">Points for Win</label>
                <input type="number" id="ruleInputPtsWin" min="0" max="10" value="${ptsWin}" style="width:100%; background:#262626; border:1px solid #444; color:#4ade80; padding:8px 10px; border-radius:8px; font-weight:700; font-size:13px;" required>
              </div>
              <div class="form-group">
                <label style="font-size:11px; color:#aaaaaa; display:block; margin-bottom:4px;">Points for Tie</label>
                <input type="number" id="ruleInputPtsTie" min="0" max="10" value="${ptsTie}" style="width:100%; background:#262626; border:1px solid #444; color:#fbbf24; padding:8px 10px; border-radius:8px; font-weight:700; font-size:13px;" required>
              </div>
              <div class="form-group">
                <label style="font-size:11px; color:#aaaaaa; display:block; margin-bottom:4px;">Points for No Result</label>
                <input type="number" id="ruleInputPtsNR" min="0" max="10" value="${ptsNR}" style="width:100%; background:#262626; border:1px solid #444; color:#38bdf8; padding:8px 10px; border-radius:8px; font-weight:700; font-size:13px;" required>
              </div>
              <div class="form-group">
                <label style="font-size:11px; color:#aaaaaa; display:block; margin-bottom:4px;">Max Overs / Bowler</label>
                <input type="number" id="ruleInputMaxOversBowler" min="1" max="10" value="${maxOversBowler}" style="width:100%; background:#262626; border:1px solid #444; color:#fff; padding:8px 10px; border-radius:8px; font-weight:700; font-size:13px;" required>
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
              <input type="checkbox" id="ruleInputSuperOver" ${superOver ? 'checked' : ''} style="accent-color:#ff5a00; width:16px; height:16px; cursor:pointer;">
              <label for="ruleInputSuperOver" style="font-size:12px; color:#ffffff; cursor:pointer;">Conduct 1-over Eliminator (Super Over) for playoff ties</label>
            </div>

            <button type="submit" id="btnSaveTournamentRules" style="background:#ff5a00; color:#fff; border:none; padding:10px 18px; border-radius:8px; font-weight:800; font-size:13px; cursor:pointer; align-self:flex-start; margin-top:6px; display:inline-flex; align-items:center; gap:6px;">
              <i class="fa-solid fa-floppy-disk"></i> SAVE TOURNAMENT RULES
            </button>
          </form>
        </div>

        <div class="rule-detail-card" style="background:#1e1e1e; border:1px solid #333333; border-radius:14px; padding:16px;">
          <h4 style="color:#ff7a29; margin:0 0 8px 0; font-size:15px; font-weight:800;"><i class="fa-solid fa-calculator"></i> Net Run Rate (NRR) Specification</h4>
          <p style="color:#cccccc; font-size:13px; line-height:1.6; margin:0;">
            <b>Formula:</b> <span style="color:#ff7a29; font-family:monospace;">(Total Runs Scored / Overs Faced) - (Total Runs Conceded / Overs Bowled)</span>.<br>
            <b>All-Out Condition:</b> When a batting side is bowled out before completing their full quota of overs, the calculation counts the full maximum quota of allotted overs (${tourney.overs || 20} overs) to preserve mathematical integrity.
          </p>
        </div>
      </div>
    `;

    // Bind Save Tournament Rules Event
    const rulesForm = document.getElementById("formTourneyRulesEdit");
    if (rulesForm) {
      rulesForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const t = getTournamentById(activeTournamentId);
        if (!t) return;

        const newOvers = parseInt(document.getElementById("ruleInputOvers")?.value) || t.overs || 20;
        const newPtsWin = parseInt(document.getElementById("ruleInputPtsWin")?.value) || 2;
        const newPtsTie = parseInt(document.getElementById("ruleInputPtsTie")?.value) || 1;
        const newPtsNR = parseInt(document.getElementById("ruleInputPtsNR")?.value) || 1;
        const newMaxBowler = parseInt(document.getElementById("ruleInputMaxOversBowler")?.value) || 4;
        const newSuperOver = document.getElementById("ruleInputSuperOver")?.checked !== false;

        t.overs = newOvers;
        t.rules = {
          ptsWin: newPtsWin,
          ptsTie: newPtsTie,
          ptsNR: newPtsNR,
          ptsLoss: 0,
          maxOversBowler: newMaxBowler,
          superOver: newSuperOver
        };

        saveTournament(t);
        showToast("Tournament rules updated successfully");
        renderRulesTab(t);
        renderPointsTableTab(t);
        renderOverviewTab(t);
      });
    }
  }

  // TAB 7: RESULTS & PLAYOFF BRACKET
  function renderResultsTab(tourney) {
    const bracketContainer = document.getElementById("tPlayoffBracketContainer");
    const awardsGrid = document.getElementById("tAwardsGridContainer");

    // Bracket
    if (bracketContainer) {
      const playoffs = (tourney.fixtures || []).filter(f => f.isPlayoff || f.stage.toLowerCase().includes("final") || f.stage.toLowerCase().includes("qualifier") || f.stage.toLowerCase().includes("eliminator") || f.stage.toLowerCase().includes("semi"));

      if (playoffs.length === 0) {
        bracketContainer.innerHTML = `<div style="text-align:center; padding:20px; color:#777777;">No playoff fixtures for this format</div>`;
      } else {
        bracketContainer.innerHTML = playoffs.map(p => `
          <div class="bracket-match-node" style="background:#1e1e1e; border:1px solid #333333; border-radius:14px; padding:14px; margin-bottom:12px;">
            <div class="bracket-node-header" style="display:flex; justify-content:space-between; margin-bottom:10px;">
              <span style="color:#ff7a29; font-weight:800; font-size:13px;"><i class="fa-solid fa-trophy"></i> ${p.stage}</span>
              <span style="color:#888888; font-size:11px;">${p.date} • ${p.ground}</span>
            </div>
            <div class="fixture-teams-body" style="display:flex; flex-direction:column; gap:6px;">
              <div class="fixture-team-row" style="display:flex; justify-content:space-between; align-items:center;">
                <div class="fixture-team-left" style="display:flex; align-items:center; gap:8px;">
                  <span class="fixture-team-avatar">🏏</span>
                  <span class="fixture-team-name ${p.winner === p.teamA ? 'winner-text' : ''}" style="font-weight:700; color:#ffffff;">${p.teamA}</span>
                </div>
                <span class="fixture-score-text" style="font-weight:800; color:#ff7a29;">${p.scoreA || '-'}</span>
              </div>
              <div class="fixture-team-row" style="display:flex; justify-content:space-between; align-items:center;">
                <div class="fixture-team-left" style="display:flex; align-items:center; gap:8px;">
                  <span class="fixture-team-avatar">⚡</span>
                  <span class="fixture-team-name ${p.winner === p.teamB ? 'winner-text' : ''}" style="font-weight:700; color:#ffffff;">${p.teamB}</span>
                </div>
                <span class="fixture-score-text" style="font-weight:800; color:#ff7a29;">${p.scoreB || '-'}</span>
              </div>
            </div>
            ${p.status === "COMPLETED" ? `
              <div class="fixture-result-bar" style="margin-top:10px; padding-top:8px; border-top:1px solid #262626; color:#4ade80; font-weight:700; font-size:12px;">
                <i class="fa-solid fa-check-circle"></i> ${p.resultText}
              </div>
            ` : `
              <div style="display:flex; justify-content:flex-end; margin-top:10px;">
                <button type="button" class="fixture-action-btn btn-start-match" data-fixture-id="${p.id}" style="background:#ff5a00; color:#ffffff; border:none; padding:6px 14px; border-radius:8px; font-weight:800; font-size:12px; cursor:pointer;">
                  <i class="fa-solid fa-baseball-bat-ball"></i> Start Match
                </button>
              </div>
            `}
          </div>
        `).join("");
      }
    }

    // Awards Section
    if (awardsGrid) {
      const topB = tourney.stats?.topBatsmen?.[0];
      const topW = tourney.stats?.topBowlers?.[0];

      awardsGrid.innerHTML = `
        <div style="background:#1e1e1e; border:1px solid #333333; border-radius:12px; padding:14px; display:flex; align-items:center; gap:12px;">
          <div style="font-size:28px;">🏆</div>
          <div>
            <span style="font-size:11px; color:#ff7a29; font-weight:800;">CHAMPION</span>
            <h4 style="margin:2px 0 0 0; color:#ffffff; font-size:15px; font-weight:800;">${tourney.winner || 'In Progress'}</h4>
          </div>
        </div>
        <div style="background:#1e1e1e; border:1px solid #333333; border-radius:12px; padding:14px; display:flex; align-items:center; gap:12px;">
          <div style="font-size:28px;">🟠</div>
          <div>
            <span style="font-size:11px; color:#ff7a29; font-weight:800;">ORANGE CAP WINNER</span>
            <h4 style="margin:2px 0 0 0; color:#ffffff; font-size:15px; font-weight:800;">${topB ? `${topB.name} (${topB.runs} Runs)` : 'TBD'}</h4>
          </div>
        </div>
        <div style="background:#1e1e1e; border:1px solid #333333; border-radius:12px; padding:14px; display:flex; align-items:center; gap:12px;">
          <div style="font-size:28px;">🟣</div>
          <div>
            <span style="font-size:11px; color:#c084fc; font-weight:800;">PURPLE CAP WINNER</span>
            <h4 style="margin:2px 0 0 0; color:#ffffff; font-size:15px; font-weight:800;">${topW ? `${topW.name} (${topW.wickets} Wkts)` : 'TBD'}</h4>
          </div>
        </div>
        <div style="background:#1e1e1e; border:1px solid #333333; border-radius:12px; padding:14px; display:flex; align-items:center; gap:12px;">
          <div style="font-size:28px;">⚡</div>
          <div>
            <span style="font-size:11px; color:#38bdf8; font-weight:800;">MAXIMUM SIXES AWARD</span>
            <h4 style="margin:2px 0 0 0; color:#ffffff; font-size:15px; font-weight:800;">${topB ? `${topB.name} (${topB.sixes || 0} Sixes)` : 'TBD'}</h4>
          </div>
        </div>
      `;
    }
  }

  // =========================================================================
  // TAB 8: TOURNAMENT AUCTION HUB ENGINE (MASTER REAL INTEGRATION)
// =========================================================================

// Master Player Database Collector (preserves real IDs, mobile numbers, roles, base prices)
function getMasterPlayerDatabase() {
  const masterMap = new Map();

  // 1. Predefined Star & Domestic Players (Unique IDs, Real Details & Indian Mobiles)
  const defaultStarPlayers = [];

  defaultStarPlayers.forEach(p => masterMap.set(p.id, { ...p }));

  // 2. Incorporate User Team Players (My Team)
  try {
    const myTeam = getMyTeamData();
    if (myTeam && Array.isArray(myTeam.players)) {
      myTeam.players.forEach((p, idx) => {
        const pId = p.id || `my_p_${idx + 1}`;
        if (!masterMap.has(pId)) {
          masterMap.set(pId, {
            id: pId,
            name: p.name || `Yuva Player ${idx + 1}`,
            role: p.role || "All-Rounder",
            mobile: p.mobile || localStorage.getItem("cricYuvaProfileMobile") || "+91 98000 00000",
            basePrice: p.basePrice || 1.0,
            avatar: p.avatar || "🏏",
            type: "Local Yuva",
            jersey: p.jersey || idx + 1
          });
        }
      });
    }
  } catch (e) {
    console.warn("Could not load myTeam into master player DB:", e);
  }

  // 3. Incorporate Custom Club Players
  try {
    const customClubs = getCustomClubsList();
    if (Array.isArray(customClubs)) {
      customClubs.forEach(club => {
        if (Array.isArray(club.players)) {
          club.players.forEach((p, idx) => {
            const pId = p.id || `club_${club.id || "c"}_p_${idx + 1}`;
            if (!masterMap.has(pId)) {
              masterMap.set(pId, {
                id: pId,
                name: p.name || `${club.name} Player`,
                role: p.role || "Batsman",
                mobile: p.mobile || "+91 98700 00000",
                basePrice: p.basePrice || 1.0,
                avatar: club.logo || "🏏",
                type: "Domestic",
                jersey: p.jersey || idx + 1
              });
            }
          });
        }
      });
    }
  } catch (e) {
    console.warn("Could not load customClubs into master player DB:", e);
  }

  return Array.from(masterMap.values());
}

// 1. INITIALIZE / SYNCHRONIZE TOURNAMENT AUCTION
function initTournamentAuction(tourney) {
  if (!tourney) return;

  const defaultPurse = (tourney.rules && tourney.rules.auctionPurse) || 100.0;
  const minSquad = (tourney.rules && tourney.rules.minSquad) || 11;
  const maxSquad = (tourney.rules && tourney.rules.maxSquad) || 15;

  if (!tourney.auction) {
    tourney.auction = {
      pursePerTeam: defaultPurse,
      minSquad: minSquad,
      maxSquad: maxSquad,
      teamPurses: {},
      currentIdx: 0,
      filter: "all",
      roleFilter: "all",
      search: "",
      pool: [],
      history: []
    };
  }

  // Ensure auction properties exist
  if (!tourney.auction.teamPurses) tourney.auction.teamPurses = {};
  if (!tourney.auction.history) tourney.auction.history = [];
  if (!tourney.auction.pool) tourney.auction.pool = [];
  if (!tourney.auction.pursePerTeam) tourney.auction.pursePerTeam = defaultPurse;
  if (!tourney.auction.minSquad) tourney.auction.minSquad = minSquad;
  if (!tourney.auction.maxSquad) tourney.auction.maxSquad = maxSquad;
  if (tourney.auction.currentIdx === undefined) tourney.auction.currentIdx = 0;
  if (!tourney.auction.filter) tourney.auction.filter = "all";
  if (!tourney.auction.roleFilter) tourney.auction.roleFilter = "all";
  if (tourney.auction.search === undefined) tourney.auction.search = "";

  // 2. Populate Initial Pool if empty
  if (tourney.auction.pool.length === 0) {
    const masterDb = getMasterPlayerDatabase();
    tourney.auction.pool = masterDb.map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      mobile: p.mobile || "",
      basePrice: p.basePrice || 1.0,
      currentBid: p.basePrice || 1.0,
      leader: null,
      status: "POOL", // POOL, SOLD, UNSOLD
      soldTo: null,
      soldPrice: 0,
      soldTimestamp: null,
      avatar: p.avatar || "🏏",
      type: p.type || "Domestic",
      jersey: p.jersey || 7
    }));
  }

  // 3. Dynamically Synchronize Participating Teams & Purses
  const participatingTeams = tourney.teams || [];
  const activeTeamNames = new Set(participatingTeams.map(t => t.name));

  // Initialize/Update purses for all active participating teams
  participatingTeams.forEach((t, index) => {
    const teamName = t.name;
    const teamId = t.id || `team_${index}`;
    const logo = t.logo || "🏏";

    if (!tourney.auction.teamPurses[teamName]) {
      tourney.auction.teamPurses[teamName] = {
        teamId: teamId,
        teamName: teamName,
        logo: logo,
        totalPurse: tourney.auction.pursePerTeam,
        spent: 0,
        remaining: tourney.auction.pursePerTeam,
        boughtCount: 0,
        required: tourney.auction.maxSquad,
        players: []
      };
    } else {
      // Sync logo and ID
      tourney.auction.teamPurses[teamName].logo = logo;
      tourney.auction.teamPurses[teamName].teamId = teamId;
      if (!tourney.auction.teamPurses[teamName].totalPurse) {
        tourney.auction.teamPurses[teamName].totalPurse = tourney.auction.pursePerTeam;
      }
    }
  });

  // Re-calculate team spent & remaining dynamically from SOLD players
  Object.keys(tourney.auction.teamPurses).forEach(tName => {
    if (!activeTeamNames.has(tName)) return;

    const purseObj = tourney.auction.teamPurses[tName];
    const soldToTeam = tourney.auction.pool.filter(p => p.status === "SOLD" && p.soldTo === tName);

    let totalSpent = 0;
    soldToTeam.forEach(p => {
      totalSpent += (Number(p.soldPrice) || 0);
    });

    purseObj.spent = Math.round(totalSpent * 100) / 100;
    purseObj.remaining = Math.max(0, Math.round((purseObj.totalPurse - purseObj.spent) * 100) / 100);
    purseObj.boughtCount = soldToTeam.length;
    purseObj.required = Math.max(0, tourney.auction.maxSquad - purseObj.boughtCount);
    purseObj.players = soldToTeam.map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      price: p.soldPrice,
      mobile: p.mobile || "",
      avatar: p.avatar || "🏏"
    }));
  });
}

// 2. RENDER THE TOURNAMENT AUCTION TAB
function renderAuctionTab(tourney) {
  if (!tourney) return;
  initTournamentAuction(tourney);

  const container = document.getElementById("tAuctionContainer");
  if (!container) return;

  const auction = tourney.auction;
  const pool = auction.pool || [];
  const teamPurses = auction.teamPurses || {};
  const teams = tourney.teams || [];

  // Summary Metrics
  const totalPlayers = pool.length;
  const soldPlayers = pool.filter(p => p.status === "SOLD");
  const unsoldPlayers = pool.filter(p => p.status === "UNSOLD");
  const poolPlayers = pool.filter(p => p.status === "POOL");
  const totalSpentAll = soldPlayers.reduce((acc, p) => acc + (Number(p.soldPrice) || 0), 0);

  // Current Player Index Bounds
  if (auction.currentIdx >= pool.length) {
    auction.currentIdx = Math.max(0, pool.length - 1);
  }
  const curPlayer = pool[auction.currentIdx] || null;

  // Filter Pool for Table
  let filteredPool = pool.filter(p => {
    // Status Filter
    if (auction.filter === "pool" && p.status !== "POOL") return false;
    if (auction.filter === "sold" && p.status !== "SOLD") return false;
    if (auction.filter === "unsold" && p.status !== "UNSOLD") return false;

    // Role Filter
    if (auction.roleFilter && auction.roleFilter !== "all") {
      const roleStr = (p.role || "").toLowerCase();
      if (auction.roleFilter === "batsman" && !roleStr.includes("bat")) return false;
      if (auction.roleFilter === "bowler" && !roleStr.includes("bowl")) return false;
      if (auction.roleFilter === "all-rounder" && !roleStr.includes("all")) return false;
      if (auction.roleFilter === "wicketkeeper" && !roleStr.includes("keeper") && !roleStr.includes("wk")) return false;
    }

    // Search Query (Name, Mobile, ID, Role)
    if (auction.search && auction.search.trim()) {
      const q = auction.search.toLowerCase().trim();
      const cleanDigits = q.replace(/\D/g, "");
      const nameMatch = p.name.toLowerCase().includes(q);
      const idMatch = p.id.toLowerCase().includes(q);
      const roleMatch = (p.role || "").toLowerCase().includes(q);
      const mobileMatch = cleanDigits && p.mobile && p.mobile.replace(/\D/g, "").includes(cleanDigits);
      if (!nameMatch && !idMatch && !roleMatch && !mobileMatch) return false;
    }
    return true;
  });

  // Current Podium Player Details
  const isSold = curPlayer && curPlayer.status === "SOLD";
  const isUnsold = curPlayer && curPlayer.status === "UNSOLD";
  const isAvailable = curPlayer && curPlayer.status === "POOL";

  // HTML Generation
  let html = `
  <div class="auction-hub-container">
    <!-- 1. TOP HEADER & METRICS BAR -->
    <div class="auction-top-bar">
      <div class="auction-title-wrap">
        <h3><i class="fa-solid fa-gavel text-orange"></i> ${tourney.name} — Live Auction</h3>
        <p><i class="fa-solid fa-wallet text-gold"></i> Budget: <b>${auction.pursePerTeam.toFixed(1)} Pts/Team</b> &bull; Squad Size: <b>${auction.minSquad}-${auction.maxSquad} Players</b> &bull; Real Database Integrated</p>
      </div>
      <div class="auction-top-actions">
        <button type="button" class="btn-auction-action primary-gold" id="btnOpenAuctionMasterSearch" title="Search Master Database by Name/Mobile/ID">
          <i class="fa-solid fa-magnifying-glass-plus"></i> Search & Add Player
        </button>
        <button type="button" class="btn-auction-action" id="btnAutoAuctionRemaining" title="Auto-Auction remaining players">
          <i class="fa-solid fa-bolt text-gold"></i> Auto-Auction
        </button>
        <button type="button" class="btn-auction-action" id="btnReAuctionUnsold" title="Re-Auction all unsold players">
          <i class="fa-solid fa-arrow-rotate-left text-orange"></i> Re-Auction Unsold (${unsoldPlayers.length})
        </button>
        <button type="button" class="btn-auction-action" id="btnSyncAuctionSquads" title="Ensure all sold players are synced to tournament team squads">
          <i class="fa-solid fa-users text-green"></i> Sync Squads
        </button>
        <button type="button" class="btn-auction-action" id="btnResetAuction" style="color:#ef4444;" title="Reset all auction data">
          <i class="fa-solid fa-trash"></i> Reset
        </button>
      </div>
    </div>

    <!-- AUCTION SUMMARY STATS PILLS -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:10px;">
      <div style="background:#151924; border:1px solid #232c42; padding:10px 14px; border-radius:10px;">
        <span style="font-size:10px; color:#72809e; font-weight:800; text-transform:uppercase;">Pool Players</span>
        <div style="font-size:18px; font-weight:900; color:#ffffff; margin-top:2px;">${totalPlayers}</div>
      </div>
      <div style="background:#151924; border:1px solid #232c42; padding:10px 14px; border-radius:10px;">
        <span style="font-size:10px; color:#34d399; font-weight:800; text-transform:uppercase;">Sold Players</span>
        <div style="font-size:18px; font-weight:900; color:#10b981; margin-top:2px;">${soldPlayers.length}</div>
      </div>
      <div style="background:#151924; border:1px solid #232c42; padding:10px 14px; border-radius:10px;">
        <span style="font-size:10px; color:#f87171; font-weight:800; text-transform:uppercase;">Unsold Players</span>
        <div style="font-size:18px; font-weight:900; color:#ef4444; margin-top:2px;">${unsoldPlayers.length}</div>
      </div>
      <div style="background:#151924; border:1px solid #232c42; padding:10px 14px; border-radius:10px;">
        <span style="font-size:10px; color:#60a5fa; font-weight:800; text-transform:uppercase;">Available Pool</span>
        <div style="font-size:18px; font-weight:900; color:#38bdf8; margin-top:2px;">${poolPlayers.length}</div>
      </div>
      <div style="background:#151924; border:1px solid #232c42; padding:10px 14px; border-radius:10px;">
        <span style="font-size:10px; color:#f59e0b; font-weight:800; text-transform:uppercase;">Total Spent</span>
        <div style="font-size:18px; font-weight:900; color:#f59e0b; margin-top:2px;">${totalSpentAll.toFixed(2)} Pts</div>
      </div>
    </div>

    <!-- 2. MAIN AUCTION GRID (PODIUM + PURSES) -->
    <div class="auction-main-grid">
      <!-- PODIUM / BIDDING CARD -->
      <div class="auction-podium-card" id="auctionPodiumBox">
  `;

  if (curPlayer) {
    const leaderPurse = curPlayer.leader ? teamPurses[curPlayer.leader] : null;
    const buyerPurse = curPlayer.soldTo ? teamPurses[curPlayer.soldTo] : null;

    html += `
        <!-- PLAYER HEADER ON STAGE -->
        <div class="podium-player-header">
          <div class="podium-player-avatar">${curPlayer.avatar || "🏏"}</div>
          <div class="podium-player-meta">
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
              <span class="podium-role-badge">${curPlayer.role || "All-Rounder"}</span>
              <span style="font-size:10px; background:#242c3f; color:#94a3b8; padding:2px 6px; border-radius:4px; font-weight:700;">🆔 ${curPlayer.id}</span>
              <span style="font-size:10px; background:#1e293b; color:#38bdf8; padding:2px 6px; border-radius:4px; font-weight:700;">#${curPlayer.jersey || 7}</span>
              ${curPlayer.mobile ? `<span style="font-size:10px; color:#888;"><i class="fa-solid fa-phone" style="font-size:9px;"></i> ${curPlayer.mobile}</span>` : ""}
            </div>
            <h2 class="podium-player-name" title="${curPlayer.name}">${curPlayer.name}</h2>
            <div class="podium-player-sub">
              ${curPlayer.type || "Domestic"} &bull; Base Price: <b>${Number(curPlayer.basePrice).toFixed(2)} Pts</b>
            </div>
          </div>
        </div>

        <!-- BID METRICS & LEADER BOX -->
        <div class="podium-bid-box">
          <div class="bid-stat-col">
            <span class="bid-stat-label">${isSold ? "FINAL SOLD PRICE" : "CURRENT BID"}</span>
            <div class="bid-stat-val gold-bid">${(isSold ? Number(curPlayer.soldPrice) : Number(curPlayer.currentBid)).toFixed(2)} Pts</div>
          </div>
          <div class="bid-stat-col">
            <span class="bid-stat-label">${isSold ? "SOLD TO FRANCHISE" : (isUnsold ? "AUCTION RESULT" : "LEADING BIDDER")}</span>
            <div class="bid-stat-leader">
              ${isSold ? `<span style="color:#10b981; font-weight:900;"><i class="fa-solid fa-circle-check"></i> ${curPlayer.soldTo}</span>` : 
                (isUnsold ? `<span style="color:#ef4444; font-weight:900;"><i class="fa-solid fa-circle-xmark"></i> UNSOLD</span>` : 
                  (curPlayer.leader ? `<span>${leaderPurse?.logo || "🏏"} ${curPlayer.leader} <small style="color:#64748b;">(Rem: ${leaderPurse?.remaining.toFixed(1)} Pts)</small></span>` : `<span style="color:#64748b;">⏳ No Bids Yet (Base: ${Number(curPlayer.basePrice).toFixed(2)})</span>`)
                )
              }
            </div>
          </div>
        </div>
    `;

    // LIVE BIDDING CONTROLS (Only when player is in POOL)
    if (isAvailable) {
      html += `
        <!-- FRANCHISE SELECTOR & REMAINING POINTS INFO -->
        <div class="auction-bidder-select-wrap">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <label for="selectBiddingTeam"><i class="fa-solid fa-shield-halved text-orange"></i> Select Bidding Franchise:</label>
            <span id="aucBidderBudgetInfo" style="font-size:11px; color:#10b981; font-weight:700;"></span>
          </div>
          <select class="auction-bidder-select" id="selectBiddingTeam">
      `;

      teams.forEach(t => {
        const pObj = teamPurses[t.name];
        const rem = pObj ? pObj.remaining : auction.pursePerTeam;
        const bought = pObj ? pObj.boughtCount : 0;
        const isMaxed = bought >= auction.maxSquad;
        const isSelected = curPlayer.leader === t.name;

        html += `
            <option value="${t.name}" ${isSelected ? "selected" : ""} ${isMaxed ? "disabled" : ""}>
              ${t.logo || "🏏"} ${t.name} &bull; Rem: ${rem.toFixed(1)} Pts &bull; Bought: ${bought}/${auction.maxSquad} ${isMaxed ? "[SQUAD FULL]" : ""}
            </option>
        `;
      });

      html += `
          </select>
        </div>

        <!-- QUICK BID INCREMENT BUTTONS -->
        <div style="display:flex; flex-direction:column; gap:4px;">
          <span style="font-size:10px; color:#72809e; font-weight:800; text-transform:uppercase;">Quick Bid Increments:</span>
          <div class="auction-quick-bid-row">
            <button type="button" class="btn-bid-inc" data-inc="0.5">+0.5 Pt</button>
            <button type="button" class="btn-bid-inc" data-inc="1.0">+1.0 Pt</button>
            <button type="button" class="btn-bid-inc" data-inc="2.0">+2.0 Pts</button>
            <button type="button" class="btn-bid-inc" data-inc="5.0">+5.0 Pts</button>
            <button type="button" class="btn-bid-inc" data-inc="10.0">+10.0 Pts</button>
          </div>
        </div>

        <!-- CUSTOM BID INPUT ROW -->
        <div class="auc-custom-bid-wrap">
          <input type="number" step="0.25" min="${curPlayer.currentBid + 0.25}" id="inputCustomBidPoints" placeholder="Enter custom bid points (e.g. ${(curPlayer.currentBid + 1).toFixed(2)})" class="auc-custom-bid-input">
          <button type="button" class="btn-place-custom-bid" id="btnPlaceCustomBid">
            <i class="fa-solid fa-gavel"></i> Place Bid
          </button>
        </div>

        <!-- HAMMER ACTIONS (SOLD / UNSOLD) -->
        <div class="auction-hammer-actions">
          <button type="button" class="btn-hammer-sold" id="btnHammerSold">
            <i class="fa-solid fa-gavel"></i> SOLD (Hammer)
          </button>
          <button type="button" class="btn-hammer-unsold" id="btnHammerUnsold">
            <i class="fa-solid fa-xmark"></i> UNSOLD
          </button>
        </div>
      `;
    } else if (isSold) {
      html += `
        <!-- SOLD BANNER & ACTIONS -->
        <div style="background:#10b98115; border:1px solid #10b98155; border-radius:10px; padding:12px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
          <div>
            <div style="color:#10b981; font-weight:900; font-size:13px;"><i class="fa-solid fa-check-circle"></i> SOLD TO ${curPlayer.soldTo}</div>
            <div style="font-size:11px; color:#94a3b8;">Price: <b>${Number(curPlayer.soldPrice).toFixed(2)} Pts</b> &bull; Added to Tournament Squad</div>
          </div>
          <button type="button" class="btn-auction-action" id="btnReopenBidding" style="font-size:10px;">
            <i class="fa-solid fa-rotate-left"></i> Re-Open Bidding
          </button>
        </div>
      `;
    } else if (isUnsold) {
      html += `
        <!-- UNSOLD BANNER & ACTIONS -->
        <div style="background:#ef444415; border:1px solid #ef444455; border-radius:10px; padding:12px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
          <div>
            <div style="color:#ef4444; font-weight:900; font-size:13px;"><i class="fa-solid fa-circle-xmark"></i> PLAYER UNSOLD</div>
            <div style="font-size:11px; color:#94a3b8;">No bids placed &bull; Available for Re-Auction</div>
          </div>
          <button type="button" class="btn-auction-action" id="btnReopenBidding" style="font-size:10px; color:#f59e0b;">
            <i class="fa-solid fa-rotate-left"></i> Put Back on Podium
          </button>
        </div>
      `;
    }

    // PODIUM NAVIGATION (Previous / Counter / Next)
    html += `
        <div class="podium-nav-row">
          <button type="button" class="btn-auction-action" id="btnPodiumPrev" ${auction.currentIdx === 0 ? "disabled" : ""}>
            <i class="fa-solid fa-chevron-left"></i> Prev
          </button>
          <span style="font-size:11px; font-weight:800; color:#8b99b5;">
            Player <b>${auction.currentIdx + 1}</b> of <b>${pool.length}</b>
          </span>
          <button type="button" class="btn-auction-action" id="btnPodiumNext" ${auction.currentIdx >= pool.length - 1 ? "disabled" : ""}>
            Next <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
    `;
  } else {
    html += `
        <div style="text-align:center; padding:40px 20px; color:#8b99b5;">
          <i class="fa-solid fa-inbox" style="font-size:32px; margin-bottom:10px;"></i>
          <p style="margin:0; font-weight:700;">No players in auction pool</p>
          <button type="button" class="btn-auction-action primary-gold" id="btnOpenAuctionMasterSearch" style="margin:12px auto 0 auto;">
            <i class="fa-solid fa-plus"></i> Add Players from Master Database
          </button>
        </div>
    `;
  }

  html += `
      </div>

      <!-- PARTICIPATING TEAMS BUDGET & SQUAD TRACKER -->
      <div class="auction-purses-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4><i class="fa-solid fa-wallet text-gold"></i> Franchise Purses & Squads</h4>
          <span style="font-size:11px; color:#72809e; font-weight:700;">${teams.length} Teams</span>
        </div>

        <div class="auction-teams-purses-list">
  `;

  if (teams.length === 0) {
    html += `
          <div style="text-align:center; padding:20px; color:#64748b; font-size:12px;">
            No participating teams in tournament.
          </div>
    `;
  } else {
    teams.forEach(t => {
      const pObj = teamPurses[t.name] || {
        totalPurse: auction.pursePerTeam,
        spent: 0,
        remaining: auction.pursePerTeam,
        boughtCount: 0,
        required: auction.maxSquad,
        players: []
      };

      const percentSpent = pObj.totalPurse > 0 ? Math.min(100, Math.round((pObj.spent / pObj.totalPurse) * 100)) : 0;
      const isMaxed = pObj.boughtCount >= auction.maxSquad;
      const isReady = pObj.boughtCount >= auction.minSquad;

      let badgeHtml = `<span class="req-badge-needed">Needs ${pObj.required}</span>`;
      if (isMaxed) {
        badgeHtml = `<span class="req-badge-full">Squad Full</span>`;
      } else if (isReady) {
        badgeHtml = `<span class="req-badge-ready">Ready (${pObj.boughtCount})</span>`;
      }

      html += `
          <div class="team-purse-row">
            <div class="team-purse-row-top">
              <div class="team-purse-name-box">
                <span class="team-purse-crest">${t.logo || "🏏"}</span>
                <div>
                  <span class="team-purse-name">${t.name}</span>
                  <div style="margin-top:2px;">${badgeHtml}</div>
                </div>
              </div>
              <div style="text-align:right;">
                <span class="team-purse-rem">${pObj.remaining.toFixed(1)} Pts</span>
                <span style="display:block; font-size:10px; color:#64748b;">Rem. Budget</span>
              </div>
            </div>
            <div class="team-purse-bar-track">
              <div class="team-purse-bar-fill" style="width:${percentSpent}%;"></div>
            </div>
            <div class="team-purse-subinfo">
              <span>Spent: <b>${pObj.spent.toFixed(1)} Pts</b></span>
              <span>Squad: <b>${pObj.boughtCount}/${auction.maxSquad}</b></span>
              <button type="button" class="btnViewTeamSquadFromAuction" data-team="${t.name}" style="background:none; border:none; color:#38bdf8; font-size:10px; font-weight:800; cursor:pointer; padding:0;">
                <i class="fa-solid fa-eye"></i> View Squad
              </button>
            </div>
          </div>
      `;
    });
  }

  html += `
        </div>
      </div>
    </div>

    <!-- 3. MASTER PLAYER POOL TABLE & SEARCH -->
    <div class="auction-pool-card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <h4 style="margin:0; font-size:14px; font-weight:800; color:#fff; display:flex; align-items:center; gap:8px;">
          <i class="fa-solid fa-list-check text-orange"></i> Player Auction Pool (${filteredPool.length} of ${pool.length})
        </h4>

        <!-- LIVE SEARCH INPUT (Name, Mobile, ID) -->
        <div style="position:relative; min-width:240px; flex:1; max-width:360px;">
          <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:#72809e; font-size:12px;"></i>
          <input type="text" id="inputAuctionSearch" placeholder="Search by Name, Mobile, or ID (p_2)..." value="${auction.search || ""}" style="width:100%; background:#0b0d13; border:1px solid #232c42; color:#fff; padding:7px 10px 7px 32px; border-radius:8px; font-size:12px; outline:none; box-sizing:border-box;">
        </div>
      </div>

      <!-- STATUS & ROLE FILTER CHIPS -->
      <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
        <span style="font-size:11px; color:#72809e; font-weight:700;">Status:</span>
        <button type="button" class="btn-auction-filter ${auction.filter === "all" ? "active" : ""}" data-filter="all">All (${pool.length})</button>
        <button type="button" class="btn-auction-filter ${auction.filter === "pool" ? "active" : ""}" data-filter="pool">Available (${poolPlayers.length})</button>
        <button type="button" class="btn-auction-filter ${auction.filter === "sold" ? "active" : ""}" data-filter="sold">Sold (${soldPlayers.length})</button>
        <button type="button" class="btn-auction-filter ${auction.filter === "unsold" ? "active" : ""}" data-filter="unsold">Unsold (${unsoldPlayers.length})</button>

        <span style="font-size:11px; color:#72809e; font-weight:700; margin-left:8px;">Role:</span>
        <button type="button" class="btn-auction-filter ${auction.roleFilter === "all" ? "active" : ""}" data-role="all">All Roles</button>
        <button type="button" class="btn-auction-filter ${auction.roleFilter === "batsman" ? "active" : ""}" data-role="batsman">Batsmen</button>
        <button type="button" class="btn-auction-filter ${auction.roleFilter === "bowler" ? "active" : ""}" data-role="bowler">Bowlers</button>
        <button type="button" class="btn-auction-filter ${auction.roleFilter === "all-rounder" ? "active" : ""}" data-role="all-rounder">All-Rounders</button>
        <button type="button" class="btn-auction-filter ${auction.roleFilter === "wicketkeeper" ? "active" : ""}" data-role="wicketkeeper">WK</button>
      </div>

      <!-- POOL TABLE -->
      <div style="overflow-x:auto; max-height:440px;">
        <table class="auction-pool-table">
          <thead>
            <tr>
              <th style="width:40px;">#</th>
              <th>Player Name & ID</th>
              <th>Role</th>
              <th>Base Pts</th>
              <th>Current / Sold Pts</th>
              <th>Status</th>
              <th>Buyer Franchise</th>
              <th style="text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>
  `;

  if (filteredPool.length === 0) {
    html += `
            <tr>
              <td colspan="8" style="text-align:center; padding:30px; color:#64748b;">
                No players matching search criteria.
              </td>
            </tr>
    `;
  } else {
    filteredPool.forEach((p, idx) => {
      const isCurrentPodium = pool.indexOf(p) === auction.currentIdx;
      const statusClass = p.status.toLowerCase();
      const actualIdx = pool.indexOf(p);

      html += `
            <tr style="${isCurrentPodium ? "background:#1e2538; border-left:3px solid #f59e0b;" : ""}">
              <td><b>${idx + 1}</b></td>
              <td>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:16px;">${p.avatar || "🏏"}</span>
                  <div>
                    <strong style="color:#ffffff; font-size:13px;">${p.name}</strong>
                    <div style="font-size:10px; color:#8b99b5;">
                      🆔 ${p.id} ${p.mobile ? `&bull; 📱 ${p.mobile}` : ""}
                    </div>
                  </div>
                </div>
              </td>
              <td><span class="podium-role-badge" style="font-size:9px;">${p.role || "Player"}</span></td>
              <td><b>${Number(p.basePrice).toFixed(2)}</b></td>
              <td style="color:${p.status === "SOLD" ? "#10b981" : "#f59e0b"}; font-weight:800;">
                ${(p.status === "SOLD" ? Number(p.soldPrice) : Number(p.currentBid)).toFixed(2)}
              </td>
              <td><span class="p-status-tag ${statusClass}">${p.status}</span></td>
              <td>
                ${p.status === "SOLD" ? `<b style="color:#10b981;">${p.soldTo}</b>` : 
                  (p.leader ? `<span style="color:#38bdf8;">${p.leader} (Leading)</span>` : `<span style="color:#64748b;">—</span>`)
                }
              </td>
              <td style="text-align:right;">
                <button type="button" class="btn-auction-action btnJumpToPlayer" data-idx="${actualIdx}" style="padding:4px 10px; font-size:10px; ${isCurrentPodium ? "background:#f59e0b; color:#000; font-weight:900;" : ""}">
                  ${isCurrentPodium ? "On Podium" : "Bid Now"}
                </button>
              </td>
            </tr>
      `;
    });
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>

    <!-- 4. CHRONOLOGICAL AUCTION HISTORY STREAM -->
    <div class="auction-pool-card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h4 style="margin:0; font-size:14px; font-weight:800; color:#fff; display:flex; align-items:center; gap:8px;">
          <i class="fa-solid fa-clock-rotate-left text-gold"></i> Live Auction History Log (${auction.history.length})
        </h4>
        <span style="font-size:11px; color:#72809e;">Real-time chronological events</span>
      </div>

      <div style="display:flex; flex-direction:column; gap:6px; max-height:280px; overflow-y:auto; padding-right:4px;">
  `;

  if (auction.history.length === 0) {
    html += `
        <div style="text-align:center; padding:24px; color:#64748b; font-size:12px;">
          No auction events recorded yet. Place bids and hammer players to populate history.
        </div>
    `;
  } else {
    auction.history.forEach((h, hIdx) => {
      const isHsold = h.status === "SOLD";

      html += `
        <div class="auc-history-card">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:11px; font-weight:800; color:#64748b; width:20px;">#${auction.history.length - hIdx}</span>
            <span style="font-size:16px;">${h.playerAvatar || "🏏"}</span>
            <div>
              <div style="font-size:12px; font-weight:800; color:#ffffff;">${h.playerName} <small style="color:#8b99b5; font-size:10px;">(ID: ${h.playerId})</small></div>
              <div style="font-size:10px; color:#72809e;">Role: ${h.role || "Player"} &bull; Time: ${h.timestamp || "Just now"}</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:10px; text-align:right;">
            <div>
              ${isHsold ? `<div style="font-size:12px; font-weight:800; color:#10b981;">${h.teamLogo || "🏏"} ${h.teamName}</div>` : `<div style="font-size:12px; font-weight:800; color:#ef4444;">UNSOLD</div>`}
              <div style="font-size:11px; font-weight:900; color:${isHsold ? "#f59e0b" : "#64748b"};">${isHsold ? `${Number(h.points).toFixed(2)} Pts` : "0.00 Pts"}</div>
            </div>
            <span class="p-status-tag ${isHsold ? "sold" : "unsold"}" style="font-size:9px;">${h.status}</span>
          </div>
        </div>
      `;
    });
  }

  html += `
      </div>
    </div>
  </div>
  `;

  container.innerHTML = html;
  attachAuctionEvents(tourney);
}

// 3. ATTACH AUCTION EVENT LISTENERS & LOGIC
function attachAuctionEvents(tourney) {
  const auction = tourney.auction;
  const pool = auction.pool || [];
  const teamPurses = auction.teamPurses || {};
  const teams = tourney.teams || [];

  // Filter Buttons (Status)
  document.querySelectorAll(".btn-auction-filter[data-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      auction.filter = btn.dataset.filter;
      renderAuctionTab(tourney);
    });
  });

  // Filter Buttons (Role)
  document.querySelectorAll(".btn-auction-filter[data-role]").forEach(btn => {
    btn.addEventListener("click", () => {
      auction.roleFilter = btn.dataset.role;
      renderAuctionTab(tourney);
    });
  });

  // Live Search Input (Table)
  const searchInp = document.getElementById("inputAuctionSearch");
  if (searchInp) {
    searchInp.addEventListener("input", (e) => {
      auction.search = e.target.value;
      renderAuctionTab(tourney);
      // Re-focus search
      const reInp = document.getElementById("inputAuctionSearch");
      if (reInp) {
        reInp.focus();
        reInp.setSelectionRange(reInp.value.length, reInp.value.length);
      }
    });
  }

  // Jump to Player Row Button
  document.querySelectorAll(".btnJumpToPlayer").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx);
      if (!isNaN(idx) && idx >= 0 && idx < pool.length) {
        auction.currentIdx = idx;
        renderAuctionTab(tourney);
        const podium = document.getElementById("auctionPodiumBox");
        if (podium) podium.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  });

  // Podium Previous & Next Navigation
  const btnPrev = document.getElementById("btnPodiumPrev");
  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      if (auction.currentIdx > 0) {
        auction.currentIdx--;
        renderAuctionTab(tourney);
      }
    });
  }

  const btnNext = document.getElementById("btnPodiumNext");
  if (btnNext) {
    btnNext.addEventListener("click", () => {
      if (auction.currentIdx < pool.length - 1) {
        auction.currentIdx++;
        renderAuctionTab(tourney);
      }
    });
  }

  // Quick Bid Increment Buttons (+0.5, +1, +2, +5, +10)
  document.querySelectorAll(".btn-bid-inc").forEach(btn => {
    btn.addEventListener("click", () => {
      const curPlayer = pool[auction.currentIdx];
      if (!curPlayer || curPlayer.status !== "POOL") return;

      const inc = parseFloat(btn.dataset.inc) || 1.0;
      const selectTeam = document.getElementById("selectBiddingTeam");
      const teamName = selectTeam ? selectTeam.value : teams[0]?.name;

      if (!teamName) {
        showToast("Please select a bidding team.");
        return;
      }

      const teamPurse = teamPurses[teamName];
      if (!teamPurse) {
        showToast("Selected team not found in tournament.");
        return;
      }

      // Check max squad size
      if (teamPurse.boughtCount >= auction.maxSquad) {
        showToast(`⚠️ ${teamName} has reached the maximum squad limit (${auction.maxSquad} players).`);
        return;
      }

      const newBid = Math.round((Number(curPlayer.currentBid) + inc) * 100) / 100;

      // Check budget
      if (newBid > teamPurse.remaining) {
        showToast(`⚠️ ${teamName} does not have enough budget! (Remaining: ${teamPurse.remaining.toFixed(2)} Pts, Attempted: ${newBid.toFixed(2)} Pts)`);
        return;
      }

      curPlayer.currentBid = newBid;
      curPlayer.leader = teamName;
      saveActiveTournament(tourney);
      renderAuctionTab(tourney);
      showToast(`⚡ Bid placed for ${curPlayer.name}: ${newBid.toFixed(2)} Pts by ${teamName}`);
    });
  });

  // Custom Bid Input Placement
  const btnCustomBid = document.getElementById("btnPlaceCustomBid");
  if (btnCustomBid) {
    btnCustomBid.addEventListener("click", () => {
      const curPlayer = pool[auction.currentIdx];
      if (!curPlayer || curPlayer.status !== "POOL") return;

      const customInp = document.getElementById("inputCustomBidPoints");
      const customVal = parseFloat(customInp?.value);

      if (isNaN(customVal) || customVal <= curPlayer.currentBid) {
        showToast(`Bid must be greater than current bid (${curPlayer.currentBid.toFixed(2)} Pts).`);
        return;
      }

      const selectTeam = document.getElementById("selectBiddingTeam");
      const teamName = selectTeam ? selectTeam.value : teams[0]?.name;
      const teamPurse = teamPurses[teamName];

      if (!teamPurse) {
        showToast("Please select a valid bidding franchise.");
        return;
      }

      if (teamPurse.boughtCount >= auction.maxSquad) {
        showToast(`⚠️ ${teamName} already has maximum squad size (${auction.maxSquad} players).`);
        return;
      }

      if (customVal > teamPurse.remaining) {
        showToast(`⚠️ ${teamName} does not have enough points! (Remaining: ${teamPurse.remaining.toFixed(2)} Pts)`);
        return;
      }

      curPlayer.currentBid = Math.round(customVal * 100) / 100;
      curPlayer.leader = teamName;
      saveActiveTournament(tourney);
      renderAuctionTab(tourney);
      showToast(`💰 Custom bid: ${curPlayer.currentBid.toFixed(2)} Pts placed by ${teamName}`);
    });
  }

  // 🔨 SOLD (Hammer) Action
  const btnSold = document.getElementById("btnHammerSold");
  if (btnSold) {
    btnSold.addEventListener("click", () => {
      const curPlayer = pool[auction.currentIdx];
      if (!curPlayer || curPlayer.status !== "POOL") return;

      const selectTeam = document.getElementById("selectBiddingTeam");
      const teamName = curPlayer.leader || (selectTeam ? selectTeam.value : null);

      if (!teamName) {
        showToast("No franchise has bid on this player yet. Please place a bid first or mark UNSOLD.");
        return;
      }

      const teamPurse = teamPurses[teamName];
      const finalPrice = Math.round(Number(curPlayer.currentBid) * 100) / 100;

      if (!teamPurse) {
        showToast("Invalid bidding team.");
        return;
      }

      if (teamPurse.boughtCount >= auction.maxSquad) {
        showToast(`⚠️ ${teamName} squad is full (Max ${auction.maxSquad} players).`);
        return;
      }

      if (finalPrice > teamPurse.remaining) {
        showToast(`⚠️ ${teamName} does not have enough budget (Remaining: ${teamPurse.remaining.toFixed(2)} Pts).`);
        return;
      }

      // Mark Player SOLD
      curPlayer.status = "SOLD";
      curPlayer.soldTo = teamName;
      curPlayer.soldPrice = finalPrice;
      curPlayer.soldTimestamp = Date.now();

      // Deduct Points from Team Purse
      teamPurse.spent = Math.round((teamPurse.spent + finalPrice) * 100) / 100;
      teamPurse.remaining = Math.max(0, Math.round((teamPurse.totalPurse - teamPurse.spent) * 100) / 100);
      teamPurse.boughtCount = (teamPurse.boughtCount || 0) + 1;
      teamPurse.required = Math.max(0, auction.maxSquad - teamPurse.boughtCount);

      // AUTOMATIC TOURNAMENT SQUAD SYNCHRONIZATION
      const tourneyTeam = tourney.teams.find(t => t.name === teamName);
      if (tourneyTeam) {
        if (!Array.isArray(tourneyTeam.players)) tourneyTeam.players = [];

        const alreadyInSquad = tourneyTeam.players.some(p => p.id === curPlayer.id || p.name.toLowerCase() === curPlayer.name.toLowerCase());
        if (!alreadyInSquad) {
          tourneyTeam.players.push({
            id: curPlayer.id, // Preserves real Player ID
            name: curPlayer.name,
            role: curPlayer.role,
            mobile: curPlayer.mobile || "",
            avatar: curPlayer.avatar || "🏏",
            isCaptain: false,
            isVC: false,
            isPlayingXi: tourneyTeam.players.length < 11,
            jersey: curPlayer.jersey || (Math.floor(Math.random() * 99) + 1),
            auctionPrice: finalPrice,
            tournamentId: tourney.id
          });
        }
        tourneyTeam.playerCount = tourneyTeam.players.length;
      }

      // Add to Chronological Auction History
      auction.history.unshift({
        id: `hist_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        playerId: curPlayer.id,
        playerName: curPlayer.name,
        playerAvatar: curPlayer.avatar || "🏏",
        role: curPlayer.role,
        teamName: teamName,
        teamLogo: (tourneyTeam && tourneyTeam.logo) || "🏏",
        points: finalPrice,
        status: "SOLD",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      });

      showToast(`🔨 SOLD! ${curPlayer.name} (ID: ${curPlayer.id}) bought by ${teamName} for ${finalPrice.toFixed(2)} Pts!`);

      // Advance to next available pool player
      findNextPoolPlayer(tourney);
      saveActiveTournament(tourney);
      renderAuctionTab(tourney);
    });
  }

  // ❌ UNSOLD Action
  const btnUnsold = document.getElementById("btnHammerUnsold");
  if (btnUnsold) {
    btnUnsold.addEventListener("click", () => {
      const curPlayer = pool[auction.currentIdx];
      if (!curPlayer || curPlayer.status !== "POOL") return;

      curPlayer.status = "UNSOLD";
      curPlayer.soldTo = null;
      curPlayer.soldPrice = 0;
      curPlayer.leader = null;

      // Add to History
      auction.history.unshift({
        id: `hist_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        playerId: curPlayer.id,
        playerName: curPlayer.name,
        playerAvatar: curPlayer.avatar || "🏏",
        role: curPlayer.role,
        teamName: "None",
        teamLogo: "❌",
        points: 0,
        status: "UNSOLD",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      });

      showToast(`❌ ${curPlayer.name} marked UNSOLD.`);
      findNextPoolPlayer(tourney);
      saveActiveTournament(tourney);
      renderAuctionTab(tourney);
    });
  }

  // Re-Open Bidding for Current Player
  const btnReopen = document.getElementById("btnReopenBidding");
  if (btnReopen) {
    btnReopen.addEventListener("click", () => {
      const curPlayer = pool[auction.currentIdx];
      if (!curPlayer) return;

      // If was sold, revert team purse and squad
      if (curPlayer.status === "SOLD" && curPlayer.soldTo) {
        const teamPurse = teamPurses[curPlayer.soldTo];
        if (teamPurse) {
          teamPurse.spent = Math.max(0, Math.round((teamPurse.spent - curPlayer.soldPrice) * 100) / 100);
          teamPurse.remaining = Math.min(teamPurse.totalPurse, Math.round((teamPurse.totalPurse - teamPurse.spent) * 100) / 100);
          teamPurse.boughtCount = Math.max(0, (teamPurse.boughtCount || 1) - 1);
          teamPurse.required = Math.max(0, auction.maxSquad - teamPurse.boughtCount);
        }

        // Remove from tournament squad
        const tourneyTeam = tourney.teams.find(t => t.name === curPlayer.soldTo);
        if (tourneyTeam && Array.isArray(tourneyTeam.players)) {
          tourneyTeam.players = tourneyTeam.players.filter(p => p.id !== curPlayer.id);
          tourneyTeam.playerCount = tourneyTeam.players.length;
        }
      }

      curPlayer.status = "POOL";
      curPlayer.soldTo = null;
      curPlayer.soldPrice = 0;
      curPlayer.currentBid = curPlayer.basePrice;
      curPlayer.leader = null;

      saveActiveTournament(tourney);
      renderAuctionTab(tourney);
      showToast(`🔄 Bidding re-opened for ${curPlayer.name}!`);
    });
  }

  // 🔄 Re-Auction All Unsold Players
  const btnReAucUnsold = document.getElementById("btnReAuctionUnsold");
  if (btnReAucUnsold) {
    btnReAucUnsold.addEventListener("click", () => {
      const unsoldList = pool.filter(p => p.status === "UNSOLD");
      if (unsoldList.length === 0) {
        showToast("No unsold players in this tournament.");
        return;
      }

      unsoldList.forEach(p => {
        p.status = "POOL";
        p.currentBid = p.basePrice;
        p.leader = null;
        p.soldTo = null;
        p.soldPrice = 0;
      });

      findNextPoolPlayer(tourney);
      saveActiveTournament(tourney);
      renderAuctionTab(tourney);
      showToast(`🔄 ${unsoldList.length} Unsold players brought back to the Auction Pool!`);
    });
  }

  // ⚡ Auto-Auction Remaining Pool
  const btnAutoAuc = document.getElementById("btnAutoAuctionRemaining");
  if (btnAutoAuc) {
    btnAutoAuc.addEventListener("click", () => {
      const poolList = pool.filter(p => p.status === "POOL");
      if (poolList.length === 0) {
        showToast("No available players in pool to auto-auction.");
        return;
      }

      if (!confirm(`Auto-auction ${poolList.length} remaining players fairly among participating teams?`)) return;

      let soldCount = 0;
      poolList.forEach(p => {
        // Find team with lowest squad and sufficient budget
        const eligibleTeams = teams.filter(t => {
          const pObj = teamPurses[t.name];
          return pObj && pObj.boughtCount < auction.maxSquad && pObj.remaining >= p.basePrice;
        });

        if (eligibleTeams.length > 0) {
          // Sort by least bought players, then most remaining budget
          eligibleTeams.sort((a, b) => {
            const pA = teamPurses[a.name];
            const pB = teamPurses[b.name];
            if (pA.boughtCount !== pB.boughtCount) return pA.boughtCount - pB.boughtCount;
            return pB.remaining - pA.remaining;
          });

          const chosenTeam = eligibleTeams[0];
          const tPurse = teamPurses[chosenTeam.name];
          const price = Math.round((Number(p.basePrice) + (Math.random() > 0.5 ? 0.5 : 0)) * 100) / 100;
          const finalPrice = Math.min(price, tPurse.remaining);

          p.status = "SOLD";
          p.soldTo = chosenTeam.name;
          p.soldPrice = finalPrice;
          p.soldTimestamp = Date.now();

          tPurse.spent = Math.round((tPurse.spent + finalPrice) * 100) / 100;
          tPurse.remaining = Math.max(0, Math.round((tPurse.totalPurse - tPurse.spent) * 100) / 100);
          tPurse.boughtCount++;
          tPurse.required = Math.max(0, auction.maxSquad - tPurse.boughtCount);

          // Add to tournament team squad
          const tourneyTeam = tourney.teams.find(t => t.name === chosenTeam.name);
          if (tourneyTeam) {
            if (!Array.isArray(tourneyTeam.players)) tourneyTeam.players = [];
            if (!tourneyTeam.players.some(tp => tp.id === p.id)) {
              tourneyTeam.players.push({
                id: p.id,
                name: p.name,
                role: p.role,
                mobile: p.mobile || "",
                avatar: p.avatar || "🏏",
                isCaptain: false,
                isVC: false,
                isPlayingXi: tourneyTeam.players.length < 11,
                jersey: p.jersey || 7,
                auctionPrice: finalPrice,
                tournamentId: tourney.id
              });
              tourneyTeam.playerCount = tourneyTeam.players.length;
            }
          }

          // History
          auction.history.unshift({
            id: `hist_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            playerId: p.id,
            playerName: p.name,
            playerAvatar: p.avatar || "🏏",
            role: p.role,
            teamName: chosenTeam.name,
            teamLogo: (tourneyTeam && tourneyTeam.logo) || "🏏",
            points: finalPrice,
            status: "SOLD",
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          });

          soldCount++;
        } else {
          p.status = "UNSOLD";
          p.soldTo = null;
          p.soldPrice = 0;
        }
      });

      saveActiveTournament(tourney);
      renderAuctionTab(tourney);
      showToast(`⚡ Auto-auction completed: ${soldCount} players sold across teams!`);
    });
  }

  // 🔄 Sync Squads Button
  const btnSyncSquads = document.getElementById("btnSyncAuctionSquads");
  if (btnSyncSquads) {
    btnSyncSquads.addEventListener("click", () => {
      let syncedCount = 0;
      const soldList = pool.filter(p => p.status === "SOLD" && p.soldTo);

      soldList.forEach(p => {
        const tObj = tourney.teams.find(t => t.name === p.soldTo);
        if (tObj) {
          if (!Array.isArray(tObj.players)) tObj.players = [];
          const existing = tObj.players.find(tp => tp.id === p.id);
          if (!existing) {
            tObj.players.push({
              id: p.id,
              name: p.name,
              role: p.role,
              mobile: p.mobile || "",
              avatar: p.avatar || "🏏",
              isCaptain: false,
              isVC: false,
              isPlayingXi: tObj.players.length < 11,
              jersey: p.jersey || 7,
              auctionPrice: p.soldPrice,
              tournamentId: tourney.id
            });
            syncedCount++;
          }
          tObj.playerCount = tObj.players.length;
        }
      });

      saveActiveTournament(tourney);
      showToast(`✓ Squads verified & synced: ${syncedCount} player roster entries verified!`);
    });
  }

  // 🔄 Reset Auction Button
  const btnReset = document.getElementById("btnResetAuction");
  if (btnReset) {
    btnReset.addEventListener("click", () => {
      if (!confirm("Are you sure you want to reset all auction bids, sales, history, and team purses for this tournament?")) return;

      tourney.auction = null;
      initTournamentAuction(tourney);
      saveActiveTournament(tourney);
      showToast("Auction state has been reset to starting pool.");
      renderAuctionTab(tourney);
    });
  }

  // 🔍 Master Player Database Search Modal Handler
  const btnOpenMasterSearch = document.getElementById("btnOpenAuctionMasterSearch");
  if (btnOpenMasterSearch) {
    btnOpenMasterSearch.addEventListener("click", () => {
      openAuctionMasterSearchModal(tourney);
    });
  }

  // View Team Squad Modal Buttons
  document.querySelectorAll(".btnViewTeamSquadFromAuction").forEach(btn => {
    btn.addEventListener("click", () => {
      const teamName = btn.dataset.team;
      openAuctionTeamSquadViewModal(tourney, teamName);
    });
  });
}

// 4. MASTER PLAYER SEARCH MODAL ENGINE
function openAuctionMasterSearchModal(tourney) {
  const modal = document.getElementById("auctionMasterPlayerSearchModal");
  const input = document.getElementById("inputMasterPlayerModalSearch");
  const listContainer = document.getElementById("auctionMasterSearchResultsList");
  const closeBtn = document.getElementById("btnCloseAuctionMasterSearch");

  if (!modal) return;
  modal.style.display = "flex";

  const allMasterPlayers = getMasterPlayerDatabase();
  let currentMasterRole = "all";

  function renderSearchResults(query = "") {
    if (!listContainer) return;
    const cleanDigits = query.replace(/\D/g, "");
    const q = query.toLowerCase().trim();

    const results = allMasterPlayers.filter(p => {
      // Role filter
      if (currentMasterRole !== "all") {
        const rStr = (p.role || "").toLowerCase();
        if (currentMasterRole === "batsman" && !rStr.includes("bat")) return false;
        if (currentMasterRole === "bowler" && !rStr.includes("bowl")) return false;
        if (currentMasterRole === "all-rounder" && !rStr.includes("all")) return false;
        if (currentMasterRole === "wicketkeeper" && !rStr.includes("keeper") && !rStr.includes("wk")) return false;
      }

      if (!q) return true;
      const nameM = p.name.toLowerCase().includes(q);
      const idM = p.id.toLowerCase().includes(q);
      const roleM = (p.role || "").toLowerCase().includes(q);
      const mobM = cleanDigits && p.mobile && p.mobile.replace(/\D/g, "").includes(cleanDigits);
      return nameM || idM || roleM || mobM;
    });

    if (results.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align:center; padding:30px; color:#8b99b5;">
          <i class="fa-solid fa-user-slash" style="font-size:24px; margin-bottom:8px;"></i>
          <p style="margin:0;">No matching players found in database.</p>
        </div>
      `;
      return;
    }

    const pool = tourney.auction?.pool || [];

    listContainer.innerHTML = results.map(p => {
      const existingInPool = pool.find(pl => pl.id === p.id || pl.name.toLowerCase() === p.name.toLowerCase());
      const isInPool = !!existingInPool;
      const isSold = existingInPool && existingInPool.status === "SOLD";

      return `
        <div class="auc-search-result-item">
          <div style="display:flex; align-items:center; gap:10px; min-width:0;">
            <span style="font-size:20px;">${p.avatar || "🏏"}</span>
            <div style="min-width:0;">
              <div style="font-size:13px; font-weight:800; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${p.name}
              </div>
              <div style="font-size:10px; color:#8b99b5; display:flex; gap:6px; flex-wrap:wrap; margin-top:2px;">
                <span style="background:#242c3f; color:#94a3b8; padding:1px 5px; border-radius:3px;">🆔 ${p.id}</span>
                <span style="color:#f59e0b;">${p.role}</span>
                ${p.mobile ? `<span style="color:#60a5fa;"><i class="fa-solid fa-phone" style="font-size:9px;"></i> ${p.mobile}</span>` : ""}
                <span>Base: <b>${p.basePrice.toFixed(1)} Pts</b></span>
              </div>
            </div>
          </div>
          <div style="display:flex; gap:6px; flex-shrink:0;">
            ${isSold ? `
              <span class="p-status-tag sold" style="font-size:10px;">SOLD to ${existingInPool.soldTo}</span>
            ` : (isInPool ? `
              <button type="button" class="btn-auction-action primary-gold btnPutOnPodiumNow" data-id="${p.id}" style="padding:5px 10px; font-size:11px;">
                <i class="fa-solid fa-gavel"></i> Put on Podium
              </button>
            ` : `
              <button type="button" class="btn-auction-action btnAddPlayerToPool" data-id="${p.id}" style="background:#3b82f6; color:#fff; border:none; padding:5px 10px; font-size:11px;">
                <i class="fa-solid fa-plus"></i> Add to Pool
              </button>
            `)}
          </div>
        </div>
      `;
    }).join("");

    // Attach Podium buttons
    listContainer.querySelectorAll(".btnPutOnPodiumNow").forEach(btn => {
      btn.addEventListener("click", () => {
        const pId = btn.dataset.id;
        const idx = pool.findIndex(pl => pl.id === pId);
        if (idx >= 0) {
          tourney.auction.currentIdx = idx;
          modal.style.display = "none";
          renderAuctionTab(tourney);
          showToast(`Player on podium: ${pool[idx].name}`);
        }
      });
    });

    // Attach Add to Pool buttons
    listContainer.querySelectorAll(".btnAddPlayerToPool").forEach(btn => {
      btn.addEventListener("click", () => {
        const pId = btn.dataset.id;
        const targetP = allMasterPlayers.find(mp => mp.id === pId);
        if (targetP) {
          pool.push({
            id: targetP.id,
            name: targetP.name,
            role: targetP.role,
            mobile: targetP.mobile || "",
            basePrice: targetP.basePrice || 1.0,
            currentBid: targetP.basePrice || 1.0,
            leader: null,
            status: "POOL",
            soldTo: null,
            soldPrice: 0,
            soldTimestamp: null,
            avatar: targetP.avatar || "🏏",
            type: targetP.type || "Domestic",
            jersey: targetP.jersey || 7
          });
          tourney.auction.currentIdx = pool.length - 1;
          saveActiveTournament(tourney);
          modal.style.display = "none";
          renderAuctionTab(tourney);
          showToast(`Added ${targetP.name} to Auction Pool & Podium!`);
        }
      });
    });
  }

  // Filter Buttons in Search Modal
  const filterBtns = modal.querySelectorAll("#aucMasterRoleFilters .btn-auction-filter");
  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentMasterRole = btn.dataset.role;
      renderSearchResults(input?.value || "");
    });
  });

  if (input) {
    input.value = "";
    input.oninput = (e) => renderSearchResults(e.target.value);
    input.focus();
  }

  renderSearchResults("");

  if (closeBtn) {
    closeBtn.onclick = () => { modal.style.display = "none"; };
  }
}

// 5. VIEW TEAM SQUAD MODAL ENGINE (AUCTION SQUAD INSPECTOR)
function openAuctionTeamSquadViewModal(tourney, teamName) {
  const modal = document.getElementById("auctionTeamSquadViewModal");
  if (!modal) return;

  const team = tourney.teams.find(t => t.name === teamName);
  const purse = tourney.auction?.teamPurses[teamName] || {
    totalPurse: 100, spent: 0, remaining: 100, boughtCount: 0, required: 15, players: []
  };

  const logoEl = document.getElementById("aucSquadModalTeamLogo");
  const nameEl = document.getElementById("aucSquadModalTeamName");
  const subEl = document.getElementById("aucSquadModalSubtitle");
  const statsBar = document.getElementById("aucSquadModalStatsBar");
  const playersList = document.getElementById("aucSquadModalPlayersList");
  const manageBtn = document.getElementById("btnManageSquadFromAuction");
  const closeBtn = document.getElementById("btnCloseAuctionSquadView");

  if (logoEl) logoEl.textContent = team?.logo || "🏏";
  if (nameEl) nameEl.textContent = teamName;
  if (subEl) subEl.textContent = `Tournament Squad & Auction Purchases &bull; ${tourney.name}`;

  if (statsBar) {
    statsBar.innerHTML = `
      <div style="text-align:center;">
        <span style="font-size:10px; color:#888; display:block;">REMAINING BUDGET</span>
        <b style="font-size:15px; color:#10b981;">${purse.remaining.toFixed(2)} Pts</b>
      </div>
      <div style="text-align:center;">
        <span style="font-size:10px; color:#888; display:block;">TOTAL SPENT</span>
        <b style="font-size:15px; color:#f59e0b;">${purse.spent.toFixed(2)} Pts</b>
      </div>
      <div style="text-align:center;">
        <span style="font-size:10px; color:#888; display:block;">SQUAD SIZE</span>
        <b style="font-size:15px; color:#38bdf8;">${team?.players?.length || purse.boughtCount} / ${tourney.auction?.maxSquad || 15}</b>
      </div>
    `;
  }

  const teamPlayers = team?.players || [];

  if (playersList) {
    if (teamPlayers.length === 0) {
      playersList.innerHTML = `
        <div style="text-align:center; padding:30px; color:#888;">
          <i class="fa-solid fa-users-slash" style="font-size:24px; margin-bottom:8px;"></i>
          <p style="margin:0;">No players bought in auction yet for ${teamName}.</p>
        </div>
      `;
    } else {
      playersList.innerHTML = teamPlayers.map((p, idx) => `
        <div style="background:#161b26; border:1px solid #232c42; border-radius:8px; padding:8px 12px; display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:11px; font-weight:800; color:#64748b;">${idx + 1}</span>
            <span style="font-size:16px;">${p.avatar || "🏏"}</span>
            <div>
              <strong style="color:#fff; font-size:12px;">${p.name}</strong>
              <div style="font-size:10px; color:#8b99b5;">
                🆔 ${p.id} &bull; ${p.role} ${p.isCaptain ? '<b style="color:#facc15;">(C)</b>' : (p.isVC ? '<b style="color:#60a5fa;">(VC)</b>' : '')} ${p.isPlayingXi ? '<span style="color:#4ade80;">• Playing XI</span>' : ''}
              </div>
            </div>
          </div>
          <div style="text-align:right;">
            <span style="font-size:12px; font-weight:900; color:#f59e0b;">${p.auctionPrice ? `${Number(p.auctionPrice).toFixed(2)} Pts` : "Retained"}</span>
          </div>
        </div>
      `).join("");
    }
  }

  if (manageBtn) {
    manageBtn.onclick = () => {
      modal.style.display = "none";
      if (typeof openTeamSquadModal === "function") {
        openTeamSquadModal(teamName, tourney.id);
      }
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => { modal.style.display = "none"; };
  }

  modal.style.display = "flex";
}

// 6. HELPER TO ADVANCE TO NEXT POOL PLAYER
function findNextPoolPlayer(tourney) {
  const auction = tourney.auction;
  if (!auction) return;
  const pool = auction.pool || [];
  const nextIdx = pool.findIndex((p, i) => i > auction.currentIdx && p.status === "POOL");
  if (nextIdx >= 0) {
    auction.currentIdx = nextIdx;
  } else {
    const anyPoolIdx = pool.findIndex(p => p.status === "POOL");
    if (anyPoolIdx >= 0) {
      auction.currentIdx = anyPoolIdx;
    }
  }
}

// 7. TOURNAMENT PERSISTENCE HELPER
function saveActiveTournament(tourney) {
  if (!tourney || !tourney.id) return;
  try {
    const list = getTournamentsList();
    const idx = list.findIndex(t => t.id === tourney.id);
    if (idx >= 0) {
      list[idx] = tourney;
    } else {
      list.push(tourney);
    }
    saveTournamentsList(list);
    if (window.CricYuvaCloud) window.CricYuvaCloud.request("/api/tournaments", { method: "POST", body: JSON.stringify(tourney) }).catch(() => {});
  } catch (e) {
    console.error("Error saving active tournament:", e);
  }
}

// =========================================================================
// 7.5 TOURNAMENT CHAT TAB & REALTIME MESSAGING ENGINE
// =========================================================================
let currentActiveChatTourneyId = null;

async function renderTournamentChatTab(tourney) {
  if (!tourney || !tourney.id) return;
  currentActiveChatTourneyId = tourney.id;

  const messagesList = document.getElementById("tChatMessagesList");
  const ctxLabel = document.getElementById("tChatContextLabel");
  const form = document.getElementById("tChatInputForm");
  const input = document.getElementById("tChatInputText");

  if (ctxLabel) {
    ctxLabel.textContent = `${tourney.name} • Official Discussion & Announcements`;
  }

  // Subscribe via WebSocket to real-time room
  const userId = getCurrentCricYuvaUserId();
  const senderName = localStorage.getItem("cricYuvaProfileName") || localStorage.getItem("cricYuvaName") || "Tournament Official";
  
  if (window.RealtimeLiveService) {
    RealtimeLiveService.connectWebSocket();
    RealtimeLiveService.send({
      type: "SUBSCRIBE_CHAT",
      room: `tournament:${tourney.id}`,
      userId: userId,
      role: "Official"
    });
  }

  if (messagesList) {
    messagesList.innerHTML = `
      <div style="text-align:center; padding:30px; color:#888;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size:20px; color:#ff7a29;"></i>
        <p style="margin-top:8px; font-size:12px;">Loading chat messages...</p>
      </div>
    `;
  }

  // Fetch chat history from REST API
  try {
    const data = await CricYuvaCloud.request(`/api/chat/tournament/${encodeURIComponent(tourney.id)}`);
    if (data.success && Array.isArray(data.messages)) {
      renderChatMessagesList(messagesList, data.messages, userId);
    } else if (messagesList) {
      messagesList.innerHTML = `
        <div style="text-align:center; padding:30px; color:#888;">
          <i class="fa-solid fa-comments" style="font-size:24px; margin-bottom:8px; color:#ff7a29;"></i>
          <p style="margin:0; font-size:13px; color:#ccc;">Welcome to ${tourney.name} Chat!</p>
          <span style="font-size:11px; color:#777;">Send match updates, organizer announcements, or questions.</span>
        </div>
      `;
    }
  } catch (err) {
    console.warn("Could not load tournament chat history:", err);
    if (messagesList) {
      messagesList.innerHTML = `
        <div style="text-align:center; padding:20px; color:#888;">
          <p style="margin:0; font-size:12px;">Chat is live. Start the conversation!</p>
        </div>
      `;
    }
  }
}

function renderChatMessagesList(container, messages, currentUserId) {
  if (!container) return;
  if (!messages || messages.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:30px; color:#888;">
        <i class="fa-solid fa-comments" style="font-size:24px; margin-bottom:8px; color:#ff7a29;"></i>
        <p style="margin:0; font-size:13px; color:#ccc;">No messages yet.</p>
        <span style="font-size:11px; color:#777;">Be the first to post an update!</span>
      </div>
    `;
    return;
  }

  container.innerHTML = messages.map(m => {
    const isMe = m.userId === currentUserId;
    const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
    const roleBadge = m.role ? `<span style="background:${isMe ? '#ff7a2933' : '#3b82f633'}; color:${isMe ? '#ff7a29' : '#60a5fa'}; border-radius:4px; font-size:9px; padding:1px 4px; font-weight:700;">${m.role}</span>` : "";

    return `
      <div style="display:flex; flex-direction:column; align-items:${isMe ? 'flex-end' : 'flex-start'}; margin-bottom:4px;">
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px; font-size:11px; color:#888;">
          <strong style="color:${isMe ? '#ff9a4d' : '#e2e8f0'};">${escapeHtml(m.senderName || "User")}</strong>
          ${roleBadge}
          <span style="font-size:10px; color:#666;">${timeStr}</span>
        </div>
        <div style="max-width:80%; background:${isMe ? '#ff7a29' : '#1f2430'}; color:${isMe ? '#000' : '#fff'}; padding:8px 12px; border-radius:${isMe ? '12px 12px 2px 12px' : '12px 12px 12px 2px'}; font-size:13px; line-height:1.4; word-break:break-word; border:1px solid ${isMe ? '#ff7a29' : '#2b3448'}; font-weight:${isMe ? '600' : '400'};">
          ${escapeHtml(m.message || "")}
        </div>
      </div>
    `;
  }).join("");

  container.scrollTop = container.scrollHeight;
}

function appendSingleChatMessage(container, m, currentUserId) {
  if (!container) return;
  // If empty placeholder is shown, clear it
  if (container.querySelector(".fa-comments") || container.querySelector(".fa-spinner")) {
    container.innerHTML = "";
  }
  const isMe = m.userId === currentUserId;
  const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
  const roleBadge = m.role ? `<span style="background:${isMe ? '#ff7a2933' : '#3b82f633'}; color:${isMe ? '#ff7a29' : '#60a5fa'}; border-radius:4px; font-size:9px; padding:1px 4px; font-weight:700;">${m.role}</span>` : "";

  const div = document.createElement("div");
  div.style.cssText = `display:flex; flex-direction:column; align-items:${isMe ? 'flex-end' : 'flex-start'}; margin-bottom:4px;`;
  div.innerHTML = `
    <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px; font-size:11px; color:#888;">
      <strong style="color:${isMe ? '#ff9a4d' : '#e2e8f0'};">${escapeHtml(m.senderName || "User")}</strong>
      ${roleBadge}
      <span style="font-size:10px; color:#666;">${timeStr}</span>
    </div>
    <div style="max-width:80%; background:${isMe ? '#ff7a29' : '#1f2430'}; color:${isMe ? '#000' : '#fff'}; padding:8px 12px; border-radius:${isMe ? '12px 12px 2px 12px' : '12px 12px 12px 2px'}; font-size:13px; line-height:1.4; word-break:break-word; border:1px solid ${isMe ? '#ff7a29' : '#2b3448'}; font-weight:${isMe ? '600' : '400'};">
      ${escapeHtml(m.message || "")}
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// Hook up RealtimeLiveService chat triggers
if (window.RealtimeLiveService) {
  RealtimeLiveService.on("tournament_chat", (msg) => {
    if (activeTourneyDetailTab === "chat" && currentActiveChatTourneyId === msg.tourneyId) {
      const messagesList = document.getElementById("tChatMessagesList");
      const currentUserId = getCurrentCricYuvaUserId();
      appendSingleChatMessage(messagesList, msg, currentUserId);
    }
  });

  RealtimeLiveService.on("team_chat", (msg) => {
    const modal = document.getElementById("teamChatModal");
    if (modal && modal.style.display !== "none" && currentTeamChatTeamName === msg.teamId) {
      const messagesList = document.getElementById("teamChatModalMessagesList");
      const currentUserId = getCurrentCricYuvaUserId();
      appendSingleChatMessage(messagesList, msg, currentUserId);
    }
  });
}

// Tournament Chat Input Form submission
const tChatInputForm = document.getElementById("tChatInputForm");
if (tChatInputForm) {
  tChatInputForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("tChatInputText");
    if (!input || !input.value.trim() || !activeTournamentId) return;

    const text = input.value.trim();
    input.value = "";

    const userId = getCurrentCricYuvaUserId();
    const senderName = localStorage.getItem("cricYuvaProfileName") || localStorage.getItem("cricYuvaName") || "Tournament Official";
    const role = "Organizer";

    const payload = {
      tourneyId: activeTournamentId,
      userId: userId,
      senderName: senderName,
      message: text,
      role: role,
      timestamp: Date.now()
    };

    // 1. Send via WebSocket for instant broadcast
    if (window.RealtimeLiveService) {
      RealtimeLiveService.send({
        type: "TOURNAMENT_CHAT_MESSAGE",
        ...payload
      });
    }

    // 2. Persist via REST API
    try {
      await CricYuvaCloud.request(`/api/chat/tournament/${encodeURIComponent(activeTournamentId)}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn("Failed to persist tournament chat:", err);
    }

    // 3. Append to local list
    const messagesList = document.getElementById("tChatMessagesList");
    appendSingleChatMessage(messagesList, payload, userId);
  });
}

// =========================================================================
// 7.6 TEAM SQUAD PRIVATE CHAT ROOM ENGINE
// =========================================================================
let currentTeamChatTeamName = "";
let currentTeamChatTourneyId = "";

async function openTeamChatModal(teamName, tourneyId) {
  currentTeamChatTeamName = teamName;
  currentTeamChatTourneyId = tourneyId || activeTournamentId || "general";

  const modal = document.getElementById("teamChatModal");
  if (!modal) return;

  const titleEl = document.getElementById("teamChatModalTeamName");
  const logoEl = document.getElementById("teamChatModalLogo");
  const ctxEl = document.getElementById("teamChatTourneyContext");
  const messagesList = document.getElementById("teamChatModalMessagesList");
  const input = document.getElementById("teamChatModalInputText");

  const tourney = getTournamentById(currentTeamChatTourneyId);
  const teamObj = (tourney?.teams || []).find(t => t.name === teamName) || getAvailableClubsList().find(c => c.name === teamName);

  if (titleEl) titleEl.textContent = `${teamName} Squad Room`;
  if (logoEl) logoEl.textContent = teamObj?.logo || "🏏";
  if (ctxEl) ctxEl.textContent = tourney?.name || "Yuva Championship";
  if (input) input.value = "";

  modal.style.display = "flex";

  const userId = getCurrentCricYuvaUserId();
  const senderName = localStorage.getItem("cricYuvaProfileName") || localStorage.getItem("cricYuvaName") || "Squad Member";

  // Subscribe to team chat room
  if (window.RealtimeLiveService) {
    RealtimeLiveService.connectWebSocket();
    RealtimeLiveService.send({
      type: "SUBSCRIBE_CHAT",
      room: `team:${currentTeamChatTourneyId}:${teamName}`,
      userId: userId,
      role: "Player"
    });
  }

  if (messagesList) {
    messagesList.innerHTML = `
      <div style="text-align:center; padding:30px; color:#888;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size:20px; color:#3b82f6;"></i>
        <p style="margin-top:8px; font-size:12px;">Loading squad messages...</p>
      </div>
    `;
  }

  // Fetch squad chat history
  try {
    const data = await CricYuvaCloud.request(`/api/chat/team/${encodeURIComponent(currentTeamChatTourneyId)}/${encodeURIComponent(teamName)}`);
    if (data.success && Array.isArray(data.messages)) {
      renderChatMessagesList(messagesList, data.messages, userId);
    } else if (messagesList) {
      messagesList.innerHTML = `
        <div style="text-align:center; padding:30px; color:#888;">
          <i class="fa-solid fa-users" style="font-size:24px; margin-bottom:8px; color:#3b82f6;"></i>
          <p style="margin:0; font-size:13px; color:#ccc;">Welcome to ${teamName} Squad Chat!</p>
          <span style="font-size:11px; color:#777;">Discuss playing XI lineup, batting order, and match tactics.</span>
        </div>
      `;
    }
  } catch (err) {
    console.warn("Could not load team chat history:", err);
    if (messagesList) {
      messagesList.innerHTML = `
        <div style="text-align:center; padding:20px; color:#888;">
          <p style="margin:0; font-size:12px;">Private squad chat ready. Send a message!</p>
        </div>
      `;
    }
  }
}

// Team Chat Modal Close
const teamChatModalCloseBtn = document.getElementById("teamChatModalCloseBtn");
if (teamChatModalCloseBtn) {
  teamChatModalCloseBtn.addEventListener("click", () => {
    const modal = document.getElementById("teamChatModal");
    if (modal) modal.style.display = "none";
  });
}

// Team Chat Modal Form submit
const teamChatModalInputForm = document.getElementById("teamChatModalInputForm");
if (teamChatModalInputForm) {
  teamChatModalInputForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("teamChatModalInputText");
    if (!input || !input.value.trim() || !currentTeamChatTeamName) return;

    const text = input.value.trim();
    input.value = "";

    const userId = getCurrentCricYuvaUserId();
    const senderName = localStorage.getItem("cricYuvaProfileName") || localStorage.getItem("cricYuvaName") || "Squad Member";
    const role = "Player";

    const payload = {
      tourneyId: currentTeamChatTourneyId,
      teamId: currentTeamChatTeamName,
      userId: userId,
      senderName: senderName,
      message: text,
      role: role,
      timestamp: Date.now()
    };

    // 1. Send via WebSocket
    if (window.RealtimeLiveService) {
      RealtimeLiveService.send({
        type: "TEAM_CHAT_MESSAGE",
        ...payload
      });
    }

    // 2. Persist via REST
    try {
      await CricYuvaCloud.request(`/api/chat/team/${encodeURIComponent(currentTeamChatTourneyId)}/${encodeURIComponent(currentTeamChatTeamName)}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn("Failed to persist team chat:", err);
    }

    // 3. Render locally
    const messagesList = document.getElementById("teamChatModalMessagesList");
    appendSingleChatMessage(messagesList, payload, userId);
  });
}

// Hook button in Squad Manager: "Team Chat"
const btnSqOpenTeamChat = document.getElementById("btnSqOpenTeamChat");
if (btnSqOpenTeamChat) {
  btnSqOpenTeamChat.addEventListener("click", () => {
    if (currentEditingTeamName) {
      openTeamChatModal(currentEditingTeamName, currentEditingTourneyId || activeTournamentId);
    }
  });
}

// =========================================================================
// 7.7 MASTER PLAYER DIRECTORY & SQUAD LINKING ENGINE
// =========================================================================
function getMasterPlayersDirectory() {
  const masterList = [];
  const addedIds = new Set();

  // 1. Default auction / master players
  if (typeof getDefaultAuctionPlayers === "function") {
    const defaults = getDefaultAuctionPlayers();
    defaults.forEach(p => {
      if (!addedIds.has(p.id)) {
        addedIds.add(p.id);
        masterList.push({
          id: p.id,
          name: p.name,
          role: p.role || "All-Rounder",
          avatar: p.avatar || "🏏",
          type: p.type || "Domestic",
          jersey: p.jersey || 7,
          mobile: p.mobile || ""
        });
      }
    });
  }

  // 2. Custom club players
  const customClubs = getCustomClubsList();
  customClubs.forEach(c => {
    (c.players || []).forEach((p, idx) => {
      const pid = p.id || `P_CLUB_${c.id || c.name}_${idx + 1}`;
      if (!addedIds.has(pid)) {
        addedIds.add(pid);
        masterList.push({
          id: pid,
          name: p.name,
          role: p.role || "Batsman",
          avatar: p.avatar || "🏏",
          type: "Club",
          jersey: p.jersey || idx + 1,
          mobile: p.mobile || ""
        });
      }
    });
  });

  return masterList;
}

function openMasterPlayerSearchModal() {
  const modal = document.getElementById("masterPlayerSearchModal");
  if (!modal) return;

  const input = document.getElementById("inputMasterPlayerQuery");
  const resultsContainer = document.getElementById("masterPlayerSearchResultsList");

  if (input) {
    input.value = "";
    input.oninput = (e) => renderMasterPlayerSearchResults(e.target.value);
  }

  renderMasterPlayerSearchResults("");
  modal.style.display = "flex";
  if (input) input.focus();
}

function renderMasterPlayerSearchResults(query) {
  const container = document.getElementById("masterPlayerSearchResultsList");
  if (!container) return;

  const q = (query || "").trim().toLowerCase();
  const allPlayers = getMasterPlayersDirectory();
  const filtered = allPlayers.filter(p => {
    if (!q) return true;
    return (p.name && p.name.toLowerCase().includes(q)) ||
           (p.id && p.id.toLowerCase().includes(q)) ||
           (p.role && p.role.toLowerCase().includes(q)) ||
           (p.mobile && p.mobile.includes(q));
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:30px; color:#888;">
        <i class="fa-solid fa-user-xmark" style="font-size:24px; margin-bottom:8px;"></i>
        <p style="margin:0; font-size:13px; color:#ccc;">No players found matching "${escapeHtml(query)}"</p>
        <span style="font-size:11px; color:#666;">Try searching by name, Player ID, or role.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(p => {
    const isAlreadyInSquad = currentEditingSquad.some(sq => sq.id === p.id || sq.name.toLowerCase() === p.name.toLowerCase());
    const roleIcon = p.role === "Bowler" ? "🎯" : (p.role === "All-Rounder" ? "⚡" : (p.role === "Wicketkeeper" ? "🧤" : "🏏"));

    return `
      <div style="background:#161922; border:1px solid #232a3b; border-radius:10px; padding:10px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="display:flex; align-items:center; gap:10px; flex:1;">
          <span style="font-size:20px;">${p.avatar || "🏏"}</span>
          <div>
            <strong style="color:#fff; font-size:13px;">${escapeHtml(p.name)}</strong>
            <div style="font-size:11px; color:#8b99b5; display:flex; align-items:center; gap:6px; margin-top:2px;">
              <span style="background:#242d40; color:#60a5fa; font-weight:700; font-size:10px; padding:1px 5px; border-radius:4px;">${escapeHtml(p.id)}</span>
              <span>${roleIcon} ${escapeHtml(p.role)}</span>
              ${p.type ? `<span>• ${escapeHtml(p.type)}</span>` : ""}
            </div>
          </div>
        </div>
        <button type="button" class="btn-link-master-player" data-player-id="${p.id}" style="background:${isAlreadyInSquad ? '#27272a' : '#ff7a00'}; color:${isAlreadyInSquad ? '#71717a' : '#000'}; border:none; padding:6px 12px; border-radius:6px; font-size:11px; font-weight:800; cursor:${isAlreadyInSquad ? 'default' : 'pointer'}; display:flex; align-items:center; gap:5px;" ${isAlreadyInSquad ? 'disabled' : ''}>
          ${isAlreadyInSquad ? '<i class="fa-solid fa-check"></i> Linked' : '<i class="fa-solid fa-plus"></i> Link to Squad'}
        </button>
      </div>
    `;
  }).join("");

  // Attach click listeners to Link buttons
  container.querySelectorAll(".btn-link-master-player:not([disabled])").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.dataset.playerId;
      const player = allPlayers.find(p => p.id === pid);
      if (player) {
        // Check again
        if (currentEditingSquad.some(sq => sq.id === player.id || sq.name.toLowerCase() === player.name.toLowerCase())) {
          showToast(`${player.name} is already in this squad!`, "warn");
          return;
        }
        currentEditingSquad.push({
          id: player.id,
          name: player.name,
          role: player.role || "All-Rounder",
          jersey: player.jersey || (currentEditingSquad.length + 1),
          avatar: player.avatar || "🏏",
          isPlayingXi: currentEditingSquad.length < 11,
          isCaptain: false,
          isVC: false
        });

        renderSquadModalPlayersList();
        renderMasterPlayerSearchResults(document.getElementById("inputMasterPlayerQuery")?.value || "");
        showToast(`Linked ${player.name} (${player.id}) to squad!`);
      }
    });
  });
}

// Master Player Search Close
const masterPlayerSearchCloseBtn = document.getElementById("masterPlayerSearchCloseBtn");
if (masterPlayerSearchCloseBtn) {
  masterPlayerSearchCloseBtn.addEventListener("click", () => {
    const modal = document.getElementById("masterPlayerSearchModal");
    if (modal) modal.style.display = "none";
  });
}

// Hook button in Squad Manager: "Search Player"
const btnSqSearchMasterPlayer = document.getElementById("btnSqSearchMasterPlayer");
if (btnSqSearchMasterPlayer) {
  btnSqSearchMasterPlayer.addEventListener("click", () => {
    openMasterPlayerSearchModal();
  });
}

// =========================================================================
// 7.8 EDIT TOURNAMENT MODAL ENGINE
// =========================================================================
function openEditTournamentModal(tourneyId) {
  const tourney = getTournamentById(tourneyId || activeTournamentId);
  if (!tourney) return;

  const modal = document.getElementById("editTournamentModal");
  if (!modal) return;

  const idInput = document.getElementById("editTourneyId");
  const nameInput = document.getElementById("editTourneyName");
  const typeInput = document.getElementById("editTourneyType");
  const logoInput = document.getElementById("editTourneyLogo");
  const formatSelect = document.getElementById("editTourneyFormat");
  const startInput = document.getElementById("editTourneyStartDate");
  const endInput = document.getElementById("editTourneyEndDate");
  const oversInput = document.getElementById("editTourneyOvers");
  const statusSelect = document.getElementById("editTourneyStatus");
  const groundsInput = document.getElementById("editTourneyGrounds");

  if (idInput) idInput.value = tourney.id;
  if (nameInput) nameInput.value = tourney.name || "";
  if (typeInput) typeInput.value = tourney.type || "REGULAR";
  if (logoInput) logoInput.value = tourney.logo || "🏆";
  if (formatSelect) formatSelect.value = tourney.format || "League + Playoffs";
  if (startInput) startInput.value = tourney.startDate || "";
  if (endInput) endInput.value = tourney.endDate || "";
  if (oversInput) oversInput.value = tourney.overs || 20;
  if (statusSelect) statusSelect.value = tourney.status || "ONGOING";
  if (groundsInput) groundsInput.value = (tourney.grounds || []).join(", ");

  // Set Type buttons visual state
  const optRegular = document.getElementById("editOptTypeRegular");
  const optAuction = document.getElementById("editOptTypeAuction");
  if (optRegular && optAuction) {
    const isAuction = tourney.type === "AUCTION";
    optRegular.style.borderColor = isAuction ? "#333" : "#ff7a29";
    optRegular.style.background = isAuction ? "#141414" : "#1e140d";
    optAuction.style.borderColor = isAuction ? "#ff7a29" : "#333";
    optAuction.style.background = isAuction ? "#1e140d" : "#141414";
  }

  // Set logo chips
  const logoChips = modal.querySelectorAll(".icon-chip");
  logoChips.forEach(chip => {
    chip.classList.toggle("active", chip.dataset.icon === (tourney.logo || "🏆"));
  });

  modal.style.display = "flex";
}

// Edit Tournament Type Toggle Buttons
const editOptTypeRegular = document.getElementById("editOptTypeRegular");
const editOptTypeAuction = document.getElementById("editOptTypeAuction");
if (editOptTypeRegular && editOptTypeAuction) {
  editOptTypeRegular.addEventListener("click", () => {
    const typeInput = document.getElementById("editTourneyType");
    if (typeInput) typeInput.value = "REGULAR";
    editOptTypeRegular.style.borderColor = "#ff7a29";
    editOptTypeRegular.style.background = "#1e140d";
    editOptTypeAuction.style.borderColor = "#333";
    editOptTypeAuction.style.background = "#141414";
  });

  editOptTypeAuction.addEventListener("click", () => {
    const typeInput = document.getElementById("editTourneyType");
    if (typeInput) typeInput.value = "AUCTION";
    editOptTypeAuction.style.borderColor = "#ff7a29";
    editOptTypeAuction.style.background = "#1e140d";
    editOptTypeRegular.style.borderColor = "#333";
    editOptTypeRegular.style.background = "#141414";
  });
}

// Edit Tournament Logo Chips
document.querySelectorAll("#editTourneyLogoRow .icon-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#editTourneyLogoRow .icon-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    const hiddenLogo = document.getElementById("editTourneyLogo");
    if (hiddenLogo) hiddenLogo.value = chip.dataset.icon || "🏆";
  });
});

// Edit Tournament Close
const editTourneyCloseBtn = document.getElementById("editTourneyCloseBtn");
if (editTourneyCloseBtn) {
  editTourneyCloseBtn.addEventListener("click", () => {
    const modal = document.getElementById("editTournamentModal");
    if (modal) modal.style.display = "none";
  });
}

// Edit Tournament Form Submit
const editTournamentForm = document.getElementById("editTournamentForm");
if (editTournamentForm) {
  editTournamentForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const tId = document.getElementById("editTourneyId")?.value;
    if (!tId) return;

    const tourney = getTournamentById(tId);
    if (!tourney) return;

    const name = document.getElementById("editTourneyName")?.value?.trim() || tourney.name;
    const type = document.getElementById("editTourneyType")?.value || "REGULAR";
    const logo = document.getElementById("editTourneyLogo")?.value || "🏆";
    const format = document.getElementById("editTourneyFormat")?.value || tourney.format;
    const startDate = document.getElementById("editTourneyStartDate")?.value || tourney.startDate;
    const endDate = document.getElementById("editTourneyEndDate")?.value || tourney.endDate;
    const overs = parseInt(document.getElementById("editTourneyOvers")?.value) || tourney.overs || 20;
    const status = document.getElementById("editTourneyStatus")?.value || tourney.status || "ONGOING";
    const groundsStr = document.getElementById("editTourneyGrounds")?.value || "";
    const grounds = groundsStr.split(",").map(g => g.trim()).filter(Boolean);

    tourney.name = name;
    tourney.type = type;
    tourney.logo = logo;
    tourney.format = format;
    tourney.startDate = startDate;
    tourney.endDate = endDate;
    tourney.overs = overs;
    tourney.status = status;
    if (grounds.length > 0) tourney.grounds = grounds;

    saveActiveTournament(tourney);

    const modal = document.getElementById("editTournamentModal");
    if (modal) modal.style.display = "none";

    renderTournamentsList();
    openTournamentDetails(tourney.id);
    showToast(`Updated "${name}" successfully!`);
  });
}

// Hook Edit Tournament button in Tournament Details Header
const btnTourneyEdit = document.getElementById("btnTourneyEdit");
if (btnTourneyEdit) {
  btnTourneyEdit.addEventListener("click", () => {
    if (activeTournamentId) {
      openEditTournamentModal(activeTournamentId);
    }
  });
}

// 7. CREATE TOURNAMENT WIZARD CONTROLLER
  function openCreateTournamentWizard() {
    wizardSelectedTeams = [];
    const modal = document.getElementById("createTournamentModal");
    if (!modal) return;

    // Reset fields
    const nameInput = document.getElementById("inputTourneyName");
    const startDateInput = document.getElementById("inputTourneyStartDate");
    const endDateInput = document.getElementById("inputTourneyEndDate");
    const hiddenOvers = document.getElementById("inputTourneyOvers");
    const customOversContainer = document.getElementById("tCustomOversContainer");
    const customOversInput = document.getElementById("inputTourneyCustomOvers");

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const nextMonth = new Date(Date.now() + 86400000 * 30);
    const yyyy2 = nextMonth.getFullYear();
    const mm2 = String(nextMonth.getMonth() + 1).padStart(2, "0");
    const dd2 = String(nextMonth.getDate()).padStart(2, "0");

    if (nameInput) nameInput.value = "";
    if (startDateInput) startDateInput.value = `${yyyy}-${mm}-${dd}`;
    if (endDateInput) endDateInput.value = `${yyyy2}-${mm2}-${dd2}`;
    if (hiddenOvers) hiddenOvers.value = "20";
    if (customOversInput) customOversInput.value = "";
    if (customOversContainer) customOversContainer.style.display = "none";

    document.querySelectorAll(".t-overs-chip").forEach(c => {
      c.classList.toggle("active", c.dataset.overs === "20");
    });

    setWizardStepPane(1);
    modal.style.display = "flex";
  }

  function setWizardStepPane(stepNum) {
    [1, 2, 3].forEach(s => {
      const tab = document.getElementById(`wStepTab${s}`);
      const pane = document.getElementById(`wStepPane${s}`);
      if (tab) tab.classList.toggle("active", s === stepNum);
      if (pane) pane.style.display = s === stepNum ? "flex" : "none";
    });

    if (stepNum === 2) {
      renderWizardTeamsSelection();
    }
  }

  let wizardTeamSearchQuery = "";

  function renderWizardTeamsSelection(filterQuery) {
    if (typeof filterQuery === "string") {
      wizardTeamSearchQuery = filterQuery.toLowerCase().trim();
    }
    const allClubs = getAvailableClubsList();
    const clubs = wizardTeamSearchQuery ? allClubs.filter(c => 
      c.name.toLowerCase().includes(wizardTeamSearchQuery) || 
      (c.city && c.city.toLowerCase().includes(wizardTeamSearchQuery)) ||
      (c.captain && c.captain.toLowerCase().includes(wizardTeamSearchQuery))
    ) : allClubs;

    const container = document.getElementById("wizardTeamsListContainer");
    const countBadge = document.getElementById("wizardSelectedTeamsCount");
    const validationHint = document.getElementById("wizardTeamsValidationHint");

    // User selects participating teams explicitly (no forced auto-selection)
    if (!Array.isArray(wizardSelectedTeams)) {
      wizardSelectedTeams = [];
    }

    if (countBadge) countBadge.textContent = wizardSelectedTeams.length;
    if (validationHint) {
      validationHint.style.display = wizardSelectedTeams.length < 2 ? "block" : "none";
    }

    if (!container) return;

    if (clubs.length === 0) {
      container.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:24px; color:#888;">
          <p style="margin:0 0 10px 0; font-size:13px;">No clubs found matching "${wizardTeamSearchQuery}"</p>
          <button type="button" id="btnSearchAddNewTeam" style="background:#ff5a00; color:#fff; border:none; padding:8px 14px; border-radius:8px; font-weight:800; font-size:11px; cursor:pointer;">
            <i class="fa-solid fa-plus"></i> Create New Team "${wizardTeamSearchQuery}"
          </button>
        </div>
      `;
      const btnAddFromSearch = document.getElementById("btnSearchAddNewTeam");
      if (btnAddFromSearch) {
        btnAddFromSearch.addEventListener("click", () => openCreateCustomClubModal(wizardTeamSearchQuery));
      }
      return;
    }

    container.innerHTML = clubs.map(c => {
      const isSel = wizardSelectedTeams.includes(c.name);
      const squad = c.players || generateDefaultSquadForClub(c.name, c.captain, c.viceCaptain);
      const xiCount = squad.filter(p => p.isPlayingXi).length || Math.min(11, squad.length);
      const cap = c.captain || (squad.find(p => p.isCaptain)?.name) || "Cap: Set";
      const vc = c.viceCaptain || (squad.find(p => p.isVC)?.name) || "";

      return `
        <div class="w-team-select-card ${isSel ? 'selected' : ''}" data-team-name="${c.name}">
          <div class="w-team-info-left">
            <div class="w-team-avatar">${c.logo || '🏏'}</div>
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <h4 style="font-size:14px; font-weight:800; color:#ffffff; margin:0;">${c.name}</h4>
                <span style="font-size:10px; color:#aaa; background:#242424; padding:2px 7px; border-radius:4px; border:1px solid #333;">${c.city || 'Club'}</span>
              </div>
              <div style="font-size:11px; color:#888; margin-top:3px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span style="color:#facc15;"><i class="fa-solid fa-crown text-gold" style="font-size:10px;"></i> ${cap}</span>
                ${vc ? `<span style="color:#60a5fa;"><i class="fa-solid fa-star text-orange" style="font-size:10px;"></i> ${vc}</span>` : ''}
                <span style="color:#bbb;">• ${squad.length} Players</span>
              </div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
            <button type="button" class="btn-manage-squad-w" data-team-name="${c.name}" title="Manage Squad, Captain, VC & Playing XI">
              <i class="fa-solid fa-users-gear"></i> Squad (${xiCount}/11)
            </button>
            <button type="button" class="btn-toggle-team-select ${isSel ? 'selected' : 'unselected'}" data-team-name="${c.name}" title="${isSel ? 'Remove from tournament' : 'Add to tournament'}">
              <i class="fa-solid ${isSel ? 'fa-circle-check' : 'fa-plus'}"></i>
              <span>${isSel ? '✓ SELECTED' : '+ ADD TEAM'}</span>
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  // 8. EVENT LISTENERS FOR TOURNAMENT SYSTEM
  const btnTopCreateTourney = document.getElementById("btnTopCreateTourney");
  if (btnTopCreateTourney) {
    btnTopCreateTourney.addEventListener("click", openCreateTournamentWizard);
  }

  const btnEmptyCreateTourney = document.getElementById("btnEmptyCreateTourney");
  if (btnEmptyCreateTourney) {
    btnEmptyCreateTourney.addEventListener("click", openCreateTournamentWizard);
  }

  const createTourneyCloseBtn = document.getElementById("createTourneyCloseBtn");
  if (createTourneyCloseBtn) {
    createTourneyCloseBtn.addEventListener("click", () => {
      const modal = document.getElementById("createTournamentModal");
      if (modal) modal.style.display = "none";
    });
  }

  // Wizard Step Navigation
  const btnWizardNextTo2 = document.getElementById("btnWizardNextTo2");
  if (btnWizardNextTo2) {
    btnWizardNextTo2.addEventListener("click", () => {
      const nameInput = document.getElementById("inputTourneyName");
      if (nameInput && !nameInput.value.trim()) {
        alert("Please enter a Tournament Name.");
        nameInput.focus();
        return;
      }

      const activeOversChip = document.querySelector(".t-overs-chip.active");
      const hiddenOvers = document.getElementById("inputTourneyOvers");
      const customOversInput = document.getElementById("inputTourneyCustomOvers");

      if (activeOversChip && activeOversChip.dataset.overs === "custom") {
        const val = parseInt(customOversInput?.value, 10);
        if (!val || isNaN(val) || val < 1 || val > 100) {
          alert("Please enter a valid number of overs (1 to 100).");
          if (customOversInput) customOversInput.focus();
          return;
        }
        if (hiddenOvers) hiddenOvers.value = String(val);
      } else if (!hiddenOvers?.value || parseInt(hiddenOvers.value, 10) < 1) {
        if (hiddenOvers) hiddenOvers.value = "20";
      }

      setWizardStepPane(2);
    });
  }

  const btnWizardBackTo1 = document.getElementById("btnWizardBackTo1");
  if (btnWizardBackTo1) {
    btnWizardBackTo1.addEventListener("click", () => setWizardStepPane(1));
  }

  const btnWizardNextTo3 = document.getElementById("btnWizardNextTo3");
  if (btnWizardNextTo3) {
    btnWizardNextTo3.addEventListener("click", () => {
      if (wizardSelectedTeams.length < 2) {
        const validationHint = document.getElementById("wizardTeamsValidationHint");
        if (validationHint) validationHint.style.display = "block";
        alert("Please select at least 2 participating teams for the tournament.");
        return;
      }
      setWizardStepPane(3);
    });
  }

  const btnWizardBackTo2 = document.getElementById("btnWizardBackTo2");
  if (btnWizardBackTo2) {
    btnWizardBackTo2.addEventListener("click", () => setWizardStepPane(2));
  }

  // Wizard Team Search & Selection Controls
  const wizardTeamsSearchInput = document.getElementById("wizardTeamsSearchInput");
  if (wizardTeamsSearchInput) {
    wizardTeamsSearchInput.addEventListener("input", (e) => {
      renderWizardTeamsSelection(e.target.value);
    });
  }

  const btnWizardSelectAllTeams = document.getElementById("btnWizardSelectAllTeams");
  if (btnWizardSelectAllTeams) {
    btnWizardSelectAllTeams.addEventListener("click", () => {
      const allClubs = getAvailableClubsList();
      wizardSelectedTeams = allClubs.map(c => c.name);
      const countBadge = document.getElementById("wizardSelectedTeamsCount");
      if (countBadge) countBadge.textContent = wizardSelectedTeams.length;
      renderWizardTeamsSelection(wizardTeamSearchQuery);
    });
  }

  const btnWizardClearTeams = document.getElementById("btnWizardClearTeams");
  if (btnWizardClearTeams) {
    btnWizardClearTeams.addEventListener("click", () => {
      wizardSelectedTeams = [];
      const countBadge = document.getElementById("wizardSelectedTeamsCount");
      if (countBadge) countBadge.textContent = 0;
      renderWizardTeamsSelection(wizardTeamSearchQuery);
    });
  }

  const btnWizardCreateNewTeam = document.getElementById("btnWizardCreateNewTeam");
  if (btnWizardCreateNewTeam) {
    btnWizardCreateNewTeam.addEventListener("click", () => {
      openCreateCustomClubModal();
    });
  }

  // Wizard Team Selection Card & Button Click Handler
  const wizardTeamsContainer = document.getElementById("wizardTeamsListContainer");
  if (wizardTeamsContainer) {
    wizardTeamsContainer.addEventListener("click", (e) => {
      // 1. Manage Squad button
      const squadBtn = e.target.closest(".btn-manage-squad-w");
      if (squadBtn) {
        e.stopPropagation();
        const teamName = squadBtn.dataset.teamName;
        openTeamSquadModal(teamName, null);
        return;
      }

      // 2. Toggle button or Card click
      const toggleBtn = e.target.closest(".btn-toggle-team-select");
      const card = e.target.closest(".w-team-select-card");
      if (!card && !toggleBtn) return;

      const teamName = (toggleBtn || card).dataset.teamName;
      if (!teamName) return;

      if (wizardSelectedTeams.includes(teamName)) {
        wizardSelectedTeams = wizardSelectedTeams.filter(t => t !== teamName);
      } else {
        wizardSelectedTeams.push(teamName);
      }

      const countBadge = document.getElementById("wizardSelectedTeamsCount");
      if (countBadge) countBadge.textContent = wizardSelectedTeams.length;
      renderWizardTeamsSelection(wizardTeamSearchQuery);
    });
  }

  // Wizard Tournament Type Toggle (Regular vs Auction)
  const optTypeRegular = document.getElementById("optTypeRegular");
  const optTypeAuction = document.getElementById("optTypeAuction");
  if (optTypeRegular && optTypeAuction) {
    optTypeRegular.addEventListener("click", () => {
      const hiddenType = document.getElementById("inputTourneyType");
      if (hiddenType) hiddenType.value = "REGULAR";
      optTypeRegular.style.borderColor = "#ff7a29";
      optTypeRegular.style.background = "#1e140d";
      optTypeAuction.style.borderColor = "#333";
      optTypeAuction.style.background = "#141414";
    });

    optTypeAuction.addEventListener("click", () => {
      const hiddenType = document.getElementById("inputTourneyType");
      if (hiddenType) hiddenType.value = "AUCTION";
      optTypeAuction.style.borderColor = "#ff7a29";
      optTypeAuction.style.background = "#1e140d";
      optTypeRegular.style.borderColor = "#333";
      optTypeRegular.style.background = "#141414";
    });
  }

  // Wizard Logo Picker
  document.querySelectorAll(".tourney-logo-selection-row .icon-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".tourney-logo-selection-row .icon-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      const hiddenLogo = document.getElementById("inputTourneySelectedLogo");
      if (hiddenLogo) hiddenLogo.value = chip.dataset.icon || "🏆";
    });
  });

  // Wizard Overs Pills & Custom Overs
  document.querySelectorAll(".t-overs-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".t-overs-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      const hiddenOvers = document.getElementById("inputTourneyOvers");
      const customContainer = document.getElementById("tCustomOversContainer");
      const customInput = document.getElementById("inputTourneyCustomOvers");

      if (chip.dataset.overs === "custom") {
        if (customContainer) customContainer.style.display = "block";
        if (customInput) {
          customInput.focus();
          if (customInput.value && hiddenOvers) {
            hiddenOvers.value = customInput.value;
          }
        }
      } else {
        if (customContainer) customContainer.style.display = "none";
        if (hiddenOvers) hiddenOvers.value = chip.dataset.overs || "20";
      }
    });
  });

  const inputTourneyCustomOvers = document.getElementById("inputTourneyCustomOvers");
  if (inputTourneyCustomOvers) {
    inputTourneyCustomOvers.addEventListener("input", (e) => {
      const hiddenOvers = document.getElementById("inputTourneyOvers");
      if (hiddenOvers) hiddenOvers.value = e.target.value;
    });
  }

  // Wizard Venues: Add Ground
  const btnAddGroundRow = document.getElementById("btnAddGroundRow");
  if (btnAddGroundRow) {
    btnAddGroundRow.addEventListener("click", () => {
      const gList = document.getElementById("tourneyGroundsList");
      if (!gList) return;
      const row = document.createElement("div");
      row.className = "venue-input-row";
      row.innerHTML = `
        <input type="text" class="tourney-ground-field" placeholder="Ground Name & City" required>
        <button type="button" class="btn-remove-venue"><i class="fa-solid fa-trash-can"></i></button>
      `;
      gList.appendChild(row);
    });
  }

  // Wizard Venues: Remove Ground
  const tourneyGroundsList = document.getElementById("tourneyGroundsList");
  if (tourneyGroundsList) {
    tourneyGroundsList.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-remove-venue");
      if (btn) {
        const row = btn.closest(".venue-input-row");
        if (row) row.remove();
      }
    });
  }

  // Tournament Format: Show/Hide Group Count
  const selectTourneyFormat = document.getElementById("selectTourneyFormat");
  const tournamentGroupCountWrap = document.getElementById("tournamentGroupCountWrap");

  if (selectTourneyFormat && tournamentGroupCountWrap) {
    const syncGroupCountVisibility = () => {
      tournamentGroupCountWrap.style.display =
        selectTourneyFormat.value === "Group Stage" ? "" : "none";
    };

    selectTourneyFormat.addEventListener("change", syncGroupCountVisibility);
    syncGroupCountVisibility();
  }

  // Submit Create Tournament Form
  const createTournamentForm = document.getElementById("createTournamentForm");
  if (createTournamentForm) {
    createTournamentForm.addEventListener("submit", (e) => {
      e.preventDefault();

      const name = document.getElementById("inputTourneyName")?.value?.trim() || "Yuva Championship";
      const tourneyType = document.getElementById("inputTourneyType")?.value || "REGULAR";
      const logo = document.getElementById("inputTourneySelectedLogo")?.value || "🏆";
      const format = document.getElementById("selectTourneyFormat")?.value || "League + Playoffs";
      const startDate = document.getElementById("inputTourneyStartDate")?.value || "2026-04-01";
      const endDate = document.getElementById("inputTourneyEndDate")?.value || "2026-05-01";
      const overs = parseInt(document.getElementById("inputTourneyOvers")?.value) || 20;
      const groupCount = format === "Group Stage"
        ? Math.max(2, parseInt(document.getElementById("selectTourneyGroupCount")?.value) || 2)
        : 0;

      // Extract grounds
      const groundInputs = document.querySelectorAll(".tourney-ground-field");
      const grounds = [];
      groundInputs.forEach(inp => {
        if (inp.value && inp.value.trim()) grounds.push(inp.value.trim());
      });
      if (grounds.length === 0) grounds.push("Wankhede Stadium, Mumbai");

      const ptsWin = parseInt(document.getElementById("inputRulePtsWin")?.value) || 2;
      const ptsTie = parseInt(document.getElementById("inputRulePtsTie")?.value) || 1;
      const maxOversBowler = parseInt(document.getElementById("inputRuleMaxOversBowler")?.value) || 4;
      const superOver = document.getElementById("checkSuperOverRule")?.checked !== false;

      // Map selected team names to full club objects
      if (!wizardSelectedTeams || wizardSelectedTeams.length < 2) {
        showToast("Please select at least 2 participating teams for the tournament.");
        if (typeof goToWizardStep === "function") goToWizardStep(2);
        return;
      }

      const allClubs = getAvailableClubsList();
      const participatingTeams = wizardSelectedTeams.map(name => {
        const found = allClubs.find(c => c.name === name);
        return found || { id: `team_${Math.random()}`, name: name, logo: "🏏", playerCount: 11, city: "City" };
      });

      // Build configured groups for Group Stage
      const tournamentGroups = format === "Group Stage"
        ? Array.from({ length: groupCount }, (_, i) => ({
            id: String.fromCharCode(65 + i),
            name: `Group ${String.fromCharCode(65 + i)}`,
            teams: []
          }))
        : [];

      if (format === "Group Stage") {
        participatingTeams.forEach((team, index) => {
          tournamentGroups[index % groupCount].teams.push(team);
        });
      }

      // Auto-generate fixtures
      const fixtures = generateTournamentFixtures(
      format,
      participatingTeams,
      grounds,
      overs,
      startDate,
      tournamentGroups
    );

      // Create tournament object
      const newTourney = {
        id: `tourney_${Date.now()}`,
        name: name,
        type: tourneyType,
        logo: logo,
        format: format,
        status: "UPCOMING",
        startDate: startDate,
        endDate: endDate,
        overs: overs,
        grounds: grounds,
        rules: {
          ptsWin: ptsWin,
          ptsTie: ptsTie,
          maxOversBowler: maxOversBowler,
          superOver: superOver,
          thirdPrize: !!document.getElementById("inputTourneyThirdPrize")?.checked
        },
        teams: participatingTeams,
        groups: tournamentGroups,
        fixtures: fixtures,
        stats: {
          totalRuns: 0,
          totalWickets: 0,
          totalSixes: 0,
          totalFours: 0,
          topBatsmen: [],
          topBowlers: []
        },
        winner: null
      };

      // Initialize auction state if tournament type is AUCTION
      if (newTourney.type === "AUCTION" || newTourney.format === "Auction" || newTourney.format === "Auction League") {
        initTournamentAuction(newTourney);
      }

      saveTournament(newTourney);

      // Close wizard modal
      const modal = document.getElementById("createTournamentModal");
      if (modal) modal.style.display = "none";

      // Render & Open Tournament Details
      renderTournamentsList();
      activeTournamentId = newTourney.id;
      openTournamentDetails(newTourney.id);
      if (newTourney.type === "AUCTION" || newTourney.format === "Auction" || newTourney.format === "Auction League") {
        if (typeof switchTournamentTab === "function") switchTournamentTab("tAuction");
      }
      showToast(`Tournament "${newTourney.name}" created successfully!`);
    });
  }

  // Tournament Card Click (Open Details)
  const tournamentsListContainer = document.getElementById("tournamentsListContainer");
  if (tournamentsListContainer) {
    tournamentsListContainer.addEventListener("click", (e) => {
      const card = e.target.closest(".tournament-card");
      if (card) {
        const id = card.dataset.tourneyId;
        if (id) openTournamentDetails(id);
      }
    });
  }

  // Tournament Hub Top Bar Back Button (Back to Screen 5 - Home)
  const tourneyBackButton = document.getElementById("tourneyBackButton");
  if (tourneyBackButton) {
    tourneyBackButton.addEventListener("click", () => {
      showScreen("screen5");
    });
  }

  // Tournament Details Back Button (Back to List or Home depending on entry source)
  const tourneyDetailBackBtn = document.getElementById("tourneyDetailBackBtn");
  if (tourneyDetailBackBtn) {
    tourneyDetailBackBtn.addEventListener("click", () => {
      if (window.tourneyNavSource === "home") {
        showScreen("screen5");
      } else {
        openTournamentScreen();
      }
    });
  }

  // Delete Tournament Button
  const btnTourneyDelete = document.getElementById("btnTourneyDelete");
  if (btnTourneyDelete) {
    btnTourneyDelete.addEventListener("click", () => {
      if (!activeTournamentId) return;
      const tourney = getTournamentById(activeTournamentId);
      if (!tourney) return;
      let shouldDelete = true;
      try {
        shouldDelete = window.confirm(`Are you sure you want to delete "${tourney.name}"? This action will permanently remove this tournament and all its fixtures.`);
      } catch (e) {
        shouldDelete = true;
      }
      if (shouldDelete) {
        const list = getTournamentsList().filter(t => t.id !== activeTournamentId);
        saveTournamentsList(list);

        // Also clean up any active match state tied to this tournament
        try {
          const am = typeof getActiveMatch === "function" ? getActiveMatch() : null;
          if (am && (am.tourneyId === activeTournamentId || am.tournamentId === activeTournamentId)) {
            if (typeof clearActiveMatchState === "function") clearActiveMatchState();
          }
        } catch (e) {}

        activeTournamentId = null;
        showToast(`"${tourney.name}" has been deleted.`);
        openTournamentScreen();
      }
    });
  }

  // Share Tournament Button
  const btnTourneyShare = document.getElementById("btnTourneyShare");
  if (btnTourneyShare) {
    btnTourneyShare.addEventListener("click", () => {
      const tourney = getTournamentById(activeTournamentId);
      if (!tourney) return;
      openShareQr("Join Tournament: " + tourney.name, buildShareUrl("joinTournament", tourney.id));
    });
  }

  // Tab Switchers in Tournament Details
  document.querySelectorAll(".t-nav-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const tabKey = tab.dataset.ttab || tab.dataset.tab;
      if (tabKey) switchTournamentTab(tabKey);
    });
  });

  // Overview quick link to points table
  const btnViewFullPointsTable = document.getElementById("btnViewFullPointsTable") || document.getElementById("btnOverviewViewFullTable");
  if (btnViewFullPointsTable) {
    btnViewFullPointsTable.addEventListener("click", () => switchTournamentTab("points"));
  }
  const btnOverviewViewFullTable = document.getElementById("btnOverviewViewFullTable");
  if (btnOverviewViewFullTable && btnOverviewViewFullTable !== btnViewFullPointsTable) {
    btnOverviewViewFullTable.addEventListener("click", () => switchTournamentTab("points"));
  }

  // Overview quick link to fixtures
  const btnViewAllFixtures = document.getElementById("btnViewAllFixtures") || document.getElementById("btnOverviewViewAllFixtures");
  if (btnViewAllFixtures) {
    btnViewAllFixtures.addEventListener("click", () => switchTournamentTab("fixtures"));
  }
  const btnOverviewViewAllFixtures = document.getElementById("btnOverviewViewAllFixtures");
  if (btnOverviewViewAllFixtures && btnOverviewViewAllFixtures !== btnViewAllFixtures) {
    btnOverviewViewAllFixtures.addEventListener("click", () => switchTournamentTab("fixtures"));
  }

  // Search Tournaments in List
  const tourneySearchInput = document.getElementById("tourneySearchInput");
  if (tourneySearchInput) {
    tourneySearchInput.addEventListener("input", (e) => {
      activeTourneySearchQuery = e.target.value;
      renderTournamentsList();
    });
  }

  // Filter Tournaments by Status
  document.querySelectorAll(".tourney-filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".tourney-filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeTourneyFilterStatus = chip.dataset.status || "all";
      renderTournamentsList();
    });
  });

  // Filter Tournaments by Format
  const tourneyFormatFilter = document.getElementById("tourneyFormatFilter") || document.getElementById("tourneyFormatFilterSelect");
  if (tourneyFormatFilter) {
    tourneyFormatFilter.addEventListener("change", (e) => {
      activeTourneyFilterFormat = e.target.value;
      renderTournamentsList();
    });
  }

  // Fixtures Filter Chips
  document.querySelectorAll(".fixtures-filter-bar .tourney-filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".fixtures-filter-bar .tourney-filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeTourneyFixtureFilter = chip.dataset.fixtureStatus || "all";
      const tourney = getTournamentById(activeTournamentId);
      if (tourney) renderFixturesTab(tourney);
    });
  });

  // Group Tabs in Points Table
  const pointsGroupTabs = document.getElementById("tPointsGroupTabsRow") || document.getElementById("tPointsGroupTabs");
  if (pointsGroupTabs) {
    pointsGroupTabs.addEventListener("click", (e) => {
      const tab = e.target.closest(".p-group-tab");
      if (!tab) return;
      activeTourneyGroupTab = tab.dataset.ptgroup || tab.dataset.group || "all";
      const tourney = getTournamentById(activeTournamentId);
      if (tourney) renderPointsTableTab(tourney);
    });
  }

  // Stats Category Selector
  document.querySelectorAll(".ts-cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".ts-cat-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeTourneyStatsCategory = btn.dataset.tscat || "batting";
      const tourney = getTournamentById(activeTournamentId);
      if (tourney) renderStatsTab(tourney);
    });
  });

  // Fixture Action: Start Match
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-start-match, .btn-start-spotlight-match");
    if (!btn) return;
    const fId = btn.dataset.fixtureId;
    const list = getTournamentsList();
    const tourney = getTournamentById(activeTournamentId) || list.find(t => (t.fixtures || []).some(f => f.id === fId));
    if (!tourney) return;
    activeTournamentId = tourney.id;

    const fixture = (tourney.fixtures || []).find(f => f.id === fId);
    if (!fixture) return;

    if (fixture.status === "COMPLETED") {
      showToast("This match is already completed. Check scorecard in Match History.");
      return;
    }

    const isUnqualified = (name) => {
      if (!name) return true;
      const lower = name.toLowerCase();
      return lower.includes("tbd") || lower.includes("winner ") || lower.includes("loser ") || lower.includes("rank ") || lower.includes("group a #") || lower.includes("group b #");
    };

    if (isUnqualified(fixture.teamA) || isUnqualified(fixture.teamB)) {
      showToast("Teams for this fixture have not qualified yet. Complete the preceding stage matches first.");
      return;
    }

    // Open Start Match Setup with Pre-filled Tournament Details!
    openStartMatchSetup({
      teamA: fixture.teamA,
      teamB: fixture.teamB,
      tournament: tourney.name,
      overs: tourney.overs || 20,
      ground: fixture.ground,
      fixtureId: fixture.id,
      tourneyId: tourney.id,
      date: fixture.date,
      time: fixture.time
    });
  });

  // Fixture Action: View Scorecard
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-view-scorecard");
    if (!btn) return;
    const fId = btn.dataset.fixtureId;
    if (fId) {
      const history = getMatchHistoryList();
      const match = history.find(m => m.fixtureId === fId || m.matchId === fId || (m.id && m.id === fId));
      if (match) {
        openHistoryMatchDetailsModal(match);
        return;
      }
    }
    renderMatchHistoryScreen();
    showScreen("screen9");
  });

  // ==========================================
  // SCHEDULE NEW FIXTURE MODAL HANDLERS
  // ==========================================
  const btnOpenCreateFixtureModal = document.getElementById("btnOpenCreateFixtureModal");
  if (btnOpenCreateFixtureModal) {
    btnOpenCreateFixtureModal.addEventListener("click", () => {
      const tourney = getTournamentById(activeTournamentId);
      if (!tourney) return;

      const teams = tourney.teams || [];
      if (teams.length < 2) {
        showToast("Add at least 2 teams to the tournament before scheduling matches");
        return;
      }

      // Populate Group Select
      const groupSelect = document.getElementById("createFixtureGroupSelect");
      if (groupSelect) {
        if (tourney.groups && tourney.groups.length > 0) {
          groupSelect.innerHTML = `<option value="">All Teams / No Group</option>` +
            tourney.groups.map(g => `<option value="${g.name}">Group ${g.name}</option>`).join("");
        } else {
          groupSelect.innerHTML = `<option value="">No Groups Defined</option>`;
        }
      }

      // Function to populate Team A and Team B dropdowns
      const populateTeamSelects = (filteredTeams) => {
        const teamASelect = document.getElementById("createFixtureTeamA");
        const teamBSelect = document.getElementById("createFixtureTeamB");
        if (!teamASelect || !teamBSelect) return;

        const optionsHtml = `<option value="">Select Team</option>` +
          filteredTeams.map(t => `<option value="${t.name}">${t.logo || '🏏'} ${t.name}</option>`).join("");

        teamASelect.innerHTML = optionsHtml;
        teamBSelect.innerHTML = optionsHtml;

        if (filteredTeams.length >= 2) {
          teamASelect.value = filteredTeams[0].name;
          teamBSelect.value = filteredTeams[1].name;
        }
      };

      populateTeamSelects(teams);

      // Listen to group filter change
      if (groupSelect) {
        groupSelect.onchange = () => {
          const grpName = groupSelect.value;
          if (grpName && tourney.groups) {
            const grp = tourney.groups.find(g => g.name === grpName || g.id === grpName);
            if (grp && grp.teams && grp.teams.length >= 2) {
              populateTeamSelects(grp.teams);
              return;
            }
          }
          populateTeamSelects(teams);
        };
      }

      // Pre-fill Defaults
      const dateField = document.getElementById("createFixtureDate");
      const timeField = document.getElementById("createFixtureTime");
      const groundField = document.getElementById("createFixtureGround");
      const stageField = document.getElementById("createFixtureStage");

      if (dateField) dateField.value = new Date().toISOString().split("T")[0];
      if (timeField) timeField.value = "19:30";
      if (groundField) groundField.value = (tourney.grounds && tourney.grounds[0]) || "Yuva Stadium, Mumbai";
      if (stageField) stageField.value = "League Match";

      const modal = document.getElementById("createFixtureModal");
      if (modal) modal.style.display = "flex";
    });
  }

  const createFixtureCloseBtn = document.getElementById("createFixtureCloseBtn");
  if (createFixtureCloseBtn) {
    createFixtureCloseBtn.addEventListener("click", () => {
      const modal = document.getElementById("createFixtureModal");
      if (modal) modal.style.display = "none";
    });
  }

  const createFixtureForm = document.getElementById("createFixtureForm");
  if (createFixtureForm) {
    createFixtureForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const tourney = getTournamentById(activeTournamentId);
      if (!tourney) return;

      const teamA = document.getElementById("createFixtureTeamA")?.value;
      const teamB = document.getElementById("createFixtureTeamB")?.value;
      const groupVal = document.getElementById("createFixtureGroupSelect")?.value || null;
      const stageVal = document.getElementById("createFixtureStage")?.value || "League Match";
      const dateVal = document.getElementById("createFixtureDate")?.value || new Date().toISOString().split("T")[0];
      const timeVal = document.getElementById("createFixtureTime")?.value || "19:30";
      const groundVal = document.getElementById("createFixtureGround")?.value || "Yuva Stadium";

      if (!teamA || !teamB) {
        showToast("Please select both participating teams");
        return;
      }
      if (teamA === teamB) {
        showToast("Both teams cannot be identical");
        return;
      }

      const newFixture = {
        id: `fix_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        stage: stageVal,
        group: groupVal || null,
        teamA: teamA,
        teamB: teamB,
        date: dateVal,
        time: timeVal,
        ground: groundVal,
        status: "UPCOMING",
        scoreA: "-",
        scoreB: "-",
        winner: null,
        resultText: null,
        isPlayoff: stageVal.toLowerCase().includes("final") || stageVal.toLowerCase().includes("semi") || stageVal.toLowerCase().includes("qualifier") || stageVal.toLowerCase().includes("eliminator")
      };

      if (!tourney.fixtures) tourney.fixtures = [];
      tourney.fixtures.push(newFixture);

      saveTournament(tourney);
      showToast("Match scheduled successfully");
      renderFixturesTab(tourney);
      renderOverviewTab(tourney);

      const modal = document.getElementById("createFixtureModal");
      if (modal) modal.style.display = "none";
    });
  }

  // Regenerate Fixtures Schedule
  const btnRegenerateSchedule = document.getElementById("btnRegenerateSchedule");
  if (btnRegenerateSchedule) {
    btnRegenerateSchedule.addEventListener("click", () => {
      const tourney = getTournamentById(activeTournamentId);
      if (!tourney) return;

      if (!tourney.teams || tourney.teams.length < 2) {
        showToast("Add at least 2 teams before generating fixtures");
        return;
      }

      if (confirm(`Regenerate fixture schedule for ${tourney.name}? This will recreate the match schedule based on current tournament teams and format.`)) {
        tourney.fixtures = generateTournamentFixtures(
          tourney.format,
          tourney.teams,
          tourney.grounds || ["Yuva Stadium, Mumbai"],
          tourney.overs || 20,
          tourney.startDate || new Date().toISOString().split("T")[0],
          tourney.groups || []
        );

        saveTournament(tourney);
        showToast("Fixture schedule generated successfully");
        renderFixturesTab(tourney);
        renderOverviewTab(tourney);
        renderPointsTableTab(tourney);
      }
    });
  }

  // ==========================================
  // EDIT FIXTURE MODAL HANDLERS
  // ==========================================
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-edit-fixture");
    if (!btn) return;
    const fId = btn.dataset.fixtureId;
    const tourney = getTournamentById(activeTournamentId);
    if (!tourney) return;

    const fixture = (tourney.fixtures || []).find(f => f.id === fId);
    if (!fixture) return;

    const modal = document.getElementById("editFixtureModal");
    const idField = document.getElementById("editFixtureId");
    const tourneyIdField = document.getElementById("editFixtureTourneyId");
    const matchupText = document.getElementById("editFixtureMatchupText");
    const groupSelect = document.getElementById("editFixtureGroupSelect");
    const teamASelect = document.getElementById("editFixtureTeamA");
    const teamBSelect = document.getElementById("editFixtureTeamB");
    const stageField = document.getElementById("editFixtureStage");
    const dateField = document.getElementById("editFixtureDate");
    const timeField = document.getElementById("editFixtureTime");
    const groundField = document.getElementById("editFixtureGround");
    const statusSelect = document.getElementById("editFixtureStatus");

    if (idField) idField.value = fixture.id;
    if (tourneyIdField) tourneyIdField.value = tourney.id;
    if (matchupText) matchupText.textContent = `${fixture.teamA} vs ${fixture.teamB}`;

    const teams = tourney.teams || [];
    const teamOptionsHtml = `<option value="">Select Team</option>` +
      teams.map(t => `<option value="${t.name}">${t.logo || '🏏'} ${t.name}</option>`).join("");

    if (teamASelect) {
      teamASelect.innerHTML = teamOptionsHtml;
      teamASelect.value = fixture.teamA;
    }
    if (teamBSelect) {
      teamBSelect.innerHTML = teamOptionsHtml;
      teamBSelect.value = fixture.teamB;
    }

    if (groupSelect) {
      if (tourney.groups && tourney.groups.length > 0) {
        groupSelect.innerHTML = `<option value="">None / All Groups</option>` +
          tourney.groups.map(g => `<option value="${g.name}">Group ${g.name}</option>`).join("");
        groupSelect.value = fixture.group || "";
      } else {
        groupSelect.innerHTML = `<option value="">No Groups</option>`;
      }
    }

    if (stageField) stageField.value = fixture.stage || "League Match";
    if (dateField) dateField.value = fixture.date || "";
    if (timeField) timeField.value = fixture.time || "19:30";
    if (groundField) groundField.value = fixture.ground || "";
    if (statusSelect) statusSelect.value = fixture.status || "UPCOMING";

    if (modal) modal.style.display = "flex";
  });

  // Edit Fixture Form Submit
  const editFixtureForm = document.getElementById("editFixtureForm");
  if (editFixtureForm) {
    editFixtureForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fId = document.getElementById("editFixtureId")?.value;
      const tId = document.getElementById("editFixtureTourneyId")?.value;
      const teamA = document.getElementById("editFixtureTeamA")?.value;
      const teamB = document.getElementById("editFixtureTeamB")?.value;
      const groupVal = document.getElementById("editFixtureGroupSelect")?.value || null;
      const stage = document.getElementById("editFixtureStage")?.value;
      const date = document.getElementById("editFixtureDate")?.value;
      const time = document.getElementById("editFixtureTime")?.value;
      const ground = document.getElementById("editFixtureGround")?.value;
      const status = document.getElementById("editFixtureStatus")?.value || "UPCOMING";

      if (teamA && teamB && teamA === teamB) {
        showToast("Both teams cannot be identical");
        return;
      }

      const tourney = getTournamentById(tId);
      if (tourney && tourney.fixtures) {
        const fixture = tourney.fixtures.find(f => f.id === fId);
        if (fixture) {
          if (teamA) fixture.teamA = teamA;
          if (teamB) fixture.teamB = teamB;
          fixture.group = groupVal || null;
          if (stage) fixture.stage = stage;
          fixture.date = date;
          fixture.time = time;
          fixture.ground = ground;
          fixture.status = status;
          if (stage) {
            fixture.isPlayoff = stage.toLowerCase().includes("final") || stage.toLowerCase().includes("semi") || stage.toLowerCase().includes("qualifier") || stage.toLowerCase().includes("eliminator");
          }

          saveTournament(tourney);
          showToast("Match details updated");
          renderFixturesTab(tourney);
          renderOverviewTab(tourney);
          renderPointsTableTab(tourney);
        }
      }

      const modal = document.getElementById("editFixtureModal");
      if (modal) modal.style.display = "none";
    });
  }

  const editFixtureCloseBtn = document.getElementById("editFixtureCloseBtn");
  if (editFixtureCloseBtn) {
    editFixtureCloseBtn.addEventListener("click", () => {
      const modal = document.getElementById("editFixtureModal");
      if (modal) modal.style.display = "none";
    });
  }

  // ==========================================
  // DELETE FIXTURE MODAL HANDLERS
  // ==========================================
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-delete-fixture");
    if (!btn) return;
    const fId = btn.dataset.fixtureId;
    const tourney = getTournamentById(activeTournamentId);
    if (!tourney) return;

    const fixture = (tourney.fixtures || []).find(f => f.id === fId);
    if (!fixture) return;

    const modal = document.getElementById("deleteFixtureConfirmModal");
    const targetInput = document.getElementById("inputDeleteTargetFixtureId");
    const titleEl = document.getElementById("deleteFixtureConfirmTitle");
    const msgEl = document.getElementById("deleteFixtureConfirmMessage");

    if (targetInput) targetInput.value = fixture.id;
    if (titleEl) titleEl.textContent = `Delete ${fixture.teamA} vs ${fixture.teamB}?`;
    if (msgEl) msgEl.textContent = `Are you sure you want to remove this ${fixture.stage} scheduled on ${fixture.date} from the tournament?`;

    if (modal) modal.style.display = "flex";
  });

  const deleteFixtureConfirmCloseBtn = document.getElementById("deleteFixtureConfirmCloseBtn");
  if (deleteFixtureConfirmCloseBtn) {
    deleteFixtureConfirmCloseBtn.addEventListener("click", () => {
      const modal = document.getElementById("deleteFixtureConfirmModal");
      if (modal) modal.style.display = "none";
    });
  }

  const btnCancelDeleteFixtureAction = document.getElementById("btnCancelDeleteFixtureAction");
  if (btnCancelDeleteFixtureAction) {
    btnCancelDeleteFixtureAction.addEventListener("click", () => {
      const modal = document.getElementById("deleteFixtureConfirmModal");
      if (modal) modal.style.display = "none";
    });
  }

  const btnConfirmDeleteFixtureAction = document.getElementById("btnConfirmDeleteFixtureAction");
  if (btnConfirmDeleteFixtureAction) {
    btnConfirmDeleteFixtureAction.addEventListener("click", () => {
      const fId = document.getElementById("inputDeleteTargetFixtureId")?.value;
      if (!fId) return;

      const tourney = getTournamentById(activeTournamentId);
      if (tourney && tourney.fixtures) {
        tourney.fixtures = tourney.fixtures.filter(f => f.id !== fId);
        saveTournament(tourney);
        showToast("Match removed from fixtures schedule");
        renderFixturesTab(tourney);
        renderOverviewTab(tourney);
      }

      const modal = document.getElementById("deleteFixtureConfirmModal");
      if (modal) modal.style.display = "none";
    });
  }

  // Add Team to Tournament Modal
  const btnAddTeamToTourney = document.getElementById("btnAddTeamToTourney") || document.getElementById("btnAddTeamToTourneyBtn");
  if (btnAddTeamToTourney) {
    btnAddTeamToTourney.addEventListener("click", () => {
      const tourney = getTournamentById(activeTournamentId);
      if (!tourney) return;

      const allClubs = getAvailableClubsList();
      const currentNames = (tourney.teams || []).map(t => t.name);
      const availableToAdd = allClubs.filter(c => !currentNames.includes(c.name));

      const selectEl = document.getElementById("selectAddTourneyTeam");
      if (selectEl) {
        if (availableToAdd.length === 0) {
          selectEl.innerHTML = `<option value="">All clubs already participating</option>`;
        } else {
          selectEl.innerHTML = availableToAdd.map(c => `<option value="${c.name}">${c.logo || '🏏'} ${c.name} (${c.city})</option>`).join("");
        }
      }

      const modal = document.getElementById("addTeamToTourneyModal");
      if (modal) modal.style.display = "flex";
    });
  }

  const addTeamToTourneyCloseBtn = document.getElementById("addTeamToTourneyCloseBtn");
  if (addTeamToTourneyCloseBtn) {
    addTeamToTourneyCloseBtn.addEventListener("click", () => {
      const modal = document.getElementById("addTeamToTourneyModal");
      if (modal) modal.style.display = "none";
    });
  }

  const addTeamToTourneyForm = document.getElementById("addTeamToTourneyForm");
  if (addTeamToTourneyForm) {
    addTeamToTourneyForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const selName = document.getElementById("selectAddTourneyTeam")?.value;
      if (!selName) return;

      const tourney = getTournamentById(activeTournamentId);
      if (!tourney) return;

      const allClubs = getAvailableClubsList();
      const clubObj = allClubs.find(c => c.name === selName) || { id: `tm_${Date.now()}`, name: selName, logo: "🏏", playerCount: 11 };

      if (!tourney.teams) tourney.teams = [];
      tourney.teams.push(clubObj);

      saveTournament(tourney);
      renderTeamsTab(tourney);
      renderPointsTableTab(tourney);
      showToast(`${clubObj.name} added to tournament`);

      const modal = document.getElementById("addTeamToTourneyModal");
      if (modal) modal.style.display = "none";
    });
  }

  // Remove Team from Tournament (when UPCOMING)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-remove-tourney-team");
    if (!btn) return;
    const teamName = btn.dataset.teamName;
    const tourney = getTournamentById(activeTournamentId);
    if (!tourney) return;

    if (confirm(`Remove "${teamName}" from ${tourney.name}?`)) {
      tourney.teams = (tourney.teams || []).filter(t => t.name !== teamName);
      // Also remove from any assigned group
      if (tourney.groups && Array.isArray(tourney.groups)) {
        tourney.groups.forEach(g => {
          if (g.teams) {
            g.teams = g.teams.filter(tm => (typeof tm === "string" ? tm : tm.name) !== teamName);
          }
        });
      }
      saveTournament(tourney);
      renderTeamsTab(tourney);
      renderPointsTableTab(tourney);
      showToast(`${teamName} removed from tournament`);
    }
  });

  // ==========================================
  // GROUP MANAGEMENT EVENT LISTENERS
  // ==========================================

  // 1. Create Group Button
  const btnCreateTourneyGroup = document.getElementById("btnCreateTourneyGroup");
  if (btnCreateTourneyGroup) {
    btnCreateTourneyGroup.addEventListener("click", () => {
      const tourney = getTournamentById(activeTournamentId);
      if (!tourney) return;

      const groups = tourney.groups || [];
      const editIdField = document.getElementById("inputEditGroupId");
      const nameField = document.getElementById("inputGroupNameField");
      const titleEl = document.getElementById("groupModalTitleText");

      if (editIdField) editIdField.value = "";
      
      // Auto-suggest next group name (e.g. Group A, Group B, Group C)
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      let suggested = "Group A";
      for (let i = 0; i < alphabet.length; i++) {
        const candidate = `Group ${alphabet[i]}`;
        if (!groups.some(g => g.name.toLowerCase() === candidate.toLowerCase())) {
          suggested = candidate;
          break;
        }
      }

      if (nameField) nameField.value = suggested;
      if (titleEl) titleEl.textContent = "Create Group";

      const modal = document.getElementById("groupManageModal");
      if (modal) modal.style.display = "flex";
      setTimeout(() => { if (nameField) nameField.focus(); }, 100);
    });
  }

  // 2. Edit Group Button (Delegated)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-edit-group");
    if (!btn) return;
    const gId = btn.dataset.groupId;
    const tourney = getTournamentById(activeTournamentId);
    if (!tourney || !tourney.groups) return;

    const group = tourney.groups.find(g => g.id === gId);
    if (!group) return;

    const editIdField = document.getElementById("inputEditGroupId");
    const nameField = document.getElementById("inputGroupNameField");
    const titleEl = document.getElementById("groupModalTitleText");

    if (editIdField) editIdField.value = group.id;
    if (nameField) nameField.value = group.name;
    if (titleEl) titleEl.textContent = `Edit ${group.name}`;

    const modal = document.getElementById("groupManageModal");
    if (modal) modal.style.display = "flex";
  });

  // 3. Save / Submit Group (Create or Edit)
  const groupManageForm = document.getElementById("groupManageForm");
  if (groupManageForm) {
    groupManageForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const tourney = getTournamentById(activeTournamentId);
      if (!tourney) return;

      const editId = document.getElementById("inputEditGroupId")?.value?.trim();
      const groupName = document.getElementById("inputGroupNameField")?.value?.trim();

      if (!groupName) {
        showToast("Please enter a group name");
        return;
      }

      if (!tourney.groups) tourney.groups = [];

      // Check for duplicate group names
      const isDuplicate = tourney.groups.some(g => g.name.toLowerCase() === groupName.toLowerCase() && g.id !== editId);
      if (isDuplicate) {
        showToast(`A group named "${groupName}" already exists!`);
        return;
      }

      if (editId) {
        // Edit existing group
        const grp = tourney.groups.find(g => g.id === editId);
        if (grp) {
          grp.name = groupName;
          showToast(`Group renamed to "${groupName}"`);
        }
      } else {
        // Create new group
        const newGroupObj = {
          id: `grp_${Date.now()}`,
          name: groupName,
          teams: []
        };
        tourney.groups.push(newGroupObj);
        showToast(`Group "${groupName}" created successfully`);
      }

      saveTournament(tourney);
      renderTeamsTab(tourney);
      renderPointsTableTab(tourney);

      const modal = document.getElementById("groupManageModal");
      if (modal) modal.style.display = "none";
    });
  }

  const groupManageModalCloseBtn = document.getElementById("groupManageModalCloseBtn");
  if (groupManageModalCloseBtn) {
    groupManageModalCloseBtn.addEventListener("click", () => {
      const modal = document.getElementById("groupManageModal");
      if (modal) modal.style.display = "none";
    });
  }

  // 4. Delete Group Flow
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-delete-group");
    if (!btn) return;
    const gId = btn.dataset.groupId;
    const tourney = getTournamentById(activeTournamentId);
    if (!tourney || !tourney.groups) return;

    const group = tourney.groups.find(g => g.id === gId);
    if (!group) return;

    const targetField = document.getElementById("inputDeleteTargetGroupId");
    const titleEl = document.getElementById("deleteGroupConfirmTitle");
    const msgEl = document.getElementById("deleteGroupConfirmMessage");

    if (targetField) targetField.value = group.id;
    if (titleEl) titleEl.textContent = `Delete ${group.name}?`;
    if (msgEl) msgEl.textContent = `Are you sure you want to delete ${group.name}? All ${(group.teams || []).length} assigned teams will be safely preserved in the tournament and unassigned from this group.`;

    const modal = document.getElementById("deleteGroupConfirmModal");
    if (modal) modal.style.display = "flex";
  });

  const btnConfirmDeleteGroupAction = document.getElementById("btnConfirmDeleteGroupAction");
  if (btnConfirmDeleteGroupAction) {
    btnConfirmDeleteGroupAction.addEventListener("click", () => {
      const gId = document.getElementById("inputDeleteTargetGroupId")?.value;
      const tourney = getTournamentById(activeTournamentId);
      if (!tourney || !tourney.groups) return;

      const group = tourney.groups.find(g => g.id === gId);
      const gName = group ? group.name : "Group";

      tourney.groups = tourney.groups.filter(g => g.id !== gId);

      if (activeTourneyGroupTab === gId) {
        activeTourneyGroupTab = "all";
      }

      saveTournament(tourney);
      renderTeamsTab(tourney);
      renderPointsTableTab(tourney);
      showToast(`${gName} deleted safely`);

      const modal = document.getElementById("deleteGroupConfirmModal");
      if (modal) modal.style.display = "none";
    });
  }

  const btnCancelDeleteGroupAction = document.getElementById("btnCancelDeleteGroupAction");
  if (btnCancelDeleteGroupAction) {
    btnCancelDeleteGroupAction.addEventListener("click", () => {
      const modal = document.getElementById("deleteGroupConfirmModal");
      if (modal) modal.style.display = "none";
    });
  }

  const deleteGroupConfirmCloseBtn = document.getElementById("deleteGroupConfirmCloseBtn");
  if (deleteGroupConfirmCloseBtn) {
    deleteGroupConfirmCloseBtn.addEventListener("click", () => {
      const modal = document.getElementById("deleteGroupConfirmModal");
      if (modal) modal.style.display = "none";
    });
  }

  // 5. Add / Assign Team to Group
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-add-team-to-group");
    if (!btn) return;
    const gId = btn.dataset.groupId;
    const tourney = getTournamentById(activeTournamentId);
    if (!tourney || !tourney.groups) return;

    const group = tourney.groups.find(g => g.id === gId);
    if (!group) return;

    const targetField = document.getElementById("inputAssignTargetGroupId");
    const nameEl = document.getElementById("assignGroupModalTargetName");
    const selectEl = document.getElementById("selectAssignTeamToGroup");

    if (targetField) targetField.value = group.id;
    if (nameEl) nameEl.textContent = group.name;

    if (selectEl) {
      const tourneyTeams = tourney.teams || [];
      const currentGrpTeamNames = (group.teams || []).map(t => typeof t === "string" ? t : t.name);

      // Filter available teams: exclude ones already in this group
      const available = tourneyTeams.filter(t => !currentGrpTeamNames.includes(t.name));

      if (available.length === 0) {
        selectEl.innerHTML = `<option value="">All registered tournament teams are already in this group</option>`;
      } else {
        selectEl.innerHTML = available.map(t => {
          const otherGrp = getTeamAssignedGroup(tourney, t.name);
          const grpNote = otherGrp ? ` (Currently in ${otherGrp.name})` : " (Unassigned)";
          return `<option value="${t.name}">${t.logo || '🏏'} ${t.name}${grpNote}</option>`;
        }).join("");
      }
    }

    const modal = document.getElementById("assignTeamToGroupModal");
    if (modal) modal.style.display = "flex";
  });

  const assignTeamToGroupForm = document.getElementById("assignTeamToGroupForm");
  if (assignTeamToGroupForm) {
    assignTeamToGroupForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const gId = document.getElementById("inputAssignTargetGroupId")?.value;
      const teamName = document.getElementById("selectAssignTeamToGroup")?.value;
      if (!gId || !teamName) return;

      const tourney = getTournamentById(activeTournamentId);
      if (!tourney || !tourney.groups) return;

      const targetGroup = tourney.groups.find(g => g.id === gId);
      if (!targetGroup) return;

      // Find full team object
      const teamObj = (tourney.teams || []).find(t => t.name === teamName) || { name: teamName, logo: "🏏", playerCount: 11 };

      // Validation: Check if already in target group
      if (!targetGroup.teams) targetGroup.teams = [];
      const alreadyInTarget = targetGroup.teams.some(t => (typeof t === "string" ? t : t.name) === teamName);
      if (alreadyInTarget) {
        showToast(`${teamName} is already in ${targetGroup.name}`);
        return;
      }

      // Remove from any other group if currently assigned
      tourney.groups.forEach(g => {
        if (g.teams) {
          g.teams = g.teams.filter(t => (typeof t === "string" ? t : t.name) !== teamName);
        }
      });

      // Add to target group
      targetGroup.teams.push(teamObj);

      saveTournament(tourney);
      renderTeamsTab(tourney);
      renderPointsTableTab(tourney);
      showToast(`${teamName} added to ${targetGroup.name}`);

      const modal = document.getElementById("assignTeamToGroupModal");
      if (modal) modal.style.display = "none";
    });
  }

  const assignTeamToGroupCloseBtn = document.getElementById("assignTeamToGroupCloseBtn");
  if (assignTeamToGroupCloseBtn) {
    assignTeamToGroupCloseBtn.addEventListener("click", () => {
      const modal = document.getElementById("assignTeamToGroupModal");
      if (modal) modal.style.display = "none";
    });
  }

  // 6. Remove Team from Group
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-remove-team-from-group");
    if (!btn) return;
    const teamName = btn.dataset.teamName;
    const gId = btn.dataset.groupId;

    const tourney = getTournamentById(activeTournamentId);
    if (!tourney || !tourney.groups) return;

    const group = tourney.groups.find(g => g.id === gId);
    if (!group) return;

    group.teams = (group.teams || []).filter(t => (typeof t === "string" ? t : t.name) !== teamName);

    saveTournament(tourney);
    renderTeamsTab(tourney);
    renderPointsTableTab(tourney);
    showToast(`${teamName} removed from ${group.name}`);
  });

  // 7. Move Team to Another Group
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-move-team-group");
    if (!btn) return;
    const teamName = btn.dataset.teamName;
    const gId = btn.dataset.groupId;

    const tourney = getTournamentById(activeTournamentId);
    if (!tourney || !tourney.groups) return;

    const currentGroup = tourney.groups.find(g => g.id === gId);
    const otherGroups = tourney.groups.filter(g => g.id !== gId);

    if (otherGroups.length === 0) {
      showToast("No other group exists. Create another group first to move this team.");
      return;
    }

    const teamField = document.getElementById("inputMoveTeamName");
    const currGroupField = document.getElementById("inputMoveCurrentGroupId");
    const summaryEl = document.getElementById("moveTeamInfoSummary");
    const selectEl = document.getElementById("selectMoveTargetGroupId");

    if (teamField) teamField.value = teamName;
    if (currGroupField) currGroupField.value = gId;
    if (summaryEl) summaryEl.innerHTML = `Moving <span class="text-orange">${teamName}</span> from <span style="color:#ffffff;">${currentGroup ? currentGroup.name : 'Group'}</span>`;

    if (selectEl) {
      selectEl.innerHTML = otherGroups.map(g => `<option value="${g.id}">${g.name} (${(g.teams || []).length} Teams)</option>`).join("");
    }

    const modal = document.getElementById("moveTeamGroupModal");
    if (modal) modal.style.display = "flex";
  });

  const moveTeamGroupForm = document.getElementById("moveTeamGroupForm");
  if (moveTeamGroupForm) {
    moveTeamGroupForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const teamName = document.getElementById("inputMoveTeamName")?.value;
      const srcGroupId = document.getElementById("inputMoveCurrentGroupId")?.value;
      const targetGroupId = document.getElementById("selectMoveTargetGroupId")?.value;

      if (!teamName || !targetGroupId) return;

      const tourney = getTournamentById(activeTournamentId);
      if (!tourney || !tourney.groups) return;

      const srcGroup = tourney.groups.find(g => g.id === srcGroupId);
      const destGroup = tourney.groups.find(g => g.id === targetGroupId);

      if (!destGroup) return;

      // Find team object
      let teamObj = null;
      if (srcGroup && srcGroup.teams) {
        teamObj = srcGroup.teams.find(t => (typeof t === "string" ? t : t.name) === teamName);
        srcGroup.teams = srcGroup.teams.filter(t => (typeof t === "string" ? t : t.name) !== teamName);
      }
      if (!teamObj) {
        teamObj = (tourney.teams || []).find(t => t.name === teamName) || { name: teamName, logo: "🏏", playerCount: 11 };
      }

      if (!destGroup.teams) destGroup.teams = [];
      // Validation check
      if (!destGroup.teams.some(t => (typeof t === "string" ? t : t.name) === teamName)) {
        destGroup.teams.push(teamObj);
      }

      saveTournament(tourney);
      renderTeamsTab(tourney);
      renderPointsTableTab(tourney);
      showToast(`${teamName} moved to ${destGroup.name}`);

      const modal = document.getElementById("moveTeamGroupModal");
      if (modal) modal.style.display = "none";
    });
  }

  const moveTeamGroupCloseBtn = document.getElementById("moveTeamGroupCloseBtn");
  if (moveTeamGroupCloseBtn) {
    moveTeamGroupCloseBtn.addEventListener("click", () => {
      const modal = document.getElementById("moveTeamGroupModal");
      if (modal) modal.style.display = "none";
    });
  }

  // Bottom Navigation Bar on Screen 11
  const navHomeFromTourney = document.getElementById("navHomeFromTourney");
  if (navHomeFromTourney) {
    navHomeFromTourney.addEventListener("click", () => showScreen("screen5"));
  }

  const navMatchesFromTourney = document.getElementById("navMatchesFromTourney");
  if (navMatchesFromTourney) {
    navMatchesFromTourney.addEventListener("click", () => {
      renderMatchHistoryScreen();
      showScreen("screen9");
    });
  }

  const centerPlusBtnTourney = document.getElementById("centerPlusBtnTourney");
  if (centerPlusBtnTourney) {
    centerPlusBtnTourney.addEventListener("click", () => {
      openStartMatchSetup();
    });
  }

  const navStatsFromTourney = document.getElementById("navStatsFromTourney");
  if (navStatsFromTourney) {
    navStatsFromTourney.addEventListener("click", () => {
      renderPlayerStatsScreen();
      showScreen("screen10");
    });
  }

  const navTourneyFromTourney = document.getElementById("navTourneyFromTourney");
  if (navTourneyFromTourney) {
    navTourneyFromTourney.addEventListener("click", () => {
      openTournamentScreen();
    });
  }

  const navMenuFromTourney = document.getElementById("navMenuFromTourney");
  if (navMenuFromTourney) {
    navMenuFromTourney.addEventListener("click", openMenuDrawer);
  }

  // =========================================================================
  // 9. SQUAD & PLAYING XI MANAGEMENT ENGINE
  // =========================================================================
  let currentEditingSquad = [];
  let currentEditingTeamName = "";
  let currentEditingTourneyId = null;

  function openTeamSquadModal(teamName, tourneyId) {
    currentEditingTeamName = teamName;
    currentEditingTourneyId = tourneyId;

    let club = null;
    if (tourneyId) {
      const tourney = getTournamentById(tourneyId);
      if (tourney && tourney.teams) {
        club = tourney.teams.find(t => t.name === teamName);
      }
    }
    if (!club) {
      const allClubs = getAvailableClubsList();
      club = allClubs.find(c => c.name === teamName);
    }

    const teamLogo = club?.logo || "🏏";
    const modal = document.getElementById("teamSquadManageModal");
    const nameEl = document.getElementById("sqModalTeamName");
    const logoEl = document.getElementById("sqModalTeamLogo");
    const teamInput = document.getElementById("inputSquadTargetTeamName");
    const tourneyInput = document.getElementById("inputSquadContextTourneyId");

    if (nameEl) nameEl.textContent = teamName;
    if (logoEl) logoEl.textContent = teamLogo;
    if (teamInput) teamInput.value = teamName;
    if (tourneyInput) tourneyInput.value = tourneyId || "";

    // Load squad or generate default
    if (club && club.players && club.players.length > 0) {
      currentEditingSquad = JSON.parse(JSON.stringify(club.players));
    } else {
      currentEditingSquad = [];
    }

    renderSquadModalPlayersList();

    const addPanel = document.getElementById("sqAddPlayerPanel") || document.getElementById("sqAddPlayerFormPanel");
    if (addPanel) addPanel.style.display = "none";

    if (modal) modal.style.display = "flex";
  }

  function renderSquadModalPlayersList() {
    const listContainer = document.getElementById("squadPlayersListContainer") || document.getElementById("sqPlayersListContainer");
    const countSquad = document.getElementById("sqStatTotalSquadCount") || document.getElementById("sqStatTotalPlayers");
    const countXi = document.getElementById("sqStatPlayingXiCount");
    const capNameEl = document.getElementById("sqStatCaptainName");
    const vcNameEl = document.getElementById("sqStatViceCaptainName");

    const xiCount = currentEditingSquad.filter(p => p.isPlayingXi).length;
    const captain = currentEditingSquad.find(p => p.isCaptain);
    const vc = currentEditingSquad.find(p => p.isVC);

    if (countSquad) countSquad.textContent = currentEditingSquad.length;
    if (countXi) {
      countXi.textContent = `${xiCount} / 11`;
      countXi.style.color = xiCount === 11 ? "#4ade80" : (xiCount > 11 ? "#f87171" : "#ff7a29");
    }
    if (capNameEl) capNameEl.textContent = captain ? captain.name : "Not Assigned";
    if (vcNameEl) vcNameEl.textContent = vc ? vc.name : "Not Assigned";

    if (!listContainer) return;

    if (currentEditingSquad.length === 0) {
      listContainer.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:30px; color:#888;">
          <i class="fa-solid fa-users" style="font-size:24px; margin-bottom:8px;"></i>
          <p style="margin:0;">No players in this squad yet. Click "+ Add Player" above to start.</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = currentEditingSquad.map((p, idx) => {
      const isXi = !!p.isPlayingXi;
      const isCap = !!p.isCaptain;
      const isVc = !!p.isVC;
      const role = p.role || "Batsman";
      const roleIcon = role === "Bowler" ? "🎯" : (role === "All-Rounder" ? "⚡" : (role === "Wicketkeeper" ? "🧤" : "🏏"));
      const jersey = p.jersey ? `#${p.jersey}` : `#${idx + 1}`;

      return `
        <div class="squad-player-item-row ${isXi ? 'is-in-xi' : ''}" data-player-index="${idx}" style="background:#191919; border:1px solid ${isXi ? '#16a34a44' : '#282828'}; border-radius:10px; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px; flex-wrap:wrap;">
          <div class="sq-player-main-left" style="display:flex; align-items:center; gap:10px; flex:1; min-width:180px;">
            <div class="sq-player-jersey-pill" style="background:#262626; color:#ff7a29; border:1px solid #3d3d3d; font-size:11px; font-weight:800; padding:3px 7px; border-radius:6px;">${jersey}</div>
            <div>
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span class="sq-player-name-title" style="font-size:13px; font-weight:800; color:#ffffff;">${p.name}</span>
                ${isCap ? '<span class="sq-badge-c" style="background:#eab30822; color:#facc15; border:1px solid #eab30855; font-size:10px; font-weight:900; padding:1px 5px; border-radius:4px;"><i class="fa-solid fa-crown"></i> C</span>' : ''}
                ${isVc ? '<span class="sq-badge-vc" style="background:#3b82f622; color:#60a5fa; border:1px solid #3b82f655; font-size:10px; font-weight:900; padding:1px 5px; border-radius:4px;"><i class="fa-solid fa-star"></i> VC</span>' : ''}
              </div>
              <div style="display:flex; align-items:center; gap:8px; font-size:11px; color:#888888; margin-top:2px;">
                <span>${roleIcon} ${role}</span>
                <span>•</span>
                <span style="color:${isXi ? '#4ade80' : '#888888'}; font-weight:${isXi ? '700' : '400'};">
                  ${isXi ? '<i class="fa-solid fa-circle-check"></i> Playing XI' : 'Bench / Squad'}
                </span>
              </div>
            </div>
          </div>

          <div class="sq-player-actions-right" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <button type="button" class="btn-toggle-player-xi" data-player-index="${idx}" style="background:${isXi ? '#16a34a22' : '#222'}; color:${isXi ? '#4ade80' : '#888'}; border:1px solid ${isXi ? '#16a34a66' : '#333'}; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;" title="Toggle Playing XI">
              <i class="fa-solid ${isXi ? 'fa-check-circle' : 'fa-circle-plus'}"></i> ${isXi ? 'In XI' : 'Add to XI'}
            </button>
            <button type="button" class="btn-set-captain" data-player-index="${idx}" style="background:${isCap ? '#eab30833' : '#222'}; color:${isCap ? '#facc15' : '#888'}; border:1px solid ${isCap ? '#eab30888' : '#333'}; padding:4px 7px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer;" title="Set as Captain">
              (C)
            </button>
            <button type="button" class="btn-set-vc" data-player-index="${idx}" style="background:${isVc ? '#3b82f633' : '#222'}; color:${isVc ? '#60a5fa' : '#888'}; border:1px solid ${isVc ? '#3b82f688' : '#333'}; padding:4px 7px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer;" title="Set as Vice Captain">
              (VC)
            </button>
            <button type="button" class="btn-delete-squad-player" data-player-index="${idx}" style="background:transparent; border:none; color:#f87171; padding:4px 6px; cursor:pointer; font-size:13px;" title="Remove player from squad">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  // Squad Modal Event Handlers
  function attachSquadListContainerListener() {
    const listContainers = [
      document.getElementById("squadPlayersListContainer"),
      document.getElementById("sqPlayersListContainer")
    ].filter(Boolean);

    listContainers.forEach(container => {
      container.addEventListener("click", (e) => {
        // Toggle XI
        const btnXi = e.target.closest(".btn-toggle-player-xi");
        if (btnXi) {
          const idx = parseInt(btnXi.dataset.playerIndex);
          if (!isNaN(idx) && currentEditingSquad[idx]) {
            const currentlyInXi = !!currentEditingSquad[idx].isPlayingXi;
            const totalInXi = currentEditingSquad.filter(p => p.isPlayingXi).length;
            if (!currentlyInXi && totalInXi >= 11) {
              showToast("Playing XI is already full (11 players). Uncheck a player first.");
              return;
            }
            currentEditingSquad[idx].isPlayingXi = !currentlyInXi;
            renderSquadModalPlayersList();
          }
          return;
        }

        // Set Captain
        const btnCap = e.target.closest(".btn-set-captain");
        if (btnCap) {
          const idx = parseInt(btnCap.dataset.playerIndex);
          if (!isNaN(idx) && currentEditingSquad[idx]) {
            currentEditingSquad.forEach((p, i) => {
              p.isCaptain = (i === idx);
              if (i === idx) {
                p.isVC = false; // Cannot be both
                p.isPlayingXi = true; // Captain is always in XI
              }
            });
            renderSquadModalPlayersList();
          }
          return;
        }

        // Set Vice Captain
        const btnVc = e.target.closest(".btn-set-vc");
        if (btnVc) {
          const idx = parseInt(btnVc.dataset.playerIndex);
          if (!isNaN(idx) && currentEditingSquad[idx]) {
            currentEditingSquad.forEach((p, i) => {
              p.isVC = (i === idx);
              if (i === idx) {
                p.isCaptain = false; // Cannot be both
                p.isPlayingXi = true; // VC is always in XI
              }
            });
            renderSquadModalPlayersList();
          }
          return;
        }

        // Delete Player
        const btnDel = e.target.closest(".btn-delete-squad-player");
        if (btnDel) {
          const idx = parseInt(btnDel.dataset.playerIndex);
          if (!isNaN(idx) && currentEditingSquad[idx]) {
            const removedName = currentEditingSquad[idx].name;
            currentEditingSquad.splice(idx, 1);
            renderSquadModalPlayersList();
            showToast(`${removedName} removed from squad`);
          }
          return;
        }
      });
    });
  }
  attachSquadListContainerListener();

  // Auto Select XI
  const btnSqAutoSelectXi = document.getElementById("btnSqAutoSelectXi");
  if (btnSqAutoSelectXi) {
    btnSqAutoSelectXi.addEventListener("click", () => {
      if (currentEditingSquad.length === 0) return;
      currentEditingSquad.forEach((p, i) => {
        p.isPlayingXi = i < 11;
      });
      // Ensure captain & VC are assigned
      if (!currentEditingSquad.some(p => p.isCaptain) && currentEditingSquad[0]) {
        currentEditingSquad[0].isCaptain = true;
      }
      if (!currentEditingSquad.some(p => p.isVC) && currentEditingSquad[1]) {
        currentEditingSquad[1].isVC = true;
      }
      renderSquadModalPlayersList();
      showToast("Auto-selected optimal 11 for Playing XI");
    });
  }

  // Add Player Panel Toggles
  const btnSqToggleAddPlayer = document.getElementById("btnSqToggleAddPlayer");
  const sqAddPlayerPanel = document.getElementById("sqAddPlayerPanel") || document.getElementById("sqAddPlayerFormPanel");
  const btnSqCloseAddPlayerPanel = document.getElementById("btnSqCloseAddPlayerPanel");
  const btnSqConfirmAddPlayer = document.getElementById("btnSqConfirmAddPlayer");

  if (btnSqToggleAddPlayer) {
    btnSqToggleAddPlayer.addEventListener("click", () => {
      const panel = document.getElementById("sqAddPlayerPanel") || document.getElementById("sqAddPlayerFormPanel");
      if (panel) {
        panel.style.display = panel.style.display === "none" ? "block" : "none";
        const nameInput = document.getElementById("inputSqNewPlayerName") || document.getElementById("inputSqPlayerName");
        if (nameInput && panel.style.display !== "none") nameInput.focus();
      }
    });
  }

  if (btnSqCloseAddPlayerPanel) {
    btnSqCloseAddPlayerPanel.addEventListener("click", () => {
      const panel = document.getElementById("sqAddPlayerPanel") || document.getElementById("sqAddPlayerFormPanel");
      if (panel) panel.style.display = "none";
    });
  }

  if (btnSqConfirmAddPlayer) {
    btnSqConfirmAddPlayer.addEventListener("click", () => {
      const nameInput = document.getElementById("inputSqNewPlayerName") || document.getElementById("inputSqPlayerName");
      const roleSelect = document.getElementById("selectSqNewPlayerRole") || document.getElementById("selectSqPlayerRole");
      const jerseyInput = document.getElementById("inputSqNewPlayerJersey") || document.getElementById("inputSqPlayerJersey");

      const name = nameInput?.value?.trim();
      const role = roleSelect?.value || "Batsman";
      const jersey = jerseyInput?.value?.trim() || String(currentEditingSquad.length + 1);

      if (!name) {
        alert("Please enter a player name.");
        if (nameInput) nameInput.focus();
        return;
      }

      const totalInXi = currentEditingSquad.filter(p => p.isPlayingXi).length;
      const isPlayingXi = totalInXi < 11;

      currentEditingSquad.push({
        name: name,
        role: role,
        jersey: jersey,
        isPlayingXi: isPlayingXi,
        isCaptain: false,
        isVC: false
      });

      if (nameInput) nameInput.value = "";
      if (jerseyInput) jerseyInput.value = "";
      const panel = document.getElementById("sqAddPlayerPanel") || document.getElementById("sqAddPlayerFormPanel");
      if (panel) panel.style.display = "none";

      renderSquadModalPlayersList();
      showToast(`${name} added to squad`);
    });
  }

  // Save Squad Changes
  const btnSqSaveSquadChanges = document.getElementById("btnSqSaveSquadChanges");
  if (btnSqSaveSquadChanges) {
    btnSqSaveSquadChanges.addEventListener("click", () => {
      if (currentEditingSquad.length === 0) {
        showToast("Squad cannot be empty.");
        return;
      }

      const captain = currentEditingSquad.find(p => p.isCaptain)?.name || currentEditingSquad[0]?.name || "Captain";
      const vc = currentEditingSquad.find(p => p.isVC)?.name || "";

      // 1. Update in active tournament if present
      if (currentEditingTourneyId) {
        const tourney = getTournamentById(currentEditingTourneyId);
        if (tourney && tourney.teams) {
          const tm = tourney.teams.find(t => t.name === currentEditingTeamName);
          if (tm) {
            tm.players = currentEditingSquad;
            tm.playerCount = currentEditingSquad.length;
            tm.captain = captain;
            tm.viceCaptain = vc;
            saveTournament(tourney);
            renderTeamsTab(tourney);
          }
        }
      }

      // 2. Also persist in custom club database
      const customClubs = getCustomClubsList();
      const customClub = customClubs.find(c => c.name === currentEditingTeamName);
      if (customClub) {
        customClub.players = currentEditingSquad;
        customClub.playerCount = currentEditingSquad.length;
        customClub.captain = captain;
        customClub.viceCaptain = vc;
        saveCustomClub(customClub);
      }

      // 3. Update wizard view if visible
      renderWizardTeamsSelection(wizardTeamSearchQuery);

      const modal = document.getElementById("teamSquadManageModal");
      if (modal) modal.style.display = "none";
      showToast(`Squad & Playing XI saved for ${currentEditingTeamName}!`);
    });
  }

  const teamSquadManageCloseBtn = document.getElementById("teamSquadManageCloseBtn");
  if (teamSquadManageCloseBtn) {
    teamSquadManageCloseBtn.addEventListener("click", () => {
      const modal = document.getElementById("teamSquadManageModal");
      if (modal) modal.style.display = "none";
    });
  }

  // Hook up Tournament Details Teams tab squad button
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-manage-tourney-squad");
    if (!btn) return;
    const teamName = btn.dataset.teamName;
    openTeamSquadModal(teamName, activeTournamentId);
  });

  // =========================================================================
  // 10. CUSTOM CLUB CREATOR MODAL ENGINE
  // =========================================================================
  function openCreateCustomClubModal(prefillName) {
    const modal = document.getElementById("createCustomClubModal");
    const nameInput = document.getElementById("inputNewClubName") || document.getElementById("customClubName");
    const cityInput = document.getElementById("inputNewClubCity") || document.getElementById("customClubCity");
    const capInput = document.getElementById("inputNewClubCaptain") || document.getElementById("customClubCaptain");
    const vcInput = document.getElementById("inputNewClubViceCaptain") || document.getElementById("customClubVC");
    const logoInput = document.getElementById("inputNewClubEmoji") || document.getElementById("customClubSelectedLogo");

    if (nameInput) nameInput.value = prefillName || "";
    if (cityInput) cityInput.value = "";
    if (capInput) capInput.value = "";
    if (vcInput) vcInput.value = "";
    if (logoInput) logoInput.value = "🏏";

    document.querySelectorAll("#createCustomClubModal .icon-chip, #createCustomClubModal .emoji-btn").forEach(c => {
      c.classList.toggle("active", c.dataset.icon === "🏏" || c.textContent.trim() === "🏏");
    });

    if (modal) modal.style.display = "flex";
    if (nameInput) nameInput.focus();
  }

  // Custom Club Logo Picker
  document.querySelectorAll("#createCustomClubModal .icon-chip, #createCustomClubModal .emoji-btn").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#createCustomClubModal .icon-chip, #createCustomClubModal .emoji-btn").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      const icon = chip.dataset.icon || chip.textContent.trim() || "🏏";
      const hiddenLogo = document.getElementById("inputNewClubEmoji") || document.getElementById("customClubSelectedLogo");
      if (hiddenLogo) hiddenLogo.value = icon;
    });
  });

  // Custom Club Form Submit
  const createCustomClubForm = document.getElementById("createCustomClubForm");
  if (createCustomClubForm) {
    createCustomClubForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = (document.getElementById("inputNewClubName") || document.getElementById("customClubName"))?.value?.trim();
      const city = (document.getElementById("inputNewClubCity") || document.getElementById("customClubCity"))?.value?.trim() || "Local";
      const logo = (document.getElementById("inputNewClubEmoji") || document.getElementById("customClubSelectedLogo"))?.value || "🏏";
      const captain = (document.getElementById("inputNewClubCaptain") || document.getElementById("customClubCaptain"))?.value?.trim() || "";
      const viceCaptain = (document.getElementById("inputNewClubViceCaptain") || document.getElementById("customClubVC"))?.value?.trim() || "";
      if (!name) {
        alert("Please enter a Team Name.");
        return;
      }

      const squad = [];
      if (captain) squad.push({ id: `p_${Date.now()}_c`, name: captain, role: "Batsman", isCaptain: true, isViceCaptain: false, isPlayingXi: true, jersey: "" });
      if (viceCaptain && viceCaptain.toLowerCase() !== captain.toLowerCase()) squad.push({ id: `p_${Date.now()}_vc`, name: viceCaptain, role: "All-Rounder", isCaptain: false, isViceCaptain: true, isPlayingXi: true, jersey: "" });

      const newClub = {
        id: `club_custom_${Date.now()}`,
        name: name,
        city: city,
        logo: logo,
        captain: captain,
        viceCaptain: viceCaptain,
        playerCount: squad.length,
        players: squad
      };

      saveCustomClub(newClub);

      // Auto-select this newly created team in wizard
      if (!wizardSelectedTeams.includes(newClub.name)) {
        wizardSelectedTeams.push(newClub.name);
      }

      const countBadge = document.getElementById("wizardSelectedTeamsCount");
      if (countBadge) countBadge.textContent = wizardSelectedTeams.length;

      renderWizardTeamsSelection(wizardTeamSearchQuery);

      const modal = document.getElementById("createCustomClubModal");
      if (modal) modal.style.display = "none";

      showToast(`Club "${name}" created and added to tournament!`);
    });
  }

  const createCustomClubCloseBtn = document.getElementById("createCustomClubCloseBtn");
  if (createCustomClubCloseBtn) {
    createCustomClubCloseBtn.addEventListener("click", () => {
      const modal = document.getElementById("createCustomClubModal");
      if (modal) modal.style.display = "none";
    });
  }

  // =========================================================================
  // 11. REALTIME PUBLIC LIVE SCORE & WEBRTC BROADCAST ENGINE
  // =========================================================================

  const RealtimeLiveService = {
    ws: null,
    wsConnected: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    sessionId: "sess_" + Math.random().toString(36).substring(2, 9),
    activeMatchSubscriptions: new Set(),
    broadcastChannel: (typeof BroadcastChannel !== "undefined") ? new BroadcastChannel("cric_yuva_live_match_stream") : null,
    listeners: new Map(), // event -> Set(callbacks)

    init: function() {
      this.connectWebSocket();
    },

    connectWebSocket: function() {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      try {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host || "localhost:3000";
        const wsUrl = `${protocol}//${host}/ws/live`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.wsConnected = true;
          this.reconnectAttempts = 0;
          console.log("[RealtimeLiveService] WebSocket Connected:", wsUrl);

          // Re-subscribe to active match rooms
          this.activeMatchSubscriptions.forEach(matchId => {
            this.send({
              type: "JOIN_MATCH",
              matchId: matchId,
              sessionId: this.sessionId,
              role: "VIEWER"
            });
          });

          this.trigger("connection_change", { connected: true });
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleIncomingMessage(data);
          } catch (err) {
            console.warn("[RealtimeLiveService] Malformed WS payload:", err);
          }
        };

        this.ws.onclose = () => {
          this.wsConnected = false;
          this.trigger("connection_change", { connected: false });
          this.scheduleReconnect();
        };

        this.ws.onerror = (err) => {
          console.warn("[RealtimeLiveService] WS error:", err);
          this.wsConnected = false;
        };
      } catch (err) {
        console.warn("[RealtimeLiveService] Error establishing WS:", err);
        this.scheduleReconnect();
      }
    },

    scheduleReconnect: function() {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      const delay = Math.min(10000, 1000 * Math.pow(1.5, this.reconnectAttempts++));
      this.reconnectTimer = setTimeout(() => {
        this.connectWebSocket();
      }, delay);
    },

    send: function(msg) {
      if (this.ws && typeof this.ws.send === "function" && this.ws.readyState === (typeof WebSocket !== "undefined" ? WebSocket.OPEN : 1)) {
        this.ws.send(JSON.stringify(msg));
        return true;
      }
      return false;
    },

    on: function(event, callback) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, new Set());
      }
      this.listeners.get(event).add(callback);
    },

    off: function(event, callback) {
      if (this.listeners.has(event)) {
        this.listeners.get(event).delete(callback);
      }
    },

    trigger: function(event, payload) {
      if (this.listeners.has(event)) {
        this.listeners.get(event).forEach(cb => {
          try { cb(payload); } catch (e) { console.error(e); }
        });
      }
    },

    handleIncomingMessage: function(msg) {
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case "MATCH_SCORE_UPDATE":
        case "MATCH_DATA":
          if (msg.data) {
            this.trigger("score_update", msg.data);
            if (this.broadcastChannel) {
              this.broadcastChannel.postMessage(msg.data);
            }
          }
          break;

        case "STREAM_STARTED":
          this.trigger("stream_started", msg);
          break;

        case "STREAM_STOPPED":
          this.trigger("stream_stopped", msg);
          break;

        case "WEBRTC_OFFER":
          this.trigger("webrtc_offer", msg);
          break;

        case "WEBRTC_ANSWER":
          this.trigger("webrtc_answer", msg);
          break;

        case "WEBRTC_ICE_CANDIDATE":
          this.trigger("webrtc_ice_candidate", msg);
          break;

        case "VIEWER_JOINED":
          this.trigger("viewer_joined", msg);
          break;

        case "TOURNAMENT_CHAT_MESSAGE":
          this.trigger("tournament_chat", msg.message || msg);
          break;

        case "TEAM_CHAT_MESSAGE":
          this.trigger("team_chat", msg.message || msg);
          break;

        case "CHAT_HISTORY":
          this.trigger("chat_history", msg);
          break;

        case "ERROR":
          this.trigger("server_error", msg);
          break;
      }
    },

    // Broadcast scorer update to Internet and local cache
    emitLiveUpdate: function(matchData) {
      if (!matchData) return;
      const mId = matchData.matchId || matchData.id || "MATCH-001";
      const payload = {
        ...matchData,
        matchId: mId,
        _updatedAt: Date.now()
      };

      // 1. Send via WebSocket to server
      this.send({
        type: "MATCH_SCORE_UPDATE",
        matchId: mId,
        matchData: payload,
        tournamentId: matchData.tournamentId || null,
        scorerUserId: (window.currentUser && window.currentUser.id) || "scorer_1"
      });

      // 2. Also POST to REST backend for persistence
      CricYuvaCloud.request(`/api/live/match/${encodeURIComponent(mId)}`, {
        method: "POST",
        body: JSON.stringify({ matchData: payload, tournamentId: matchData.tournamentId || null })
      }).catch(err => console.warn("[REST Sync Error]:", err));

      // 3. Update localStorage & BroadcastChannel
      try {
        localStorage.setItem("cric_yuva_active_live_stream", JSON.stringify(payload));
        if (this.broadcastChannel) {
          this.broadcastChannel.postMessage(payload);
        }
      } catch (err) {}
    },

    joinMatchRoom: function(matchId) {
      if (!matchId) return;
      this.activeMatchSubscriptions.add(matchId);
      this.send({
        type: "JOIN_MATCH",
        matchId: matchId,
        sessionId: this.sessionId,
        role: "VIEWER"
      });
    },

    leaveMatchRoom: function(matchId) {
      if (!matchId) return;
      this.activeMatchSubscriptions.delete(matchId);
      this.send({
        type: "LEAVE_MATCH",
        matchId: matchId,
        sessionId: this.sessionId
      });
    },

    // Search matches from server backend
    searchServerMatches: async function(query) {
      try {
        const res = await fetch(`/api/live/matches?search=${encodeURIComponent(query || "")}`);
        const data = await res.json();
        return data.matches || [];
      } catch (err) {
        return [];
      }
    },

    getLiveMatchStream: function() {
      try {
        const stored = localStorage.getItem("cric_yuva_active_live_stream");
        return stored ? JSON.parse(stored) : null;
      } catch (e) {
        return null;
      }
    }
  };

  // Initialize service
  RealtimeLiveService.init();

  const PublicLiveScoreService = RealtimeLiveService;

  // =========================================================================
  // 12. WEBRTC VIDEO BROADCAST & VIEWER MANAGERS
  // =========================================================================

  const VideoBroadcastManager = {
    localStream: null,
    compositeStream: null,
    compositeCanvas: null,
    compositeCtx: null,
    animationFrameId: null,
    facingMode: "environment", // "environment" or "user"
    audioMuted: false,
    isBroadcasting: false,
    activeMatchId: null,
    activeTournamentId: null,
    peerConnections: new Map(), // viewerSessionId -> RTCPeerConnection
    watermarkLogoImg: null,

    init: function() {
      this.compositeCanvas = document.getElementById("bcastCompositeCanvas");
      if (this.compositeCanvas) {
        this.compositeCtx = this.compositeCanvas.getContext("2d");
        this.compositeCanvas.width = 1280;
        this.compositeCanvas.height = 720;
      }

      this.watermarkLogoImg = new Image();
      this.watermarkLogoImg.src = "cric-yuva-logo.png";

      // Listen for incoming viewer joins
      RealtimeLiveService.on("viewer_joined", (msg) => {
        if (this.isBroadcasting && msg.matchId === this.activeMatchId) {
          this.createOfferForViewer(msg.sessionId);
        }
      });

      // Listen for WebRTC answers from viewers
      RealtimeLiveService.on("webrtc_answer", async (msg) => {
        if (this.isBroadcasting && msg.matchId === this.activeMatchId) {
          const pc = this.peerConnections.get(msg.viewerSessionId);
          if (pc && pc.signalingState === "have-local-offer") {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            } catch (err) {
              console.warn("Error setting remote description on broadcaster:", err);
            }
          }
        }
      });

      // Listen for ICE candidates from viewers
      RealtimeLiveService.on("webrtc_ice_candidate", async (msg) => {
        if (this.isBroadcasting && msg.matchId === this.activeMatchId) {
          const pc = this.peerConnections.get(msg.viewerSessionId);
          if (pc && msg.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (err) {
              console.warn("Error adding ICE candidate on broadcaster:", err);
            }
          }
        }
      });
    },

    startCamera: async function(facingMode = "environment") {
      this.facingMode = facingMode;
      const videoEl = document.getElementById("bcastLocalVideo");
      const pitchMock = document.getElementById("bcastPitchMockup");
      const statusText = document.getElementById("broadcastIngestStatusText");

      try {
        if (this.localStream) {
          this.localStream.getTracks().forEach(t => t.stop());
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          showToast("Camera API not supported in this browser viewport.");
          return false;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: this.facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true
        });

        this.localStream = stream;
        if (videoEl) {
          videoEl.srcObject = stream;
          videoEl.style.display = "block";
          if (pitchMock) pitchMock.style.display = "none";
        }

        if (statusText) {
          statusText.innerHTML = `<span style="color:#22c55e; font-weight:800;">● CAMERA READY</span>: Ingest Active (${facingMode === "user" ? "Front" : "Back"} Lens)`;
        }

        this.startCompositeLoop();
        showToast(`📷 CAMERA READY (${facingMode === "user" ? "Front" : "Back"})`);
        return true;
      } catch (err) {
        console.warn("Camera getUserMedia error:", err);
        let errMsg = "CAMERA ERROR: Ingest stream initialization failed";
        let stateBadge = `<span style="color:#ef4444; font-weight:800;">● CAMERA ERROR</span>`;
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          errMsg = "CAMERA DENIED: Please grant camera permission in browser settings";
          stateBadge = `<span style="color:#ef4444; font-weight:800;">● CAMERA DENIED</span>`;
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          errMsg = "CAMERA ERROR: No video capture device found";
          stateBadge = `<span style="color:#f59e0b; font-weight:800;">● CAMERA OFF</span>`;
        }
        showToast(`⚠️ ${errMsg}`);
        if (statusText) statusText.innerHTML = `${stateBadge}: ${errMsg}`;
        return false;
      }
    },

    stopCamera: function() {
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
        this.localStream = null;
      }
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      const videoEl = document.getElementById("bcastLocalVideo");
      const pitchMock = document.getElementById("bcastPitchMockup");
      const statusText = document.getElementById("broadcastIngestStatusText");
      if (videoEl) {
        videoEl.srcObject = null;
        videoEl.style.display = "none";
      }
      if (pitchMock) pitchMock.style.display = "flex";
      if (statusText) {
        statusText.innerHTML = `<span style="color:#94a3b8; font-weight:800;">● CAMERA OFF</span>: Feed Disconnected`;
      }
    },

    toggleMuteAudio: function() {
      if (!this.localStream) return;
      this.audioMuted = !this.audioMuted;
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.audioMuted;
      });
      const btnMute = document.getElementById("btnCamMute");
      if (btnMute) {
        btnMute.innerHTML = this.audioMuted ? `<i class="fa-solid fa-microphone-slash"></i> Muted` : `<i class="fa-solid fa-microphone"></i> Mic`;
        btnMute.classList.toggle("active", !this.audioMuted);
      }
      showToast(this.audioMuted ? "Microphone Muted" : "Microphone Active");
    },

    startCompositeLoop: function() {
      if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

      const render = () => {
        if (!this.compositeCanvas || !this.compositeCtx) return;
        const ctx = this.compositeCtx;
        const w = this.compositeCanvas.width;
        const h = this.compositeCanvas.height;
        const videoEl = document.getElementById("bcastLocalVideo");

        // 1. Draw Background / Video Frame
        if (videoEl && videoEl.readyState >= 2 && !videoEl.paused && videoEl.videoWidth) {
          ctx.drawImage(videoEl, 0, 0, w, h);
        } else {
          ctx.fillStyle = "#0c101c";
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = "#1e293b";
          ctx.font = "bold 28px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("CRIC YUVA LIVE BROADCAST INGEST", w / 2, h / 2 - 20);
        }

        // 2. Draw TV Watermark in Top Corner
        ctx.save();
        ctx.fillStyle = "rgba(10, 14, 23, 0.75)";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 2;
        roundRect(ctx, w - 180, 20, 160, 60, 10, true, true);

        if (this.watermarkLogoImg && this.watermarkLogoImg.complete && this.watermarkLogoImg.naturalWidth > 0) {
          ctx.drawImage(this.watermarkLogoImg, w - 170, 26, 48, 48);
        }
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("CRIC YUVA", w - 114, 46);

        ctx.fillStyle = "#ef4444";
        roundRect(ctx, w - 114, 52, 54, 18, 4, true, false);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.fillText("LIVE HD", w - 108, 65);
        ctx.restore();

        // 3. Draw Bottom Live Scoreboard Overlay
        if (currentBroadcastSource && currentBroadcastSource.matchData) {
          const md = currentBroadcastSource.matchData;
          const currInnNum = md.currentInnings || 1;
          const inn = currInnNum === 2 ? (md.innings2 || {}) : (md.innings1 || {});
          const tName = inn.battingTeam || md.teamA?.name || "Team Alpha";
          const score = `${inn.totalRuns || 0}/${inn.wickets || 0}`;
          const overs = `(${inn.overs || 0}.${inn.balls || 0} / ${md.overs || 20} Ov)`;

          ctx.save();
          // Overlay background bar
          const gradient = ctx.createLinearGradient(0, h - 110, 0, h);
          gradient.addColorStop(0, "rgba(8, 10, 16, 0)");
          gradient.addColorStop(0.2, "rgba(8, 10, 16, 0.88)");
          gradient.addColorStop(1, "rgba(8, 10, 16, 0.98)");
          ctx.fillStyle = gradient;
          ctx.fillRect(0, h - 110, w, 110);

          ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, h - 90);
          ctx.lineTo(w, h - 90);
          ctx.stroke();

          // Team & Score text
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 26px sans-serif";
          ctx.textAlign = "left";
          ctx.fillText(tName, 24, h - 55);

          ctx.fillStyle = "#ff7a00";
          ctx.font = "bold 32px sans-serif";
          ctx.fillText(score, 24 + ctx.measureText(tName).width + 16, h - 55);

          ctx.fillStyle = "#94a3b8";
          ctx.font = "bold 18px sans-serif";
          ctx.fillText(overs, 24 + ctx.measureText(tName).width + 16 + ctx.measureText(score).width + 12, h - 55);

          // Batters and Bowler sub-text
          ctx.fillStyle = "#cbd5e1";
          ctx.font = "16px sans-serif";
          const batters = (inn.batting || []).filter(b => b.isAtCrease);
          let batterStr = "Striker 0*(0) • Non-Striker 0(0)";
          if (batters.length >= 2) {
            batterStr = `${batters[0].name} ${batters[0].runs}*(${batters[0].balls}) • ${batters[1].name} ${batters[1].runs}(${batters[1].balls})`;
          }
          ctx.fillText(batterStr, 24, h - 22);

          const bowler = (inn.bowling || []).find(b => b.isCurrentBowler) || (inn.bowling && inn.bowling[0]);
          if (bowler) {
            ctx.fillStyle = "#38bdf8";
            ctx.textAlign = "right";
            ctx.fillText(`Bowl: ${bowler.name} ${bowler.overs}.${bowler.balls}-${bowler.maidens || 0}-${bowler.runs || 0}-${bowler.wickets || 0}`, w - 24, h - 22);
          }
          ctx.restore();
        }

        this.animationFrameId = requestAnimationFrame(render);
      };

      this.animationFrameId = requestAnimationFrame(render);

      // Create composite media stream
      if (this.compositeCanvas && this.compositeCanvas.captureStream) {
        this.compositeStream = this.compositeCanvas.captureStream(30);
        if (this.localStream) {
          const audioTracks = this.localStream.getAudioTracks();
          if (audioTracks.length > 0) {
            this.compositeStream.addTrack(audioTracks[0]);
          }
        }
      }
    },

    startBroadcast: async function(config) {
      const { matchId, tournamentId, destinations, sourceType } = config;
      this.activeMatchId = matchId;
      this.activeTournamentId = tournamentId;
      this.isBroadcasting = true;

      // Authorize with backend
      try {
        const data = await CricYuvaCloud.request("/api/live/stream/authorize", {
          method: "POST",
          body: JSON.stringify({ tournamentId, matchId, destinations, cameraSlot: selectedCameraIngest })
        });
        if (!data.success) {
          this.isBroadcasting = false;
          const msg = data.message || data.error || "Permission Denied";
          alert(msg);
          showToast(`❌ ${msg}`);
          return false;
        }

        // Notify WebSocket
        RealtimeLiveService.send({
          type: "START_BROADCAST",
          userId: (window.currentUser && window.currentUser.id) || "user_default",
          tournamentId: tournamentId,
          matchId: matchId,
          destinations: destinations,
          cameraSlot: selectedCameraIngest
        });

        return true;
      } catch (err) {
        this.isBroadcasting = false;
        showToast("❌ BROADCAST START FAILED: Backend connection error");
        return false;
      }
    },

    stopBroadcast: async function() {
      this.isBroadcasting = false;
      const mId = this.activeMatchId;

      // Close all peer connections
      this.peerConnections.forEach((pc) => {
        try { pc.close(); } catch (e) {}
      });
      this.peerConnections.clear();

      try {
        await CricYuvaCloud.request("/api/live/stream/stop", { method: "POST", body: JSON.stringify({ matchId: mId }) });

        RealtimeLiveService.send({
          type: "STOP_BROADCAST",
          matchId: mId
        });
      } catch (err) {}

      showToast("⏹ Live Broadcast Stream Ended");
    },

    createOfferForViewer: async function(viewerSessionId) {
      if (!this.compositeStream) return;
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });

      this.peerConnections.set(viewerSessionId, pc);

      this.compositeStream.getTracks().forEach(track => {
        pc.addTrack(track, this.compositeStream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          RealtimeLiveService.send({
            type: "WEBRTC_ICE_CANDIDATE",
            matchId: this.activeMatchId,
            viewerSessionId: viewerSessionId,
            candidate: event.candidate
          });
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        RealtimeLiveService.send({
          type: "WEBRTC_OFFER",
          matchId: this.activeMatchId,
          viewerSessionId: viewerSessionId,
          sdp: offer
        });
      } catch (err) {
        console.warn("Error creating WebRTC offer:", err);
      }
    }
  };

  // Helper for drawing rounded rect on canvas
  function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    if (typeof radius === "undefined") radius = 5;
    if (typeof radius === "number") radius = { tl: radius, tr: radius, br: radius, bl: radius };
    ctx.beginPath();
    ctx.moveTo(x + radius.tl, y);
    ctx.lineTo(x + width - radius.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
    ctx.lineTo(x + width, y + height - radius.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
    ctx.lineTo(x + radius.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
    ctx.lineTo(x, y + radius.tl);
    ctx.quadraticCurveTo(x, y, x + radius.tl, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  // =========================================================================
  // 13. PUBLIC LIVE SCORE VIEWER ENGINE (READ-ONLY)
  // =========================================================================

  const VideoViewerManager = {
    peerConnection: null,
    activeMatchId: null,
    isConnected: false,

    init: function() {
      // Listen for WebRTC offers from the broadcaster
      RealtimeLiveService.on("webrtc_offer", async (msg) => {
        if (msg.matchId === this.activeMatchId && (!msg.viewerSessionId || msg.viewerSessionId === RealtimeLiveService.sessionId)) {
          await this.handleOffer(msg.sdp);
        }
      });

      // Listen for ICE candidates
      RealtimeLiveService.on("webrtc_ice_candidate", async (msg) => {
        if (msg.matchId === this.activeMatchId && (!msg.viewerSessionId || msg.viewerSessionId === RealtimeLiveService.sessionId)) {
          if (this.peerConnection && msg.candidate) {
            try {
              await this.peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (err) {
              console.warn("Error adding ICE candidate on viewer:", err);
            }
          }
        }
      });

      // Listen for stream ended
      RealtimeLiveService.on("stream_stopped", (msg) => {
        if (msg.matchId === this.activeMatchId) {
          this.handleStreamEnded();
        }
      });
    },

    connectToStream: function(matchId) {
      this.activeMatchId = matchId;
      this.cleanup();

      const videoPlayer = document.getElementById("pubLiveVideoPlayer");
      const fallback = document.getElementById("pubLiveVideoFallback");
      const statusText = document.getElementById("pubLiveStreamStatusText");
      const pillText = document.getElementById("pubStreamPillText");

      if (videoPlayer) videoPlayer.style.display = "none";
      if (fallback) fallback.style.display = "flex";
      if (statusText) statusText.textContent = "Connecting to live video broadcast...";
      if (pillText) pillText.textContent = "CONNECTING";

      // Join match room on WebSocket to request stream
      RealtimeLiveService.joinMatchRoom(matchId);

      // Check if match already has active stream via REST
      fetch(`/api/live/stream/${matchId}`)
        .then(res => res.json())
        .then(data => {
          if (!data.streamActive) {
            if (statusText) statusText.textContent = "LIVE SOURCE UNAVAILABLE • Waiting for broadcaster camera...";
            if (pillText) pillText.textContent = "WAITING FOR SOURCE";
          }
        })
        .catch(() => {});
    },

    handleOffer: async function(offerSdp) {
      this.cleanup();
      const videoPlayer = document.getElementById("pubLiveVideoPlayer");
      const fallback = document.getElementById("pubLiveVideoFallback");
      const pillText = document.getElementById("pubStreamPillText");

      this.peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });

      this.peerConnection.ontrack = (event) => {
        if (videoPlayer && event.streams && event.streams[0]) {
          videoPlayer.srcObject = event.streams[0];
          videoPlayer.style.display = "block";
          if (fallback) fallback.style.display = "none";
          if (pillText) pillText.textContent = "LIVE HD • 1080p";
          this.isConnected = true;
        }
      };

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          RealtimeLiveService.send({
            type: "WEBRTC_ICE_CANDIDATE",
            matchId: this.activeMatchId,
            viewerSessionId: RealtimeLiveService.sessionId,
            candidate: event.candidate
          });
        }
      };

      try {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offerSdp));
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        RealtimeLiveService.send({
          type: "WEBRTC_ANSWER",
          matchId: this.activeMatchId,
          viewerSessionId: RealtimeLiveService.sessionId,
          sdp: answer
        });
      } catch (err) {
        console.warn("Error handling WebRTC offer on viewer:", err);
      }
    },

    handleStreamEnded: function() {
      this.cleanup();
      const videoPlayer = document.getElementById("pubLiveVideoPlayer");
      const fallback = document.getElementById("pubLiveVideoFallback");
      const statusText = document.getElementById("pubLiveStreamStatusText");
      const pillText = document.getElementById("pubStreamPillText");

      if (videoPlayer) videoPlayer.style.display = "none";
      if (fallback) fallback.style.display = "flex";
      if (statusText) statusText.textContent = "STREAM ENDED • The broadcaster has stopped this live feed.";
      if (pillText) pillText.textContent = "STREAM ENDED";
    },

    cleanup: function() {
      if (this.peerConnection) {
        try { this.peerConnection.close(); } catch (e) {}
        this.peerConnection = null;
      }
      this.isConnected = false;
    }
  };

  VideoViewerManager.init();
  VideoBroadcastManager.init();

  let activePublicLiveModalMatchId = null;

  async function openPublicLiveScoreModal(fixtureOrMatchId) {
    const modal = document.getElementById("publicLiveScoreModal");
    if (!modal) return;

    activePublicLiveModalMatchId = fixtureOrMatchId || "MATCH-001";
    modal.style.display = "flex";

    // 1. Initial render with local/server data
    await renderPublicLiveScoreContent(activePublicLiveModalMatchId);

    // 2. Connect to video stream and live WebSocket updates
    VideoViewerManager.connectToStream(activePublicLiveModalMatchId);

    // 3. Listen to real-time score updates
    RealtimeLiveService.on("score_update", (updatedMatch) => {
      if (modal.style.display !== "none" && (updatedMatch.matchId === activePublicLiveModalMatchId || !activePublicLiveModalMatchId)) {
        renderPublicLiveScoreContent(activePublicLiveModalMatchId, updatedMatch);
      }
    });
  }

  async function renderPublicLiveScoreContent(fixtureOrMatchId, livePayload) {
    let matchData = livePayload;

    if (!matchData && fixtureOrMatchId) {
      // Fetch from backend server first for true cross-device synchronization
      try {
        const res = await fetch(`/api/live/match/${fixtureOrMatchId}`);
        const data = await res.json();
        if (data.success && data.match) {
          matchData = data.match;
        }
      } catch (err) {}
    }

    if (!matchData) {
      // Fallback to local memory / match manager
      const currentMatch = getActiveMatch ? getActiveMatch() : null;
      if (currentMatch && (currentMatch.matchId === fixtureOrMatchId || currentMatch.id === fixtureOrMatchId || !fixtureOrMatchId)) {
        matchData = currentMatch;
      } else {
        const tourney = getTournamentById ? getTournamentById(activeTournamentId) : null;
        if (tourney && tourney.fixtures) {
          const fix = tourney.fixtures.find(f => f.id === fixtureOrMatchId);
          if (fix) {
            matchData = convertFixtureToMatchData(fix, tourney);
          }
        }
        
        if (!matchData && fixtureOrMatchId) {
          const historyList = getHistoryMatches ? getHistoryMatches() : [];
          const histMatch = historyList.find(m => m.matchId === fixtureOrMatchId);
          if (histMatch) matchData = histMatch;
        }
      }
    }

    if (!matchData) {
      matchData = PublicLiveScoreService.getLiveMatchStream() || (getActiveMatch ? getActiveMatch() : null);
    }

    const tAName = matchData?.teamA?.name || matchData?.teamA || "Team A";
    const tBName = matchData?.teamB?.name || matchData?.teamB || "Team B";
    const tourneyName = matchData?.tournament || matchData?.tourneyName || "Cric Yuva Live Championship";
    const ground = matchData?.ground || "Wankhede Stadium, Mumbai";
    const matchOvers = matchData?.overs || 20;

    // Set Header
    const tourneyEl = document.getElementById("pubLiveTourneyName");
    const venueEl = document.getElementById("pubLiveMatchStageVenue");

    if (tourneyEl) tourneyEl.textContent = `${tourneyName.toUpperCase()}`;
    if (venueEl) venueEl.textContent = `${ground} • ${matchOvers} Overs • Read-Only Viewer`;

    // Active Innings resolution
    const inn1 = matchData?.innings1 || { battingTeam: tAName, bowlingTeam: tBName, totalRuns: 0, wickets: 0, overs: 0, balls: 0, batting: [], bowling: [] };
    const inn2 = matchData?.innings2 || { battingTeam: tBName, bowlingTeam: tAName, totalRuns: 0, wickets: 0, overs: 0, balls: 0, batting: [], bowling: [] };
    const currInnNum = matchData?.currentInnings || 1;
    const activeInn = currInnNum === 2 ? inn2 : inn1;

    const battingTeamName = activeInn.battingTeam || (currInnNum === 2 ? tBName : tAName);
    const runs = activeInn.totalRuns || 0;
    const wkts = activeInn.wickets || 0;
    const ovs = activeInn.overs || 0;
    const bls = activeInn.balls || 0;
    const totalBalls = (ovs * 6) + bls;
    const crr = totalBalls > 0 ? ((runs / totalBalls) * 6).toFixed(2) : "0.00";

    // Set Video Score Overlay elements
    const pubOvBatTeam = document.getElementById("pubOvBatTeam");
    const pubOvScore = document.getElementById("pubOvScore");
    const pubOvOvers = document.getElementById("pubOvOvers");
    const pubOvCrr = document.getElementById("pubOvCrr");
    const pubOvBatters = document.getElementById("pubOvBatters");
    const pubOvBowler = document.getElementById("pubOvBowler");

    if (pubOvBatTeam) pubOvBatTeam.textContent = battingTeamName;
    if (pubOvScore) pubOvScore.textContent = `${runs}/${wkts}`;
    if (pubOvOvers) pubOvOvers.textContent = `(${ovs}.${bls} / ${matchOvers} Ov)`;
    if (pubOvCrr) pubOvCrr.textContent = `CRR: ${crr}`;

    // Set Innings Tag and CRR
    const innTagEl = document.getElementById("pubLiveInningsTag");
    const crrValEl = document.getElementById("pubLiveCrrVal");
    if (innTagEl) innTagEl.textContent = `${currInnNum === 2 ? '2nd' : '1st'} Innings • ${matchData?.status || 'LIVE'}`;
    if (crrValEl) crrValEl.textContent = crr;

    // Set Batting Team Info & Score
    const batLogoEl = document.getElementById("pubLiveBatLogo");
    const batTeamEl = document.getElementById("pubLiveBatTeam");
    const batSubEl = document.getElementById("pubLiveBatSub");
    const scoreTextEl = document.getElementById("pubLiveScoreText");
    const oversTextEl = document.getElementById("pubLiveOversText");

    if (batLogoEl) batLogoEl.textContent = "🏏";
    if (batTeamEl) batTeamEl.textContent = battingTeamName;
    if (batSubEl) {
      if (matchData?.status === "COMPLETED") {
        batSubEl.innerHTML = `<i class="fa-solid fa-trophy text-orange"></i> Match Concluded`;
      } else {
        batSubEl.innerHTML = `<i class="fa-solid fa-baseball-bat-ball"></i> Batting Now (${runs}/${wkts})`;
      }
    }
    if (scoreTextEl) scoreTextEl.textContent = `${runs}/${wkts}`;
    if (oversTextEl) oversTextEl.textContent = `(${ovs}.${bls} / ${matchOvers}.0 Ov)`;

    // Target banner (for 2nd innings)
    const targetBox = document.getElementById("pubLiveTargetBox");
    const targetRunsVal = document.getElementById("pubLiveTargetRunsVal");
    const equationText = document.getElementById("pubLiveEquationText");

    if (targetBox) {
      if (currInnNum === 2 && inn1.totalRuns !== undefined) {
        targetBox.style.display = "block";
        const target = (inn1.totalRuns || 0) + 1;
        const remainingRuns = Math.max(0, target - runs);
        const remainingBalls = Math.max(0, (matchOvers * 6) - totalBalls);
        const rrr = remainingBalls > 0 ? ((remainingRuns / remainingBalls) * 6).toFixed(2) : "0.00";
        if (targetRunsVal) targetRunsVal.textContent = target;
        if (equationText) equationText.textContent = `Need ${remainingRuns} runs in ${remainingBalls} balls (RRR: ${rrr})`;
      } else {
        targetBox.style.display = "none";
      }
    }

    // In-crease Batters
    const battersContainer = document.getElementById("pubLiveBattersRows");
    let creaseBatters = (activeInn.batting || []).filter(b => b.isAtCrease);
    if (creaseBatters.length === 0) creaseBatters = [];

    if (pubOvBatters && creaseBatters.length >= 2) {
      pubOvBatters.textContent = `${creaseBatters[0].name} ${creaseBatters[0].runs}*(${creaseBatters[0].balls}) • ${creaseBatters[1].name} ${creaseBatters[1].runs}(${creaseBatters[1].balls})`;
    }

    if (battersContainer) {
      battersContainer.innerHTML = "";
      creaseBatters.forEach(b => {
        const sr = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : "0.0";
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.padding = "6px 0";
        row.style.borderBottom = "1px solid #252525";
        row.innerHTML = `
          <span style="font-weight:700; color:#fff; font-size:12px;">${b.name} ${b.isStriker ? '<span style="color:#ff7a29;">*</span>' : ''}</span>
          <span style="display:flex; gap:16px; font-size:12px; font-weight:700;">
            <span style="width:28px; text-align:center; color:${b.runs >= 50 ? '#fbbf24' : '#fff'};">${b.runs || 0}</span>
            <span style="width:28px; text-align:center; color:#888;">${b.balls || 0}</span>
            <span style="width:24px; text-align:center; color:#888;">${b.fours || 0}</span>
            <span style="width:24px; text-align:center; color:#888;">${b.sixes || 0}</span>
            <span style="width:36px; text-align:center; color:#38bdf8;">${sr}</span>
          </span>
        `;
        battersContainer.appendChild(row);
      });
    }

    // Active Bowler
    const bowlerContainer = document.getElementById("pubLiveBowlerRow");
    const currentBowler = (activeInn.bowling || []).find(b => b.isCurrentBowler) || (activeInn.bowling && activeInn.bowling[0]) || {
      name: "Anrich Nortje",
      overs: 1,
      balls: 4,
      maidens: 0,
      runs: 14,
      wickets: 1
    };

    if (pubOvBowler) {
      pubOvBowler.textContent = `${currentBowler.name} ${currentBowler.overs}.${currentBowler.balls}-${currentBowler.maidens || 0}-${currentBowler.runs || 0}-${currentBowler.wickets || 0}`;
    }

    if (bowlerContainer) {
      const bBalls = (currentBowler.overs * 6) + currentBowler.balls;
      const bowlerEcon = bBalls > 0 ? ((currentBowler.runs / bBalls) * 6).toFixed(2) : "0.00";

      bowlerContainer.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0;">
          <span style="font-weight:700; color:#38bdf8; font-size:12px;"><i class="fa-solid fa-baseball"></i> ${currentBowler.name}</span>
          <span style="display:flex; gap:16px; font-size:12px; font-weight:700;">
            <span style="width:28px; text-align:center; color:#fff;">${currentBowler.overs}.${currentBowler.balls}</span>
            <span style="width:24px; text-align:center; color:#888;">${currentBowler.maidens || 0}</span>
            <span style="width:28px; text-align:center; color:#fff;">${currentBowler.runs || 0}</span>
            <span style="width:28px; text-align:center; color:#4ade80;">${currentBowler.wickets || 0}</span>
            <span style="width:36px; text-align:center; color:#38bdf8;">${bowlerEcon}</span>
          </span>
        </div>
      `;
    }

    // Recent Deliveries Ticker
    const recentBallsContainer = document.getElementById("pubLiveRecentBallsTicker");
    if (recentBallsContainer) {
      recentBallsContainer.innerHTML = "";
      const deliveries = (activeInn.currentOverDeliveries && activeInn.currentOverDeliveries.length > 0)
        ? activeInn.currentOverDeliveries
        : [{ label: "1", typeClass: "run" }, { label: "4", typeClass: "four" }, { label: "0", typeClass: "dot" }, { label: "Wd", typeClass: "extra" }, { label: "6", typeClass: "six" }];

      deliveries.forEach(d => {
        const span = document.createElement("span");
        let cls = "ball-pill";
        if (d.typeClass === "four" || d.label === "4") cls += " four";
        else if (d.typeClass === "six" || d.label === "6") cls += " six";
        else if (d.typeClass === "wicket" || d.label === "W") cls += " wicket";
        else if (d.typeClass === "extra" || d.label.includes("Wd") || d.label.includes("Nb")) cls += " extra";
        else if (d.label === "0" || d.label === "•") cls += " dot";
        
        span.className = cls;
        span.textContent = d.label;
        recentBallsContainer.appendChild(span);
      });
    }

    // Match Summary Box
    const summaryDetails = document.getElementById("pubLiveSummaryDetails");
    if (summaryDetails) {
      if (matchData?.result) {
        summaryDetails.innerHTML = `<b style="color:#ff7a29;">Result:</b> ${matchData.result}`;
      } else if (matchData?.toss) {
        summaryDetails.innerHTML = `<b style="color:#38bdf8;">Toss:</b> ${matchData.toss.winner} won the toss and chose to ${matchData.toss.decision}.`;
      } else {
        summaryDetails.innerHTML = `Live score synchronized continuously across all connected viewers and scorer devices.`;
      }
    }
  }

  // Live score search and direct ID lookup functionality
  const pubLiveSearchInput = document.getElementById("pubLiveSearchInput");
  const btnPubLookupId = document.getElementById("btnPubLookupId");
  const pubViewerNotice = document.getElementById("pubViewerNotice");
  const pubViewerNoticeText = document.getElementById("pubViewerNoticeText");
  const pubTourneyMatchesBrowser = document.getElementById("pubTourneyMatchesBrowser");
  const pubTourneyBrowserTitle = document.getElementById("pubTourneyBrowserTitle");
  const pubTourneyMatchesList = document.getElementById("pubTourneyMatchesList");

  async function handlePublicLookup(rawQuery) {
    const q = (rawQuery || "").trim();
    if (!q) {
      if (pubViewerNotice) pubViewerNotice.style.display = "none";
      if (pubTourneyMatchesBrowser) pubTourneyMatchesBrowser.style.display = "none";
      return;
    }

    // 1. Check if Query is a Tournament ID
    const matchedTourney = findTournamentByIdOrAlias(q);
    if (matchedTourney) {
      if (pubViewerNotice) pubViewerNotice.style.display = "none";
      if (pubTourneyMatchesBrowser && pubTourneyMatchesList) {
        pubTourneyMatchesBrowser.style.display = "block";
        if (pubTourneyBrowserTitle) {
          pubTourneyBrowserTitle.textContent = `${matchedTourney.name} (${matchedTourney.id})`;
        }
        pubTourneyMatchesList.innerHTML = "";

        const fixtures = matchedTourney.fixtures || [];
        if (fixtures.length === 0) {
          pubTourneyMatchesList.innerHTML = `<div style="font-size:11px; color:#888; padding:6px 0;">No fixtures scheduled in this tournament.</div>`;
        } else {
          fixtures.forEach(fix => {
            const isLive = fix.status === "LIVE";
            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.justifyContent = "space-between";
            row.style.alignItems = "center";
            row.style.padding = "6px 8px";
            row.style.background = isLive ? "#ef444414" : "#202020";
            row.style.border = isLive ? "1px solid #ef444455" : "1px solid #2a2a2a";
            row.style.borderRadius = "8px";

            row.innerHTML = `
              <div style="display:flex; flex-direction:column; gap:2px;">
                <span style="font-size:11.5px; font-weight:800; color:#fff;">${fix.teamA} vs ${fix.teamB}</span>
                <span style="font-size:10px; color:#888;">${fix.id} • ${fix.date || 'Today'} • <b style="color:${isLive ? '#ef4444' : '#94a3b8'};">${fix.status}</b></span>
              </div>
              <div>
                ${isLive ? `
                  <button type="button" class="btn-card-mini-action btn-pub-watch-fix" data-fix-id="${fix.id}" style="background:#ef4444; color:#fff; border:none; padding:4px 8px; font-size:10.5px; font-weight:800; border-radius:6px; cursor:pointer;">
                    <i class="fa-solid fa-tower-broadcast"></i> WATCH LIVE
                  </button>
                ` : `
                  <span style="font-size:10px; color:#666; font-weight:700; padding:4px 6px;">${fix.status}</span>
                `}
              </div>
            `;
            pubTourneyMatchesList.appendChild(row);
          });
        }
      }
      return;
    }

    // 2. Check Server Matches API
    const serverMatches = await RealtimeLiveService.searchServerMatches(q);
    if (serverMatches.length > 0) {
      if (pubViewerNotice) pubViewerNotice.style.display = "none";
      if (pubTourneyMatchesBrowser) pubTourneyMatchesBrowser.style.display = "none";
      const m = serverMatches[0];
      activePublicLiveModalMatchId = m.matchId;
      renderPublicLiveScoreContent(m.matchId, m.data);
      VideoViewerManager.connectToStream(m.matchId);
      return;
    }

    // 3. Check if Query is a Local Match ID
    const matchedMatch = findMatchByIdOrAlias(q);
    if (matchedMatch) {
      if (pubViewerNotice) pubViewerNotice.style.display = "none";
      if (pubTourneyMatchesBrowser) pubTourneyMatchesBrowser.style.display = "none";
      const mId = matchedMatch.matchId || matchedMatch.id;
      activePublicLiveModalMatchId = mId;
      renderPublicLiveScoreContent(mId);
      VideoViewerManager.connectToStream(mId);
      return;
    }

    // 4. Search by team / keyword in history
    const histMatches = getHistoryMatches ? getHistoryMatches() : [];
    const matchedHistory = histMatches.find(m => 
      (m.teamA?.name || "").toLowerCase().includes(q.toLowerCase()) ||
      (m.teamB?.name || "").toLowerCase().includes(q.toLowerCase()) ||
      (m.tournament || "").toLowerCase().includes(q.toLowerCase())
    );

    if (matchedHistory) {
      if (pubViewerNotice) pubViewerNotice.style.display = "none";
      if (pubTourneyMatchesBrowser) pubTourneyMatchesBrowser.style.display = "none";
      activePublicLiveModalMatchId = matchedHistory.matchId;
      renderPublicLiveScoreContent(matchedHistory.matchId);
      VideoViewerManager.connectToStream(matchedHistory.matchId);
      return;
    }

    // 5. If nothing matched: STRICT ERROR NOT FOUND BANNER
    if (pubTourneyMatchesBrowser) pubTourneyMatchesBrowser.style.display = "none";
    if (pubViewerNotice && pubViewerNoticeText) {
      pubViewerNotice.style.display = "flex";
      pubViewerNoticeText.textContent = `MATCH OR TOURNAMENT NOT FOUND (ID '${q}' does not exist)`;
    }
  }

  if (btnPubLookupId && pubLiveSearchInput) {
    btnPubLookupId.addEventListener("click", () => {
      handlePublicLookup(pubLiveSearchInput.value);
    });
    pubLiveSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        handlePublicLookup(pubLiveSearchInput.value);
      }
    });
  }

  // Handle clicking fixture watch inside public tournament browser
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-pub-watch-fix");
    if (!btn) return;
    const fixId = btn.dataset.fixId;
    if (fixId) {
      activePublicLiveModalMatchId = fixId;
      renderPublicLiveScoreContent(fixId);
      VideoViewerManager.connectToStream(fixId);
      if (pubViewerNotice) pubViewerNotice.style.display = "none";
      if (pubTourneyMatchesBrowser) pubTourneyMatchesBrowser.style.display = "none";
    }
  });

  // Public Live Score Controls
  const btnPubLiveRefresh = document.getElementById("btnPubLiveRefresh");
  if (btnPubLiveRefresh) {
    btnPubLiveRefresh.addEventListener("click", () => {
      renderPublicLiveScoreContent(activePublicLiveModalMatchId);
      showToast("Live scoreboard refreshed with latest feed");
    });
  }

  const publicLiveScoreCloseBtn = document.getElementById("publicLiveScoreCloseBtn");
  if (publicLiveScoreCloseBtn) {
    publicLiveScoreCloseBtn.addEventListener("click", () => {
      const modal = document.getElementById("publicLiveScoreModal");
      if (modal) modal.style.display = "none";
      VideoViewerManager.cleanup();
    });
  }

  // Hook Live Watch button on Fixtures
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-public-live-watch");
    if (!btn) return;
    const fId = btn.dataset.fixtureId;
    openPublicLiveScoreModal(fId);
  });

  // =========================================================================
  // 14. UNIFIED LIVE BROADCAST CENTER STUDIO CONTROLLER
  // =========================================================================

  function normalizeId(id) {
    return (id || "").toString().trim().toLowerCase();
  }

  function findMatchByIdOrAlias(query) {
    if (!query) return null;
    const q = normalizeId(query);

    // 1. Check current active match
    const active = getActiveMatch ? getActiveMatch() : null;
    if (active) {
      const actId = normalizeId(active.matchId || active.id || "match_active");
      if (actId === q || q === "match-001" || q === "match-101" || q === "live" || q === "active") {
        return active;
      }
    }

    // 2. Check history matches
    const historyList = getHistoryMatches ? getHistoryMatches() : [];
    for (let idx = 0; idx < historyList.length; idx++) {
      const m = historyList[idx];
      const mId = normalizeId(m.matchId || m.id || `match_${idx + 1}`);
      const aliasId = `match-${String(idx + 1).padStart(3, '0')}`;
      const aliasIdShort = `match-${idx + 1}`;
      if (mId === q || aliasId === q || aliasIdShort === q) {
        return m;
      }
    }

    // 3. Check tournament fixtures across all tournaments
    const tourneys = getTournamentsList ? getTournamentsList() : [];
    for (const t of tourneys) {
      if (t.fixtures && Array.isArray(t.fixtures)) {
        for (let fIdx = 0; fIdx < t.fixtures.length; fIdx++) {
          const f = t.fixtures[fIdx];
          const fId = normalizeId(f.id || `fix_${fIdx + 1}`);
          const fAlias = `match-${String(fIdx + 1).padStart(3, '0')}`;
          if (fId === q || fAlias === q || f.matchId === query) {
            return convertFixtureToMatchData(f, t);
          }
        }
      }
    }

    return null;
  }

  function findTournamentByIdOrAlias(query) {
    if (!query) return null;
    const q = normalizeId(query);
    const tourneys = getTournamentsList ? getTournamentsList() : [];

    for (let idx = 0; idx < tourneys.length; idx++) {
      const t = tourneys[idx];
      const tId = normalizeId(t.id || `tourney_${idx + 1}`);
      const alias = `tournament-${String(idx + 1).padStart(3, '0')}`;
      const aliasShort = `tournament-${idx + 1}`;
      const aliasT = `t-${idx + 1}`;
      const nameCode = normalizeId(t.name || "").replace(/\s+/g, '-');
      if (tId === q || alias === q || aliasShort === q || aliasT === q || nameCode.includes(q) || q.includes(tId)) {
        return t;
      }
    }
    return null;
  }

  function convertFixtureToMatchData(fix, tourney) {
    if (!fix) return null;

    // 1. Check if real completed match exists in match history
    try {
      const history = typeof getMatchHistoryList === "function" ? getMatchHistoryList() : [];
      const histMatch = history.find(m => m.matchId === fix.id || m.fixtureId === fix.id || (m.tournamentId === tourney?.id && ((m.teamA?.name === fix.teamA && m.teamB?.name === fix.teamB) || (m.teamA?.name === fix.teamB && m.teamB?.name === fix.teamA)) && m.status === "COMPLETED"));
      if (histMatch) return histMatch;
    } catch (e) {}

    // 2. Check if active match already exists in active match storage
    try {
      const activeSaved = localStorage.getItem("cricYuvaActiveMatch");
      if (activeSaved) {
        const parsed = JSON.parse(activeSaved);
        if (parsed && (parsed.matchId === fix.id || parsed.fixtureId === fix.id)) {
          return parsed;
        }
      }
    } catch (e) {}

    // Resolve real squad players from team A & team B
    const allClubs = typeof getAvailableClubsList === "function" ? getAvailableClubsList() : [];
    const teamAObj = (tourney?.teams || []).find(t => (typeof t === "object" ? t.name : t) === fix.teamA) || allClubs.find(c => c.name === fix.teamA);
    const teamBObj = (tourney?.teams || []).find(t => (typeof t === "object" ? t.name : t) === fix.teamB) || allClubs.find(c => c.name === fix.teamB);

    const squadA = (typeof teamAObj === "object" && Array.isArray(teamAObj.players)) ? teamAObj.players : [];
    const squadB = (typeof teamBObj === "object" && Array.isArray(teamBObj.players)) ? teamBObj.players : [];

    const inn1 = createInningsStructure(fix.teamA, fix.teamB, squadA, squadB);

    return {
      matchId: fix.id,
      fixtureId: fix.id,
      tournament: tourney?.name || "Tournament Match",
      tournamentId: tourney?.id || null,
      tourneyId: tourney?.id || null,
      teamA: {
        id: teamAObj?.id || null,
        name: fix.teamA,
        logo: (typeof teamAObj === "object" && teamAObj?.logo) ? teamAObj.logo : "🏏",
        players: squadA,
        playingXi: squadA
      },
      teamB: {
        id: teamBObj?.id || null,
        name: fix.teamB,
        logo: (typeof teamBObj === "object" && teamBObj?.logo) ? teamBObj.logo : "🏏",
        players: squadB,
        playingXi: squadB
      },
      ground: fix.ground || (tourney?.grounds?.[0]) || "Yuva Stadium",
      date: fix.date || "Today",
      time: fix.time || "14:30",
      status: fix.status || "UPCOMING",
      result: fix.resultText || null,
      winner: fix.winner || null,
      overs: tourney?.overs || 20,
      currentInningIndex: 1,
      innings1: inn1,
      innings2: null,
      historyStack: []
    };
  }

  // Active Broadcast State
  let currentBroadcastSource = null; // { type: "SINGLE_MATCH" | "TOURNAMENT", tournamentId: null, matchId: "...", matchData: {...} }
  let selectedCameraIngest = "BACK_CAMERA";

  // ==========================================
  // USER-ISOLATED SOCIAL ACCOUNTS & OAUTH
  // ==========================================

  function getCurrentCricYuvaUserId() {
    let uId = localStorage.getItem("cricYuvaUserId");
    if (!uId) {
      const mob = localStorage.getItem("cricYuvaProfileMobile") || localStorage.getItem("cricYuvaMobile");
      const email = localStorage.getItem("cricYuvaProfileEmail");
      if (mob && mob.trim()) {
        uId = "user_" + mob.trim().replace(/\D/g, "");
      } else if (email && email.trim()) {
        uId = "user_" + email.trim().replace(/[^a-zA-Z0-9]/g, "_");
      } else {
        uId = "user_" + Math.random().toString(36).substring(2, 10);
      }
      localStorage.setItem("cricYuvaUserId", uId);
    }
    return uId;
  }

  // Cleanup obsolete fake social account keys from localStorage
  try {
    Object.keys(localStorage).forEach(k => {
      if (k && k.startsWith("cricYuvaSocialAccounts_")) {
        localStorage.removeItem(k);
      }
    });
  } catch (e) {}

  // ==========================================
  // MOBILE-FIRST SOCIAL LIVE STREAM DEEP-LINKING
  // ==========================================

  function launchSocialLiveStreamApp(platform, matchId = null) {
    const p = String(platform || "").toLowerCase();
    let platformLabel = "Live Stream";
    let webUrl = "https://studio.youtube.com/";

    const effectiveMatchId = matchId ||
      (currentBroadcastSource && currentBroadcastSource.matchId) ||
      (typeof getActiveMatch === "function" && getActiveMatch()?.matchId) ||
      "MATCH-001";

    const viewerLink = `${window.location.origin}${window.location.pathname}?view=live&matchId=${encodeURIComponent(effectiveMatchId)}`;

    if (p.includes("yt") || p.includes("youtube")) {
      platformLabel = "YouTube";
      webUrl = "https://studio.youtube.com/";
    } else if (p.includes("insta") || p.includes("instagram")) {
      platformLabel = "Instagram";
      webUrl = "https://www.instagram.com/";
    } else if (p.includes("fb") || p.includes("facebook")) {
      platformLabel = "Facebook";
      webUrl = "https://www.facebook.com/live/producer";
    }

    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(viewerLink).catch(() => {});
      }
    } catch (e) {}

    showToast(`Opening ${platformLabel}... Live score link copied to clipboard!`);

    const opened = window.open(webUrl, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.href = webUrl;
    }
  }

  // ==========================================
  // BROADCAST CENTER CONTROLLER
  // ==========================================

  function openBroadcastCenterModal(initialSourceType = "SINGLE_MATCH", initialId = null, preferredPlatform = null) {
    const modal = document.getElementById("broadcastCenterModal");
    if (!modal) return;

    modal.style.display = "flex";

    // 1. Initialize Camera Preview
    VideoBroadcastManager.startCamera("environment");

    // 2. Populate Dropdowns
    populateBroadcastSingleMatchesDropdown();

    // 3. Resolve Match to load
    let resolvedMatchId = initialId;
    if (!resolvedMatchId) {
      const activeM = typeof getActiveMatch === "function" ? getActiveMatch() : null;
      if (activeM) {
        resolvedMatchId = activeM.matchId || activeM.id || "MATCH-001";
      } else {
        resolvedMatchId = "MATCH-001";
      }
    }

    // 4. Handle initial source tab
    if (initialSourceType === "TOURNAMENT" && initialId) {
      switchBroadcastSourceTab("TOURNAMENT");
      populateBroadcastTournamentsDropdown(initialId);
    } else {
      switchBroadcastSourceTab("SINGLE_MATCH");
      populateBroadcastTournamentsDropdown(null);
      const inputMatchId = document.getElementById("inputBroadcastMatchId");
      if (inputMatchId) inputMatchId.value = resolvedMatchId;
      loadBroadcastMatchById(resolvedMatchId);
    }

    // Update Match ID Badge in Quick Share widget
    const idBadge = document.getElementById("bCurrentMatchIdBadge");
    if (idBadge && resolvedMatchId) {
      idBadge.textContent = resolvedMatchId;
    }

    // If user clicked a direct social button on Home screen, launch that platform
    if (preferredPlatform) {
      launchSocialLiveStreamApp(preferredPlatform, resolvedMatchId);
    }
  }

  function switchBroadcastSourceTab(tabType) {
    const tabSingle = document.getElementById("tabBroadcastSingle");
    const tabTourney = document.getElementById("tabBroadcastTourney");
    const secSingle = document.getElementById("broadcastSingleMatchSection");
    const secTourney = document.getElementById("broadcastTourneySection");

    if (tabType === "SINGLE_MATCH") {
      if (tabSingle) tabSingle.classList.add("active");
      if (tabTourney) tabTourney.classList.remove("active");
      if (secSingle) secSingle.style.display = "block";
      if (secTourney) secTourney.style.display = "none";
    } else {
      if (tabSingle) tabSingle.classList.remove("active");
      if (tabTourney) tabTourney.classList.add("active");
      if (secSingle) secSingle.style.display = "none";
      if (secTourney) secTourney.style.display = "block";
    }
  }

  function populateBroadcastSingleMatchesDropdown() {
    const matchSelect = document.getElementById("broadcastMatchSelect");
    if (!matchSelect) return;

    matchSelect.innerHTML = '<option value="">-- Choose from your active or recent matches --</option>';

    const activeM = getActiveMatch ? getActiveMatch() : null;
    if (activeM) {
      const mId = activeM.matchId || activeM.id || "MATCH-001";
      const tA = activeM.teamA?.name || activeM.teamA || "Team Alpha";
      const tB = activeM.teamB?.name || activeM.teamB || "Team Beta";
      matchSelect.innerHTML += `<option value="${mId}">🔴 ACTIVE MATCH: ${tA} vs ${tB} [${mId}]</option>`;
    }

    const historyMatches = getHistoryMatches ? getHistoryMatches() : [];
    historyMatches.forEach(m => {
      const mId = m.matchId || m.id;
      const tA = m.teamA?.name || m.teamA || "Team Alpha";
      const tB = m.teamB?.name || m.teamB || "Team Beta";
      if (!activeM || (activeM.matchId !== mId && activeM.id !== mId)) {
        matchSelect.innerHTML += `<option value="${mId}">${tA} vs ${tB} [${mId}]</option>`;
      }
    });

  }

  function populateBroadcastTournamentsDropdown(selectedTourneyId = null) {
    const tourneySelect = document.getElementById("broadcastTourneySelect");
    if (!tourneySelect) return;

    tourneySelect.innerHTML = '<option value="">-- Choose a Tournament --</option>';
    const tournaments = getTournamentsList ? getTournamentsList() : [];

    tournaments.forEach(t => {
      tourneySelect.innerHTML += `<option value="${t.id}" ${t.id === selectedTourneyId ? "selected" : ""}>🏆 ${t.name} (${t.fixtures ? t.fixtures.length : 0} Matches)</option>`;
    });

    if (selectedTourneyId) {
      populateTournamentFixturesDropdown(selectedTourneyId);
    }
  }

  function populateTournamentFixturesDropdown(tournamentId) {
    const container = document.getElementById("broadcastTourneyMatchesContainer");
    const fixturesListEl = document.getElementById("broadcastTourneyFixturesList");
    const liveCountBadge = document.getElementById("bTourneyLiveMatchesCount");
    if (!container || !fixturesListEl) return;

    if (!tournamentId) {
      container.style.display = "none";
      return;
    }

    const tournaments = getTournamentsList ? getTournamentsList() : [];
    const tourney = tournaments.find(t => t.id === tournamentId);
    if (!tourney || !tourney.fixtures || tourney.fixtures.length === 0) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    fixturesListEl.innerHTML = "";

    let liveCount = 0;
    tourney.fixtures.forEach(f => {
      const isLive = f.status === "LIVE" || f.status === "IN_PROGRESS";
      if (isLive) liveCount++;
      const statusBadge = isLive 
        ? '<span style="background:#ef444422; color:#ef4444; padding:2px 6px; border-radius:4px; font-weight:800; font-size:10px;">🔴 LIVE</span>' 
        : (f.status === "COMPLETED" 
            ? '<span style="background:#22c55e22; color:#22c55e; padding:2px 6px; border-radius:4px; font-weight:800; font-size:10px;">COMPLETED</span>' 
            : '<span style="background:#3b82f622; color:#38bdf8; padding:2px 6px; border-radius:4px; font-weight:800; font-size:10px;">UPCOMING</span>');

      const card = document.createElement("div");
      card.className = "b-fixture-select-card";
      card.style.cssText = "background:#1a1e2b; border:1px solid #2b3348; border-radius:8px; padding:10px; margin-bottom:6px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;";
      card.innerHTML = `
        <div>
          <div style="font-size:12px; font-weight:800; color:#fff;">${f.teamA} vs ${f.teamB}</div>
          <small style="font-size:10px; color:#8c93a4;">Match #${f.matchNumber || f.id} • ${f.ground || "Yuva Stadium"}</small>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${statusBadge}
          <button type="button" class="btn-card-mini-action" style="font-size:10.5px; font-weight:800; padding:4px 8px;">Select</button>
        </div>
      `;
      card.addEventListener("click", () => {
        loadBroadcastMatchById(f.id);
        const idBadge = document.getElementById("bCurrentMatchIdBadge");
        if (idBadge) idBadge.textContent = f.id;
      });
      fixturesListEl.appendChild(card);
    });

    if (liveCountBadge) {
      liveCountBadge.textContent = `${liveCount} LIVE`;
      liveCountBadge.style.display = liveCount > 0 ? "inline-block" : "none";
    }
  }

  async function loadBroadcastMatchById(matchId) {
    const notice = document.getElementById("broadcastMatchNotice");
    const noticeText = document.getElementById("broadcastMatchNoticeText");
    const linkedBanner = document.getElementById("broadcastLinkedBanner");
    const linkedBannerText = document.getElementById("broadcastLinkedBannerText");

    if (!matchId) return;
    const cleanId = matchId.trim().toUpperCase();

    // 1. Try local active match
    let matchData = null;
    const activeM = getActiveMatch ? getActiveMatch() : null;
    if (activeM && (activeM.matchId?.toUpperCase() === cleanId || activeM.id?.toUpperCase() === cleanId)) {
      matchData = activeM;
    }

    // 2. Try history matches
    if (!matchData) {
      const hist = getHistoryMatches ? getHistoryMatches() : [];
      matchData = hist.find(m => m.matchId?.toUpperCase() === cleanId || m.id?.toUpperCase() === cleanId);
    }

    // 3. Try Tournament fixtures
    if (!matchData) {
      const tourneys = getTournamentsList ? getTournamentsList() : [];
      for (const t of tourneys) {
        const fix = (t.fixtures || []).find(f => f.id?.toUpperCase() === cleanId);
        if (fix) {
          matchData = convertFixtureToMatchData(fix, t);
          break;
        }
      }
    }

    // 4. Try REST Server
    if (!matchData) {
      try {
        const res = await fetch(`/api/live/match/${cleanId}`);
        const data = await res.json();
        if (data.success && data.match) {
          matchData = data.match;
        }
      } catch (err) {}
    }

    if (!matchData) {
      if (notice && noticeText) {
        noticeText.textContent = `Match ID '${cleanId}' not found in active matches or server store.`;
        notice.style.display = "flex";
      }
      if (linkedBanner) linkedBanner.style.display = "none";
      currentBroadcastSource = null;
      return;
    }

    // Match Found
    if (notice) notice.style.display = "none";
    if (linkedBanner) {
      linkedBanner.style.display = "flex";
      const tA = matchData.teamA?.name || matchData.teamA || "Team Alpha";
      const tB = matchData.teamB?.name || matchData.teamB || "Team Beta";
      if (linkedBannerText) {
        linkedBannerText.textContent = `Source Connected: ${cleanId} (${tA} vs ${tB})`;
      }
    }

    currentBroadcastSource = {
      type: "SINGLE_MATCH",
      id: cleanId,
      matchId: cleanId,
      tournamentId: matchData.tournamentId || null,
      matchData: matchData
    };

    const idBadge = document.getElementById("bCurrentMatchIdBadge");
    if (idBadge) idBadge.textContent = cleanId;

    // Update overlay in Broadcast preview
    updateBroadcastPreviewOverlay(matchData);
  }

  function updateBroadcastPreviewOverlay(matchData) {
    if (!matchData) return;
    const tA = matchData.teamA?.name || matchData.teamA || "Team Alpha";
    const tB = matchData.teamB?.name || matchData.teamB || "Team Beta";
    
    const currInnNum = matchData.currentInnings || 1;
    const currInn = currInnNum === 2 ? (matchData.innings2 || {}) : (matchData.innings1 || {});
    const batTeam = currInn.battingTeam || tA;
    const runs = currInn.totalRuns || 0;
    const wkts = currInn.wickets || 0;
    const ovs = currInn.overs || 0;
    const bls = currInn.balls || 0;

    const bTitle = document.getElementById("bOverlayMatchTitle");
    const bBatTeam = document.getElementById("bOverlayBatTeam");
    const bScore = document.getElementById("bOverlayScore");
    const bOvers = document.getElementById("bOverlayOvers");

    if (bTitle) bTitle.textContent = `${matchData.matchId || "MATCH"} • ${tA} vs ${tB}`;
    if (bBatTeam) bBatTeam.textContent = batTeam;
    if (bScore) bScore.textContent = `${runs}/${wkts}`;
    if (bOvers) bOvers.textContent = `(${ovs}.${bls} / ${matchData.overs || 20} Ov)`;
  }

  // Camera & Lens Switching
  const btnCamBack = document.getElementById("btnCamBack");
  const btnCamFront = document.getElementById("btnCamFront");
  const btnCamMute = document.getElementById("btnCamMute");

  if (btnCamBack && btnCamFront) {
    btnCamBack.addEventListener("click", () => {
      selectedCameraIngest = "BACK_CAMERA";
      btnCamBack.classList.add("active");
      btnCamFront.classList.remove("active");
      VideoBroadcastManager.startCamera("environment");
    });

    btnCamFront.addEventListener("click", () => {
      selectedCameraIngest = "FRONT_CAMERA";
      btnCamFront.classList.add("active");
      btnCamBack.classList.remove("active");
      VideoBroadcastManager.startCamera("user");
    });
  }

  if (btnCamMute) {
    btnCamMute.addEventListener("click", () => {
      VideoBroadcastManager.toggleMuteAudio();
    });
  }

  // Source Type Tabs
  const tabBroadcastSingle = document.getElementById("tabBroadcastSingle");
  const tabBroadcastTourney = document.getElementById("tabBroadcastTourney");
  if (tabBroadcastSingle && tabBroadcastTourney) {
    tabBroadcastSingle.addEventListener("click", () => switchBroadcastSourceTab("SINGLE_MATCH"));
    tabBroadcastTourney.addEventListener("click", () => switchBroadcastSourceTab("TOURNAMENT"));
  }

  // Single Match Load
  const btnLoadBroadcastMatch = document.getElementById("btnLoadBroadcastMatch");
  const inputBroadcastMatchId = document.getElementById("inputBroadcastMatchId");
  const broadcastMatchSelect = document.getElementById("broadcastMatchSelect");

  if (btnLoadBroadcastMatch && inputBroadcastMatchId) {
    btnLoadBroadcastMatch.addEventListener("click", () => {
      loadBroadcastMatchById(inputBroadcastMatchId.value);
    });
  }

  if (broadcastMatchSelect && inputBroadcastMatchId) {
    broadcastMatchSelect.addEventListener("change", () => {
      if (broadcastMatchSelect.value) {
        inputBroadcastMatchId.value = broadcastMatchSelect.value;
        loadBroadcastMatchById(broadcastMatchSelect.value);
      }
    });
  }

  // Tournament & Fixture Select
  const broadcastTourneySelect = document.getElementById("broadcastTourneySelect");
  if (broadcastTourneySelect) {
    broadcastTourneySelect.addEventListener("change", () => {
      populateTournamentFixturesDropdown(broadcastTourneySelect.value);
    });
  }

  // Social Deep Link Buttons
  const btnLaunchYouTubeLive = document.getElementById("btnLaunchYouTubeLive");
  if (btnLaunchYouTubeLive) {
    btnLaunchYouTubeLive.addEventListener("click", () => {
      launchSocialLiveStreamApp("youtube");
    });
  }

  const btnLaunchInstagramLive = document.getElementById("btnLaunchInstagramLive");
  if (btnLaunchInstagramLive) {
    btnLaunchInstagramLive.addEventListener("click", () => {
      launchSocialLiveStreamApp("instagram");
    });
  }

  const btnLaunchFacebookLive = document.getElementById("btnLaunchFacebookLive");
  if (btnLaunchFacebookLive) {
    btnLaunchFacebookLive.addEventListener("click", () => {
      launchSocialLiveStreamApp("facebook");
    });
  }

  // Quick Copy Match ID & Score Link Chips
  const btnCopyBroadcastMatchId = document.getElementById("btnCopyBroadcastMatchId");
  if (btnCopyBroadcastMatchId) {
    btnCopyBroadcastMatchId.addEventListener("click", () => {
      const activeId = (currentBroadcastSource && currentBroadcastSource.matchId) ||
                       (typeof getActiveMatch === "function" && getActiveMatch()?.matchId) ||
                       "MATCH-001";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(activeId).then(() => {
          showToast(`Match ID '${activeId}' copied to clipboard!`);
        }).catch(() => {
          showToast(`Match ID: ${activeId}`);
        });
      } else {
        showToast(`Match ID: ${activeId}`);
      }
    });
  }

  const btnCopyBroadcastScoreLink = document.getElementById("btnCopyBroadcastScoreLink");
  if (btnCopyBroadcastScoreLink) {
    btnCopyBroadcastScoreLink.addEventListener("click", () => {
      const activeId = (currentBroadcastSource && currentBroadcastSource.matchId) ||
                       (typeof getActiveMatch === "function" && getActiveMatch()?.matchId) ||
                       "MATCH-001";
      const viewerUrl = `${window.location.origin}${window.location.pathname}?view=live&matchId=${encodeURIComponent(activeId)}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(viewerUrl).then(() => {
          showToast("Live scoreboard link copied to clipboard!");
        }).catch(() => {
          prompt("Copy Live Score Link:", viewerUrl);
        });
      } else {
        prompt("Copy Live Score Link:", viewerUrl);
      }
    });
  }

  // Start / Stop Broadcast Session
  const btnStartBroadcastSession = document.getElementById("btnStartBroadcastSession");
  const btnStopBroadcastSession = document.getElementById("btnStopBroadcastSession");
  const bSessionStatusText = document.getElementById("bSessionStatusText");

  if (btnStartBroadcastSession && btnStopBroadcastSession) {
    btnStartBroadcastSession.addEventListener("click", async () => {
      if (!currentBroadcastSource || !currentBroadcastSource.matchId) {
        alert("Please load a valid Match ID or select a Tournament fixture before starting the broadcast.");
        return;
      }

      btnStartBroadcastSession.disabled = true;
      btnStartBroadcastSession.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> STARTING...';

      const success = await VideoBroadcastManager.startBroadcast({
        matchId: currentBroadcastSource.matchId,
        tournamentId: currentBroadcastSource.tournamentId || null,
        destinations: ["CRIC_YUVA_LIVE"],
        sourceType: currentBroadcastSource.type
      });

      btnStartBroadcastSession.disabled = false;
      btnStartBroadcastSession.innerHTML = '<i class="fa-solid fa-circle-play"></i> START BROADCAST';

      if (!success) return;

      const sessionObj = {
        id: "bcast_" + Date.now(),
        userId: getCurrentCricYuvaUserId(),
        sourceType: currentBroadcastSource.type,
        tournamentId: currentBroadcastSource.tournamentId || null,
        matchId: currentBroadcastSource.matchId,
        cameraSlot: selectedCameraIngest,
        destinations: ["CRIC_YUVA_LIVE"],
        status: "LIVE",
        startedAt: new Date().toISOString()
      };

      try {
        localStorage.setItem("cricYuvaActiveBroadcastSession", JSON.stringify(sessionObj));
      } catch (e) {}

      if (bSessionStatusText) {
        bSessionStatusText.innerHTML = `🔴 <span style="color:#ef4444; font-weight:900;">LIVE BROADCASTING</span> (${currentBroadcastSource.matchId})`;
      }

      btnStartBroadcastSession.style.display = "none";
      btnStopBroadcastSession.style.display = "inline-flex";

      showToast(`🔴 Live broadcast active! Camera stream with live score overlay is broadcasting.`);
    });

    btnStopBroadcastSession.addEventListener("click", async () => {
      await VideoBroadcastManager.stopBroadcast();

      try {
        localStorage.removeItem("cricYuvaActiveBroadcastSession");
      } catch (e) {}

      if (bSessionStatusText) {
        bSessionStatusText.textContent = "● IDLE (Ready to Stream)";
      }

      btnStartBroadcastSession.style.display = "inline-flex";
      btnStopBroadcastSession.style.display = "none";

      showToast("⏹ Live Broadcast session stopped.");
    });
  }

  // Copy Public Viewer URL
  const btnCopyBroadcastViewerLink = document.getElementById("btnCopyBroadcastViewerLink");
  if (btnCopyBroadcastViewerLink) {
    btnCopyBroadcastViewerLink.addEventListener("click", () => {
      const mId = currentBroadcastSource?.matchId || "MATCH-001";
      const viewerUrl = `${window.location.origin}${window.location.pathname}?matchId=${mId}`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(viewerUrl).then(() => {
          showToast(`📋 Public Viewer Link copied: ${mId}`);
        }).catch(() => {
          prompt("Copy Public Live Viewer Link:", viewerUrl);
        });
      } else {
        prompt("Copy Public Live Viewer Link:", viewerUrl);
      }
    });
  }

  const btnQrBroadcastViewerLink = document.getElementById("btnQrBroadcastViewerLink");
  if (btnQrBroadcastViewerLink) btnQrBroadcastViewerLink.addEventListener("click", () => {
    const mId = currentBroadcastSource?.matchId;
    if (mId) openShareQr("Live Match: " + mId, buildShareUrl("live", mId));
    else showToast("Start or select a live match first.", true);
  });

  // Close Broadcast Center
  const broadcastCloseBtn = document.getElementById("broadcastCloseBtn");
  if (broadcastCloseBtn) {
    broadcastCloseBtn.addEventListener("click", () => {
      const modal = document.getElementById("broadcastCenterModal");
      if (modal) modal.style.display = "none";
      if (!VideoBroadcastManager.isBroadcasting) {
        VideoBroadcastManager.stopCamera();
      }
    });
  }

  async function hydrateCloudData() {
    if (!localStorage.getItem("cricYuvaCloudToken")) return;
    try {
      const data = await CricYuvaCloud.request("/api/tournaments");
      const local = getTournamentsList(); const byId = new Map(local.map(t => [t.id, t]));
      (data.tournaments || []).forEach(t => { if (t?.id && !byId.has(t.id)) byId.set(t.id, t); });
      saveTournamentsList([...byId.values()]);
    } catch (e) {}
    try {
      const data = await CricYuvaCloud.request("/api/teams");
      const local = getCustomClubsList(); const byName = new Map(local.map(t => [String(t.name || "").toLowerCase(), t]));
      (data.teams || []).forEach(t => { if (t?.name) byName.set(String(t.name).toLowerCase(), t); });
      localStorage.setItem("cric_yuva_custom_clubs", JSON.stringify([...byName.values()]));
    } catch (e) {}
  }

  function rememberInvite(type, id) {
    try { localStorage.setItem("cricYuvaPendingInvite", JSON.stringify({ type, id })); } catch (e) {}
  }
  async function processPendingInvite() {
    let invite = null;
    try { invite = JSON.parse(localStorage.getItem("cricYuvaPendingInvite") || "null"); } catch (e) {}
    if (!invite || !invite.id || !localStorage.getItem("cricYuvaCloudToken")) return;
    try {
      if (invite.type === "team") await CricYuvaCloud.joinTeam({ teamId: invite.id });
      else if (invite.type === "tournament") await CricYuvaCloud.joinTournament({ tournamentId: invite.id });
      else if (invite.type === "player") await CricYuvaCloud.playerRequest({ playerId: invite.id });
      localStorage.removeItem("cricYuvaPendingInvite");
      showToast("Invite request sent successfully.");
    } catch (e) {}
  }

  // ==========================================
  // GLOBAL SEARCH + SHARE/QR ACTIONS
  // ==========================================
  hydrateCloudData().finally(() => processPendingInvite());

  const globalSearchBtn = document.getElementById("globalSearchBtn");
  const globalSearchModal = document.getElementById("globalSearchModal");
  const globalSearchInput = document.getElementById("globalSearchInput");
  const globalSearchResults = document.getElementById("globalSearchResults");
  function renderGlobalSearch(query) {
    if (!globalSearchResults) return;
    const q = String(query || "").trim().toLowerCase();
    const rows = [];
    getTournamentsList().forEach(t => {
      if (!q || t.name.toLowerCase().includes(q)) rows.push({ type: "Tournament", name: t.name, action: () => openTournamentDetails(t.id) });
      (t.teams || []).forEach(tm => {
        if (tm.name && (!q || tm.name.toLowerCase().includes(q))) rows.push({ type: "Team", name: tm.name, action: () => openTournamentDetails(t.id, "teams") });
        (tm.players || []).forEach(p => {
          if (p.name && (!q || p.name.toLowerCase().includes(q) || String(p.id || "").toLowerCase().includes(q))) rows.push({ type: "Player", name: p.name, action: () => openPlayerProfileDetailModal(p.id || p.name) });
        });
      });
    });
    const team = getTeamData();
    if (team) {
      if (!q || team.teamName.toLowerCase().includes(q)) rows.push({ type: "My Team", name: team.teamName, action: () => showScreen("screen6") });
      (team.players || []).forEach(p => { if (p.name && (!q || p.name.toLowerCase().includes(q) || String(p.id || "").toLowerCase().includes(q))) rows.push({ type: "Player", name: p.name, action: () => openPlayerProfileDetailModal(p.id || p.name) }); });
    }
    const unique = []; const seen = new Set();
    rows.forEach(r => { const k = `${r.type}:${r.name}`; if (!seen.has(k)) { seen.add(k); unique.push(r); } });
    globalSearchResults.innerHTML = unique.slice(0, 30).map((r, i) => `<button type="button" class="global-search-result" data-i="${i}"><span>${escapeHtml(r.type)}</span><b>${escapeHtml(r.name)}</b></button>`).join("") || `<div class="global-search-empty">No real teams, players or tournaments found.</div>`;
    globalSearchResults.querySelectorAll(".global-search-result").forEach((el, i) => el.addEventListener("click", () => { unique[i].action(); if (globalSearchModal) globalSearchModal.style.display = "none"; }));
  }
  if (globalSearchBtn && globalSearchModal) {
    globalSearchBtn.addEventListener("click", () => { globalSearchModal.style.display = "flex"; if (globalSearchInput) { globalSearchInput.value = ""; renderGlobalSearch(""); globalSearchInput.focus(); } });
  }
  if (globalSearchInput) globalSearchInput.addEventListener("input", () => renderGlobalSearch(globalSearchInput.value));
  document.getElementById("globalSearchCloseBtn")?.addEventListener("click", () => { if (globalSearchModal) globalSearchModal.style.display = "none"; });

  document.getElementById("shareQrCloseBtn")?.addEventListener("click", () => { document.getElementById("cricYuvaShareQrModal").style.display = "none"; });
  document.getElementById("shareQrCopyBtn")?.addEventListener("click", () => { const v = document.getElementById("shareQrUrl")?.value || ""; if (navigator.clipboard) navigator.clipboard.writeText(v).then(() => showToast("Link copied!")); });
  document.getElementById("shareQrShareBtn")?.addEventListener("click", () => { const v = document.getElementById("shareQrUrl")?.value || ""; shareCurrentUrl(v, document.getElementById("shareQrTitle")?.textContent || "Cric Yuva"); });

  const teamShareBtn = document.getElementById("btnTeamShareQr");
  if (teamShareBtn) teamShareBtn.addEventListener("click", () => { const team = getTeamData(); if (team?.teamName) openShareQr("Join Team: " + team.teamName, buildShareUrl("joinTeam", team.id || team.teamName)); else showToast("Create your real team first.", true); });

  const appShareBtn = document.getElementById("btnAppShare");
  if (appShareBtn) appShareBtn.addEventListener("click", () => openShareQr("Open / Download Cric Yuva", buildShareUrl("download", "cric-yuva")));

  const playerRequestBtn = document.getElementById("btnPlayerRequestQr");
  if (playerRequestBtn) playerRequestBtn.addEventListener("click", () => {
    if (!currentDetailPlayerId) return;
    openShareQr("Player Request: " + currentDetailPlayerId, buildShareUrl("playerRequest", currentDetailPlayerId));
  });


  // Auto-open via URL query parameters on page load
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const qMatchId = urlParams.get("matchId") || urlParams.get("match");
    const qTourneyId = urlParams.get("tourneyId") || urlParams.get("tournamentId");
    const qBroadcast = urlParams.get("broadcast") || urlParams.get("studio");
    const qJoinTeam = urlParams.get("joinTeam");
    const qJoinTournament = urlParams.get("joinTournament");
    const qPlayerRequest = urlParams.get("playerRequest");
    const qLive = urlParams.get("live");

    if (qJoinTeam) {
      rememberInvite("team", qJoinTeam);
      setTimeout(async () => {
        try { await CricYuvaCloud.joinTeam({ teamId: qJoinTeam, userId: localStorage.getItem("cricYuvaCloudUserId") || "" }); showToast("Team join request sent successfully."); }
        catch (e) { showToast("Team join link received. Please log in to send the request."); }
      }, 500);
    } else if (qJoinTournament) {
      rememberInvite("tournament", qJoinTournament);
      setTimeout(async () => {
        try { await CricYuvaCloud.joinTournament({ tournamentId: qJoinTournament, userId: localStorage.getItem("cricYuvaCloudUserId") || "" }); showToast("Tournament join request sent successfully."); }
        catch (e) { showToast("Tournament join link received. Please log in to join."); }
      }, 500);
    } else if (qPlayerRequest) {
      rememberInvite("player", qPlayerRequest);
      setTimeout(async () => {
        try { await CricYuvaCloud.playerRequest({ playerId: qPlayerRequest, requesterId: localStorage.getItem("cricYuvaCloudUserId") || "" }); showToast("Player request sent successfully."); }
        catch (e) { showToast("Player request link received. Please log in to send it."); }
      }, 500);
    } else if (qLive) {
      setTimeout(() => openPublicLiveScoreModal(qLive), 500);
    } else if (qBroadcast) {
      setTimeout(() => {
        openBroadcastCenterModal(qTourneyId ? "TOURNAMENT" : "SINGLE_MATCH", qTourneyId || qMatchId);
      }, 500);
    } else if (qMatchId) {
      setTimeout(() => {
        openPublicLiveScoreModal(qMatchId);
      }, 500);
    } else if (qTourneyId) {
      setTimeout(() => {
        openPublicLiveScoreModal(qTourneyId);
      }, 500);
    }
  } catch (e) {}


  // ==========================================
  // MASTER PLAYER DIRECTORY & SEARCH TO SQUAD
  // ==========================================
  function getMasterPlayerDirectory() {
    const out = [];
    const seen = new Set();
    const add = (p, teamName = "") => {
      if (!p || !p.name) return;
      const id = String(p.id || `${teamName}_${p.name}`).trim();
      const key = id.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ ...p, id, team: p.team || teamName });
    };
    const myTeam = getTeamData();
    if (myTeam) (myTeam.players || []).forEach(p => add(p, myTeam.teamName || ""));
    getCustomClubsList().forEach(c => (c.players || []).forEach(p => add(p, c.name || "")));
    getTournamentsList().forEach(t => (t.teams || []).forEach(tm =>
      (tm.players || []).forEach(p => add(p, tm.name || ""))
    ));
    return out;
  }

  function addPlayerFromDirectoryToSquad(playerId) {
    const directory = getMasterPlayerDirectory();
    const masterPlayer = directory.find(p => p.id === playerId);
    if (!masterPlayer) return;

    const team = getTeamData() || initDefaultTeam();
    if (!team.players) team.players = [];

    if (team.players.some(p => p.name.toLowerCase().trim() === masterPlayer.name.toLowerCase().trim() || p.id === masterPlayer.id)) {
      showToast(`${masterPlayer.name} is already in your squad!`);
      return;
    }

    const currentXI = team.players.filter(p => p.inPlayingXI !== false);
    const newPlayer = {
      id: "p_" + Date.now(),
      name: masterPlayer.name,
      role: masterPlayer.role,
      jersey: masterPlayer.jersey,
      batStyle: masterPlayer.batStyle,
      bowlStyle: masterPlayer.bowlStyle,
      isCaptain: false,
      isViceCaptain: false,
      photo: "",
      inPlayingXI: currentXI.length < 11,
      matches: masterPlayer.matches,
      runs: masterPlayer.runs,
      hs: masterPlayer.hs,
      avg: masterPlayer.avg,
      sr: masterPlayer.sr,
      fifties: masterPlayer.fifties,
      hundreds: masterPlayer.hundreds,
      wickets: masterPlayer.wickets,
      econ: masterPlayer.econ
    };

    team.players.push(newPlayer);
    saveTeamData(team);
    renderMyTeamPage();
    renderTeamPlayerSearchResults(document.getElementById("inputSearchTeamPlayer")?.value || "");
    showToast(`Added ${newPlayer.name} to squad! (${newPlayer.inPlayingXI ? 'Playing XI' : 'Bench'})`);
  }

  // ==========================================
  // PLAYING XI TOGGLE & DETAILED PLAYER PROFILE
  // ==========================================
  function togglePlayerPlayingXI(playerId) {
    const team = getTeamData() || initDefaultTeam();
    if (!team || !team.players) return;
    const player = team.players.find(p => p.id === playerId);
    if (!player) return;

    const currentXI = team.players.filter(p => p.inPlayingXI !== false);
    if (player.inPlayingXI === false) {
      if (currentXI.length >= 11) {
        showToast("Playing XI already has 11 players. Bench another player first!");
        return;
      }
      player.inPlayingXI = true;
      showToast(`${player.name} added to Playing XI`);
    } else {
      player.inPlayingXI = false;
      showToast(`${player.name} moved to Bench`);
    }
    saveTeamData(team);
    renderMyTeamPage();
  }

  let currentDetailPlayerId = null;

  function openPlayerProfileDetailModal(playerIdOrName) {
    if (!playerIdOrName) return;
    const query = String(playerIdOrName).trim();
    const queryLower = query.toLowerCase();

    // 1. Search in user's active team
    let player = null;
    let isMyTeamPlayer = false;
    const team = (typeof getTeamData === "function") ? (getTeamData() || initDefaultTeam()) : null;
    if (team && Array.isArray(team.players)) {
      player = team.players.find(p => p.id === query || (p.name && p.name.toLowerCase() === queryLower));
      if (player) isMyTeamPlayer = true;
    }

    // 2. Search in master player directory/database
    if (!player && typeof getMasterPlayersDirectory === "function") {
      player = getMasterPlayersDirectory().find(p => p.id === query || (p.name && p.name.toLowerCase() === queryLower));
    }
    if (!player && typeof getMasterPlayerDatabase === "function") {
      player = getMasterPlayerDatabase().find(p => p.id === query || (p.name && p.name.toLowerCase() === queryLower));
    }

    // 3. Search in tournament participating teams
    if (!player && typeof getTournamentsList === "function") {
      const tourneys = getTournamentsList();
      for (const t of tourneys) {
        for (const tm of (t.teams || [])) {
          if (Array.isArray(tm.players)) {
            const found = tm.players.find(p => p.id === query || (p.name && p.name.toLowerCase() === queryLower));
            if (found) {
              player = found;
              break;
            }
          }
        }
        if (player) break;
      }
    }

    // 4. Search in calculated player stats
    let calculatedStat = null;
    if (typeof calculateAllPlayerStats === "function") {
      const allStats = calculateAllPlayerStats("all", "all");
      calculatedStat = allStats.find(s => s.id === query || s.playerId === query || (s.name && s.name.toLowerCase() === queryLower));
    }

    if (!player && calculatedStat) {
      player = {
        id: calculatedStat.id || calculatedStat.playerId || `CY-${calculatedStat.name.replace(/\s+/g, '_')}`,
        name: calculatedStat.name,
        role: calculatedStat.role || "Batsman",
        team: calculatedStat.team || "Yuva XI",
        jersey: (calculatedStat.jersey || "").replace("#", "") || "18",
        batStyle: calculatedStat.battingStyle || "Right-hand Bat",
        bowlStyle: calculatedStat.bowlingStyle || "Right-arm Medium",
        photo: calculatedStat.photo || ""
      };
    }

    if (!player) {
      showToast("Player not found. Search a registered player or add the player first.", true);
      return;
    }

    currentDetailPlayerId = player.id || query;

    const modal = document.getElementById("playerProfileDetailModal");
    if (!modal) return;

    // Header & Role
    const roleBadge = document.getElementById("playerDetailRoleBadge");
    if (roleBadge) roleBadge.textContent = (player.role || "BATSMAN").toUpperCase();
    const headerName = document.getElementById("playerDetailHeaderName");
    if (headerName) headerName.innerHTML = `<i class="fa-regular fa-user text-orange"></i> ${player.name}`;

    // Top Card
    const avatar = document.getElementById("playerDetailAvatar");
    if (avatar) {
      if (player.photo) {
        avatar.innerHTML = `<img src="${player.photo}" alt="${player.name}" style="width:100%; height:100%; object-fit:cover;">`;
      } else {
        avatar.textContent = getInitials(player.name);
      }
    }
    const fullName = document.getElementById("playerDetailFullName");
    if (fullName) fullName.textContent = player.name;
    const jerseyBadge = document.getElementById("playerDetailJerseyBadge");
    if (jerseyBadge) jerseyBadge.textContent = player.jersey ? `#${String(player.jersey).replace('#', '')}` : "#18";

    const inXI = player.inPlayingXI !== false;
    const xiBadge = document.getElementById("playerDetailXIStatusBadge");
    if (xiBadge) {
      xiBadge.textContent = inXI ? "PLAYING XI" : "ON BENCH";
      xiBadge.style.background = inXI ? "rgba(34,197,94,0.2)" : "rgba(148,163,184,0.2)";
      xiBadge.style.color = inXI ? "#4ade80" : "#94a3b8";
      xiBadge.style.borderColor = inXI ? "rgba(34,197,94,0.4)" : "rgba(148,163,184,0.4)";
    }

    const stylesText = document.getElementById("playerDetailStylesText");
    const batStyle = player.batStyle || (player.battingHand ? `${player.battingHand} Bat` : "Right Hand Bat");
    const bowlStyle = player.bowlStyle || (player.bowlingStyle ? player.bowlingStyle : (player.role === "Bowler" ? "Right-arm Fast" : "Right-arm Offbreak"));
    if (stylesText) stylesText.textContent = `${batStyle} • ${bowlStyle}`;

    const idText = document.getElementById("playerDetailIdText");
    const displayId = (player.id && player.id.startsWith("CY")) ? player.id : `CY2026-${(player.id || query).replace(/\D/g, '').padEnd(4, '0').slice(-4)}`;
    if (idText) idText.textContent = `Player ID: ${displayId}`;

    // Real Career / Tournament Stats
    let mMatches, mRuns, mHs, mSr, mAvg, m50s, m100s, mWickets, mEcon;
    if (calculatedStat) {
      mMatches = calculatedStat.matchesPlayed || (calculatedStat.matchIds ? calculatedStat.matchIds.size : 0) || player.matches || 1;
      mRuns = calculatedStat.runs !== undefined ? calculatedStat.runs : (player.runs || 0);
      mHs = calculatedStat.hsDisplay || (calculatedStat.highestScore !== undefined ? `${calculatedStat.highestScore}${calculatedStat.isHighestScoreNotOut ? '*' : ''}` : (player.hs || "0"));
      mSr = calculatedStat.strikeRate || player.sr || "0.00";
      mAvg = calculatedStat.batAvg || player.avg || "0.00";
      m50s = calculatedStat.fifties !== undefined ? calculatedStat.fifties : (player.fifties || 0);
      m100s = calculatedStat.hundreds !== undefined ? calculatedStat.hundreds : (player.hundreds || 0);
      mWickets = calculatedStat.wickets !== undefined ? calculatedStat.wickets : (player.wickets || 0);
      mEcon = calculatedStat.economy || player.econ || "0.00";
    } else {
      mMatches = player.matches || 12;
      mRuns = player.runs !== undefined ? player.runs : (player.role === "Batsman" ? 385 : (player.role === "All-Rounder" ? 210 : 45));
      mHs = player.hs || (player.role === "Batsman" ? "82*" : "38*");
      mSr = player.sr || (player.role === "Batsman" ? "138.4" : "124.0");
      mAvg = player.avg || (player.role === "Batsman" ? "38.5" : "24.0");
      m50s = player.fifties !== undefined ? player.fifties : (player.role === "Batsman" ? 3 : 1);
      m100s = player.hundreds !== undefined ? player.hundreds : (player.role === "Batsman" ? 1 : 0);
      mWickets = player.wickets !== undefined ? player.wickets : (player.role === "Bowler" ? 18 : (player.role === "All-Rounder" ? 9 : 1));
      mEcon = player.econ || (player.role === "Bowler" ? "6.85" : "7.50");
    }

    const statMatches = document.getElementById("statDetailMatches");
    if (statMatches) statMatches.textContent = mMatches;
    const statRuns = document.getElementById("statDetailRuns");
    if (statRuns) statRuns.textContent = mRuns;
    const statHs = document.getElementById("statDetailHighest");
    if (statHs) statHs.textContent = mHs;
    const statSr = document.getElementById("statDetailStrikeRate");
    if (statSr) statSr.textContent = mSr;
    const statAvg = document.getElementById("statDetailAvg");
    if (statAvg) statAvg.textContent = mAvg;
    const statMilestones = document.getElementById("statDetailMilestones");
    if (statMilestones) statMilestones.textContent = `${m50s} / ${m100s}`;
    const statWickets = document.getElementById("statDetailWickets");
    if (statWickets) statWickets.textContent = mWickets;
    const statEcon = document.getElementById("statDetailEcon");
    if (statEcon) statEcon.textContent = mEcon;

    // Action Labels (only relevant if in user's team)
    const labelXI = document.getElementById("labelToggleXI");
    if (labelXI) {
      labelXI.textContent = inXI ? "Move to Bench" : "Add to Playing XI";
      const btnXI = labelXI.closest("button");
      if (btnXI) btnXI.style.display = isMyTeamPlayer ? "flex" : "none";
    }
    const labelCap = document.getElementById("labelSetCaptain");
    if (labelCap) {
      labelCap.textContent = player.isCaptain ? "Captain (Active)" : "Make Captain (C)";
      const btnCap = labelCap.closest("button");
      if (btnCap) btnCap.style.display = isMyTeamPlayer ? "flex" : "none";
    }
    const labelVC = document.getElementById("labelSetVC");
    if (labelVC) {
      labelVC.textContent = player.isViceCaptain ? "Vice-Captain (Active)" : "Make Vice-Captain";
      const btnVC = labelVC.closest("button");
      if (btnVC) btnVC.style.display = isMyTeamPlayer ? "flex" : "none";
    }

    modal.style.display = "flex";
  }

  function closePlayerProfileDetailModal() {
    const modal = document.getElementById("playerProfileDetailModal");
    if (modal) modal.style.display = "none";
    currentDetailPlayerId = null;
  }

  // ==========================================
  // EVENT LISTENERS FOR MODALS & BUTTONS
  // ==========================================
  const btnSearchAddPlayerOpen = document.getElementById("btnSearchAddPlayerOpen");
  if (btnSearchAddPlayerOpen) {
    btnSearchAddPlayerOpen.addEventListener("click", openTeamPlayerSearchModal);
  }

  const btnCloseTeamPlayerSearch = document.getElementById("btnCloseTeamPlayerSearch");
  if (btnCloseTeamPlayerSearch) {
    btnCloseTeamPlayerSearch.addEventListener("click", closeTeamPlayerSearchModal);
  }

  const inputSearchTeamPlayer = document.getElementById("inputSearchTeamPlayer");
  const btnSearchClearQuery = document.getElementById("btnSearchClearQuery");
  if (inputSearchTeamPlayer) {
    inputSearchTeamPlayer.addEventListener("input", function() {
      const val = this.value;
      if (btnSearchClearQuery) {
        btnSearchClearQuery.style.display = val ? "block" : "none";
      }
      renderTeamPlayerSearchResults(val);
    });
  }

  if (btnSearchClearQuery && inputSearchTeamPlayer) {
    btnSearchClearQuery.addEventListener("click", function() {
      inputSearchTeamPlayer.value = "";
      btnSearchClearQuery.style.display = "none";
      renderTeamPlayerSearchResults("");
    });
  }

  // Role filter chips in search modal
  document.querySelectorAll("#teamPlayerSearchModal [data-search-filter]").forEach(chip => {
    chip.addEventListener("click", function() {
      document.querySelectorAll("#teamPlayerSearchModal [data-search-filter]").forEach(c => c.classList.remove("active"));
      this.classList.add("active");
      currentSearchRoleFilter = this.getAttribute("data-search-filter") || "all";
      renderTeamPlayerSearchResults(inputSearchTeamPlayer ? inputSearchTeamPlayer.value : "");
    });
  });

  // Profile Detail Modal Buttons
  const btnClosePlayerProfileDetail = document.getElementById("btnClosePlayerProfileDetail");
  if (btnClosePlayerProfileDetail) {
    btnClosePlayerProfileDetail.addEventListener("click", closePlayerProfileDetailModal);
  }

  const btnDetailTogglePlayingXI = document.getElementById("btnDetailTogglePlayingXI");
  if (btnDetailTogglePlayingXI) {
    btnDetailTogglePlayingXI.addEventListener("click", function() {
      if (!currentDetailPlayerId) return;
      togglePlayerPlayingXI(currentDetailPlayerId);
      openPlayerProfileDetailModal(currentDetailPlayerId);
    });
  }

  const btnDetailSetCaptain = document.getElementById("btnDetailSetCaptain");
  if (btnDetailSetCaptain) {
    btnDetailSetCaptain.addEventListener("click", function() {
      if (!currentDetailPlayerId) return;
      const team = getTeamData() || initDefaultTeam();
      const player = team.players.find(p => p.id === currentDetailPlayerId);
      if (!player) return;
      team.players.forEach(p => p.isCaptain = false);
      player.isCaptain = true;
      team.captainName = player.name;
      saveTeamData(team);
      renderMyTeamPage();
      openPlayerProfileDetailModal(currentDetailPlayerId);
      showToast(`${player.name} is now Team Captain!`);
    });
  }

  const btnDetailSetViceCaptain = document.getElementById("btnDetailSetViceCaptain");
  if (btnDetailSetViceCaptain) {
    btnDetailSetViceCaptain.addEventListener("click", function() {
      if (!currentDetailPlayerId) return;
      const team = getTeamData() || initDefaultTeam();
      const player = team.players.find(p => p.id === currentDetailPlayerId);
      if (!player) return;
      team.players.forEach(p => p.isViceCaptain = false);
      player.isViceCaptain = true;
      team.viceCaptainName = player.name;
      saveTeamData(team);
      renderMyTeamPage();
      openPlayerProfileDetailModal(currentDetailPlayerId);
      showToast(`${player.name} is now Vice-Captain!`);
    });
  }

  const btnDetailEditPlayer = document.getElementById("btnDetailEditPlayer");
  if (btnDetailEditPlayer) {
    btnDetailEditPlayer.addEventListener("click", function() {
      if (!currentDetailPlayerId) return;
      const pId = currentDetailPlayerId;
      closePlayerProfileDetailModal();
      openEditPlayerModal(pId);
    });
  }

  const btnDetailRemoveSquad = document.getElementById("btnDetailRemoveSquad");
  if (btnDetailRemoveSquad) {
    btnDetailRemoveSquad.addEventListener("click", function() {
      if (!currentDetailPlayerId) return;
      const pId = currentDetailPlayerId;
      closePlayerProfileDetailModal();
      handleDeletePlayer(pId);
    });
  }

  // Live TV & Broadcast Center Buttons
  const expandStreamBtn = document.getElementById("expandStreamBtn");
  if (expandStreamBtn) {
    expandStreamBtn.addEventListener("click", function() {
      openBroadcastCenterModal();
    });
  }

  // External RTMP/WHIP panels removed in favor of direct camera studio & deep-linking


  // Tournament wizard custom overs chip
  const tOversChipCustom = document.getElementById("tOversChipCustom");
  if (tOversChipCustom) {
    tOversChipCustom.addEventListener("click", function() {
      const val = prompt("Enter match overs (1 - 50):", "12");
      if (val && !isNaN(val) && parseInt(val) > 0) {
        const overs = parseInt(val);
        document.querySelectorAll("#tOversChips .wizard-chip").forEach(c => c.classList.remove("active"));
        tOversChipCustom.classList.add("active");
        tOversChipCustom.textContent = overs + " Overs";
        tOversChipCustom.setAttribute("data-overs", overs);
      }
    });
  }

  // Clear tournament search button
  const tourneyClearSearchBtn = document.getElementById("tourneyClearSearchBtn");
  if (tourneyClearSearchBtn) {
    tourneyClearSearchBtn.addEventListener("click", function() {
      const input = document.getElementById("tourneySearchInput");
      if (input) {
        input.value = "";
        input.dispatchEvent(new Event("input"));
        tourneyClearSearchBtn.style.display = "none";
      }
    });
  }

  // Bottom Navigation Bar from History & Stats
  const navMenuFromHistory = document.getElementById("navMenuFromHistory");
  if (navMenuFromHistory) navMenuFromHistory.addEventListener("click", openMenuDrawer);

  const navUpdatesFromHistory = document.getElementById("navUpdatesFromHistory");
  if (navUpdatesFromHistory) navUpdatesFromHistory.addEventListener("click", () => showScreen("screen9"));

  const navStatsFromStats = document.getElementById("navStatsFromStats");
  if (navStatsFromStats) navStatsFromStats.addEventListener("click", () => renderStatsScreen());


  // Global window functions for inter-module accessibility
  window.openTournamentScreen = openTournamentScreen;
  window.getAvailableClubsList = getAvailableClubsList;
  window.getTournamentsList = getTournamentsList;
  window.handleRunDelivery = handleRunDelivery;
  window.checkInningsCompletionStatus = checkInningsCompletionStatus;
  window.syncMatchToTournament = syncMatchToTournament;
  window.getAvailableClubsList = getAvailableClubsList;
  window.getTournamentsList = getTournamentsList;
  window.openTournamentDetails = openTournamentDetails;
  window.openCreateTournamentWizard = openCreateTournamentWizard;
  window.openTeamSquadModal = openTeamSquadModal;
  window.openCreateCustomClubModal = openCreateCustomClubModal;
  window.openPublicLiveScoreModal = openPublicLiveScoreModal;
  window.openBroadcastCenterModal = openBroadcastCenterModal;
  window.openPlayerProfileDetailModal = openPlayerProfileDetailModal;
  window.PublicLiveScoreService = PublicLiveScoreService;
  window.RealtimeLiveService = RealtimeLiveService;
  window.VideoBroadcastManager = VideoBroadcastManager;
  window.VideoViewerManager = VideoViewerManager;

  // Initialize tournaments and live scoreboard on startup
  getTournamentsList();
  if (typeof updateHomeLiveScoreboard === "function") {
    updateHomeLiveScoreboard();
  }

});
