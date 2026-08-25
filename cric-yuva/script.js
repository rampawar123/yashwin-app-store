function initCricYuvaApp() {

let navigationHistory = [];
let currentScreen = "screen1";

const featureNames = {
team: ["MY TEAM", "fa-users"],
matches: ["MY MATCHES", "fa-cricket-bat-ball"],
live: ["LIVE CRICKET", "fa-video"],
tournament: ["TOURNAMENT & SERIES", "fa-trophy"],
statistics: ["STATISTICS", "fa-chart-column"],
leaderboard: ["LEADERBOARD", "fa-ranking-star"],
subscription: ["SUBSCRIPTION", "fa-crown"],
payment: ["PAYMENT SETTINGS", "fa-credit-card"],
updates: ["UPDATES", "fa-bullhorn"],
contact: ["CONTACT", "fa-comment-dots"],
language: ["CHANGE LANGUAGE", "fa-language"],
youtube: ["YOUTUBE", "fa-youtube"],
instagram: ["INSTAGRAM", "fa-instagram"],
whatsapp: ["WHATSAPP", "fa-whatsapp"],
facebook: ["FACEBOOK", "fa-facebook"],
x: ["X", "fa-x-twitter"],
about: ["ABOUT CRIC YUVA", "fa-circle-info"],
blogs: ["BLOGS", "fa-newspaper"],
privacy: ["PRIVACY POLICY", "fa-shield-halved"],
terms: ["PAID SERVICE TERMS", "fa-file-contract"]
};

/* =====================================================
HELPER
===================================================== */

function getElement(id) {
return document.getElementById(id);
}

function addClick(id, callback) {
const element = getElement(id);

if (element) {    
    element.addEventListener("click", callback);    
}

}

/* =====================================================
SCREEN SYSTEM
===================================================== */

function showScreen(screenId, addHistory = true) {

const target = getElement(screenId);    

if (!target) {    
    console.error("Screen not found:", screenId);    
    return;    
}    

if (    
    addHistory &&    
    currentScreen !== screenId &&    
    currentScreen !== "screen1"    
) {    
    navigationHistory.push(currentScreen);    
}    

document.querySelectorAll(".app-screen").forEach(function (screen) {    
    screen.classList.remove("active");    
});    

target.classList.add("active");    

currentScreen = screenId;    

window.scrollTo({    
    top: 0,    
    behavior: "auto"    
});    

closeMenu();    

}

function goBack() {

if (navigationHistory.length > 0) {    

    const previousScreen = navigationHistory.pop();    

    showScreen(previousScreen, false);    

} else {    

    navigationHistory = [];    
    showScreen("screen5", false);    
}

}

function goHome() {

navigationHistory = [];    

showScreen("screen5", false);

}

/* =====================================================
PASSWORD EYE
===================================================== */

function setupPasswordEye(buttonId, inputId) {

const button = getElement(buttonId);    
const input = getElement(inputId);    

if (!button || !input) return;    

button.addEventListener("click", function () {    

    const icon = button.querySelector("i");    

    if (input.type === "password") {    

        input.type = "text";    

        if (icon) {    
            icon.classList.remove("fa-eye");    
            icon.classList.add("fa-eye-slash");    
        }    

    } else {    

        input.type = "password";    

        if (icon) {    
            icon.classList.remove("fa-eye-slash");    
            icon.classList.add("fa-eye");    
        }    
    }    
});

}

setupPasswordEye("loginEyeButton", "loginPassword");
setupPasswordEye("newPasswordEye", "newPassword");
setupPasswordEye("verifyPasswordEye", "verifyPassword");

/* =====================================================
PLAYER ID
===================================================== */

function getPlayerId() {

let id = localStorage.getItem("cricYuvaPlayerId");    

if (!id) {    

    const mobile =    
        localStorage.getItem("cricYuvaMobile") || "0000000000";    

    const lastFour = mobile.slice(-4);    

    id = "CY" + lastFour + "001";    

    localStorage.setItem(    
        "cricYuvaPlayerId",    
        id    
    );    
}    

return id;

}

/* =====================================================
SPLASH
===================================================== */

setTimeout(function () {

const savedMobile =    
    localStorage.getItem("cricYuvaMobile");    

const savedPassword =    
    localStorage.getItem("cricYuvaPassword");    

const profileComplete =    
    localStorage.getItem("cricYuvaProfileComplete");    

if (    
    savedMobile &&    
    savedPassword &&    
    profileComplete === "true"    
) {    

    loadProfileToScreen4();    
    loadHomeProfile();    

    navigationHistory = [];    

    showScreen("screen5", false);    

} else {    

    showScreen("screen2", false);    
}

}, 2500);

/* =====================================================
CREATE ACCOUNT
===================================================== */

addClick(
"createAccountButton",
function () {

showScreen("screen3");    
}

);

addClick(
"createBackButton",
function () {

navigationHistory = [];    

    showScreen("screen2", false);    
}

);

addClick(
"saveAccountButton",
function () {

const mobileInput = getElement("newMobile");    
    const passwordInput = getElement("newPassword");    
    const verifyPasswordInput =    
        getElement("verifyPassword");    

    if (    
        !mobileInput ||    
        !passwordInput ||    
        !verifyPasswordInput    
    ) {    
        return;    
    }    

    const mobile =    
        mobileInput.value.trim();    

    const password =    
        passwordInput.value;    

    const verifyPassword =    
        verifyPasswordInput.value;    


    if (!/^[0-9]{10}$/.test(mobile)) {    

        alert(    
            "Please enter a valid 10 digit mobile number."    
        );    

        return;    
    }    


    if (password.length < 4) {    

        alert(    
            "Password must be at least 4 characters."    
        );    

        return;    
    }    


    if (password !== verifyPassword) {    

        alert("Password does not match!");    

        return;    
    }    


    const oldMobile =    
        localStorage.getItem("cricYuvaMobile");    


    /*    
     * New mobile number means new account.    
     * Old player's profile data is cleared.    
     */    

    if (    
        oldMobile &&    
        oldMobile !== mobile    
    ) {    

        localStorage.removeItem(    
            "cricYuvaProfile"    
        );    

        localStorage.removeItem(    
            "cricYuvaProfilePhoto"    
        );    

        localStorage.removeItem(    
            "cricYuvaPlayerId"    
        );    

        localStorage.removeItem(    
            "cricYuvaPlayerName"    
        );    
    }    


    localStorage.setItem(    
        "cricYuvaMobile",    
        mobile    
    );    

    localStorage.setItem(    
        "cricYuvaPassword",    
        password    
    );    

    localStorage.setItem(    
        "cricYuvaProfileComplete",    
        "false"    
    );    


    const profileMobile =    
        getElement("profileMobile");    

    if (profileMobile) {    
        profileMobile.value = mobile;    
    }    


    clearProfileForm();    

    const playerId =    
        getElement("playerId");    

    if (playerId) {    
        playerId.textContent =    
            getPlayerId();    
    }    


    alert(    
        "Account created successfully!"    
    );    


    navigationHistory = [];    

    showScreen("screen4", false);    
}

);

/* =====================================================
LOGIN
===================================================== */

addClick(
"loginButton",
function () {

const loginMobile =    
        getElement("loginMobile");    

    const loginPassword =    
        getElement("loginPassword");    

    if (    
        !loginMobile ||    
        !loginPassword    
    ) {    
        return;    
    }    


    const mobile =    
        loginMobile.value.trim();    

    const password =    
        loginPassword.value;    


    const savedMobile =    
        localStorage.getItem(    
            "cricYuvaMobile"    
        );    

    const savedPassword =    
        localStorage.getItem(    
            "cricYuvaPassword"    
        );    


    if (    
        !savedMobile ||    
        !savedPassword    
    ) {    

        alert(    
            "Please create a new account first."    
        );    

        return;    
    }    


    if (    
        mobile === savedMobile &&    
        password === savedPassword    
    ) {    

        loadProfileToScreen4();    
        loadHomeProfile();    

        const profileComplete =    
            localStorage.getItem(    
                "cricYuvaProfileComplete"    
            );    


        navigationHistory = [];    


        if (    
            profileComplete === "true"    
        ) {    

            showScreen(    
                "screen5",    
                false    
            );    

        } else {    

            showScreen(    
                "screen4",    
                false    
            );    
        }    

    } else {    

        alert(    
            "Invalid mobile number or password!"    
        );    
    }    
}

);

/* =====================================================
FORGOT PASSWORD
===================================================== */

addClick(
"forgotPasswordButton",
function () {

const mobile =    
        localStorage.getItem(    
            "cricYuvaMobile"    
        );    

    if (!mobile) {    

        alert(    
            "No account found. Please create a new account."    
        );    

        return;    
    }    


    alert(    
        "Password reset system will be added in the next version."    
    );    
}

);

/* =====================================================
PROFILE PHOTO
===================================================== */

const replacePhotoBtn =
getElement("replacePhotoBtn");

const profilePhotoInput =
getElement("profilePhotoInput");

if (
replacePhotoBtn &&
profilePhotoInput
) {

replacePhotoBtn.addEventListener(    
    "click",    
    function () {    

        profilePhotoInput.click();    
    }    
);    


profilePhotoInput.addEventListener(    
    "change",    
    function () {    

        const file =    
            this.files[0];    

        if (!file) return;    


        if (    
            !file.type.startsWith(    
                "image/"    
            )    
        ) {    

            alert(    
                "Please select an image file."    
            );    

            return;    
        }    


        const reader =    
            new FileReader();    


        reader.onload =    
            function (event) {    

                const imageData =    
                    event.target.result;    


                localStorage.setItem(    
                    "cricYuvaProfilePhoto",    
                    imageData    
                );    


                setProfileImage(    
                    imageData    
                );    


                updateAllProfilePhotos(    
                    imageData    
                );    
            };    


        reader.readAsDataURL(    
            file    
        );    
    }    
);

}

function setProfileImage(imageData) {

const profilePhoto =    
    getElement("profilePhoto");    

if (!profilePhoto) return;    


if (imageData) {    

    profilePhoto.innerHTML =    
        '<img src="' +    
        imageData +    
        '" alt="Profile Photo">';    

} else {    

    const savedName =    
        localStorage.getItem(    
            "cricYuvaPlayerName"    
        ) || "PLAYER";    

    const initial =    
        savedName.charAt(0)    
            .toUpperCase();    


    profilePhoto.innerHTML =    
        '<span id="profileInitial">' +    
        initial +    
        '</span>';    
}

}

function updateAllProfilePhotos(
imageData
) {

const photoContainers = [    
    getElement("homeProfilePhoto"),    
    getElement("menuProfilePhoto")    
];    


photoContainers.forEach(    
    function (container) {    

        if (    
            container &&    
            imageData    
        ) {    

            container.innerHTML =    
                '<img src="' +    
                imageData +    
                '" alt="Profile Photo">';    
        }    
    }    
);

}

/* =====================================================
CLEAR PROFILE FORM
===================================================== */

function clearProfileForm() {

const fields = [    
    "profileName",    
    "profileEmail",    
    "jerseyName",    
    "jerseyNumber",    
    "pantSize",    
    "dateOfBirth"    
];    


fields.forEach(    
    function (id) {    

        const field =    
            getElement(id);    

        if (field) {    
            field.value = "";    
        }    
    }    
);    


const jerseySize =    
    getElement("jerseySize");    

if (jerseySize) {    
    jerseySize.value = "";    
}    


const profilePhoto =    
    getElement("profilePhoto");    

if (profilePhoto) {    

    profilePhoto.innerHTML =    
        '<span id="profileInitial">P</span>';    
}

}

/* =====================================================
PROFILE SAVE
===================================================== */

addClick(
"saveProfileButton",
function () {

const name =    
        getElement("profileName")    
        .value.trim();    

    const mobile =    
        getElement("profileMobile")    
        .value.trim();    

    const email =    
        getElement("profileEmail")    
        .value.trim();    

    const jerseyName =    
        getElement("jerseyName")    
        .value.trim();    

    const jerseyNumber =    
        getElement("jerseyNumber")    
        .value.trim();    

    const jerseySize =    
        getElement("jerseySize")    
        .value;    

    const pantSize =    
        getElement("pantSize")    
        .value.trim();    

    const dateOfBirth =    
        getElement("dateOfBirth")    
        .value;    


    if (!name) {    

        alert(    
            "Please enter your name."    
        );    

        return;    
    }    


    if (    
        !/^[0-9]{10}$/.test(    
            mobile    
        )    
    ) {    

        alert(    
            "Please enter a valid mobile number."    
        );    

        return;    
    }    


    const profileData = {    

        name: name,    
        mobile: mobile,    
        email: email,    
        jerseyName: jerseyName,    
        jerseyNumber: jerseyNumber,    
        jerseySize: jerseySize,    
        pantSize: pantSize,    
        dateOfBirth: dateOfBirth,    
        playerId: getPlayerId()    
    };    


    localStorage.setItem(    
        "cricYuvaProfile",    
        JSON.stringify(    
            profileData    
        )    
    );    


    localStorage.setItem(    
        "cricYuvaProfileComplete",    
        "true"    
    );    


    localStorage.setItem(    
        "cricYuvaPlayerName",    
        name    
    );    


    loadHomeProfile();    

    setProfileImage(    
        localStorage.getItem(    
            "cricYuvaProfilePhoto"    
        )    
    );    


    alert(    
        "Profile saved successfully!"    
    );    


    goHome();    
}

);

/* =====================================================
LOAD PROFILE
===================================================== */

function loadProfileToScreen4() {

const savedMobile =    
    localStorage.getItem(    
        "cricYuvaMobile"    
    );    

const profileMobile =    
    getElement("profileMobile");    


if (    
    savedMobile &&    
    profileMobile    
) {    

    profileMobile.value =    
        savedMobile;    
}    


const playerId =    
    getElement("playerId");    

if (playerId) {    

    playerId.textContent =    
        getPlayerId();    
}    


const savedProfile =    
    localStorage.getItem(    
        "cricYuvaProfile"    
    );    


if (!savedProfile) {    

    loadSavedPhoto();    

    updateProfileInitial();    

    return;    
}    


try {    

    const profile =    
        JSON.parse(    
            savedProfile    
        );    


    if (getElement("profileName")) {    
        getElement("profileName").value =    
            profile.name || "";    
    }    


    if (getElement("profileMobile")) {    
        getElement("profileMobile").value =    
            profile.mobile ||    
            savedMobile ||    
            "";    
    }    


    if (getElement("profileEmail")) {    
        getElement("profileEmail").value =    
            profile.email || "";    
    }    


    if (getElement("jerseyName")) {    
        getElement("jerseyName").value =    
            profile.jerseyName || "";    
    }    


    if (getElement("jerseyNumber")) {    
        getElement("jerseyNumber").value =    
            profile.jerseyNumber || "";    
    }    


    if (getElement("jerseySize")) {    
        getElement("jerseySize").value =    
            profile.jerseySize || "";    
    }    


    if (getElement("pantSize")) {    
        getElement("pantSize").value =    
            profile.pantSize || "";    
    }    


    if (getElement("dateOfBirth")) {    
        getElement("dateOfBirth").value =    
            profile.dateOfBirth || "";    
    }    


} catch (error) {    

    console.error(    
        "Profile load error:",    
        error    
    );    
}    


loadSavedPhoto();    

updateProfileInitial();

}

function loadSavedPhoto() {

const photo =    
    localStorage.getItem(    
        "cricYuvaProfilePhoto"    
    );    


if (photo) {    

    setProfileImage(    
        photo    
    );    
}

}

function updateProfileInitial() {

const profilePhoto =    
    getElement("profilePhoto");    

if (!profilePhoto) return;    


const photo =    
    localStorage.getItem(    
        "cricYuvaProfilePhoto"    
    );    


if (photo) return;    


const name =    
    getElement("profileName")    
    .value.trim() ||    
    localStorage.getItem(    
        "cricYuvaPlayerName"    
    ) ||    
    "PLAYER";    


const initial =    
    name.charAt(0)    
        .toUpperCase() || "P";    


profilePhoto.innerHTML =    
    '<span id="profileInitial">' +    
    initial +    
    '</span>';

}

/* =====================================================
LOAD HOME PROFILE
===================================================== */

function loadHomeProfile() {

const savedProfile =    
    localStorage.getItem(    
        "cricYuvaProfile"    
    );    

const savedName =    
    localStorage.getItem(    
        "cricYuvaPlayerName"    
    );    


const playerId =    
    getPlayerId();    


let name =    
    savedName ||    
    "CRIC YUVA PLAYER";    


if (savedProfile) {    

    try {    

        const profile =    
            JSON.parse(    
                savedProfile    
            );    


        if (profile.name) {    
            name =    
                profile.name;    
        }    

    } catch (error) {    

        console.error(    
            error    
        );    
    }    
}    


const initial =    
    name.charAt(0)    
        .toUpperCase() || "P";    


const homePlayerName =    
    getElement("homePlayerName");    

const menuPlayerName =    
    getElement("menuPlayerName");    

const homePlayerId =    
    getElement("homePlayerId");    

const menuPlayerId =    
    getElement("menuPlayerId");    

const homeInitial =    
    getElement("homeInitial");    

const menuInitial =    
    getElement("menuInitial");    


if (homePlayerName) {    
    homePlayerName.textContent =    
        name;    
}    

if (menuPlayerName) {    
    menuPlayerName.textContent =    
        name;    
}    

if (homePlayerId) {    
    homePlayerId.textContent =    
        "ID: " +    
        playerId;    
}    

if (menuPlayerId) {    
    menuPlayerId.textContent =    
        playerId;    
}    

if (homeInitial) {    
    homeInitial.textContent =    
        initial;    
}    

if (menuInitial) {    
    menuInitial.textContent =    
        initial;    
}    


const photo =    
    localStorage.getItem(    
        "cricYuvaProfilePhoto"    
    );    


if (photo) {    

    updateAllProfilePhotos(    
        photo    
    );    

} else {    

    const homePhoto =    
        getElement(    
            "homeProfilePhoto"    
        );    

    const menuPhoto =    
        getElement(    
            "menuProfilePhoto"    
        );    


    if (homePhoto) {    

        homePhoto.innerHTML =    
            '<span id="homeInitial">' +    
            initial +    
            '</span>';    
    }    


    if (menuPhoto) {    

        menuPhoto.innerHTML =    
            '<span id="menuInitial">' +    
            initial +    
            '</span>';    
    }    
}

}

/* =====================================================
PROFILE BACK
===================================================== */

addClick(
"profileBackButton",
function () {

const profileComplete =    
        localStorage.getItem(    
            "cricYuvaProfileComplete"    
        );    


    if (    
        profileComplete === "true"    
    ) {    

        if (    
            navigationHistory.length > 0    
        ) {    

            goBack();    

        } else {    

            goHome();    
        }    

    } else {    

        navigationHistory = [];    

        showScreen(    
            "screen2",    
            false    
        );    
    }    
}

);

/* =====================================================
SIDE MENU
===================================================== */

const sideMenu =
getElement("sideMenu");

const menuOverlay =
getElement("menuOverlay");

function openMenu() {

if (sideMenu) {    
    sideMenu.classList.add(    
        "open"    
    );    
}    

if (menuOverlay) {    
    menuOverlay.classList.add(    
        "open"    
    );    
}

}

function closeMenu() {

if (sideMenu) {    
    sideMenu.classList.remove(    
        "open"    
    );    
}    

if (menuOverlay) {    
    menuOverlay.classList.remove(    
        "open"    
    );    
}

}

addClick(
"menuButton",
openMenu
);

addClick(
"closeMenuButton",
closeMenu
);

if (menuOverlay) {

menuOverlay.addEventListener(    
    "click",    
    closeMenu    
);

}

/* =====================================================
QUICK MODAL
===================================================== */

const quickModalOverlay =
getElement(
"quickModalOverlay"
);

function openQuickModal() {

if (quickModalOverlay) {    

    quickModalOverlay.classList.add(    
        "open"    
    );    
}

}

function closeQuickModal() {

if (quickModalOverlay) {    

    quickModalOverlay.classList.remove(    
        "open"    
    );    
}

}

addClick(
"centerActionButton",
openQuickModal
);

addClick(
"quickModalClose",
closeQuickModal
);

if (quickModalOverlay) {

quickModalOverlay.addEventListener(    
    "click",    
    function (event) {    

        if (    
            event.target ===    
            quickModalOverlay    
        ) {    

            closeQuickModal();    
        }    
    }    
);

}

/* =====================================================
NOTIFICATIONS
===================================================== */

function updateNotificationDot() {

const dot =    
    getElement(    
        "notificationDot"    
    );    


if (!dot) return;    


const hasUnread =    
    localStorage.getItem(    
        "cricYuvaHasUnreadNotifications"    
    ) === "true";    


dot.style.display =    
    hasUnread ?    
    "block" :    
    "none";

}

addClick(
"notificationButton",
function () {

localStorage.setItem(    
        "cricYuvaHasUnreadNotifications",    
        "false"    
    );    

    updateNotificationDot();    

    openFeature(    
        "updates"    
    );    
}

);

/* =====================================================
FEATURE PAGES
===================================================== */

function openFeature(action) {

closeMenu();    
closeQuickModal();

   if (action === "team") {
       openMyTeam();
       return;
   }


if (action === "home") {    

    goHome();    

    return;    
}    


if (action === "profile") {    

    loadProfileToScreen4();    

    showScreen(    
        "screen4"    
    );    

    return;    
}    


if (action === "share") {    

    shareApp();    

    return;    
}    


const feature =    
    featureNames[action];    


if (!feature) return;    


const title =    
    feature[0];    

const iconClass =    
    feature[1];    


const featureTitle =    
    getElement(    
        "featureTitle"    
    );    

const featureMainTitle =    
    getElement(    
        "featureMainTitle"    
    );    

const featureText =    
    getElement(    
        "featureText"    
    );    

const featureIcon =    
    getElement(    
        "featureIcon"    
    );    


if (featureTitle) {    

    featureTitle.textContent =    
        title;    
}    


if (featureMainTitle) {    

    featureMainTitle.textContent =    
        title;    
}    


if (featureText) {    

    featureText.textContent =    
        title +    
        " page is ready for the next development step.";    
}    


if (featureIcon) {    

    featureIcon.innerHTML =    
        '<i class="fa-solid ' +    
        iconClass +    
        '"></i>';    
}    


showScreen(    
    "featureScreen"    
);

}

document
.querySelectorAll(
"[data-action]"
)
.forEach(
function (button) {

button.addEventListener(    
            "click",    
            function () {    

                const action =    
                    button.dataset.action;    

                openFeature(    
                    action    
                );    
            }    
        );    
    }    
);

/* =====================================================
HOME SPECIAL BUTTONS
===================================================== */

addClick(
"openProfileFromHome",
function () {

loadProfileToScreen4();    

    showScreen(    
        "screen4"    
    );    
}

);

addClick(
"watchLiveButton",
function () {

openFeature(    
        "live"    
    );    
}

);

addClick(
"matchDetailsButton",
function () {

openFeature(    
        "matches"    
    );    
}

);

/* =====================================================
FEATURE BACK BUTTON
===================================================== */

addClick(
"featureBackButton",
goBack
);

addClick(
"featureHomeButton",
goHome
);

/* =====================================================
SHARE APP
===================================================== */

function shareApp() {

const appUrl =    
    window.location.href;    

const shareText =    
    "Join me on CRIC YUVA - Play Together, Win Together!\n\n" +    
    appUrl;    


if (navigator.share) {    

    navigator.share({    
        title: "CRIC YUVA",    
        text: shareText,    
        url: appUrl    
    })    
    .catch(function () {});    

} else if (    
    navigator.clipboard    
) {    

    navigator.clipboard    
        .writeText(    
            shareText    
        )    
        .then(function () {    

            alert(    
                "CRIC YUVA share link copied!"    
            );    
        })    
        .catch(function () {    

            alert(    
                shareText    
            );    
        });    

} else {    

    alert(    
        shareText    
    );    
}

}

/* =====================================================
LOGOUT
===================================================== */

addClick(
"logoutButton",
function () {

closeMenu();    


    const loginMobile =    
        getElement(    
            "loginMobile"    
        );    

    const loginPassword =    
        getElement(    
            "loginPassword"    
        );    


    if (loginMobile) {    
        loginMobile.value = "";    
    }    


    if (loginPassword) {    
        loginPassword.value = "";    
    }    


    navigationHistory = [];    


    showScreen(    
        "screen2",    
        false    
    );    
}

);

/* =====================================================
MY TEAM SCREEN
===================================================== */

function openMyTeam() {

    closeMenu();
    closeQuickModal();

    const myTeamScreen = getElement("myTeamScreen");

    if (!myTeamScreen) {
        alert("My Team screen not found.");
        return;
    }

    showScreen("myTeamScreen");
}


/* OPEN MY TEAM FROM ANY BUTTON */

document.querySelectorAll(
    '[data-action="team"]'
).forEach(function (button) {

    button.addEventListener(
        "click",
        function (event) {

            event.preventDefault();
            event.stopPropagation();

            openMyTeam();
        }
    );

});


/* MY TEAM BACK */

addClick(
    "myTeamBackButton",
    function () {
        goBack();
    }
);


/* MY TEAM NOTIFICATION */

addClick(
    "teamNotificationButton",
    function () {
        openFeature("updates");
    }
);


/* CREATE TEAM */

addClick(
    "createTeamButton",
    function () {

        alert(
            "Create Team screen will open next."
        );

    }
);


/* ADD PLAYER */

addClick(
    "addPlayerButton",
    function () {

        alert(
            "Add Player screen will open next."
        );

    }
);


/* EDIT TEAM */

addClick(
    "editTeamButton",
    function () {

        alert(
            "Edit Team option will open next."
        );

    }
);


/* TEAM MATCHES */

addClick(
    "teamMatchesButton",
    function () {

        openFeature("matches");

    }
);


/* TEAM TOURNAMENT */

addClick(
    "teamTournamentButton",
    function () {

        openFeature("tournament");

    }
);


/* TEAM STATISTICS */

addClick(
    "teamStatisticsButton",
    function () {

        openFeature("statistics");

    }
);


/* TEAM VIEW ALL PLAYERS */

addClick(
    "viewAllTeamPlayersButton",
    function () {

        alert(
            "Team players list will open next."
        );

    }
);


/* TEAM TAB BUTTONS */

document.querySelectorAll(
    ".team-tab"
).forEach(function (button) {

    button.addEventListener(
        "click",
        function () {

            document
                .querySelectorAll(".team-tab")
                .forEach(function (tab) {

                    tab.classList.remove("active");

                });

            button.classList.add("active");

        }
    );

});

/* =====================================================
MY TEAM SCREEN
===================================================== */

function openMyTeam() {

    closeMenu();
    closeQuickModal();

    const myTeamScreen = getElement("myTeamScreen");

    if (!myTeamScreen) {
        alert("My Team screen not found.");
        return;
    }

    showScreen("myTeamScreen");
}


/* =====================================================
MY TEAM BACK BUTTON
===================================================== */

addClick(
    "myTeamBackButton",
    function () {

        goBack();

    }
);


/* =====================================================
MY TEAM NOTIFICATION BUTTON
===================================================== */

addClick(
    "teamNotificationButton",
    function () {

        openFeature("updates");

    }
);


/* =====================================================
CREATE TEAM BUTTON
===================================================== */

addClick(
    "createTeamButton",
    function () {

        alert("Create Team feature will be added next.");

    }
);


/* =====================================================
ADD PLAYER BUTTON
===================================================== */

addClick(
    "addPlayerButton",
    function () {

        alert("Add Player feature will be added next.");

    }
);


/* =====================================================
EDIT TEAM BUTTON
===================================================== */

addClick(
    "editTeamButton",
    function () {

        alert("Edit Team feature will be added next.");

    }
);


/* =====================================================
TEAM MATCHES BUTTON
===================================================== */

addClick(
    "teamMatchesButton",
    function () {

        openFeature("matches");

    }
);


/* =====================================================
TEAM TOURNAMENT BUTTON
===================================================== */

addClick(
    "teamTournamentButton",
    function () {

        openFeature("tournament");

    }
);


/* =====================================================
TEAM STATISTICS BUTTON
===================================================== */

addClick(
    "teamStatisticsButton",
    function () {

        openFeature("statistics");

    }
);


/* =====================================================
VIEW ALL PLAYERS BUTTON
===================================================== */

addClick(
    "viewAllTeamPlayersButton",
    function () {

        alert("Team players list will be added next.");

    }
);


/* =====================================================
TEAM TAB BUTTONS
===================================================== */

document
    .querySelectorAll(".team-tab")
    .forEach(function (button) {

        button.addEventListener(
            "click",
            function () {

                document
                    .querySelectorAll(".team-tab")
                    .forEach(function (tab) {

                        tab.classList.remove("active");

                    });

                button.classList.add("active");

            }
        );

    });

 /* =====================================================
BOTTOM CENTER + BUTTON
===================================================== */

document.querySelectorAll(
    "#centerActionButton, .center-action, .bottom-center-button, .nav-center-btn, .add-button"
).forEach(function (button) {

    button.addEventListener("click", function () {

        alert("Bottom + button is working!");

    });

});

/* =====================================================
INITIAL LOAD
===================================================== */

loadProfileToScreen4();
loadHomeProfile();
updateNotificationDot();

}

if (
document.readyState === "loading"
) {

document.addEventListener(
"DOMContentLoaded",
initCricYuvaApp
);

} else {

initCricYuvaApp();
}
