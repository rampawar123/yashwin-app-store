/* =========================================================
   CRIC YUVA V1.0
   FINAL WORKING SCRIPT
   PART 1
   CORE + NAVIGATION + ACCOUNT + PROFILE
========================================================= */

"use strict";

const CRIC_YUVA = {
    currentScreen: null,
    history: [],
    actionMap: {
        "home": "screen5",
        "about": "aboutScreen",
        "add-player": "addPlayerScreen",
        "create-match": "createMatchScreen",
        "create-tournament": "createTournamentScreen",
        "friends": "friendsScreen",
        "groups": "groupsScreen",
        "help-support": "helpSupportScreen",
        "innings-complete": "inningsCompleteScreen",

    "contact":
        "helpSupportScreen",
        "leaderboard": "tournamentLeaderboardScreen",
        "live": "liveScoreScreen",
        "live-match-center": "liveMatchCenterScreen",
        "live-match-details": "liveMatchDetailsScreen",
        "live-score": "liveScoreScreen",
        "live-scoring": "liveScoringScreen",
        "manage-roles": "manageRolesScreen",
        "match-awards": "matchAwardsScreen",
        "match-control": "matchControlScreen",
        "match-details": "matchDetailsScreen",
        "match-history": "matchHistoryScreen",
        "match-result": "matchResultScreen",
        "match-settings": "matchSettingsScreen",
        "matches": "matchesScreen",
        "player-achievements": "playerAchievementsScreen",
        "player-friends": "playerFriendsScreen",
        "player-profile": "playerProfileScreen",
        "player-public-profile": "playerPublicProfileScreen",
        "player-requests": "playerRequestsScreen",
        "player-statistics": "playerStatisticsScreen",
        "players": "playerProfileScreen",
        "playing11": "playing11Screen",
        "privacy": "privacySettingsScreen",
        "profile": "playerProfileScreen",
        "scorecard": "scorecardScreen",
        "security-settings": "securitySettingsScreen",
        "select-batsmen": "selectBatsmenScreen",
        "select-playing-team": "selectPlayingTeamScreen",
        "settings": "settingsScreen",
        "share": "shareMatchScreen",
        "single-match": "singleMatchScreen",
        "statistics": "playerStatisticsScreen",
        "subscription": "subscriptionScreen",
        "team": "myTeamScreen",
        "payment": "subscriptionScreen",
        "team-chat": "teamChatScreen",
        "terms": "termsConditionsScreen",
        "tournament": "tournamentsScreen",
        "tournament-auction": "tournamentAuctionScreen",
        "tournament-details": "tournamentDetailsScreen",
        "tournament-rules": "tournamentRulesScreen",
        "tournament-schedule": "tournamentScheduleScreen",
        "tournament-teams": "tournamentTeamsScreen",
        "tournaments": "tournamentsScreen",
        "updates": "updatesScreen",
        "ground": "groundDetailsScreen"
    }
};


/* =========================================================
   SHORTCUT
========================================================= */

function $(id) {
    return document.getElementById(id);
}


/* =========================================================
   SAFE LOCAL STORAGE
========================================================= */

function getStoredData(key, fallback) {

    try {

        const value = localStorage.getItem(key);

        if (value === null) {
            return fallback;
        }

        return JSON.parse(value);

    } catch (error) {

        console.error(
            "Storage read error:",
            key,
            error
        );

        return fallback;
    }
}


function setStoredData(key, value) {

    try {

        localStorage.setItem(
            key,
            JSON.stringify(value)
        );

        return true;

    } catch (error) {

        console.error(
            "Storage save error:",
            key,
            error
        );

        return false;
    }
}


/* =========================================================
   ACCOUNT DATA
========================================================= */

function getAccount() {

    return getStoredData(
        "cricYuvaAccount",
        {
            mobile: "",
            password: "",
            name: "",
            email: "",
            jerseyName: "",
            jerseyNumber: "",
            jerseySize: "",
            pantSize: "",
            birthDate: "",
            photo: ""
        }
    );
}


function saveAccount(account) {

    return setStoredData(
        "cricYuvaAccount",
        account
    );
}


/* =========================================================
   SCREEN CHECK
========================================================= */

function getAllScreens() {

    return Array.from(
        document.querySelectorAll(".app-screen")
    );
}


function screenExists(screenId) {

    return !!$(screenId);
}


/* =========================================================
   OPEN SCREEN
========================================================= */

function openScreen(
    screenId,
    addToHistory = true
) {

    const target = $(screenId);

    if (!target) {

        console.warn(
            "Screen not found:",
            screenId
        );

        return false;
    }


    const current =
        CRIC_YUVA.currentScreen;


    getAllScreens().forEach(function (screen) {

        screen.classList.remove(
            "active"
        );

    });


    target.classList.add(
        "active"
    );


    if (
        addToHistory &&
        current &&
        current !== screenId
    ) {

        CRIC_YUVA.history.push(
            current
        );

    }


    CRIC_YUVA.currentScreen =
        screenId;


    try {

        window.scrollTo({
            top: 0,
            left: 0,
            behavior: "smooth"
        });

    } catch (error) {

        window.scrollTo(0, 0);

    }


    updateBottomNavigation(
        screenId
    );


    console.log(
        "Opened screen:",
        screenId
    );


    return true;
}


/* =========================================================
   BACK SCREEN
========================================================= */

function goBack() {

    if (
        CRIC_YUVA.history.length > 0
    ) {

        const previous =
            CRIC_YUVA.history.pop();

        openScreen(
            previous,
            false
        );

        return true;
    }


    return false;
}


/* =========================================================
   OPEN FIRST AVAILABLE SCREEN
========================================================= */

function openFirstAvailable() {

    const account =
        getAccount();


    if (
        account &&
        account.mobile &&
        account.password
    ) {

        if (screenExists("screen5")) {

            openScreen(
                "screen5",
                false
            );

            return;
        }

    }


    if (screenExists("screen2")) {

        openScreen(
            "screen2",
            false
        );

    }

}


/* =========================================================
   ACTION NAVIGATION
========================================================= */

function handleAction(action) {

    if (!action) {
        return false;
    }


    const targetScreen =
        CRIC_YUVA.actionMap[action];


    if (!targetScreen) {

        console.warn(
            "No action mapping:",
            action
        );

        return false;
    }


    if (!screenExists(targetScreen)) {

        console.warn(
            "Mapped screen does not exist:",
            action,
            "->",
            targetScreen
        );

        return false;
    }


    return openScreen(
        targetScreen
    );
}


/* =========================================================
   GLOBAL DATA-ACTION BUTTON SYSTEM
========================================================= */

document.addEventListener(
    "click",
    function (event) {

        const button =
            event.target.closest(
                "[data-action]"
            );


        if (!button) {
            return;
        }


        const action =
            button.getAttribute(
                "data-action"
            );


        if (!action) {
            return;
        }


        const targetScreen =
            CRIC_YUVA.actionMap[action];


        if (!targetScreen) {
            return;
        }


        event.preventDefault();


        handleAction(action);

    }
);


/* =========================================================
   PASSWORD SHOW / HIDE
========================================================= */

function setupPasswordEye(
    buttonId,
    inputId
) {

    const button =
        $(buttonId);

    const input =
        $(inputId);


    if (
        !button ||
        !input
    ) {
        return;
    }


    button.addEventListener(
        "click",
        function (event) {

            event.preventDefault();
            event.stopPropagation();


            if (
                input.type === "password"
            ) {

                input.type = "text";

                const icon =
                    button.querySelector("i");

                if (icon) {

                    icon.classList.remove(
                        "fa-eye"
                    );

                    icon.classList.add(
                        "fa-eye-slash"
                    );

                }

            } else {

                input.type = "password";

                const icon =
                    button.querySelector("i");

                if (icon) {

                    icon.classList.remove(
                        "fa-eye-slash"
                    );

                    icon.classList.add(
                        "fa-eye"
                    );

                }

            }

        }
    );

}


/* =========================================================
   MOBILE NUMBER HELPER
========================================================= */

function cleanMobile(value) {

    return String(
        value || ""
    ).replace(
        /\D/g,
        ""
    ).slice(
        0,
        10
    );
}


function isValidMobile(value) {

    return /^[0-9]{10}$/.test(
        cleanMobile(value)
    );
}


/* =========================================================
   CREATE ACCOUNT SCREEN
========================================================= */

function openCreateAccount() {

    if (!screenExists("screen3")) {

        alert(
            "Create Account screen not found."
        );

        return;
    }


    openScreen("screen3");

}


/* =========================================================
   SAVE NEW ACCOUNT
========================================================= */

function saveNewAccount() {

    const mobile =
        cleanMobile(
            $("newMobile") ?
            $("newMobile").value :
            ""
        );


    const password =
        $("newPassword") ?
        $("newPassword").value :
        "";


    const verifyPassword =
        $("verifyPassword") ?
        $("verifyPassword").value :
        "";


    if (!mobile) {

        alert(
            "Please enter mobile number"
        );

        $("newMobile")?.focus();

        return false;
    }


    if (!isValidMobile(mobile)) {

        alert(
            "Please enter valid 10 digit mobile number"
        );

        $("newMobile")?.focus();

        return false;
    }


    if (!password) {

        alert(
            "Please enter password"
        );

        $("newPassword")?.focus();

        return false;
    }


    if (
        password.length < 4
    ) {

        alert(
            "Password must be at least 4 characters"
        );

        $("newPassword")?.focus();

        return false;
    }


    if (
        password !== verifyPassword
    ) {

        alert(
            "Password and Verify Password do not match"
        );

        $("verifyPassword")?.focus();

        return false;
    }


    const oldAccount =
        getAccount();


    const account = {

        ...oldAccount,

        mobile: mobile,

        password: password

    };


    saveAccount(account);


    if ($("loginMobile")) {

        $("loginMobile").value =
            mobile;

    }


    if ($("loginPassword")) {

        $("loginPassword").value =
            password;

    }


    localStorage.setItem(
        "cricYuvaLoggedIn",
        "true"
    );


    alert(
        "Account created successfully!"
    );


    openScreen("screen4");


    loadProfileData();


    return true;
}


/* =========================================================
   LOGIN
========================================================= */

function loginAccount() {

    const mobile =
        cleanMobile(
            $("loginMobile") ?
            $("loginMobile").value :
            ""
        );


    const password =
        $("loginPassword") ?
        $("loginPassword").value :
        "";


    if (!mobile) {

        alert(
            "Please enter mobile number"
        );

        $("loginMobile")?.focus();

        return false;
    }


    if (!isValidMobile(mobile)) {

        alert(
            "Please enter valid 10 digit mobile number"
        );

        $("loginMobile")?.focus();

        return false;
    }


    if (!password) {

        alert(
            "Please enter password"
        );

        $("loginPassword")?.focus();

        return false;
    }


    const account =
        getAccount();


    if (
        account.mobile &&
        mobile !== account.mobile
    ) {

        alert(
            "Mobile number is incorrect"
        );

        return false;
    }


    if (
        account.password &&
        password !== account.password
    ) {

        alert(
            "Password is incorrect"
        );

        return false;
    }


    if (!account.mobile) {

        account.mobile =
            mobile;

    }


    if (!account.password) {

        account.password =
            password;

    }


    saveAccount(account);


    localStorage.setItem(
        "cricYuvaLoggedIn",
        "true"
    );


    loadProfileData();


    if (screenExists("screen5")) {

        openScreen("screen5");

    } else {

        openScreen("screen4");

    }


    return true;
}


/* =========================================================
   PROFILE LOAD
========================================================= */

function loadProfileData() {

    const account =
        getAccount();


    if ($("profileMobile")) {

        $("profileMobile").value =
            account.mobile || "";

    }


    if ($("profileName")) {

        $("profileName").value =
            account.name || "";

    }


    if ($("profileEmail")) {

        $("profileEmail").value =
            account.email || "";

    }


    if ($("jerseyName")) {

        $("jerseyName").value =
            account.jerseyName || "";

    }


    if ($("jerseyNumber")) {

        $("jerseyNumber").value =
            account.jerseyNumber || "";

    }


    if ($("jerseySize")) {

        $("jerseySize").value =
            account.jerseySize || "";

    }


    if ($("dateOfBirth")) {

        $("dateOfBirth").value =
            account.birthDate || "";

    }


    updateProfilePhoto(
        account.photo || ""
    );


    updateHomeProfile(
        account
    );

}


/* =========================================================
   PROFILE PHOTO
========================================================= */

function updateProfilePhoto(photo) {

    const profilePhoto =
        $("profilePhoto");


    const profileInitial =
        $("profileInitial");


    if (!profilePhoto) {
        return;
    }


    if (photo) {

        profilePhoto.style.backgroundImage =
            "url('" + photo + "')";

        profilePhoto.style.backgroundSize =
            "cover";

        profilePhoto.style.backgroundPosition =
            "center";

        profilePhoto.style.backgroundRepeat =
            "no-repeat";


        if (profileInitial) {

            profileInitial.style.display =
                "none";

        }

    } else {

        profilePhoto.style.backgroundImage =
            "";


        if (profileInitial) {

            profileInitial.style.display =
                "";

        }

    }

}


/* =========================================================
   HOME PROFILE UPDATE
========================================================= */

function updateHomeProfile(account) {

    const name =
        account.name ||
        "PLAYER";


    if ($("homePlayerName")) {

        $("homePlayerName").textContent =
            name;

    }


    if ($("homeInitial")) {

        $("homeInitial").textContent =
            name.charAt(0).toUpperCase();

    }


    const homeAvatar =
        $("homeProfilePhoto");


    if (
        homeAvatar &&
        account.photo
    ) {

        homeAvatar.style.backgroundImage =
            "url('" +
            account.photo +
            "')";

        homeAvatar.style.backgroundSize =
            "cover";

        homeAvatar.style.backgroundPosition =
            "center";

    }

}


/* =========================================================
   SAVE PROFILE
========================================================= */

function saveProfile() {

    const account =
        getAccount();


    if ($("profileName")) {

        account.name =
            $("profileName").value.trim();

    }


    if ($("profileMobile")) {

        account.mobile =
            cleanMobile(
                $("profileMobile").value
            );

    }


    if ($("profileEmail")) {

        account.email =
            $("profileEmail").value.trim();

    }


    if ($("jerseyName")) {

        account.jerseyName =
            $("jerseyName").value.trim();

    }


    if ($("jerseyNumber")) {

        account.jerseyNumber =
            $("jerseyNumber").value.trim();

    }


    if ($("jerseySize")) {

        account.jerseySize =
            $("jerseySize").value;

    }


    if ($("dateOfBirth")) {

        account.birthDate =
            $("dateOfBirth").value;

    }


    if (!account.mobile) {

        alert(
            "Mobile number is missing. Please login again."
        );

        return false;
    }


    saveAccount(account);


    updateHomeProfile(
        account
    );


    alert(
        "Profile saved successfully!"
    );


    return true;
}


/* =========================================================
   PROFILE PHOTO UPLOAD
========================================================= */

function setupProfilePhoto() {

    const replaceButton =
        $("replacePhotoBtn");

    const input =
        $("profilePhotoInput");


    if (
        replaceButton &&
        input
    ) {

        replaceButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();
                event.stopPropagation();

                input.click();

            }
        );

    }


    if (!input) {
        return;
    }


    input.addEventListener(
        "change",
        function () {

            const file =
                input.files &&
                input.files[0];


            if (!file) {
                return;
            }


            if (
                !file.type.startsWith(
                    "image/"
                )
            ) {

                alert(
                    "Please select an image file."
                );

                input.value = "";

                return;
            }


            const reader =
                new FileReader();


            reader.onload =
                function (event) {

                    const image =
                        event.target.result;


                    const account =
                        getAccount();


                    account.photo =
                        image;


                    saveAccount(
                        account
                    );


                    updateProfilePhoto(
                        image
                    );


                    updateHomeProfile(
                        account
                    );


                    console.log(
                        "Profile photo saved"
                    );

                };


            reader.readAsDataURL(
                file
            );

        }
    );

}


/* =========================================================
   QUICK ACTION MODAL
========================================================= */

function setupQuickModal() {

    const openButton =
        $("centerActionButton");

    const modal =
        $("quickModalOverlay");

    const closeButton =
        $("quickModalClose");


    if (
        openButton &&
        modal
    ) {

        openButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                modal.classList.add(
                    "active"
                );

            }
        );

    }


    if (
        closeButton &&
        modal
    ) {

        closeButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                modal.classList.remove(
                    "active"
                );

            }
        );

    }


    if (modal) {

        modal.addEventListener(
            "click",
            function (event) {

                if (
                    event.target === modal
                ) {

                    modal.classList.remove(
                        "active"
                    );

                }

            }
        );

    }

}


/* =========================================================
   BOTTOM NAVIGATION ACTIVE STATE
========================================================= */

function updateBottomNavigation(
    screenId
) {

    const items =
        document.querySelectorAll(
            ".bottom-nav-item"
        );


    items.forEach(
        function (item) {

            item.classList.remove(
                "active"
            );

        }
    );


    let action = "";


    if (
        screenId === "screen5"
    ) {

        action = "home";

    } else if (
        screenId === "matchesScreen"
    ) {

        action = "matches";

    } else if (
        screenId === "tournamentsScreen"
    ) {

        action = "tournaments";

    } else if (
        screenId === "playerProfileScreen" ||
        screenId === "screen4"
    ) {

        action = "profile";

    }


    if (!action) {
        return;
    }


    const activeButton =
        document.querySelector(
            '.bottom-nav-item[data-action="' +
            action +
            '"]'
        );


    if (activeButton) {

        activeButton.classList.add(
            "active"
        );

    }

}


/* =========================================================
   APP BUTTON SETUP
========================================================= */

function setupPartOneButtons() {

    const loginButton =
        $("loginButton");

    const createAccountButton =
        $("createAccountButton");

    const createBackButton =
        $("createBackButton");

    const saveAccountButton =
        $("saveAccountButton");

    const saveProfileButton =
        $("saveProfileButton");

    const continueToHomeButton =
        $("continueToHomeButton");

    const forgotPasswordButton =
        $("forgotPasswordButton");


    if (loginButton) {

        loginButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                loginAccount();

            }
        );

    }


    if (createAccountButton) {

        createAccountButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                openCreateAccount();

            }
        );

    }


    if (createBackButton) {

        createBackButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                openScreen("screen2");

            }
        );

    }


    if (saveAccountButton) {

        saveAccountButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                saveNewAccount();

            }
        );

    }


    if (saveProfileButton) {

        saveProfileButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                saveProfile();

            }
        );

    }


    if (continueToHomeButton) {

        continueToHomeButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                saveProfile();

                openScreen("screen5");

            }
        );

    }


    if (forgotPasswordButton) {

        forgotPasswordButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                alert(
                    "Password reset system will be added in the next part."
                );

            }
        );

    }


    setupPasswordEye(
        "loginEyeButton",
        "loginPassword"
    );


    setupPasswordEye(
        "newPasswordEye",
        "newPassword"
    );


    setupPasswordEye(
        "verifyPasswordEye",
        "verifyPassword"
    );


    setupProfilePhoto();


    setupQuickModal();

}


/* =========================================================
   INPUT NUMBER CONTROL
========================================================= */

function setupMobileInputs() {

    const inputs = [
        $("loginMobile"),
        $("newMobile")
    ];


    inputs.forEach(
        function (input) {

            if (!input) {
                return;
            }


            input.addEventListener(
                "input",
                function () {

                    input.value =
                        cleanMobile(
                            input.value
                        );

                }
            );

        }
    );

}


/* =========================================================
   ENTER KEY LOGIN
========================================================= */

function setupEnterKeys() {

    const loginPassword =
        $("loginPassword");


    if (loginPassword) {

        loginPassword.addEventListener(
            "keydown",
            function (event) {

                if (
                    event.key === "Enter"
                ) {

                    event.preventDefault();

                    loginAccount();

                }

            }
        );

    }


    const verifyPassword =
        $("verifyPassword");


    if (verifyPassword) {

        verifyPassword.addEventListener(
            "keydown",
            function (event) {

                if (
                    event.key === "Enter"
                ) {

                    event.preventDefault();

                    saveNewAccount();

                }

            }
        );

    }

}


/* =========================================================
   SPLASH
========================================================= */

function setupSplash() {

    const splash =
        $("splashScreen") ||
        $("screen1");

    if (!splash) {
        openFirstAvailable();
        return;
    }

    setTimeout(function () {

        const target =
            document.getElementById("screen5");

        if (!target) {
            openFirstAvailable();
            return;
        }

        document
            .querySelectorAll(".app-screen")
            .forEach(function (screen) {
                screen.classList.remove("active");
            });

        target.classList.add("active");

        if (typeof CRIC_YUVA !== "undefined") {
            CRIC_YUVA.currentScreen = "screen5";
        }

        window.scrollTo(0, 0);

    }, 2500);

}

/* =========================================================
   INITIALIZE PART 1
========================================================= */

function initializeCricYuvaPart1() {

    console.log(
        "CRIC YUVA FINAL SCRIPT PART 1 LOADED"
    );


    const activeScreen =
        document.querySelector(
            ".app-screen.active"
        );


    if (activeScreen) {

        CRIC_YUVA.currentScreen =
            activeScreen.id;

    }


    setupPartOneButtons();

    setupMobileInputs();

    setupEnterKeys();

    loadProfileData();

    setupSplash();


    window.openScreen =
        openScreen;

    window.showScreen =
        openScreen;

    window.goBack =
        goBack;

    window.CRIC_YUVA =
        CRIC_YUVA;


    console.log(
        "PART 1 READY"
    );

}


if (
    document.readyState === "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeCricYuvaPart1,
        { once: true }
    );

} else {

    initializeCricYuvaPart1();

    }

/* =========================================================
   CRIC YUVA V1.0
   FINAL WORKING SCRIPT
   PART 2
   BACK BUTTON + HOME + MENU + GENERAL BUTTON NAVIGATION
========================================================= */

"use strict";


/* =========================================================
   PART 2 HELPER
========================================================= */

function part2OpenScreen(screenId) {

    if (
        typeof openScreen === "function"
    ) {

        return openScreen(screenId);

    }

    const target =
        document.getElementById(screenId);

    if (!target) {

        console.warn(
            "PART 2 SCREEN NOT FOUND:",
            screenId
        );

        return false;

    }

    document
        .querySelectorAll(".app-screen")
        .forEach(function (screen) {

            screen.classList.remove("active");

        });

    target.classList.add("active");

    window.scrollTo({
        top: 0,
        left: 0,
        behavior: "smooth"
    });

    return true;
}


/* =========================================================
   PART 2 GO BACK
========================================================= */

function part2GoBack() {

    if (
        typeof goBack === "function"
    ) {

        const success =
            goBack();

        if (success) {

            return true;

        }

    }


    /* Fallback home */

    if (
        document.getElementById("screen5")
    ) {

        part2OpenScreen("screen5");

        return true;

    }


    return false;
}


/* =========================================================
   GLOBAL BACK BUTTON SYSTEM
========================================================= */

function setupGlobalBackButtons() {

    const backSelectors = [

        "[data-back]",
        "[data-action='back']",
        ".back-btn",
        ".back-button",
        ".screen-back",
        ".header-back",
        ".page-back"

    ];


    const buttons =
        document.querySelectorAll(
            backSelectors.join(",")
        );


    buttons.forEach(function (button) {

        if (
            button.dataset.part2BackReady === "true"
        ) {

            return;

        }


        button.dataset.part2BackReady =
            "true";


        button.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                event.stopPropagation();

                part2GoBack();

            }
        );

    });

}


/* =========================================================
   BACK BUTTON BY ICON / TEXT DETECTION
========================================================= */

document.addEventListener(
    "click",
    function (event) {

        const button =
            event.target.closest(
                "button"
            );

        if (!button) {

            return;

        }


        if (
            button.dataset.part2IgnoreBack === "true"
        ) {

            return;

        }


        const text =
            (
                button.innerText ||
                button.textContent ||
                ""
            )
            .trim()
            .toUpperCase();


        const hasBackIcon =
            button.querySelector(
                ".fa-arrow-left, .fa-chevron-left, .fa-angle-left"
            );


        if (
            text === "BACK" ||
            text === "GO BACK" ||
            hasBackIcon
        ) {

            const currentScreen =
                button.closest(
                    ".app-screen.active"
                );


            if (!currentScreen) {

                return;

            }


            event.preventDefault();

            event.stopPropagation();

            part2GoBack();

        }

    },
    true
);


/* =========================================================
   HOME BUTTON SYSTEM
========================================================= */

function setupHomeButtons() {

    const selectors = [

        "[data-home]",
        "[data-action='home']",
        "#homeButton",
        ".home-btn",
        ".home-button"

    ];


    document
        .querySelectorAll(
            selectors.join(",")
        )
        .forEach(function (button) {

            if (
                button.dataset.part2HomeReady ===
                "true"
            ) {

                return;

            }


            button.dataset.part2HomeReady =
                "true";


            button.addEventListener(
                "click",
                function (event) {

                    event.preventDefault();

                    event.stopPropagation();

                    if (
                        document.getElementById("screen5")
                    ) {

                        part2OpenScreen(
                            "screen5"
                        );

                    }

                }
            );

        });

}


/* =========================================================
   MENU SYSTEM
========================================================= */

function setupMenuSystem() {

    const menuButton =
        document.getElementById("menuButton") ||
        document.getElementById("menuBtn") ||
        document.querySelector("[data-menu-button]");

    const sideMenu =
        document.getElementById("sideMenu") ||
        document.querySelector(".side-menu");

    const menuOverlay =
        document.getElementById("menuOverlay");

    function openMenu() {
        if (sideMenu) {
            sideMenu.classList.add("active", "open");
        }

        if (menuOverlay) {
            menuOverlay.classList.add("active", "open");
        }
    }

    function closeMenu() {
        if (sideMenu) {
            sideMenu.classList.remove("active", "open");
        }

        if (menuOverlay) {
            menuOverlay.classList.remove("active", "open");
        }
    }

    if (menuButton) {
        menuButton.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();

            if (sideMenu && (sideMenu.classList.contains("active") || sideMenu.classList.contains("open"))) {
                closeMenu();
            } else {
                openMenu();
            }
        });
    }

    const closeButtons =
        document.querySelectorAll(
            ".menu-close, .close-menu, #closeMenuButton, .close-menu-button, [data-close-menu]"
        );

    closeButtons.forEach(function (button) {
        button.addEventListener("click", function (event) {
            event.preventDefault();
            closeMenu();
        });
    });

    if (menuOverlay) {
        menuOverlay.addEventListener("click", function (event) {
            if (event.target === menuOverlay) {
                closeMenu();
            }
        });
    }

}

/* =========================================================
   BOTTOM NAVIGATION
========================================================= */

function setupBottomNavigationPart2() {

    const navButtons =
        document.querySelectorAll(
            ".bottom-nav-item[data-action]"
        );


    navButtons.forEach(function (button) {

        if (
            button.dataset.part2NavReady ===
            "true"
        ) {

            return;

        }


        button.dataset.part2NavReady =
            "true";


        button.addEventListener(
            "click",
            function (event) {

                const action =
                    button.getAttribute(
                        "data-action"
                    );


                if (!action) {

                    return;

                }


                if (
                    !window.CRIC_YUVA ||
                    !window.CRIC_YUVA.actionMap ||
                    !window.CRIC_YUVA
                        .actionMap[action]
                ) {

                    return;

                }


                event.preventDefault();

                event.stopPropagation();


                const screenId =
                    window.CRIC_YUVA
                        .actionMap[action];


                part2OpenScreen(
                    screenId
                );


                document
                    .querySelectorAll(
                        ".bottom-nav-item"
                    )
                    .forEach(function (item) {

                        item.classList.remove(
                            "active"
                        );

                    });


                button.classList.add(
                    "active"
                );

            }
        );

    });

}


/* =========================================================
   GENERIC SCREEN BUTTON SYSTEM
========================================================= */

const PART2_BUTTON_SCREEN_MAP = {

    /* HOME */

    "my-profile":
        "playerProfileScreen",

    "profile":
        "playerProfileScreen",

    "my-team":
        "myTeamScreen",

    "team":
        "myTeamScreen",

    "teams":
        "myTeamScreen",

    "my-matches":
        "matchesScreen",

    "matches":
        "matchesScreen",

    "friends":
        "friendsScreen",

    "groups":
        "groupsScreen",


    /* MATCH */

    "create-match":
        "createMatchScreen",

    "new-match":
        "createMatchScreen",

    "single-match":
        "singleMatchScreen",

    "live-score":
        "liveScoreScreen",

    "live-scoring":
        "liveScoringScreen",

    "scorecard":
        "scorecardScreen",

    "playing11":
        "playing11Screen",

    "select-playing-team":
        "selectPlayingTeamScreen",

    "select-batsmen":
        "selectBatsmenScreen",

    "match-history":
        "matchHistoryScreen",

    "match-result":
        "matchResultScreen",

    "match-details":
        "matchDetailsScreen",

    "match-settings":
        "matchSettingsScreen",

    "match-awards":
        "matchAwardsScreen",


    /* TOURNAMENT */

    "tournament":
        "tournamentsScreen",

    "tournaments":
        "tournamentsScreen",

    "create-tournament":
        "createTournamentScreen",

    "tournament-details":
        "tournamentDetailsScreen",

    "tournament-teams":
        "tournamentTeamsScreen",

    "tournament-schedule":
        "tournamentScheduleScreen",

    "tournament-rules":
        "tournamentRulesScreen",

    "tournament-auction":
        "tournamentAuctionScreen",

    "leaderboard":
        "tournamentLeaderboardScreen",


    /* PLAYER */

    "players":
        "playerProfileScreen",

    "player-profile":
        "playerProfileScreen",

    "player-public-profile":
        "playerPublicProfileScreen",

    "player-statistics":
        "playerStatisticsScreen",

    "statistics":
        "playerStatisticsScreen",

    "player-achievements":
        "playerAchievementsScreen",

    "player-friends":
        "playerFriendsScreen",

    "player-requests":
        "playerRequestsScreen",


    /* SETTINGS */

    "settings":
        "settingsScreen",

    "privacy":
        "privacySettingsScreen",

    "security-settings":
        "securitySettingsScreen",

    "subscription":
        "subscriptionScreen",
        "payment": "subscriptionScreen",

    "updates":
        "updatesScreen",

    "help-support":
        "helpSupportScreen",

    "contact":
        "helpSupportScreen",

    "about":
        "aboutScreen",

    "terms":
        "termsConditionsScreen",

    "ground":
        "groundDetailsScreen"

};


/* =========================================================
   PART 2 ACTION CLICK SYSTEM
========================================================= */

document.addEventListener(
    "click",
    function (event) {

        const button =
            event.target.closest(
                "[data-action]"
            );


        if (!button) {

            return;

        }


        const action =
            button.getAttribute(
                "data-action"
            );


        if (!action) {

            return;

        }


        const screenId =
            PART2_BUTTON_SCREEN_MAP[
                action
            ];


        if (!screenId) {

            return;

        }


        if (
            !document.getElementById(
                screenId
            )
        ) {

            console.warn(
                "PART 2 TARGET SCREEN NOT FOUND:",
                action,
                screenId
            );

            return;

        }


        event.preventDefault();

        event.stopPropagation();

        event.stopImmediatePropagation();


        part2OpenScreen(
            screenId
        );

    },
    true
);


/* =========================================================
   GENERIC BUTTON TEXT NAVIGATION
========================================================= */

function setupTextNavigation() {

    const textMap = {

        "MY PROFILE":
            "playerProfileScreen",

        "PROFILE":
            "playerProfileScreen",

        "MY TEAM":
            "myTeamScreen",

        "TEAMS":
            "myTeamScreen",

        "MATCHES":
            "matchesScreen",

        "MY MATCHES":
            "matchesScreen",

        "FRIENDS":
            "friendsScreen",

        "GROUPS":
            "groupsScreen",

        "CREATE MATCH":
            "createMatchScreen",

        "CREATE TOURNAMENT":
            "createTournamentScreen",

        "TOURNAMENTS":
            "tournamentsScreen",

        "SETTINGS":
            "settingsScreen",

        "HELP & SUPPORT":
            "helpSupportScreen",

        "ABOUT":
            "aboutScreen"

    };


    document
        .querySelectorAll("button")
        .forEach(function (button) {

            if (
                button.dataset.part2TextReady ===
                "true"
            ) {

                return;

            }


            const text =
                (
                    button.innerText ||
                    ""
                )
                .trim()
                .toUpperCase();


            const screenId =
                textMap[text];


            if (!screenId) {

                return;

            }


            button.dataset.part2TextReady =
                "true";


            button.addEventListener(
                "click",
                function (event) {

                    if (
                        !document.getElementById(
                            screenId
                        )
                    ) {

                        return;

                    }


                    event.preventDefault();

                    event.stopPropagation();


                    part2OpenScreen(
                        screenId
                    );

                }
            );

        });

}


/* =========================================================
   GENERAL SAVE BUTTON PROTECTION
========================================================= */

document.addEventListener(
    "click",
    function (event) {

        const button =
            event.target.closest(
                "button"
            );


        if (!button) {

            return;

        }


        const text =
            (
                button.innerText ||
                ""
            )
            .trim()
            .toUpperCase();


        if (
            text !== "SAVE" &&
            text !== "SAVE CHANGES"
        ) {

            return;

        }


        const activeScreen =
            document.querySelector(
                ".app-screen.active"
            );


        if (!activeScreen) {

            return;

        }


        console.log(
            "SAVE BUTTON CLICKED:",
            activeScreen.id
        );

    },
    true
);


/* =========================================================
   PART 2 INITIALIZATION
========================================================= */

function initializeCricYuvaPart2() {

    console.log(
        "CRIC YUVA FINAL SCRIPT PART 2 LOADED"
    );


    setupGlobalBackButtons();

    setupHomeButtons();

    setupMenuSystem();

    setupBottomNavigationPart2();

    setupTextNavigation();


    console.log(
        "PART 2 READY"
    );

}


if (
    document.readyState === "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeCricYuvaPart2,
        { once: true }
    );

} else {

    initializeCricYuvaPart2();

                 }

/* =========================================================
   CRIC YUVA V1.0
   FINAL WORKING SCRIPT
   PART 3
   MATCH SYSTEM + LIVE SCORING + SCORECARD
========================================================= */

"use strict";

/* =========================================================
   PART 3 MATCH DATA
========================================================= */

function getMatches() {
    return getStoredData("cricYuvaMatches", []);
}

function saveMatches(matches) {
    return setStoredData("cricYuvaMatches", matches);
}

function getCurrentMatch() {
    return getStoredData("cricYuvaCurrentMatch", null);
}

function saveCurrentMatch(match) {
    return setStoredData("cricYuvaCurrentMatch", match);
}

/* =========================================================
   CREATE NEW MATCH
========================================================= */

function createNewMatch() {

    const match = {
        id: "match_" + Date.now(),
        teamA: "",
        teamB: "",
        overs: 20,
        venue: "",
        date: "",
        status: "upcoming",

        score: 0,
        wickets: 0,
        legalBalls: 0,
        totalRuns: 0,
        extras: 0,

        innings: 1,

        batsman1: "",
        batsman2: "",
        bowler: "",

        battingTeam: "",
        bowlingTeam: "",

        playing11A: [],
        playing11B: [],

        history: []
    };

    saveCurrentMatch(match);

    console.log("NEW MATCH CREATED:", match);

    return match;
}

/* =========================================================
   SAVE MATCH
========================================================= */

function saveCurrentMatchToList() {

    const match = getCurrentMatch();

    if (!match) {
        return false;
    }

    let matches = getMatches();

    const index = matches.findIndex(function(item) {
        return item.id === match.id;
    });

    if (index >= 0) {
        matches[index] = match;
    } else {
        matches.push(match);
    }

    saveMatches(matches);

    return true;
}

/* =========================================================
   INPUT VALUE HELPER
========================================================= */

function getValue(ids) {

    for (let i = 0; i < ids.length; i++) {

        const element =
            document.getElementById(ids[i]);

        if (element && element.value !== undefined) {

            const value =
                String(element.value).trim();

            if (value) {
                return value;
            }
        }
    }

    return "";
}

/* =========================================================
   SAVE MATCH DETAILS
========================================================= */

function saveMatchDetails() {

    let match =
        getCurrentMatch();

    if (!match) {
        match = createNewMatch();
    }

    const teamA = getValue([
        "teamA",
        "teamAInput",
        "matchTeamA",
        "firstTeam"
    ]);

    const teamB = getValue([
        "teamB",
        "teamBInput",
        "matchTeamB",
        "secondTeam"
    ]);

    const overs = getValue([
        "matchOvers",
        "oversInput",
        "totalOvers"
    ]);

    const venue = getValue([
        "matchVenue",
        "venueInput",
        "groundInput"
    ]);

    const date = getValue([
        "matchDate",
        "dateInput"
    ]);

    if (teamA) {
        match.teamA = teamA;
    }

    if (teamB) {
        match.teamB = teamB;
    }

    if (overs && !isNaN(Number(overs))) {
        match.overs = Number(overs);
    }

    if (venue) {
        match.venue = venue;
    }

    if (date) {
        match.date = date;
    }

    saveCurrentMatch(match);
    saveCurrentMatchToList();

    console.log(
        "MATCH DETAILS SAVED:",
        match
    );

    return true;
}

/* =========================================================
   MATCH SCREEN BUTTONS
========================================================= */

function setupMatchButtons() {

    const createButtons =
        document.querySelectorAll(
            "#createNewMatchButton, " +
            "[data-action='create-new-match'], " +
            "[data-create-match]"
        );

    createButtons.forEach(function(button) {

        if (button.dataset.part3Ready === "true") {
            return;
        }

        button.dataset.part3Ready = "true";

        button.addEventListener(
            "click",
            function(event) {

                event.preventDefault();

                createNewMatch();

                if (
                    document.getElementById(
                        "createMatchScreen"
                    )
                ) {
                    part2OpenScreen(
                        "createMatchScreen"
                    );
                }
            }
        );
    });


    const startButtons =
        document.querySelectorAll(
            "[data-action='start-match'], " +
            "#startMatchButton, " +
            "#startNewMatchButton"
        );

    startButtons.forEach(function(button) {

        if (button.dataset.part3Ready === "true") {
            return;
        }

        button.dataset.part3Ready = "true";

        button.addEventListener(
            "click",
            function(event) {

                event.preventDefault();

                saveMatchDetails();

                let match =
                    getCurrentMatch();

                if (!match) {
                    match = createNewMatch();
                }

                match.status = "live";

                saveCurrentMatch(match);
                saveCurrentMatchToList();

                if (
                    document.getElementById(
                        "selectPlayingTeamScreen"
                    )
                ) {

                    part2OpenScreen(
                        "selectPlayingTeamScreen"
                    );

                } else if (
                    document.getElementById(
                        "liveScoringScreen"
                    )
                ) {

                    part2OpenScreen(
                        "liveScoringScreen"
                    );
                }
            }
        );
    });

}

/* =========================================================
   SELECT PLAYING TEAM
========================================================= */

function setupPlayingTeamButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "[data-team], [data-playing-team]"
                );

            if (!button) {
                return;
            }

            const activeScreen =
                document.querySelector(
                    ".app-screen.active"
                );

            if (!activeScreen) {
                return;
            }

            if (
                activeScreen.id !==
                "selectPlayingTeamScreen"
            ) {
                return;
            }

            event.preventDefault();

            const selectedTeam =
                button.getAttribute("data-team") ||
                button.getAttribute(
                    "data-playing-team"
                );

            let match =
                getCurrentMatch();

            if (!match) {
                match = createNewMatch();
            }

            match.battingTeam =
                selectedTeam;

            match.bowlingTeam =
                selectedTeam === match.teamA ?
                match.teamB :
                match.teamA;

            saveCurrentMatch(match);

            document
                .querySelectorAll(
                    "[data-team], [data-playing-team]"
                )
                .forEach(function(item) {

                    item.classList.remove(
                        "selected"
                    );
                });

            button.classList.add(
                "selected"
            );

            console.log(
                "BATTING TEAM:",
                selectedTeam
            );

        },
        true
    );

}

/* =========================================================
   PLAYING 11 CONTINUE
========================================================= */

function setupPlaying11Buttons() {

    const buttons =
        document.querySelectorAll(
            "[data-action='continue-playing11'], " +
            "#continuePlaying11Button, " +
            "#savePlaying11Button"
        );

    buttons.forEach(function(button) {

        if (button.dataset.part3Ready === "true") {
            return;
        }

        button.dataset.part3Ready = "true";

        button.addEventListener(
            "click",
            function(event) {

                event.preventDefault();

                const activeScreen =
                    document.querySelector(
                        ".app-screen.active"
                    );

                if (
                    activeScreen &&
                    activeScreen.id ===
                    "selectPlayingTeamScreen"
                ) {

                    part2OpenScreen(
                        "playing11Screen"
                    );

                } else if (
                    document.getElementById(
                        "selectBatsmenScreen"
                    )
                ) {

                    part2OpenScreen(
                        "selectBatsmenScreen"
                    );

                } else if (
                    document.getElementById(
                        "liveScoringScreen"
                    )
                ) {

                    part2OpenScreen(
                        "liveScoringScreen"
                    );
                }
            }
        );
    });

}

/* =========================================================
   GET SCORE OVER TEXT
========================================================= */

function getOverText(match) {

    const completedOvers =
        Math.floor(
            match.legalBalls / 6
        );

    const balls =
        match.legalBalls % 6;

    return (
        completedOvers +
        "." +
        balls
    );
}

/* =========================================================
   SCORE UPDATE
========================================================= */

function addRuns(runs) {

    let match =
        getCurrentMatch();

    if (!match) {
        match = createNewMatch();
        match.status = "live";
    }

    runs = Number(runs);

    if (isNaN(runs)) {
        return;
    }

    match.score += runs;
    match.totalRuns += runs;

    match.legalBalls += 1;

    match.history.push({
        type: "run",
        runs: runs,
        legal: true,
        time: Date.now()
    });

    saveCurrentMatch(match);
    saveCurrentMatchToList();

    updateLiveScoreUI();
}

/* =========================================================
   WICKET
========================================================= */

function addWicket() {

    let match =
        getCurrentMatch();

    if (!match) {
        match = createNewMatch();
    }

    match.wickets += 1;
    match.legalBalls += 1;

    match.history.push({
        type: "wicket",
        runs: 0,
        legal: true,
        time: Date.now()
    });

    saveCurrentMatch(match);
    saveCurrentMatchToList();

    updateLiveScoreUI();

    if (
        document.getElementById(
            "selectBatsmenScreen"
        )
    ) {
        setTimeout(function() {
            part2OpenScreen(
                "selectBatsmenScreen"
            );
        }, 300);
    }
}

/* =========================================================
   WIDE
========================================================= */

function addWide(runs) {

    let match =
        getCurrentMatch();

    if (!match) {
        match = createNewMatch();
    }

    runs = Number(runs || 1);

    match.score += runs;
    match.totalRuns += runs;
    match.extras += runs;

    match.history.push({
        type: "wide",
        runs: runs,
        legal: false,
        time: Date.now()
    });

    saveCurrentMatch(match);
    saveCurrentMatchToList();

    updateLiveScoreUI();
}

/* =========================================================
   NO BALL
========================================================= */

function addNoBall(runs) {

    let match =
        getCurrentMatch();

    if (!match) {
        match = createNewMatch();
    }

    runs = Number(runs || 1);

    match.score += runs;
    match.totalRuns += runs;
    match.extras += 1;

    match.history.push({
        type: "noball",
        runs: runs,
        legal: false,
        time: Date.now()
    });

    saveCurrentMatch(match);
    saveCurrentMatchToList();

    updateLiveScoreUI();
}

/* =========================================================
   DOT BALL
========================================================= */

function addDotBall() {

    let match =
        getCurrentMatch();

    if (!match) {
        match = createNewMatch();
    }

    match.legalBalls += 1;

    match.history.push({
        type: "dot",
        runs: 0,
        legal: true,
        time: Date.now()
    });

    saveCurrentMatch(match);
    saveCurrentMatchToList();

    updateLiveScoreUI();
}

/* =========================================================
   UNDO LAST BALL
========================================================= */

function undoLastBall() {

    let match =
        getCurrentMatch();

    if (
        !match ||
        !Array.isArray(match.history) ||
        match.history.length === 0
    ) {
        return;
    }

    const last =
        match.history.pop();

    if (last.legal) {
        match.legalBalls =
            Math.max(
                0,
                match.legalBalls - 1
            );
    }

    if (
        last.type === "wicket"
    ) {

        match.wickets =
            Math.max(
                0,
                match.wickets - 1
            );

    } else {

        match.score =
            Math.max(
                0,
                match.score - Number(last.runs || 0)
            );

        match.totalRuns =
            Math.max(
                0,
                match.totalRuns -
                Number(last.runs || 0)
            );

        if (
            last.type === "wide" ||
            last.type === "noball"
        ) {

            match.extras =
                Math.max(
                    0,
                    match.extras -
                    Number(last.runs || 0)
                );
        }
    }

    saveCurrentMatch(match);
    saveCurrentMatchToList();

    updateLiveScoreUI();
}

/* =========================================================
   LIVE SCORE UI
========================================================= */

function updateLiveScoreUI() {

    const match =
        getCurrentMatch();

    if (!match) {
        return;
    }

    const scoreText =
        match.score +
        "/" +
        match.wickets;

    const overText =
        getOverText(match);

    const scoreIds = [
        "liveScore",
        "scoreDisplay",
        "currentScore",
        "matchScore",
        "scoreValue"
    ];

    scoreIds.forEach(function(id) {

        const element =
            document.getElementById(id);

        if (element) {
            element.textContent =
                scoreText;
        }
    });

    const overIds = [
        "liveOvers",
        "oversDisplay",
        "currentOvers",
        "overValue"
    ];

    overIds.forEach(function(id) {

        const element =
            document.getElementById(id);

        if (element) {
            element.textContent =
                overText;
        }
    });

    const teamIds = [
        "battingTeamName",
        "liveTeamName",
        "scoreTeamName"
    ];

    teamIds.forEach(function(id) {

        const element =
            document.getElementById(id);

        if (element) {
            element.textContent =
                match.battingTeam ||
                match.teamA ||
                "TEAM";
        }
    });

}

/* =========================================================
   LIVE SCORING BUTTON DETECTOR
========================================================= */

function setupScoringButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "button"
                );

            if (!button) {
                return;
            }

            const activeScreen =
                document.querySelector(
                    ".app-screen.active"
                );

            if (!activeScreen) {
                return;
            }

            const allowedScreens = [
                "liveScoringScreen",
                "liveScoreScreen",
                "matchControlScreen"
            ];

            if (
                !allowedScreens.includes(
                    activeScreen.id
                )
            ) {
                return;
            }

            const text =
                (
                    button.innerText ||
                    button.textContent ||
                    ""
                )
                .trim()
                .toUpperCase();

            const action =
                (
                    button.getAttribute(
                        "data-score"
                    ) ||
                    button.getAttribute(
                        "data-action"
                    ) ||
                    ""
                )
                .trim()
                .toLowerCase();


            if (
                /^[0-6]$/.test(text)
            ) {

                event.preventDefault();
                event.stopPropagation();

                addRuns(
                    Number(text)
                );

                return;
            }


            if (
                text === "W" ||
                text === "WK" ||
                text === "WICKET" ||
                action === "wicket"
            ) {

                event.preventDefault();
                event.stopPropagation();

                addWicket();

                return;
            }


            if (
                text === "DOT" ||
                text === "0" ||
                action === "dot"
            ) {

                event.preventDefault();
                event.stopPropagation();

                addDotBall();

                return;
            }


            if (
                text === "WD" ||
                text === "WIDE" ||
                action === "wide"
            ) {

                event.preventDefault();
                event.stopPropagation();

                addWide(1);

                return;
            }


            if (
                text === "NB" ||
                text === "NO BALL" ||
                action === "noball"
            ) {

                event.preventDefault();
                event.stopPropagation();

                addNoBall(1);

                return;
            }


            if (
                text === "UNDO" ||
                action === "undo"
            ) {

                event.preventDefault();
                event.stopPropagation();

                undoLastBall();

                return;
            }

        },
        true
    );

}

/* =========================================================
   COMPLETE INNINGS
========================================================= */

function completeInnings() {

    let match =
        getCurrentMatch();

    if (!match) {
        return;
    }

    match.status =
        "innings-complete";

    match.innings += 1;

    saveCurrentMatch(match);
    saveCurrentMatchToList();

    if (
        document.getElementById(
            "inningsCompleteScreen"
        )
    ) {

        part2OpenScreen(
            "inningsCompleteScreen"
        );
    }
}

/* =========================================================
   MATCH COMPLETE
========================================================= */

function completeMatch() {

    let match =
        getCurrentMatch();

    if (!match) {
        return;
    }

    match.status =
        "completed";

    saveCurrentMatch(match);
    saveCurrentMatchToList();

    if (
        document.getElementById(
            "matchResultScreen"
        )
    ) {

        part2OpenScreen(
            "matchResultScreen"
        );
    }
}

/* =========================================================
   COMPLETE BUTTONS
========================================================= */

function setupCompleteButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "button"
                );

            if (!button) {
                return;
            }

            const text =
                (
                    button.innerText ||
                    ""
                )
                .trim()
                .toUpperCase();

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) ||
                    ""
                )
                .toLowerCase();


            if (
                text === "COMPLETE INNINGS" ||
                action === "innings-complete"
            ) {

                event.preventDefault();

                completeInnings();

            }


            if (
                text === "END MATCH" ||
                text === "COMPLETE MATCH" ||
                action === "complete-match"
            ) {

                event.preventDefault();

                completeMatch();

            }

        },
        true
    );

}

/* =========================================================
   MATCH LIST LOAD
========================================================= */

function loadMatchesUI() {

    const matches =
        getMatches();

    console.log(
        "SAVED MATCHES:",
        matches.length
    );
}

/* =========================================================
   PART 3 INITIALIZE
========================================================= */

function initializeCricYuvaPart3() {

    console.log(
        "CRIC YUVA FINAL SCRIPT PART 3 LOADED"
    );

    setupMatchButtons();

    setupPlayingTeamButtons();

    setupPlaying11Buttons();

    setupScoringButtons();

    setupCompleteButtons();

    loadMatchesUI();

    updateLiveScoreUI();

    window.createNewMatch =
        createNewMatch;

    window.saveMatchDetails =
        saveMatchDetails;

    window.addRuns =
        addRuns;

    window.addWide =
        addWide;

    window.addNoBall =
        addNoBall;

    window.addWicket =
        addWicket;

    window.addDotBall =
        addDotBall;

    window.undoLastBall =
        undoLastBall;

    window.updateLiveScoreUI =
        updateLiveScoreUI;

    console.log(
        "PART 3 READY"
    );
}


if (
    document.readyState === "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeCricYuvaPart3,
        { once: true }
    );

} else {

    initializeCricYuvaPart3();
}

/* =========================================================
   CRIC YUVA V1.0
   FINAL WORKING SCRIPT
   PART 4
   TOURNAMENT + AUCTION + SOCIAL + SETTINGS
========================================================= */

"use strict";

/* =========================================================
   PART 4 STORAGE HELPERS
========================================================= */

function part4Get(key, fallback) {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : fallback;
    } catch (error) {
        console.error("PART 4 LOAD ERROR:", key, error);
        return fallback;
    }
}

function part4Set(key, value) {
    try {
        localStorage.setItem(
            key,
            JSON.stringify(value)
        );
        return true;
    } catch (error) {
        console.error("PART 4 SAVE ERROR:", key, error);
        return false;
    }
}

/* =========================================================
   TOURNAMENT STORAGE
========================================================= */

function getTournaments() {
    return part4Get(
        "cricYuvaTournaments",
        []
    );
}

function saveTournaments(tournaments) {
    return part4Set(
        "cricYuvaTournaments",
        tournaments
    );
}

function getCurrentTournament() {
    return part4Get(
        "cricYuvaCurrentTournament",
        null
    );
}

function saveCurrentTournament(tournament) {
    return part4Set(
        "cricYuvaCurrentTournament",
        tournament
    );
}

/* =========================================================
   CREATE TOURNAMENT
========================================================= */

function createTournamentData() {

    const tournament = {
        id: "tournament_" + Date.now(),
        name: "",
        organizer: "",
        location: "",
        startDate: "",
        endDate: "",
        teams: [],
        players: [],
        matches: [],
        groups: [],
        status: "upcoming",
        createdAt: new Date().toISOString()
    };

    saveCurrentTournament(tournament);

    return tournament;
}

/* =========================================================
   SAVE TOURNAMENT
========================================================= */

function saveTournamentToList() {

    const tournament =
        getCurrentTournament();

    if (!tournament) {
        return false;
    }

    const tournaments =
        getTournaments();

    const index =
        tournaments.findIndex(
            function(item) {
                return item.id === tournament.id;
            }
        );

    if (index >= 0) {
        tournaments[index] = tournament;
    } else {
        tournaments.push(tournament);
    }

    saveTournaments(tournaments);

    return true;
}

/* =========================================================
   FIND TOURNAMENT INPUT
========================================================= */

function getTournamentInput(ids) {

    for (let i = 0; i < ids.length; i++) {

        const element =
            document.getElementById(ids[i]);

        if (
            element &&
            element.value !== undefined &&
            String(element.value).trim()
        ) {
            return String(
                element.value
            ).trim();
        }
    }

    return "";
}

/* =========================================================
   SAVE TOURNAMENT DETAILS
========================================================= */

function saveTournamentDetails() {

    let tournament =
        getCurrentTournament();

    if (!tournament) {
        tournament =
            createTournamentData();
    }

    const name =
        getTournamentInput([
            "tournamentName",
            "newTournamentName",
            "createTournamentName"
        ]);

    const organizer =
        getTournamentInput([
            "tournamentOrganizer",
            "organizerName"
        ]);

    const location =
        getTournamentInput([
            "tournamentLocation",
            "tournamentVenue",
            "venueName"
        ]);

    const startDate =
        getTournamentInput([
            "tournamentStartDate",
            "startDate"
        ]);

    const endDate =
        getTournamentInput([
            "tournamentEndDate",
            "endDate"
        ]);

    if (name) {
        tournament.name = name;
    }

    if (organizer) {
        tournament.organizer = organizer;
    }

    if (location) {
        tournament.location = location;
    }

    if (startDate) {
        tournament.startDate = startDate;
    }

    if (endDate) {
        tournament.endDate = endDate;
    }

    saveCurrentTournament(tournament);
    saveTournamentToList();

    console.log(
        "TOURNAMENT SAVED:",
        tournament
    );

    return tournament;
}

/* =========================================================
   CREATE TOURNAMENT BUTTONS
========================================================= */

function setupTournamentButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest("button");

            if (!button) {
                return;
            }

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                ).toLowerCase();

            const id =
                button.id || "";

            const text =
                (
                    button.innerText ||
                    ""
                ).trim().toUpperCase();


            /* CREATE NEW TOURNAMENT */

            if (
                id ===
                "createNewTournamentButton" ||
                action ===
                "create-new-tournament"
            ) {

                event.preventDefault();

                createTournamentData();

                if (
                    document.getElementById(
                        "createTournamentScreen"
                    )
                ) {

                    part2OpenScreen(
                        "createTournamentScreen"
                    );
                }

                return;
            }


            /* SAVE TOURNAMENT */

            const activeScreen =
                document.querySelector(
                    ".app-screen.active"
                );

            if (
                activeScreen &&
                activeScreen.id ===
                "createTournamentScreen" &&
                (
                    text === "SAVE" ||
                    text === "CREATE TOURNAMENT" ||
                    action === "save-tournament"
                )
            ) {

                event.preventDefault();
                event.stopPropagation();

                const tournament =
                    saveTournamentDetails();

                if (
                    !tournament.name
                ) {

                    alert(
                        "Please enter tournament name"
                    );

                    return;
                }

                alert(
                    "Tournament created successfully!"
                );

                if (
                    document.getElementById(
                        "tournamentDetailsScreen"
                    )
                ) {

                    part2OpenScreen(
                        "tournamentDetailsScreen"
                    );
                }

                return;
            }

        },
        true
    );
}

/* =========================================================
   TOURNAMENT TEAM SYSTEM
========================================================= */

function addTeamToTournament(teamName) {

    if (!teamName) {
        return false;
    }

    let tournament =
        getCurrentTournament();

    if (!tournament) {
        tournament =
            createTournamentData();
    }

    const cleanName =
        String(teamName).trim();

    if (!cleanName) {
        return false;
    }

    const exists =
        tournament.teams.some(
            function(team) {

                return (
                    String(
                        team.name
                    ).toLowerCase() ===
                    cleanName.toLowerCase()
                );
            }
        );

    if (exists) {

        alert(
            "This team already exists!"
        );

        return false;
    }

    tournament.teams.push({
        id: "tteam_" + Date.now(),
        name: cleanName,
        players: []
    });

    saveCurrentTournament(
        tournament
    );

    saveTournamentToList();

    console.log(
        "TOURNAMENT TEAM ADDED:",
        cleanName
    );

    return true;
}

/* =========================================================
   ADD TOURNAMENT TEAM BUTTON
========================================================= */

function setupTournamentTeamButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest("button");

            if (!button) {
                return;
            }

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                ).toLowerCase();

            const id =
                button.id || "";

            if (
                action !==
                "add-tournament-team" &&
                id !==
                "addTournamentTeamButton"
            ) {
                return;
            }

            event.preventDefault();

            const teamName =
                getTournamentInput([
                    "tournamentTeamName",
                    "newTournamentTeamName",
                    "teamNameInput"
                ]);

            if (!teamName) {

                alert(
                    "Please enter team name"
                );

                return;
            }

            if (
                addTeamToTournament(
                    teamName
                )
            ) {

                alert(
                    "Team added successfully!"
                );
            }

        },
        true
    );
}

/* =========================================================
   AUCTION DATA
========================================================= */

function getAuctionData() {
    return part4Get(
        "cricYuvaAuctionData",
        {
            players: [],
            soldPlayers: [],
            currentPlayerId: null,
            status: "not-started"
        }
    );
}

function saveAuctionData(data) {
    return part4Set(
        "cricYuvaAuctionData",
        data
    );
}

/* =========================================================
   START AUCTION
========================================================= */

function startAuction() {

    const auction =
        getAuctionData();

    auction.status =
        "live";

    saveAuctionData(
        auction
    );

    if (
        document.getElementById(
            "tournamentAuctionScreen"
        )
    ) {

        part2OpenScreen(
            "tournamentAuctionScreen"
        );
    }

    console.log(
        "AUCTION STARTED"
    );
}

/* =========================================================
   AUCTION BUTTON SYSTEM
========================================================= */

function setupAuctionButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest("button");

            if (!button) {
                return;
            }

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                ).toLowerCase();

            const id =
                button.id || "";

            const text =
                (
                    button.innerText ||
                    ""
                ).trim().toUpperCase();


            if (
                action ===
                "start-auction" ||
                id ===
                "startAuctionButton" ||
                text ===
                "START AUCTION"
            ) {

                event.preventDefault();

                startAuction();

                return;
            }


            if (
                action ===
                "next-player" ||
                id ===
                "nextAuctionPlayerButton"
            ) {

                event.preventDefault();

                const auction =
                    getAuctionData();

                if (
                    !auction.players ||
                    auction.players.length === 0
                ) {

                    alert(
                        "No players available for auction"
                    );

                    return;
                }

                let index =
                    auction.players.findIndex(
                        function(player) {

                            return (
                                player.id ===
                                auction.currentPlayerId
                            );
                        }
                    );

                index++;

                if (
                    index >=
                    auction.players.length
                ) {
                    index = 0;
                }

                auction.currentPlayerId =
                    auction.players[index].id;

                saveAuctionData(
                    auction
                );

                console.log(
                    "NEXT AUCTION PLAYER:",
                    auction.players[index]
                );

                return;
            }

        },
        true
    );
}

/* =========================================================
   FRIENDS SYSTEM
========================================================= */

function getFriends() {
    return part4Get(
        "cricYuvaFriends",
        []
    );
}

function saveFriends(friends) {
    return part4Set(
        "cricYuvaFriends",
        friends
    );
}

function addFriend(friend) {

    if (!friend) {
        return false;
    }

    const friends =
        getFriends();

    const name =
        String(friend.name || "")
        .trim();

    if (!name) {
        return false;
    }

    const exists =
        friends.some(
            function(item) {

                return (
                    String(
                        item.name
                    ).toLowerCase() ===
                    name.toLowerCase()
                );
            }
        );

    if (exists) {
        return false;
    }

    friends.push({
        id: "friend_" + Date.now(),
        name: name,
        mobile: friend.mobile || "",
        photo: friend.photo || "",
        status: "accepted",
        addedAt: new Date().toISOString()
    });

    saveFriends(
        friends
    );

    return true;
}

/* =========================================================
   FRIEND BUTTONS
========================================================= */

function setupFriendButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest("button");

            if (!button) {
                return;
            }

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                ).toLowerCase();

            if (
                action ===
                "accept-friend"
            ) {

                event.preventDefault();

                button.textContent =
                    "Friends";

                button.classList.add(
                    "accepted"
                );

                console.log(
                    "FRIEND ACCEPTED"
                );
            }

        },
        true
    );
}

/* =========================================================
   GROUP SYSTEM
========================================================= */

function getGroups() {
    return part4Get(
        "cricYuvaGroups",
        []
    );
}

function saveGroups(groups) {
    return part4Set(
        "cricYuvaGroups",
        groups
    );
}

function createGroup(name) {

    const cleanName =
        String(name || "")
        .trim();

    if (!cleanName) {
        return false;
    }

    const groups =
        getGroups();

    groups.push({
        id: "group_" + Date.now(),
        name: cleanName,
        members: [],
        messages: [],
        createdAt:
            new Date().toISOString()
    });

    saveGroups(
        groups
    );

    return true;
}

/* =========================================================
   CREATE GROUP BUTTON
========================================================= */

function setupGroupButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest("button");

            if (!button) {
                return;
            }

            const id =
                button.id || "";

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                ).toLowerCase();


            if (
                id !==
                "createGroupButton" &&
                id !==
                "createFirstGroupButton" &&
                action !==
                "create-group"
            ) {
                return;
            }

            event.preventDefault();

            const groupName =
                getTournamentInput([
                    "groupName",
                    "newGroupName",
                    "createGroupName"
                ]);

            if (!groupName) {

                if (
                    document.getElementById(
                        "createGroupForm"
                    )
                ) {

                    part2OpenScreen(
                        "createGroupForm"
                    );

                    return;
                }

                alert(
                    "Please enter group name"
                );

                return;
            }

            if (
                createGroup(groupName)
            ) {

                alert(
                    "Group created successfully!"
                );
            }

        },
        true
    );
}

/* =========================================================
   CHAT SYSTEM
========================================================= */

function getChatMessages() {
    return part4Get(
        "cricYuvaChatMessages",
        []
    );
}

function saveChatMessages(messages) {
    return part4Set(
        "cricYuvaChatMessages",
        messages
    );
}

function sendChatMessage(message) {

    const cleanMessage =
        String(message || "")
        .trim();

    if (!cleanMessage) {
        return false;
    }

    const messages =
        getChatMessages();

    messages.push({
        id: "message_" + Date.now(),
        message: cleanMessage,
        sender: "Me",
        time:
            new Date().toISOString()
    });

    saveChatMessages(
        messages
    );

    return true;
}

/* =========================================================
   CHAT SEND BUTTON
========================================================= */

function setupChatButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest("button");

            if (!button) {
                return;
            }

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                ).toLowerCase();

            const id =
                button.id || "";

            if (
                action !==
                "send-message" &&
                id !==
                "sendMessageButton"
            ) {
                return;
            }

            event.preventDefault();

            const input =
                document.getElementById(
                    "chatMessageInput"
                ) ||
                document.getElementById(
                    "messageInput"
                );

            if (!input) {
                return;
            }

            if (
                sendChatMessage(
                    input.value
                )
            ) {

                input.value = "";

                console.log(
                    "CHAT MESSAGE SENT"
                );
            }

        },
        true
    );
}

/* =========================================================
   NOTIFICATION SYSTEM
========================================================= */

function getNotifications() {
    return part4Get(
        "cricYuvaNotifications",
        []
    );
}

function saveNotifications(data) {
    return part4Set(
        "cricYuvaNotifications",
        data
    );
}

function addNotification(
    title,
    message
) {

    const notifications =
        getNotifications();

    notifications.unshift({
        id: "notification_" + Date.now(),
        title: title || "Cric Yuva",
        message: message || "",
        read: false,
        time:
            new Date().toISOString()
    });

    saveNotifications(
        notifications
    );
}

/* =========================================================
   SETTINGS SYSTEM
========================================================= */

function getSettings() {
    return part4Get(
        "cricYuvaSettings",
        {
            notifications: true,
            darkMode: false,
            sound: true
        }
    );
}

function saveSettings(settings) {
    return part4Set(
        "cricYuvaSettings",
        settings
    );
}

function setupSettingsButtons() {

    document.addEventListener(
        "change",
        function(event) {

            const input =
                event.target;

            if (
                !input ||
                input.type !== "checkbox"
            ) {
                return;
            }

            const id =
                input.id || "";

            const settings =
                getSettings();

            if (
                id ===
                "notificationToggle" ||
                id ===
                "loginAlertsToggle"
            ) {

                settings.notifications =
                    input.checked;

                saveSettings(
                    settings
                );
            }

            if (
                id ===
                "darkModeToggle"
            ) {

                settings.darkMode =
                    input.checked;

                document.body.classList.toggle(
                    "dark-mode",
                    input.checked
                );

                saveSettings(
                    settings
                );
            }

            if (
                id ===
                "soundToggle"
            ) {

                settings.sound =
                    input.checked;

                saveSettings(
                    settings
                );
            }

        },
        true
    );
}

/* =========================================================
   BACKUP DATA
========================================================= */

function createCricYuvaBackup() {

    const backup = {
        account:
            part4Get(
                "cricYuvaAccount",
                {}
            ),

        teams:
            part4Get(
                "cricYuvaTeams",
                []
            ),

        matches:
            part4Get(
                "cricYuvaMatches",
                []
            ),

        tournaments:
            getTournaments(),

        friends:
            getFriends(),

        groups:
            getGroups(),

        chatMessages:
            getChatMessages(),

        settings:
            getSettings(),

        createdAt:
            new Date().toISOString()
    };

    localStorage.setItem(
        "cricYuvaBackup",
        JSON.stringify(backup)
    );

    console.log(
        "BACKUP CREATED:",
        backup
    );

    return backup;
}

/* =========================================================
   DOWNLOAD BACKUP
========================================================= */

function downloadCricYuvaBackup() {

    const backup =
        createCricYuvaBackup();

    const blob =
        new Blob(
            [
                JSON.stringify(
                    backup,
                    null,
                    2
                )
            ],
            {
                type:
                    "application/json"
            }
        );

    const url =
        URL.createObjectURL(
            blob
        );

    const link =
        document.createElement("a");

    link.href = url;

    link.download =
        "cric-yuva-backup-" +
        Date.now() +
        ".json";

    document.body.appendChild(
        link
    );

    link.click();

    link.remove();

    URL.revokeObjectURL(
        url
    );

    alert(
        "Backup created successfully!"
    );
}

/* =========================================================
   BACKUP BUTTONS
========================================================= */

function setupBackupButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "button"
                );

            if (!button) {
                return;
            }

            const id =
                button.id || "";

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                ).toLowerCase();


            if (
                id ===
                "createDataBackupButton" ||
                id ===
                "createFullBackupButton" ||
                id ===
                "backupDataCreateButton" ||
                action ===
                "create-backup"
            ) {

                event.preventDefault();

                downloadCricYuvaBackup();

            }

        },
        true
    );
}

/* =========================================================
   RESET APP DATA
========================================================= */

function resetCricYuvaData() {

    const confirmed =
        confirm(
            "Are you sure you want to delete all Cric Yuva data?"
        );

    if (!confirmed) {
        return;
    }

    const keys = [
        "cricYuvaAccount",
        "cricYuvaLoggedIn",
        "cricYuvaTeams",
        "cricYuvaMatches",
        "cricYuvaCurrentMatch",
        "cricYuvaTournaments",
        "cricYuvaCurrentTournament",
        "cricYuvaAuctionData",
        "cricYuvaFriends",
        "cricYuvaGroups",
        "cricYuvaChatMessages",
        "cricYuvaNotifications",
        "cricYuvaSettings"
    ];

    keys.forEach(
        function(key) {
            localStorage.removeItem(key);
        }
    );

    alert(
        "All Cric Yuva data has been deleted."
    );

    window.location.reload();
}

/* =========================================================
   RESET BUTTON DETECTOR
========================================================= */

function setupResetButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "button"
                );

            if (!button) {
                return;
            }

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                ).toLowerCase();

            const id =
                button.id || "";

            if (
                action ===
                "reset-data" ||
                id ===
                "resetDataButton"
            ) {

                event.preventDefault();

                resetCricYuvaData();
            }

        },
        true
    );
}

/* =========================================================
   PART 4 GLOBAL FUNCTIONS
========================================================= */

window.createTournamentData =
    createTournamentData;

window.saveTournamentDetails =
    saveTournamentDetails;

window.addTeamToTournament =
    addTeamToTournament;

window.startAuction =
    startAuction;

window.addFriend =
    addFriend;

window.createGroup =
    createGroup;

window.sendChatMessage =
    sendChatMessage;

window.createCricYuvaBackup =
    createCricYuvaBackup;

window.downloadCricYuvaBackup =
    downloadCricYuvaBackup;

window.resetCricYuvaData =
    resetCricYuvaData;

/* =========================================================
   PART 4 INITIALIZATION
========================================================= */

function initializeCricYuvaPart4() {

    console.log(
        "CRIC YUVA FINAL SCRIPT PART 4 LOADED"
    );

    setupTournamentButtons();

    setupTournamentTeamButtons();

    setupAuctionButtons();

    setupFriendButtons();

    setupGroupButtons();

    setupChatButtons();

    setupSettingsButtons();

    setupBackupButtons();

    setupResetButtons();

    console.log(
        "PART 4 READY"
    );
}

if (
    document.readyState === "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeCricYuvaPart4,
        { once: true }
    );

} else {

    initializeCricYuvaPart4();
}

/* =========================================================
   CRIC YUVA V1.0
   FINAL WORKING SCRIPT
   PART 5
   REMAINING SCREENS + PROFILE + SETTINGS + NAVIGATION
========================================================= */

"use strict";

/* =========================================================
   PART 5 SAFE SCREEN OPEN
========================================================= */

function part5OpenScreen(screenId) {

    if (
        typeof part2OpenScreen === "function"
    ) {
        return part2OpenScreen(screenId);
    }

    const target =
        document.getElementById(screenId);

    if (!target) {
        console.warn(
            "SCREEN NOT FOUND:",
            screenId
        );
        return false;
    }

    document
        .querySelectorAll(".app-screen")
        .forEach(function(screen) {
            screen.classList.remove("active");
        });

    target.classList.add("active");

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

    return true;
}


/* =========================================================
   SCREEN ACTION MAP
========================================================= */

const part5ScreenMap = {

    "about": "aboutScreen",

    "profile": "playerProfileScreen",

    "player-profile":
        "playerProfileScreen",

    "player-public-profile":
        "playerPublicProfileScreen",

    "player-statistics":
        "playerStatisticsScreen",

    "statistics":
        "playerStatisticsScreen",

    "player-achievements":
        "playerAchievementsScreen",

    "achievements":
        "playerAchievementsScreen",

    "friends":
        "friendsScreen",

    "player-friends":
        "playerFriendsScreen",

    "player-requests":
        "playerRequestsScreen",

    "groups":
        "groupsScreen",

    "team-chat":
        "teamChatScreen",

    "subscription":
        "subscriptionScreen",
        "payment": "subscriptionScreen",

    "settings":
        "settingsScreen",

    "privacy":
        "privacySettingsScreen",

    "security-settings":
        "securitySettingsScreen",

    "change-password":
        "changePasswordScreen",

    "help":
        "helpSupportScreen",

    "help-support":
        "helpSupportScreen",

    "contact":
        "helpSupportScreen",

    "updates":
        "updatesScreen",

    "terms":
        "termsConditionsScreen",

    "matches":
        "matchesScreen",

    "match-history":
        "matchHistoryScreen",

    "match-settings":
        "matchSettingsScreen",

    "match-details":
        "matchDetailsScreen",

    "scorecard":
        "scorecardScreen",

    "leaderboard":
        "tournamentLeaderboardScreen",

    "ground":
        "groundDetailsScreen",

    "live":
        "liveScoreScreen",

    "live-score":
        "liveScoreScreen",

    "live-match-center":
        "liveMatchCenterScreen",

    "live-match-details":
        "liveMatchDetailsScreen",

    "tournaments":
        "tournamentsScreen",

    "tournament":
        "tournamentsScreen",

    "tournament-details":
        "tournamentDetailsScreen",

    "tournament-rules":
        "tournamentRulesScreen",

    "tournament-schedule":
        "tournamentScheduleScreen",

    "tournament-teams":
        "tournamentTeamsScreen",

    "tournament-auction":
        "tournamentAuctionScreen",

    "manage-roles":
        "manageRolesScreen",

    "playing11":
        "playing11Screen",

    "select-batsmen":
        "selectBatsmenScreen",

    "select-playing-team":
        "selectPlayingTeamScreen",

    "match-awards":
        "matchAwardsScreen",

    "share":
        "shareMatchScreen",

    "add-player":
        "addPlayerScreen",

    "players":
        "playerProfileScreen"
};


/* =========================================================
   GENERIC DATA-ACTION NAVIGATION
========================================================= */

function setupPart5Navigation() {

    document.addEventListener(
        "click",
        function(event) {

            const element =
                event.target.closest(
                    "[data-action]"
                );

            if (!element) {
                return;
            }

            const action =
                (
                    element.getAttribute(
                        "data-action"
                    ) || ""
                )
                .trim()
                .toLowerCase();

            const screenId =
                part5ScreenMap[action];

            if (!screenId) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            part5OpenScreen(screenId);

        },
        true
    );
}


/* =========================================================
   GENERIC BACK BUTTON SYSTEM
========================================================= */

function part5GoBack() {

    if (
        typeof part2GoBack === "function"
    ) {
        part2GoBack();
        return;
    }

    const history =
        JSON.parse(
            sessionStorage.getItem(
                "cricYuvaScreenHistory"
            ) || "[]"
        );

    if (
        history.length > 0
    ) {

        const previous =
            history.pop();

        sessionStorage.setItem(
            "cricYuvaScreenHistory",
            JSON.stringify(history)
        );

        part5OpenScreen(previous);

        return;
    }

    if (
        document.getElementById(
            "screen4"
        )
    ) {
        part5OpenScreen("screen4");
    }
}


function setupPart5BackButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "button, [role='button']"
                );

            if (!button) {
                return;
            }

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                )
                .trim()
                .toLowerCase();

            const id =
                (
                    button.id || ""
                )
                .toLowerCase();

            const text =
                (
                    button.innerText ||
                    button.textContent ||
                    ""
                )
                .trim()
                .toUpperCase();

            if (
                action === "back" ||
                action === "go-back" ||
                id.includes("back") ||
                text === "BACK"
            ) {

                event.preventDefault();
                event.stopPropagation();

                part5GoBack();
            }

        },
        true
    );
}


/* =========================================================
   GET ACCOUNT FOR PROFILE
========================================================= */

function part5GetAccount() {

    try {

        return JSON.parse(
            localStorage.getItem(
                "cricYuvaAccount"
            )
        ) || {};

    } catch (error) {

        return {};
    }
}


function part5SaveAccount(account) {

    localStorage.setItem(
        "cricYuvaAccount",
        JSON.stringify(account)
    );
}


/* =========================================================
   LOAD PROFILE EVERY TIME
========================================================= */

function part5LoadProfile() {

    const account =
        part5GetAccount();

    const mobile =
        account.mobile ||
        localStorage.getItem(
            "cricYuvaMobile"
        ) ||
        "";

    const name =
        account.name || "";

    const email =
        account.email || "";

    const profileMobile =
        document.getElementById(
            "profileMobile"
        );

    if (profileMobile) {
        profileMobile.value = mobile;
    }

    const profileName =
        document.getElementById(
            "profileName"
        );

    if (profileName) {
        profileName.value = name;
    }

    const profileEmail =
        document.getElementById(
            "profileEmail"
        );

    if (profileEmail) {
        profileEmail.value = email;
    }

    const jerseyName =
        document.getElementById(
            "jerseyName"
        );

    if (jerseyName) {
        jerseyName.value =
            account.jerseyName || "";
    }

    const jerseyNumber =
        document.getElementById(
            "jerseyNumber"
        );

    if (jerseyNumber) {
        jerseyNumber.value =
            account.jerseyNumber || "";
    }

    const jerseySize =
        document.getElementById(
            "jerseySize"
        );

    if (jerseySize) {
        jerseySize.value =
            account.jerseySize || "";
    }

    const pantSize =
        document.getElementById(
            "pantSize"
        );

    if (pantSize) {
        pantSize.value =
            account.pantSize || "";
    }

    const profilePhoto =
        document.getElementById(
            "profilePhoto"
        );

    if (
        profilePhoto &&
        account.photo
    ) {

        profilePhoto.style.backgroundImage =
            "url('" +
            account.photo +
            "')";

        profilePhoto.style.backgroundSize =
            "cover";

        profilePhoto.style.backgroundPosition =
            "center";

        const initial =
            document.getElementById(
                "profileInitial"
            );

        if (initial) {
            initial.style.display = "none";
        }
    }
}


/* =========================================================
   SAVE PROFILE - EXTRA FIELDS
========================================================= */

function part5SaveProfile() {

    const account =
        part5GetAccount();

    const name =
        document.getElementById(
            "profileName"
        );

    const mobile =
        document.getElementById(
            "profileMobile"
        );

    const email =
        document.getElementById(
            "profileEmail"
        );

    const jerseyName =
        document.getElementById(
            "jerseyName"
        );

    const jerseyNumber =
        document.getElementById(
            "jerseyNumber"
        );

    const jerseySize =
        document.getElementById(
            "jerseySize"
        );

    const pantSize =
        document.getElementById(
            "pantSize"
        );


    if (name) {
        account.name =
            name.value.trim();
    }

    if (
        mobile &&
        mobile.value.trim()
    ) {
        account.mobile =
            mobile.value.trim();

        localStorage.setItem(
            "cricYuvaMobile",
            account.mobile
        );
    }

    if (email) {
        account.email =
            email.value.trim();
    }

    if (jerseyName) {
        account.jerseyName =
            jerseyName.value.trim();
    }

    if (jerseyNumber) {
        account.jerseyNumber =
            jerseyNumber.value.trim();
    }

    if (jerseySize) {
        account.jerseySize =
            jerseySize.value;
    }

    if (pantSize) {
        account.pantSize =
            pantSize.value;
    }

    part5SaveAccount(account);

    part5LoadProfile();

    return true;
}


/* =========================================================
   PROFILE SAVE BUTTON
========================================================= */

function setupPart5ProfileSave() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest("button");

            if (!button) {
                return;
            }

            const activeScreen =
                document.querySelector(
                    ".app-screen.active"
                );

            if (
                !activeScreen ||
                activeScreen.id !==
                "playerProfileScreen"
            ) {
                return;
            }

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                )
                .toLowerCase();

            const text =
                (
                    button.innerText ||
                    ""
                )
                .trim()
                .toUpperCase();

            if (
                action === "save-profile" ||
                text === "SAVE" ||
                text === "SAVE PROFILE"
            ) {

                event.preventDefault();
                event.stopPropagation();

                part5SaveProfile();

                alert(
                    "Profile saved successfully!"
                );
            }

        },
        true
    );
}


/* =========================================================
   CHANGE PASSWORD SYSTEM
========================================================= */

function part5ChangePassword() {

    const current =
        document.getElementById(
            "currentPasswordInput"
        );

    const newPassword =
        document.getElementById(
            "newPasswordInput"
        );

    const confirmPassword =
        document.getElementById(
            "confirmNewPasswordInput"
        );

    if (
        !current ||
        !newPassword ||
        !confirmPassword
    ) {
        return false;
    }

    const account =
        part5GetAccount();

    if (
        !current.value
    ) {

        alert(
            "Please enter current password"
        );

        return false;
    }

    if (
        account.password &&
        current.value !==
        account.password
    ) {

        alert(
            "Current password is incorrect"
        );

        return false;
    }

    if (
        newPassword.value.length < 4
    ) {

        alert(
            "New password must be at least 4 characters"
        );

        return false;
    }

    if (
        newPassword.value !==
        confirmPassword.value
    ) {

        alert(
            "New password and confirm password do not match"
        );

        return false;
    }

    account.password =
        newPassword.value;

    part5SaveAccount(account);

    current.value = "";
    newPassword.value = "";
    confirmPassword.value = "";

    alert(
        "Password changed successfully!"
    );

    return true;
}


function setupPart5Password() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest("button");

            if (!button) {
                return;
            }

            const id =
                button.id || "";

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                ).toLowerCase();

            if (
                id ===
                "saveNewPasswordButton" ||
                action ===
                "save-new-password"
            ) {

                event.preventDefault();

                part5ChangePassword();
            }

        },
        true
    );
}


/* =========================================================
   SHARE SYSTEM
========================================================= */

function part5ShareApp() {

    const text =
        "Join me on Cric Yuva!";

    if (
        navigator.share
    ) {

        navigator.share({
            title: "Cric Yuva",
            text: text,
            url: window.location.href
        })
        .catch(function(error) {
            console.log(
                "Share cancelled:",
                error
            );
        });

    } else {

        navigator.clipboard
            .writeText(
                window.location.href
            )
            .then(function() {

                alert(
                    "App link copied successfully!"
                );

            })
            .catch(function() {

                alert(
                    "Sharing is not supported on this device"
                );
            });
    }
}


function setupPart5Share() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "button, [data-action='share-app']"
                );

            if (!button) {
                return;
            }

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                ).toLowerCase();

            if (
                action ===
                "share-app" ||
                action ===
                "share"
            ) {

                event.preventDefault();

                part5ShareApp();
            }

        },
        true
    );
}


/* =========================================================
   LOGOUT SYSTEM
========================================================= */

function part5Logout() {

    localStorage.removeItem(
        "cricYuvaLoggedIn"
    );

    sessionStorage.removeItem(
        "cricYuvaScreenHistory"
    );

    if (
        document.getElementById(
            "screen2"
        )
    ) {

        part5OpenScreen(
            "screen2"
        );

    } else {

        window.location.reload();
    }
}


function setupPart5Logout() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "button"
                );

            if (!button) {
                return;
            }

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                ).toLowerCase();

            const id =
                (
                    button.id || ""
                ).toLowerCase();

            const text =
                (
                    button.innerText ||
                    ""
                )
                .trim()
                .toUpperCase();

            if (
                action === "logout" ||
                id === "logoutbutton" ||
                text === "LOGOUT" ||
                text === "LOG OUT"
            ) {

                event.preventDefault();

                const confirmLogout =
                    confirm(
                        "Do you want to logout?"
                    );

                if (
                    confirmLogout
                ) {
                    part5Logout();
                }
            }

        },
        true
    );
}


/* =========================================================
   LOAD PROFILE ON SCREEN OPEN
========================================================= */

function setupPart5ProfileAutoLoad() {

    document.addEventListener(
        "click",
        function(event) {

            const element =
                event.target.closest(
                    "[data-action='profile'], " +
                    "[data-action='player-profile']"
                );

            if (element) {

                setTimeout(
                    part5LoadProfile,
                    100
                );
            }

        },
        true
    );

    part5LoadProfile();
}


/* =========================================================
   PART 5 GLOBAL FUNCTIONS
========================================================= */

window.part5OpenScreen =
    part5OpenScreen;

window.part5GoBack =
    part5GoBack;

window.part5LoadProfile =
    part5LoadProfile;

window.part5SaveProfile =
    part5SaveProfile;

window.part5ChangePassword =
    part5ChangePassword;

window.part5ShareApp =
    part5ShareApp;

window.part5Logout =
    part5Logout;


/* =========================================================
   PART 5 INITIALIZATION
========================================================= */

function initializeCricYuvaPart5() {

    console.log(
        "CRIC YUVA FINAL SCRIPT PART 5 LOADED"
    );

    setupPart5Navigation();

    setupPart5BackButtons();

    setupPart5ProfileSave();

    setupPart5Password();

    setupPart5Share();

    setupPart5Logout();

    setupPart5ProfileAutoLoad();

    console.log(
        "PART 5 READY"
    );
}


if (
    document.readyState === "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeCricYuvaPart5,
        { once: true }
    );

} else {

    initializeCricYuvaPart5();
        }

/* =========================================================
   CRIC YUVA V1.0
   FINAL WORKING SCRIPT
   PART 6
   FINAL HISTORY + BACK BUTTON + NAVIGATION FIX
========================================================= */

"use strict";


/* =========================================================
   PART 6 SCREEN HISTORY SYSTEM
========================================================= */

const CRIC_YUVA_HISTORY_KEY =
    "cricYuvaScreenHistory";

let part6CurrentScreen =
    sessionStorage.getItem(
        "cricYuvaCurrentScreen"
    ) || "home";


function part6GetHistory() {

    try {

        const saved =
            JSON.parse(
                sessionStorage.getItem(
                    CRIC_YUVA_HISTORY_KEY
                ) || "[]"
            );

        return Array.isArray(saved)
            ? saved
            : [];

    } catch (error) {

        return [];
    }
}


function part6SaveHistory(history) {

    sessionStorage.setItem(
        CRIC_YUVA_HISTORY_KEY,
        JSON.stringify(history)
    );
}


/* =========================================================
   FIND ACTIVE SCREEN
========================================================= */

function part6GetActiveScreenId() {

    const activeScreen =
        document.querySelector(
            ".app-screen.active, .page.active"
        );

    if (activeScreen) {
        return activeScreen.id;
    }

    return part6CurrentScreen;
}


/* =========================================================
   SAVE CURRENT SCREEN
========================================================= */

function part6SaveCurrentScreen(screenId) {

    if (!screenId) {
        return;
    }

    part6CurrentScreen =
        screenId;

    sessionStorage.setItem(
        "cricYuvaCurrentScreen",
        screenId
    );
}


/* =========================================================
   OPEN SCREEN WITH HISTORY
========================================================= */

function part6OpenScreen(screenId, addHistory = true) {

    if (!screenId) {
        return false;
    }

    const target =
        document.getElementById(
            screenId
        );

    if (!target) {

        console.warn(
            "CRIC YUVA SCREEN NOT FOUND:",
            screenId
        );

        return false;
    }


    const previousScreen =
        part6GetActiveScreenId();


    if (
        addHistory === true &&
        previousScreen &&
        previousScreen !== screenId
    ) {

        const history =
            part6GetHistory();


        if (
            history[
                history.length - 1
            ] !== previousScreen
        ) {

            history.push(
                previousScreen
            );

            part6SaveHistory(
                history
            );
        }
    }


    const screens =
        document.querySelectorAll(
            ".app-screen, .page"
        );


    screens.forEach(
        function(screen) {

            screen.classList.remove(
                "active"
            );

        }
    );


    target.classList.add(
        "active"
    );


    part6SaveCurrentScreen(
        screenId
    );


    window.scrollTo({
        top: 0,
        left: 0,
        behavior: "smooth"
    });


    /* PROFILE DATA LOAD */

    if (
        screenId ===
        "playerProfileScreen"
    ) {

        setTimeout(
            function() {

                if (
                    typeof part5LoadProfile ===
                    "function"
                ) {

                    part5LoadProfile();

                }

            },
            100
        );
    }


    return true;
}


/* =========================================================
   UNIVERSAL GO BACK
========================================================= */

function part6GoBack() {

    let history =
        part6GetHistory();


    /* Remove current screen if accidentally stored */

    const current =
        part6GetActiveScreenId();


    while (
        history.length > 0 &&
        history[
            history.length - 1
        ] === current
    ) {

        history.pop();

    }


    if (
        history.length > 0
    ) {

        const previous =
            history.pop();

        part6SaveHistory(
            history
        );

        return part6OpenScreen(
            previous,
            false
        );
    }


    /* NO HISTORY - GO HOME */

    const homeOptions = [

        "screen5",
        "homeScreen",
        "home"

    ];


    for (
        let i = 0;
        i < homeOptions.length;
        i++
    ) {

        const homeId =
            homeOptions[i];


        if (
            document.getElementById(
                homeId
            )
        ) {

            return part6OpenScreen(
                homeId,
                false
            );
        }
    }


    return false;
}


/* =========================================================
   PART 6 OPEN SCREEN MAP
========================================================= */

const part6ScreenMap = {

    "home":
        "screen5",

    "profile":
        "playerProfileScreen",

    "player-profile":
        "playerProfileScreen",

    "public-profile":
        "playerPublicProfileScreen",

    "player-public-profile":
        "playerPublicProfileScreen",

    "friends":
        "friendsScreen",

    "player-friends":
        "playerFriendsScreen",

    "requests":
        "playerRequestsScreen",

    "player-requests":
        "playerRequestsScreen",

    "groups":
        "groupsScreen",

    "chat":
        "teamChatScreen",

    "team-chat":
        "teamChatScreen",

    "statistics":
        "playerStatisticsScreen",

    "player-statistics":
        "playerStatisticsScreen",

    "achievements":
        "playerAchievementsScreen",

    "player-achievements":
        "playerAchievementsScreen",

    "subscription":
        "subscriptionScreen",
        "payment": "subscriptionScreen",

    "settings":
        "settingsScreen",

    "privacy":
        "privacySettingsScreen",

    "security":
        "securitySettingsScreen",

    "security-settings":
        "securitySettingsScreen",

    "change-password":
        "changePasswordScreen",

    "help":
        "helpSupportScreen",

    "help-support":
        "helpSupportScreen",

    "contact":
        "helpSupportScreen",

    "updates":
        "updatesScreen",

    "terms":
        "termsConditionsScreen",

    "matches":
        "matchesScreen",

    "match-history":
        "matchHistoryScreen",

    "match-settings":
        "matchSettingsScreen",

    "match-details":
        "matchDetailsScreen",

    "scorecard":
        "scorecardScreen",

    "live":
        "liveScoreScreen",

    "live-score":
        "liveScoreScreen",

    "live-match-center":
        "liveMatchCenterScreen",

    "tournaments":
        "tournamentsScreen",

    "tournament-details":
        "tournamentDetailsScreen",

    "tournament-rules":
        "tournamentRulesScreen",

    "tournament-schedule":
        "tournamentScheduleScreen",

    "tournament-teams":
        "tournamentTeamsScreen",

    "tournament-auction":
        "tournamentAuctionScreen",

    "leaderboard":
        "tournamentLeaderboardScreen",

    "ground":
        "groundDetailsScreen",

    "playing11":
        "playing11Screen",

    "select-playing-team":
        "selectPlayingTeamScreen",

    "select-batsmen":
        "selectBatsmenScreen",

    "match-awards":
        "matchAwardsScreen",

    "manage-roles":
        "manageRolesScreen",

    "share":
        "shareMatchScreen",

    "add-player":
        "addPlayerScreen"

};


/* =========================================================
   UNIVERSAL DATA-ACTION CLICK
========================================================= */

function setupPart6Navigation() {

    document.addEventListener(
        "click",
        function(event) {

            const element =
                event.target.closest(
                    "[data-action]"
                );


            if (!element) {
                return;
            }


            const action =
                (
                    element.getAttribute(
                        "data-action"
                    ) || ""
                )
                .trim()
                .toLowerCase();


            /* BACK */

            if (
                action === "back" ||
                action === "go-back"
            ) {

                event.preventDefault();

                event.stopImmediatePropagation();

                part6GoBack();

                return;
            }


            /* SCREEN OPEN */

            const screenId =
                part6ScreenMap[
                    action
                ];


            if (!screenId) {
                return;
            }


            event.preventDefault();

            event.stopImmediatePropagation();

            part6OpenScreen(
                screenId,
                true
            );

        },
        true
    );
}


/* =========================================================
   UNIVERSAL BACK BUTTON DETECTOR
========================================================= */

function setupPart6BackButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "button, a, [role='button'], .backBtn, .back-button, .back"
                );


            if (!button) {
                return;
            }


            const id =
                (
                    button.id ||
                    ""
                )
                .toLowerCase();


            const className =
                (
                    button.className ||
                    ""
                )
                .toString()
                .toLowerCase();


            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                )
                .toLowerCase();


            const ariaLabel =
                (
                    button.getAttribute(
                        "aria-label"
                    ) || ""
                )
                .toLowerCase();


            const isBackButton =

                action === "back" ||

                action === "go-back" ||

                id.includes("back") ||

                className.includes("back") ||

                ariaLabel.includes("back");


            if (!isBackButton) {
                return;
            }


            event.preventDefault();

            event.stopImmediatePropagation();

            part6GoBack();

        },
        true
    );
}


/* =========================================================
   FIX INLINE onclick OPEN PAGE
========================================================= */

window.openPage =
    function(pageName) {

        if (
            !pageName
        ) {
            return false;
        }


        const directTarget =
            document.getElementById(
                pageName
            );


        if (directTarget) {

            return part6OpenScreen(
                pageName,
                true
            );
        }


        const mappedScreen =
            part6ScreenMap[
                String(pageName)
                    .toLowerCase()
            ];


        if (mappedScreen) {

            return part6OpenScreen(
                mappedScreen,
                true
            );
        }


        console.warn(
            "OPEN PAGE NOT FOUND:",
            pageName
        );

        return false;
    };


window.goBack =
    function() {

        return part6GoBack();

    };


/* =========================================================
   MOBILE PHONE BACK BUTTON / POPSTATE
========================================================= */

window.addEventListener(
    "popstate",
    function(event) {

        part6GoBack();

    }
);


/* =========================================================
   PROFILE SAVE BUTTON UNIVERSAL FIX
========================================================= */

function setupPart6ProfileSaveFix() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "button, [role='button']"
                );


            if (!button) {
                return;
            }


            const id =
                (
                    button.id ||
                    ""
                )
                .toLowerCase();


            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                )
                .toLowerCase();


            const text =
                (
                    button.innerText ||
                    button.textContent ||
                    ""
                )
                .trim()
                .toLowerCase();


            const isSaveProfile =

                action === "save-profile" ||

                id === "saveprofilebutton" ||

                id === "saveprofile" ||

                text === "save" ||

                text === "save profile";


            if (!isSaveProfile) {
                return;
            }


            const active =
                part6GetActiveScreenId();


            if (
                active !==
                "playerProfileScreen"
            ) {
                return;
            }


            event.preventDefault();

            event.stopImmediatePropagation();


            if (
                typeof part5SaveProfile ===
                "function"
            ) {

                const saved =
                    part5SaveProfile();


                if (saved) {

                    alert(
                        "Profile saved successfully!"
                    );

                }

            } else {

                console.error(
                    "PROFILE SAVE FUNCTION NOT FOUND"
                );

            }

        },
        true
    );
}


/* =========================================================
   LOAD SAVED MOBILE NUMBER
========================================================= */

function part6LoadMobileNumber() {

    let mobile = "";


    try {

        const account =
            JSON.parse(
                localStorage.getItem(
                    "cricYuvaAccount"
                ) || "{}"
            );


        mobile =
            account.mobile || "";

    } catch (error) {

        mobile = "";

    }


    if (!mobile) {

        mobile =
            localStorage.getItem(
                "cricYuvaMobile"
            ) || "";

    }


    const mobileFields =
        document.querySelectorAll(
            "#profileMobile, " +
            "input[name='mobile'], " +
            "input[data-field='mobile']"
        );


    mobileFields.forEach(
        function(field) {

            if (
                field &&
                mobile
            ) {

                field.value =
                    mobile;

            }

        }
    );
}


/* =========================================================
   SAVE PROFILE ON INPUT CHANGE
========================================================= */

function setupPart6ProfileInputSave() {

    const fieldIds = [

        "profileName",

        "profileMobile",

        "profileEmail",

        "jerseyName",

        "jerseyNumber",

        "jerseySize",

        "pantSize"

    ];


    fieldIds.forEach(
        function(id) {

            const field =
                document.getElementById(
                    id
                );


            if (!field) {
                return;
            }


            field.addEventListener(
                "change",
                function() {

                    try {

                        const account =
                            JSON.parse(
                                localStorage.getItem(
                                    "cricYuvaAccount"
                                ) || "{}"
                            );


                        const keyMap = {

                            profileName:
                                "name",

                            profileMobile:
                                "mobile",

                            profileEmail:
                                "email",

                            jerseyName:
                                "jerseyName",

                            jerseyNumber:
                                "jerseyNumber",

                            jerseySize:
                                "jerseySize",

                            pantSize:
                                "pantSize"

                        };


                        const key =
                            keyMap[id];


                        if (key) {

                            account[key] =
                                field.value;

                            localStorage.setItem(
                                "cricYuvaAccount",
                                JSON.stringify(
                                    account
                                )
                            );

                        }


                        if (
                            id ===
                            "profileMobile"
                        ) {

                            localStorage.setItem(
                                "cricYuvaMobile",
                                field.value
                            );

                        }

                    } catch (error) {

                        console.error(
                            error
                        );

                    }

                }
            );

        }
    );
}


/* =========================================================
   PART 6 GLOBAL FUNCTIONS
========================================================= */

window.part6OpenScreen =
    part6OpenScreen;


window.part6GoBack =
    part6GoBack;


window.part6GetHistory =
    part6GetHistory;


window.part6LoadMobileNumber =
    part6LoadMobileNumber;


/* =========================================================
   PART 6 INITIALIZATION
========================================================= */

function initializeCricYuvaPart6() {

    console.log(
        "CRIC YUVA FINAL SCRIPT PART 6 LOADED"
    );


    setupPart6Navigation();

    setupPart6BackButtons();

    setupPart6ProfileSaveFix();

    setupPart6ProfileInputSave();

    part6LoadMobileNumber();


    const activeScreen =
        part6GetActiveScreenId();


    if (
        activeScreen
    ) {

        part6SaveCurrentScreen(
            activeScreen
        );

    }


    console.log(
        "PART 6 READY"
    );
}


if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeCricYuvaPart6,
        { once: true }
    );

} else {

    initializeCricYuvaPart6();

                        }

/* =========================================================
   CRIC YUVA V1.0
   FINAL WORKING SCRIPT
   PART 7
   COMMON BUTTONS + PASSWORD + PHOTO + MODAL FIX
========================================================= */

"use strict";


/* =========================================================
   PART 7 SAFE OPEN SCREEN
========================================================= */

function part7OpenScreen(screenId) {

    if (!screenId) {
        return false;
    }

    if (
        typeof part6OpenScreen === "function"
    ) {
        return part6OpenScreen(
            screenId,
            true
        );
    }

    if (
        typeof part5OpenScreen === "function"
    ) {
        return part5OpenScreen(
            screenId
        );
    }

    const target =
        document.getElementById(
            screenId
        );

    if (!target) {
        console.warn(
            "PART 7 SCREEN NOT FOUND:",
            screenId
        );
        return false;
    }

    document
        .querySelectorAll(
            ".app-screen, .page"
        )
        .forEach(function(screen) {

            screen.classList.remove(
                "active"
            );

        });

    target.classList.add(
        "active"
    );

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

    return true;
}


/* =========================================================
   PASSWORD EYE SYSTEM
========================================================= */

function part7TogglePassword(button) {

    if (!button) {
        return false;
    }

    const targetId =
        button.getAttribute(
            "data-target"
        );

    let input = null;

    if (targetId) {

        input =
            document.getElementById(
                targetId
            );
    }


    if (!input) {

        const container =
            button.parentElement;

        if (container) {

            input =
                container.querySelector(
                    "input[type='password'], input[type='text']"
                );
        }
    }


    if (!input) {
        return false;
    }


    if (
        input.type ===
        "password"
    ) {

        input.type = "text";

        button.classList.add(
            "password-visible"
        );

    } else {

        input.type = "password";

        button.classList.remove(
            "password-visible"
        );
    }

    return true;
}


/* =========================================================
   FIX ALL PASSWORD EYE BUTTONS
========================================================= */

function setupPart7PasswordEyes() {

    const eyeMap = {

        loginEyeButton:
            "loginPassword",

        newPasswordEye:
            "newPassword",

        verifyPasswordEye:
            "verifyPassword",

        currentPasswordEye:
            "currentPasswordInput",

        newPasswordInputEye:
            "newPasswordInput",

        confirmNewPasswordEye:
            "confirmNewPasswordInput"

    };


    Object.keys(
        eyeMap
    ).forEach(function(buttonId) {

        const button =
            document.getElementById(
                buttonId
            );

        const input =
            document.getElementById(
                eyeMap[buttonId]
            );

        if (
            button &&
            input &&
            !button.dataset.part7Bound
        ) {

            button.dataset.part7Bound =
                "true";

            button.addEventListener(
                "click",
                function(event) {

                    event.preventDefault();
                    event.stopPropagation();

                    if (
                        input.type ===
                        "password"
                    ) {

                        input.type =
                            "text";

                    } else {

                        input.type =
                            "password";
                    }

                }
            );
        }
    });


    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "[data-password-toggle], " +
                    ".password-eye, " +
                    ".eye-button, " +
                    ".toggle-password"
                );

            if (!button) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            part7TogglePassword(
                button
            );

        },
        true
    );
}


/* =========================================================
   PROFILE PHOTO OPEN
========================================================= */

function setupPart7PhotoButton() {

    const photoButtons = [

        "replacePhotoBtn",

        "editProfilePhotoButton",

        "profilePhotoButton",

        "changePhotoButton"

    ];


    const fileInputs = [

        "profilePhotoInput",

        "profileImageInput",

        "photoInput"

    ];


    let fileInput = null;


    fileInputs.some(
        function(inputId) {

            const input =
                document.getElementById(
                    inputId
                );

            if (input) {

                fileInput =
                    input;

                return true;
            }

            return false;
        }
    );


    if (!fileInput) {
        return;
    }


    photoButtons.forEach(
        function(buttonId) {

            const button =
                document.getElementById(
                    buttonId
                );

            if (
                button &&
                !button.dataset.part7PhotoBound
            ) {

                button.dataset.part7PhotoBound =
                    "true";

                button.addEventListener(
                    "click",
                    function(event) {

                        event.preventDefault();
                        event.stopPropagation();

                        fileInput.click();

                    }
                );
            }
        }
    );


    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "[data-action='change-photo'], " +
                    "[data-action='replace-photo'], " +
                    "[data-action='edit-photo']"
                );

            if (!button) {
                return;
            }

            event.preventDefault();

            fileInput.click();

        },
        true
    );


    if (
        !fileInput.dataset.part7ChangeBound
    ) {

        fileInput.dataset.part7ChangeBound =
            "true";

        fileInput.addEventListener(
            "change",
            function() {

                const file =
                    fileInput.files &&
                    fileInput.files[0];

                if (!file) {
                    return;
                }


                if (
                    !file.type ||
                    !file.type.startsWith(
                        "image/"
                    )
                ) {

                    alert(
                        "Please select an image file"
                    );

                    fileInput.value =
                        "";

                    return;
                }


                const reader =
                    new FileReader();


                reader.onload =
                    function(loadEvent) {

                        const image =
                            loadEvent.target.result;


                        const profilePhoto =
                            document.getElementById(
                                "profilePhoto"
                            );


                        if (profilePhoto) {

                            profilePhoto.style.backgroundImage =
                                "url('" +
                                image +
                                "')";

                            profilePhoto.style.backgroundSize =
                                "cover";

                            profilePhoto.style.backgroundPosition =
                                "center";
                        }


                        const initial =
                            document.getElementById(
                                "profileInitial"
                            );

                        if (initial) {

                            initial.style.display =
                                "none";
                        }


                        try {

                            const account =
                                JSON.parse(
                                    localStorage.getItem(
                                        "cricYuvaAccount"
                                    ) || "{}"
                                );

                            account.photo =
                                image;

                            localStorage.setItem(
                                "cricYuvaAccount",
                                JSON.stringify(
                                    account
                                )
                            );

                        } catch (error) {

                            console.error(
                                "PHOTO SAVE ERROR:",
                                error
                            );
                        }

                    };


                reader.readAsDataURL(
                    file
                );

            }
        );
    }
}


/* =========================================================
   DATA-SCREEN BUTTON SYSTEM
========================================================= */

function setupPart7DataScreenButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "[data-screen]"
                );

            if (!button) {
                return;
            }

            const screenId =
                (
                    button.getAttribute(
                        "data-screen"
                    ) || ""
                )
                .trim();

            if (!screenId) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            part7OpenScreen(
                screenId
            );

        },
        true
    );
}


/* =========================================================
   CLOSE MODAL SYSTEM
========================================================= */

function part7CloseModal(modal) {

    if (!modal) {
        return;
    }

    modal.classList.remove(
        "active"
    );

    modal.classList.remove(
        "show"
    );

    modal.style.display =
        "none";
}


function setupPart7ModalButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "[data-action='close'], " +
                    "[data-action='cancel'], " +
                    ".modal-close, " +
                    ".close-modal"
                );

            if (!button) {
                return;
            }


            const modal =
                button.closest(
                    ".modal, .modal-overlay, .popup, .dialog"
                );


            if (!modal) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            part7CloseModal(
                modal
            );

        },
        true
    );
}


/* =========================================================
   GENERIC CANCEL BUTTON
========================================================= */

function setupPart7CancelButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "button, [role='button']"
                );

            if (!button) {
                return;
            }

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                )
                .trim()
                .toLowerCase();


            const text =
                (
                    button.innerText ||
                    button.textContent ||
                    ""
                )
                .trim()
                .toUpperCase();


            const id =
                (
                    button.id ||
                    ""
                )
                .toLowerCase();


            const isCancel =

                action ===
                "cancel" ||

                id.includes(
                    "cancel"
                ) ||

                text ===
                "CANCEL";


            if (!isCancel) {
                return;
            }


            const modal =
                button.closest(
                    ".modal, .modal-overlay, .popup, .dialog"
                );


            if (modal) {

                event.preventDefault();
                event.stopPropagation();

                part7CloseModal(
                    modal
                );

                return;
            }


            event.preventDefault();
            event.stopPropagation();


            if (
                typeof part6GoBack ===
                "function"
            ) {

                part6GoBack();

            } else if (
                typeof part5GoBack ===
                "function"
            ) {

                part5GoBack();
            }

        },
        true
    );
}


/* =========================================================
   ENTER KEY BUTTON SYSTEM
========================================================= */

function setupPart7EnterKeys() {

    document.addEventListener(
        "keydown",
        function(event) {

            if (
                event.key !==
                "Enter"
            ) {
                return;
            }


            const activeScreen =
                document.querySelector(
                    ".app-screen.active, .page.active"
                );


            if (!activeScreen) {
                return;
            }


            const submitButton =
                activeScreen.querySelector(
                    "[type='submit'], " +
                    "[data-action='save'], " +
                    "[data-action='login'], " +
                    "[data-action='continue']"
                );


            if (
                submitButton
            ) {

                event.preventDefault();

                submitButton.click();
            }

        }
    );
}


/* =========================================================
   PART 7 GLOBAL FUNCTIONS
========================================================= */

window.part7OpenScreen =
    part7OpenScreen;

window.part7TogglePassword =
    part7TogglePassword;

window.part7CloseModal =
    part7CloseModal;


/* =========================================================
   PART 7 INITIALIZATION
========================================================= */

function initializeCricYuvaPart7() {

    console.log(
        "CRIC YUVA FINAL SCRIPT PART 7 LOADED"
    );

    setupPart7PasswordEyes();

    setupPart7PhotoButton();

    setupPart7DataScreenButtons();

    setupPart7ModalButtons();

    setupPart7CancelButtons();

    setupPart7EnterKeys();

    console.log(
        "PART 7 READY"
    );
}


if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeCricYuvaPart7,
        { once: true }
    );

} else {

    initializeCricYuvaPart7();
        }

/* =========================================================
   CRIC YUVA V1.0
   FINAL WORKING SCRIPT
   PART 8
   MATCH + TOURNAMENT + CREATE + SAVE BUTTON SYSTEM
========================================================= */

"use strict";


/* =========================================================
   PART 8 SAFE OPEN
========================================================= */

function part8OpenScreen(screenId) {

    if (!screenId) {
        return false;
    }

    if (typeof part6OpenScreen === "function") {
        return part6OpenScreen(screenId, true);
    }

    if (typeof part7OpenScreen === "function") {
        return part7OpenScreen(screenId);
    }

    const target = document.getElementById(screenId);

    if (!target) {
        console.warn("PART 8 SCREEN NOT FOUND:", screenId);
        return false;
    }

    document
        .querySelectorAll(".app-screen, .page")
        .forEach(function(screen) {
            screen.classList.remove("active");
        });

    target.classList.add("active");

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

    return true;
}


/* =========================================================
   PART 8 ACTION → SCREEN MAP
========================================================= */

const part8ScreenMap = {

    "create-match": "createMatchScreen",
    "new-match": "createMatchScreen",
    "create-new-match": "createMatchScreen",

    "create-tournament": "createTournamentScreen",
    "new-tournament": "createTournamentScreen",
    "create-new-tournament": "createTournamentScreen",

    "add-player": "addPlayerScreen",

    "create-group": "createGroupForm",
    "new-group": "createGroupForm",

    "upcoming-match": "upcomingMatchesScreen",

    "tournament-announcement":
        "tournamentAnnouncementsScreen",

    "create-announcement":
        "tournamentAnnouncementsScreen",

    "tournament-venue":
        "tournamentVenuesScreen",

    "backup-data":
        "backupDataScreen",

    "data-backup":
        "backupDataScreen",

    "settings":
        "settingsScreen",

    "matches":
        "matchesScreen",

    "tournaments":
        "tournamentsScreen"
};


/* =========================================================
   CREATE / OPEN BUTTON NAVIGATION
========================================================= */

function setupPart8CreateNavigation() {

    document.addEventListener(
        "click",
        function(event) {

            const element =
                event.target.closest(
                    "[data-action], button, [role='button']"
                );

            if (!element) {
                return;
            }

            const action =
                (
                    element.getAttribute(
                        "data-action"
                    ) || ""
                )
                .trim()
                .toLowerCase();

            const id =
                (
                    element.id ||
                    ""
                )
                .trim();

            let screenId =
                part8ScreenMap[action];

            const idMap = {

                createNewMatchButton:
                    "createMatchScreen",

                createNewTournamentButton:
                    "createTournamentScreen",

                createGroupButton:
                    "createGroupForm",

                createFirstGroupButton:
                    "createGroupForm",

                createFirstUpcomingMatchButton:
                    "createMatchScreen",

                createTournamentAnnouncementButton:
                    "tournamentAnnouncementsScreen",

                createFirstTournamentAnnouncementButton:
                    "tournamentAnnouncementsScreen",

                createFirstTournamentVenueButton:
                    "tournamentVenuesScreen",

                backupDataCreateButton:
                    "backupDataScreen"
            };

            if (!screenId && idMap[id]) {
                screenId = idMap[id];
            }

            if (!screenId) {
                return;
            }

            const target =
                document.getElementById(screenId);

            if (!target) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            part8OpenScreen(screenId);

        },
        true
    );
}


/* =========================================================
   SAFE GENERIC SAVE
========================================================= */

function part8SaveForm(formKey, data) {

    try {

        localStorage.setItem(
            "cricYuva_" + formKey,
            JSON.stringify(data)
        );

        return true;

    } catch (error) {

        console.error(
            "SAVE ERROR:",
            formKey,
            error
        );

        return false;
    }
}


/* =========================================================
   COLLECT FORM VALUES
========================================================= */

function part8CollectFormData(screen) {

    const data = {};

    if (!screen) {
        return data;
    }

    const fields =
        screen.querySelectorAll(
            "input, select, textarea"
        );

    fields.forEach(
        function(field) {

            const key =
                field.name ||
                field.id;

            if (!key) {
                return;
            }

            if (
                field.type === "checkbox"
            ) {

                data[key] =
                    field.checked;

                return;
            }

            if (
                field.type === "radio"
            ) {

                if (field.checked) {
                    data[key] =
                        field.value;
                }

                return;
            }

            data[key] =
                field.value;
        }
    );

    return data;
}


/* =========================================================
   MATCH SAVE SYSTEM
========================================================= */

function part8SaveMatch() {

    const screen =
        document.getElementById(
            "createMatchScreen"
        );

    if (!screen) {
        return false;
    }

    const data =
        part8CollectFormData(screen);

    data.savedAt =
        new Date().toISOString();

    const saved =
        part8SaveForm(
            "matchDraft",
            data
        );

    if (saved) {

        alert(
            "Match saved successfully!"
        );
    }

    return saved;
}


/* =========================================================
   TOURNAMENT SAVE SYSTEM
========================================================= */

function part8SaveTournament() {

    const screen =
        document.getElementById(
            "createTournamentScreen"
        );

    if (!screen) {
        return false;
    }

    const data =
        part8CollectFormData(screen);

    data.savedAt =
        new Date().toISOString();

    const saved =
        part8SaveForm(
            "tournamentDraft",
            data
        );

    if (saved) {

        alert(
            "Tournament saved successfully!"
        );
    }

    return saved;
}


/* =========================================================
   GROUP SAVE SYSTEM
========================================================= */

function part8SaveGroup() {

    const screen =
        document.getElementById(
            "createGroupForm"
        );

    if (!screen) {
        return false;
    }

    const data =
        part8CollectFormData(screen);

    data.savedAt =
        new Date().toISOString();

    const saved =
        part8SaveForm(
            "groupDraft",
            data
        );

    if (saved) {

        alert(
            "Group saved successfully!"
        );
    }

    return saved;
}


/* =========================================================
   UNIVERSAL CREATE SCREEN SAVE
========================================================= */

function setupPart8SaveButtons() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "button, [role='button']"
                );

            if (!button) {
                return;
            }

            const activeScreen =
                document.querySelector(
                    ".app-screen.active, .page.active"
                );

            if (!activeScreen) {
                return;
            }

            const id =
                (
                    button.id ||
                    ""
                ).toLowerCase();

            const action =
                (
                    button.getAttribute(
                        "data-action"
                    ) || ""
                ).toLowerCase();

            const text =
                (
                    button.innerText ||
                    button.textContent ||
                    ""
                )
                .trim()
                .toUpperCase();

            const isSave =

                action === "save" ||
                action === "create" ||
                action === "save-match" ||
                action === "save-tournament" ||
                id.includes("save") ||
                text === "SAVE" ||
                text === "CREATE" ||
                text === "CREATE MATCH" ||
                text === "CREATE TOURNAMENT";

            if (!isSave) {
                return;
            }


            if (
                activeScreen.id ===
                "createMatchScreen"
            ) {

                event.preventDefault();
                event.stopImmediatePropagation();

                part8SaveMatch();

                return;
            }


            if (
                activeScreen.id ===
                "createTournamentScreen"
            ) {

                event.preventDefault();
                event.stopImmediatePropagation();

                part8SaveTournament();

                return;
            }


            if (
                activeScreen.id ===
                "createGroupForm"
            ) {

                event.preventDefault();
                event.stopImmediatePropagation();

                part8SaveGroup();

                return;
            }

        },
        true
    );
}


/* =========================================================
   ADD PLAYER QUICK SAVE
========================================================= */

function setupPart8AddPlayer() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "[data-action='save-player'], " +
                    "#saveNewPlayerButton"
                );

            if (!button) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const screen =
                document.getElementById(
                    "addPlayerScreen"
                );

            if (!screen) {
                return;
            }

            const data =
                part8CollectFormData(screen);

            data.savedAt =
                new Date().toISOString();

            part8SaveForm(
                "newPlayerDraft",
                data
            );

            alert(
                "Player saved successfully!"
            );

        },
        true
    );
}


/* =========================================================
   PART 8 GLOBAL FUNCTIONS
========================================================= */

window.part8OpenScreen =
    part8OpenScreen;

window.part8SaveMatch =
    part8SaveMatch;

window.part8SaveTournament =
    part8SaveTournament;

window.part8SaveGroup =
    part8SaveGroup;


/* =========================================================
   PART 8 INITIALIZATION
========================================================= */

function initializeCricYuvaPart8() {

    console.log(
        "CRIC YUVA FINAL SCRIPT PART 8 LOADED"
    );

    setupPart8CreateNavigation();

    setupPart8SaveButtons();

    setupPart8AddPlayer();

    console.log(
        "PART 8 READY"
    );
}


if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeCricYuvaPart8,
        { once: true }
    );

} else {

    initializeCricYuvaPart8();
        }

/* =========================================================
   CRIC YUVA V1.0
   FINAL WORKING SCRIPT
   PART 9
   FINAL BUTTON SAFETY + DUPLICATE PROTECTION + DEBUG
========================================================= */

"use strict";


/* =========================================================
   PART 9 SAFE FUNCTION RUNNER
========================================================= */

function part9RunSafely(
    functionName,
    callback
) {

    try {

        if (
            typeof callback ===
            "function"
        ) {

            return callback();

        }

    } catch (error) {

        console.error(
            "CRIC YUVA ERROR IN " +
            functionName + ":",
            error
        );
    }

    return false;
}


/* =========================================================
   PART 9 GET ACTIVE SCREEN
========================================================= */

function part9GetActiveScreen() {

    return document.querySelector(
        ".app-screen.active, .page.active"
    );
}


/* =========================================================
   PART 9 GET ACTIVE SCREEN ID
========================================================= */

function part9GetActiveScreenId() {

    const screen =
        part9GetActiveScreen();

    return screen
        ? screen.id
        : "";
}


/* =========================================================
   PART 9 BUTTON LOADING STATE
========================================================= */

function part9SetButtonBusy(
    button,
    busy
) {

    if (!button) {
        return;
    }

    if (busy) {

        if (
            !button.dataset.originalText
        ) {

            button.dataset.originalText =
                button.innerHTML;
        }

        button.disabled = true;

        button.classList.add(
            "button-loading"
        );

    } else {

        button.disabled = false;

        button.classList.remove(
            "button-loading"
        );
    }
}


/* =========================================================
   PART 9 PREVENT DOUBLE RAPID CLICK
========================================================= */

function setupPart9DoubleClickProtection() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "button, [role='button']"
                );

            if (!button) {
                return;
            }

            if (
                button.dataset.part9Processing ===
                "true"
            ) {

                event.preventDefault();

                event.stopImmediatePropagation();

                return;
            }

            button.dataset.part9Processing =
                "true";

            setTimeout(
                function() {

                    button.dataset.part9Processing =
                        "false";

                },
                350
            );

        },
        true
    );
}


/* =========================================================
   PART 9 FORM VALIDATION HELPER
========================================================= */

function part9ValidateRequiredFields(
    screen
) {

    if (!screen) {
        return true;
    }

    const requiredFields =
        screen.querySelectorAll(
            "[required]"
        );

    for (
        let i = 0;
        i < requiredFields.length;
        i++
    ) {

        const field =
            requiredFields[i];

        if (
            !field.value ||
            !field.value.trim()
        ) {

            const label =
                field.getAttribute(
                    "placeholder"
                ) ||
                field.name ||
                field.id ||
                "required field";

            alert(
                "Please fill: " +
                label
            );

            field.focus();

            return false;
        }
    }

    return true;
}


/* =========================================================
   PART 9 UNIVERSAL FORM SUBMIT FIX
========================================================= */

function setupPart9FormSubmit() {

    document.addEventListener(
        "submit",
        function(event) {

            const form =
                event.target;

            if (!form) {
                return;
            }

            event.preventDefault();

            const screen =
                form.closest(
                    ".app-screen, .page"
                );

            if (
                !part9ValidateRequiredFields(
                    screen
                )
            ) {
                return;
            }

            const submitButton =
                form.querySelector(
                    "[type='submit']"
                );

            if (submitButton) {
                submitButton.click();
            }

        },
        true
    );
}


/* =========================================================
   PART 9 FIX BUTTON TYPE
========================================================= */

function part9FixButtonTypes() {

    const buttons =
        document.querySelectorAll(
            "button"
        );

    buttons.forEach(
        function(button) {

            if (
                !button.hasAttribute(
                    "type"
                )
            ) {

                const insideForm =
                    button.closest(
                        "form"
                    );

                if (insideForm) {

                    button.setAttribute(
                        "type",
                        "button"
                    );
                }
            }

        }
    );
}


/* =========================================================
   PART 9 BUTTON ENABLE CHECK
========================================================= */

function setupPart9ButtonEnableCheck() {

    document.addEventListener(
        "click",
        function(event) {

            const button =
                event.target.closest(
                    "button"
                );

            if (!button) {
                return;
            }

            if (button.disabled) {

                event.preventDefault();

                event.stopImmediatePropagation();

                return;
            }

        },
        true
    );
}


/* =========================================================
   PART 9 AUTO LOAD PROFILE DATA
========================================================= */

function setupPart9ProfileAutoRefresh() {

    document.addEventListener(
        "click",
        function(event) {

            const element =
                event.target.closest(
                    "[data-action='profile'], " +
                    "[data-action='player-profile']"
                );

            if (!element) {
                return;
            }

            setTimeout(
                function() {

                    part9RunSafely(
                        "PROFILE AUTO REFRESH",
                        function() {

                            if (
                                typeof part5LoadProfile ===
                                "function"
                            ) {

                                part5LoadProfile();

                                return true;
                            }

                            return false;
                        }
                    );

                },
                150
            );

        },
        true
    );
}


/* =========================================================
   PART 9 ERROR DEBUG
========================================================= */

function setupPart9ErrorDebug() {

    window.addEventListener(
        "error",
        function(event) {

            console.error(
                "CRIC YUVA JAVASCRIPT ERROR:",
                event.message,
                "LINE:",
                event.lineno,
                "FILE:",
                event.filename
            );

        }
    );


    window.addEventListener(
        "unhandledrejection",
        function(event) {

            console.error(
                "CRIC YUVA PROMISE ERROR:",
                event.reason
            );

        }
    );
}


/* =========================================================
   PART 9 FINAL SYSTEM CHECK
========================================================= */

function part9FinalSystemCheck() {

    const activeScreen =
        part9GetActiveScreenId();

    const buttonCount =
        document.querySelectorAll(
            "button"
        ).length;

    const screenCount =
        document.querySelectorAll(
            ".app-screen"
        ).length;

    console.log(
        "================================="
    );

    console.log(
        "CRIC YUVA FINAL SYSTEM CHECK"
    );

    console.log(
        "ACTIVE SCREEN:",
        activeScreen
    );

    console.log(
        "TOTAL SCREENS:",
        screenCount
    );

    console.log(
        "TOTAL BUTTONS:",
        buttonCount
    );

    console.log(
        "PART 1-9 SCRIPT READY"
    );

    console.log(
        "================================="
    );

}


/* =========================================================
   PART 9 GLOBAL FUNCTIONS
========================================================= */

window.part9GetActiveScreenId =
    part9GetActiveScreenId;

window.part9FinalSystemCheck =
    part9FinalSystemCheck;


/* =========================================================
   PART 9 INITIALIZATION
========================================================= */

function initializeCricYuvaPart9() {

    console.log(
        "CRIC YUVA FINAL SCRIPT PART 9 LOADED"
    );

    part9FixButtonTypes();

    setupPart9DoubleClickProtection();

    setupPart9FormSubmit();

    setupPart9ButtonEnableCheck();

    setupPart9ProfileAutoRefresh();

    setupPart9ErrorDebug();

    setTimeout(
        part9FinalSystemCheck,
        500
    );

    console.log(
        "PART 9 READY"
    );
}


if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeCricYuvaPart9,
        { once: true }
    );

} else {

    initializeCricYuvaPart9();
                        }

/* =========================================================
   SOCIAL MEDIA BUTTONS
========================================================= */

document.addEventListener("click", function (event) {

    const button =
        event.target.closest("[data-action]");

    if (!button) return;

    const action =
        button.dataset.action;

    const socialLinks = {

        youtube:
            "https://www.youtube.com/",

        instagram:
            "https://www.instagram.com/",

        whatsapp:
            "https://wa.me/",

        facebook:
            "https://www.facebook.com/"

    };

    if (socialLinks[action]) {

        event.preventDefault();

        window.open(
            socialLinks[action],
            "_blank",
            "noopener,noreferrer"
        );

    }

});


/* =========================================================
   CHANGE LANGUAGE BUTTON
========================================================= */

document.addEventListener("click", function (event) {

    const button =
        event.target.closest(
            '[data-action="language"]'
        );

    if (!button) return;

    event.preventDefault();

    const language =
        prompt(
            "Select Language:\n\n1 = English\n2 = हिंदी\n3 = मराठी",
            localStorage.getItem("cricYuvaLanguage") || "1"
        );

    const languages = {
        "1": "English",
        "2": "हिंदी",
        "3": "मराठी"
    };

    if (!languages[language]) return;

    localStorage.setItem(
        "cricYuvaLanguage",
        language
    );

    alert(
        "Language selected: " +
        languages[language]
    );

});

