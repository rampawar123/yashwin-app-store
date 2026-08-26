document.addEventListener("DOMContentLoaded", function () {

    /* =====================================================
       CRIC YUVA - COMPLETE JAVASCRIPT
       SCREEN 1 TO SCREEN 28
    ===================================================== */


    /* =====================================================
       STORAGE
    ===================================================== */

    const STORAGE_KEYS = {
        account: "cricYuvaAccount",
        profile: "cricYuvaProfile",
        team: "cricYuvaTeam",
        players: "cricYuvaPlayers",
        matches: "cricYuvaMatches",
        tournament: "cricYuvaTournament",
        chat: "cricYuvaTeamChat"
    };


    /* =====================================================
       HELPERS
    ===================================================== */

    function getElement(id) {
        return document.getElementById(id);
    }


    function getJSON(key, defaultValue) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : defaultValue;
        } catch (error) {
            return defaultValue;
        }
    }


    function setJSON(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }


    function showMessage(message) {
        alert(message);
    }


    /* =====================================================
       SCREEN SYSTEM
    ===================================================== */

    const allScreens = document.querySelectorAll(".app-screen");


    const screenMap = {
        home: "screen5",
        profile: "screen4",

        team: "myTeamScreen",
        "add-player": "addPlayerScreen",
        "player-requests": "playerRequestsScreen",
        "team-chat": "teamChatScreen",
        "manage-roles": "manageRolesScreen",

        matches: "matchesScreen",
        "create-match": "createMatchScreen",
        "single-match": "singleMatchScreen",
        "live-score": "liveScoreScreen",
        scorecard: "scorecardScreen",
        playing11: "playing11Screen",

        tournament: "tournamentScreen",
        "create-tournament": "createTournamentScreen",
        auction: "auctionScreen",
        fixtures: "fixturesScreen",
        "points-table": "pointsTableScreen",

        statistics: "statisticsScreen",
        leaderboard: "leaderboardScreen",
        live: "liveScreen",
        updates: "updatesScreen",
        subscription: "subscriptionScreen",
        payment: "paymentScreen",
        contact: "contactScreen"
    };


    let currentScreenId = "screen1";
    let previousScreenId = "screen1";


    function showScreen(screenId) {

        const targetScreen = getElement(screenId);

        if (!targetScreen) {
            console.log("Screen not found:", screenId);
            return;
        }

        if (currentScreenId !== screenId) {
            previousScreenId = currentScreenId;
            currentScreenId = screenId;
        }

        allScreens.forEach(function (screen) {
            screen.classList.remove("active");
        });

        targetScreen.classList.add("active");

        closeMenu();
        closeQuickModal();

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });

        updateHomeProfile();
        renderTeamPlayers();
        renderMatches();
        renderTournamentData();
        updateStatistics();
    }


    function goAction(action) {

        if (!action) {
            return;
        }

        if (action === "share") {
            shareApp();
            return;
        }

        if (action === "ground") {
            openGround();
            return;
        }

        if (action === "youtube") {
            showMessage("YouTube link will be added soon.");
            return;
        }

        if (action === "instagram") {
            showMessage("Instagram link will be added soon.");
            return;
        }

        if (action === "whatsapp") {
            showMessage("WhatsApp support link will be added soon.");
            return;
        }

        if (action === "facebook") {
            showMessage("Facebook link will be added soon.");
            return;
        }

        if (action === "language") {
            showMessage("Language selection will be added soon.");
            return;
        }

        if (action === "about") {
            showMessage(
                "CRIC YUVA V1.0\n\n" +
                "Play Together, Win Together.\n\n" +
                "Your complete cricket platform."
            );
            return;
        }

        if (action === "privacy") {
            showMessage("Privacy Policy page will be added soon.");
            return;
        }

        if (action === "terms") {
            showMessage("Paid Service Terms will be added soon.");
            return;
        }

        if (action === "auction-players") {
            showMessage("Auction Players management will be added in the next update.");
            return;
        }

        if (action === "auction-teams") {
            showMessage("Auction Teams management will be added in the next update.");
            return;
        }

        if (action === "auction-token") {
            showMessage("Auction Token system will be added in the next update.");
            return;
        }

        if (action === "auction-live") {
            showMessage("Live Auction system will be added in the next update.");
            return;
        }

        if (action === "tournament-list") {
            renderTournamentData();
            showScreen("tournamentScreen");
            return;
        }

        if (screenMap[action]) {
            showScreen(screenMap[action]);
        }
    }


    /* =====================================================
       SPLASH SCREEN - SCREEN 1
    ===================================================== */

    setTimeout(function () {

        const account = getJSON(STORAGE_KEYS.account, null);
        const profile = getJSON(STORAGE_KEYS.profile, null);

        if (account && profile && profile.name) {
            showScreen("screen5");
        } else if (account) {
            showScreen("screen4");
        } else {
            showScreen("screen2");
        }

    }, 2500);


    /* =====================================================
       PASSWORD SHOW / HIDE
    ===================================================== */

    function setupPasswordToggle(buttonId, inputId) {

        const button = getElement(buttonId);
        const input = getElement(inputId);

        if (!button || !input) {
            return;
        }

        button.addEventListener("click", function () {

            const icon = button.querySelector("i");

            if (input.type === "password") {

                input.type = "text";

                if (icon) {
                    icon.className = "fa-regular fa-eye-slash";
                }

            } else {

                input.type = "password";

                if (icon) {
                    icon.className = "fa-regular fa-eye";
                }

            }

        });

    }


    setupPasswordToggle("loginEyeButton", "loginPassword");
    setupPasswordToggle("newPasswordEye", "newPassword");
    setupPasswordToggle("verifyPasswordEye", "verifyPassword");


    /* =====================================================
       LOGIN - SCREEN 2
    ===================================================== */

    const loginButton = getElement("loginButton");


    if (loginButton) {

        loginButton.addEventListener("click", function () {

            const mobileInput = getElement("loginMobile");
            const passwordInput = getElement("loginPassword");

            const mobile = mobileInput.value.trim();
            const password = passwordInput.value.trim();

            if (mobile.length !== 10) {
                showMessage("Please enter a valid 10 digit mobile number.");
                return;
            }

            if (!password) {
                showMessage("Please enter your password.");
                return;
            }

            const account = getJSON(STORAGE_KEYS.account, null);

            if (!account) {
                showMessage("Account not found. Please create a new account.");
                showScreen("screen3");
                return;
            }

            if (
                account.mobile !== mobile ||
                account.password !== password
            ) {
                showMessage("Invalid mobile number or password.");
                return;
            }

            const profile = getJSON(STORAGE_KEYS.profile, null);

            if (profile && profile.name) {
                showMessage("Login Successful!");
                showScreen("screen5");
            } else {
                showMessage("Login Successful! Please complete your profile.");
                showScreen("screen4");
            }

        });

    }


    /* =====================================================
       CREATE ACCOUNT - SCREEN 3
    ===================================================== */

    const createAccountButton = getElement("createAccountButton");
    const createBackButton = getElement("createBackButton");
    const saveAccountButton = getElement("saveAccountButton");


    if (createAccountButton) {
        createAccountButton.addEventListener("click", function () {
            showScreen("screen3");
        });
    }


    if (createBackButton) {
        createBackButton.addEventListener("click", function () {
            showScreen("screen2");
        });
    }


    if (saveAccountButton) {

        saveAccountButton.addEventListener("click", function () {

            const mobile = getElement("newMobile").value.trim();
            const password = getElement("newPassword").value.trim();
            const verifyPassword = getElement("verifyPassword").value.trim();

            if (mobile.length !== 10) {
                showMessage("Please enter a valid 10 digit mobile number.");
                return;
            }

            if (password.length < 4) {
                showMessage("Password must be at least 4 characters.");
                return;
            }

            if (password !== verifyPassword) {
                showMessage("Passwords do not match.");
                return;
            }

            const account = {
                mobile: mobile,
                password: password
            };

            setJSON(STORAGE_KEYS.account, account);

            const existingProfile = getJSON(
                STORAGE_KEYS.profile,
                {}
            );

            existingProfile.mobile = mobile;

            if (!existingProfile.playerId) {
                existingProfile.playerId =
                    "CY" +
                    Date.now()
                    .toString()
                    .slice(-8);
            }

            setJSON(
                STORAGE_KEYS.profile,
                existingProfile
            );

            showMessage(
                "Account created successfully!"
            );

            loadProfileData();
            showScreen("screen4");

        });

    }


    /* =====================================================
       FORGOT PASSWORD
    ===================================================== */

    const forgotPasswordButton = getElement(
        "forgotPasswordButton"
    );


    if (forgotPasswordButton) {

        forgotPasswordButton.addEventListener(
            "click",
            function () {

                const account = getJSON(
                    STORAGE_KEYS.account,
                    null
                );

                if (!account) {
                    showMessage(
                        "No account found. Please create a new account."
                    );
                    return;
                }

                const newPassword = prompt(
                    "Enter your new password:"
                );

                if (
                    newPassword &&
                    newPassword.trim().length >= 4
                ) {

                    account.password =
                        newPassword.trim();

                    setJSON(
                        STORAGE_KEYS.account,
                        account
                    );

                    showMessage(
                        "Password changed successfully!"
                    );

                } else if (newPassword !== null) {

                    showMessage(
                        "Password must be at least 4 characters."
                    );

                }

            }
        );

    }


    /* =====================================================
       PROFILE - SCREEN 4
    ===================================================== */

    function loadProfileData() {

        const profile = getJSON(
            STORAGE_KEYS.profile,
            {}
        );

        const account = getJSON(
            STORAGE_KEYS.account,
            null
        );


        if (account && getElement("profileMobile")) {
            getElement("profileMobile").value =
                profile.mobile || account.mobile || "";
        }


        if (getElement("profileName")) {
            getElement("profileName").value =
                profile.name || "";
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

        if (getElement("playerId")) {

            getElement("playerId").textContent =
                profile.playerId ||
                "CY00000001";

        }


        if (profile.photo) {

            setPhotoToElement(
                getElement("profilePhoto"),
                profile.photo
            );

        } else {

            const initial =
                profile.name ?
                profile.name.charAt(0).toUpperCase() :
                "P";

            const profileInitial =
                getElement("profileInitial");

            if (profileInitial) {
                profileInitial.textContent = initial;
            }

        }

    }


    function setPhotoToElement(element, photo) {

        if (!element) {
            return;
        }

        element.innerHTML = "";

        const image = document.createElement("img");

        image.src = photo;
        image.alt = "Profile Photo";

        image.style.width = "100%";
        image.style.height = "100%";
        image.style.objectFit = "cover";
        image.style.borderRadius = "50%";

        element.appendChild(image);

    }


    const profileBackButton =
        getElement("profileBackButton");


    if (profileBackButton) {

        profileBackButton.addEventListener(
            "click",
            function () {

                const account = getJSON(
                    STORAGE_KEYS.account,
                    null
                );

                if (account) {
                    showScreen("screen5");
                } else {
                    showScreen("screen2");
                }

            }
        );

    }


    const replacePhotoBtn =
        getElement("replacePhotoBtn");

    const profilePhotoInput =
        getElement("profilePhotoInput");


    if (replacePhotoBtn && profilePhotoInput) {

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
                    profilePhotoInput.files[0];

                if (!file) {
                    return;
                }

                const reader = new FileReader();

                reader.onload = function (event) {

                    const profile = getJSON(
                        STORAGE_KEYS.profile,
                        {}
                    );

                    profile.photo =
                        event.target.result;

                    setJSON(
                        STORAGE_KEYS.profile,
                        profile
                    );

                    setPhotoToElement(
                        getElement("profilePhoto"),
                        profile.photo
                    );

                    updateHomeProfile();

                };

                reader.readAsDataURL(file);

            }
        );

    }


    const saveProfileButton =
        getElement("saveProfileButton");


    if (saveProfileButton) {

        saveProfileButton.addEventListener(
            "click",
            function () {

                const name =
                    getElement("profileName").value.trim();

                if (!name) {
                    showMessage(
                        "Please enter your name."
                    );
                    return;
                }


                const oldProfile = getJSON(
                    STORAGE_KEYS.profile,
                    {}
                );


                const profile = {

                    name: name,

                    mobile:
                        getElement("profileMobile")
                        .value
                        .trim(),

                    email:
                        getElement("profileEmail")
                        .value
                        .trim(),

                    jerseyName:
                        getElement("jerseyName")
                        .value
                        .trim(),

                    jerseyNumber:
                        getElement("jerseyNumber")
                        .value
                        .trim(),

                    jerseySize:
                        getElement("jerseySize")
                        .value,

                    pantSize:
                        getElement("pantSize")
                        .value
                        .trim(),

                    dateOfBirth:
                        getElement("dateOfBirth")
                        .value,

                    playerId:
                        oldProfile.playerId ||
                        (
                            "CY" +
                            Date.now()
                            .toString()
                            .slice(-8)
                        ),

                    photo:
                        oldProfile.photo || ""

                };


                setJSON(
                    STORAGE_KEYS.profile,
                    profile
                );


                showMessage(
                    "Profile saved successfully!"
                );


                updateHomeProfile();
                showScreen("screen5");

            }
        );

    }


    /* =====================================================
       HOME PROFILE UPDATE - SCREEN 5
    ===================================================== */

    function updateHomeProfile() {

        const profile = getJSON(
            STORAGE_KEYS.profile,
            {}
        );


        const playerName =
            profile.name || "CRIC YUVA PLAYER";

        const playerId =
            profile.playerId || "CY00000001";

        const initial =
            playerName.charAt(0).toUpperCase();


        const nameIds = [
            "homePlayerName",
            "menuPlayerName"
        ];


        nameIds.forEach(function (id) {

            const element = getElement(id);

            if (element) {
                element.textContent = playerName;
            }

        });


        const idIds = [
            "homePlayerId",
            "menuPlayerId"
        ];


        idIds.forEach(function (id) {

            const element = getElement(id);

            if (element) {

                if (id === "homePlayerId") {
                    element.textContent =
                        "ID: " + playerId;
                } else {
                    element.textContent =
                        playerId;
                }

            }

        });


        const initialIds = [
            "homeInitial",
            "menuInitial",
            "profileInitial"
        ];


        initialIds.forEach(function (id) {

            const element = getElement(id);

            if (element && !profile.photo) {
                element.textContent = initial;
            }

        });


        if (profile.photo) {

            setPhotoToElement(
                getElement("homeProfilePhoto"),
                profile.photo
            );

            setPhotoToElement(
                getElement("menuProfilePhoto"),
                profile.photo
            );

        }

    }


    const openProfileFromHome =
        getElement("openProfileFromHome");


    if (openProfileFromHome) {

        openProfileFromHome.addEventListener(
            "click",
            function () {
                loadProfileData();
                showScreen("screen4");
            }
        );

    }


    const bottomProfileButton =
        getElement("bottomProfileButton");


    if (bottomProfileButton) {

        bottomProfileButton.addEventListener(
            "click",
            function () {
                loadProfileData();
                showScreen("screen4");
            }
        );

    }


    /* =====================================================
       DATA ACTION BUTTONS
    ===================================================== */

    document.addEventListener(
        "click",
        function (event) {

            const button =
                event.target.closest("[data-action]");

            if (!button) {
                return;
            }

            const action =
                button.getAttribute("data-action");

            if (action === "profile") {
                loadProfileData();
            }

            goAction(action);

        }
    );


    /* =====================================================
       SIDE MENU
    ===================================================== */

    const menuButton =
        getElement("menuButton");

    const sideMenu =
        getElement("sideMenu");

    const menuOverlay =
        getElement("menuOverlay");

    const closeMenuButton =
        getElement("closeMenuButton");


    function openMenu() {

        if (sideMenu) {
            sideMenu.classList.add("active");
        }

        if (menuOverlay) {
            menuOverlay.classList.add("active");
        }

    }


    function closeMenu() {

        if (sideMenu) {
            sideMenu.classList.remove("active");
        }

        if (menuOverlay) {
            menuOverlay.classList.remove("active");
        }

    }


    if (menuButton) {
        menuButton.addEventListener(
            "click",
            openMenu
        );
    }


    if (closeMenuButton) {
        closeMenuButton.addEventListener(
            "click",
            closeMenu
        );
    }


    if (menuOverlay) {
        menuOverlay.addEventListener(
            "click",
            closeMenu
        );
    }


    /* =====================================================
       QUICK ACTION MODAL
    ===================================================== */

    const centerActionButton =
        getElement("centerActionButton");

    const quickModalOverlay =
        getElement("quickModalOverlay");

    const quickModalClose =
        getElement("quickModalClose");


    function openQuickModal() {

        if (quickModalOverlay) {
            quickModalOverlay.classList.add("active");
        }

    }


    function closeQuickModal() {

        if (quickModalOverlay) {
            quickModalOverlay.classList.remove("active");
        }

    }


    if (centerActionButton) {

        centerActionButton.addEventListener(
            "click",
            openQuickModal
        );

    }


    if (quickModalClose) {

        quickModalClose.addEventListener(
            "click",
            closeQuickModal
        );

    }


    if (quickModalOverlay) {

        quickModalOverlay.addEventListener(
            "click",
            function (event) {

                if (
                    event.target === quickModalOverlay
                ) {
                    closeQuickModal();
                }

            }
        );

    }


    /* =====================================================
       MY TEAM - SCREEN 6
    ===================================================== */

    function getPlayers() {
        return getJSON(
            STORAGE_KEYS.players,
            []
        );
    }


    function renderTeamPlayers() {

        const players = getPlayers();

        const totalPlayersCount =
            getElement("totalPlayersCount");

        const playingElevenCount =
            getElement("playingElevenCount");

        const substituteCount =
            getElement("substituteCount");


        if (totalPlayersCount) {
            totalPlayersCount.textContent =
                players.length;
        }


        if (playingElevenCount) {
            playingElevenCount.textContent =
                Math.min(players.length, 11);
        }


        if (substituteCount) {

            substituteCount.textContent =
                Math.max(
                    players.length - 11,
                    0
                );

        }


        const emptyCard =
            document.querySelector(
                "#myTeamScreen .empty-feature-card"
            );


        if (emptyCard) {

            if (players.length === 0) {
    const oldPlayerList = getElement("teamPlayerList");

    if (oldPlayerList) {
        oldPlayerList.remove();
    }

    emptyCard.style.display = "";
            }

            } else {

                let playerList =
                    getElement("teamPlayersList");

                if (!playerList) {

                    playerList =
                        document.createElement("div");

                    playerList.id =
                        "teamPlayersList";

                    playerList.className =
                        "team-players-list";

                    emptyCard.parentNode.insertBefore(
                        playerList,
                        emptyCard
                    );

                }


                playerList.innerHTML = "";


                players.forEach(
                    function (player, index) {

                        const item =
                            document.createElement("div");

                        item.className =
                            "team-player-item";

                        item.innerHTML =
                            "<div class='team-player-number'>" +
                            (index + 1) +
                            "</div>" +

                            "<div class='team-player-info'>" +

                            "<strong>" +
                            escapeHTML(player.name) +
                            "</strong>" +

                            "<span>" +
                            escapeHTML(player.role) +
                            " • #" +
                            escapeHTML(player.jersey) +
                            "</span>" +

                            "</div>" +

                            "<button type='button' class='remove-player-button' data-player-index='" +
                            index +
                            "'>" +

                            "<i class='fa-solid fa-trash'></i>" +

                            "</button>";

                        playerList.appendChild(item);

                    }
                );


                emptyCard.style.display = "none";

            }

        }

    }


    function escapeHTML(value) {

        const div =
            document.createElement("div");

        div.textContent = value || "";

        return div.innerHTML;

    }


    document.addEventListener(
        "click",
        function (event) {

            const removeButton =
                event.target.closest(
                    ".remove-player-button"
                );

            if (!removeButton) {
                return;
            }

            const index =
                Number(
                    removeButton.dataset.playerIndex
                );

            const players = getPlayers();

            players.splice(index, 1);

            setJSON(
                STORAGE_KEYS.players,
                players
            );

            renderTeamPlayers();
            updateStatistics();

        }
    );


    /* =====================================================
       ADD PLAYER - SCREEN 7
    ===================================================== */

    const saveNewPlayerButton =
        getElement("saveNewPlayerButton");


    if (saveNewPlayerButton) {

        saveNewPlayerButton.addEventListener(
            "click",
            function () {

                const name =
                    getElement("newPlayerName")
                    .value
                    .trim();

                const mobile =
                    getElement("newPlayerMobile")
                    .value
                    .trim();

                const role =
                    getElement("newPlayerRole")
                    .value;

                const jersey =
                    getElement("newPlayerJersey")
                    .value
                    .trim();


                if (!name) {
                    showMessage(
                        "Please enter player name."
                    );
                    return;
                }


                if (
                    mobile &&
                    mobile.length !== 10
                ) {
                    showMessage(
                        "Please enter a valid mobile number."
                    );
                    return;
                }


                if (!role) {
                    showMessage(
                        "Please select player role."
                    );
                    return;
                }


                const players = getPlayers();


                players.push({
                    name: name,
                    mobile: mobile,
                    role: role,
                    jersey: jersey
                });


                setJSON(
                    STORAGE_KEYS.players,
                    players
                );


                getElement("newPlayerName").value = "";
                getElement("newPlayerMobile").value = "";
                getElement("newPlayerRole").value = "";
                getElement("newPlayerJersey").value = "";


                showMessage(
                    "Player added successfully!"
                );


                renderTeamPlayers();
                showScreen("myTeamScreen");

            }
        );

    }


    /* =====================================================
       MANAGE ROLES - SCREEN 10
    ===================================================== */

    function selectTeamRole(
        roleType
    ) {

        const players = getPlayers();

        if (players.length === 0) {

            showMessage(
                "Please add players first."
            );

            return;
        }


        const playerNames =
            players.map(
                function (player, index) {
                    return (
                        (index + 1) +
                        ". " +
                        player.name
                    );
                }
            )
            .join("\n");


        const selected =
            prompt(
                "Enter player number:\n\n" +
                playerNames
            );


        const playerIndex =
            Number(selected) - 1;


        if (
            isNaN(playerIndex) ||
            !players[playerIndex]
        ) {

            return;

        }


        const team = getJSON(
            STORAGE_KEYS.team,
            {}
        );


        if (roleType === "captain") {

            team.captain =
                players[playerIndex].name;

        } else {

            team.viceCaptain =
                players[playerIndex].name;

        }


        setJSON(
            STORAGE_KEYS.team,
            team
        );


        updateTeamRoles();

    }


    function updateTeamRoles() {

        const team = getJSON(
            STORAGE_KEYS.team,
            {}
        );


        const captainName =
            getElement("captainName");

        const viceCaptainName =
            getElement("viceCaptainName");


        if (captainName) {

            captainName.textContent =
                team.captain ||
                "Not Selected";

        }


        if (viceCaptainName) {

            viceCaptainName.textContent =
                team.viceCaptain ||
                "Not Selected";

        }

    }


    const selectCaptainButton =
        getElement("selectCaptainButton");

    const selectViceCaptainButton =
        getElement(
            "selectViceCaptainButton"
        );


    if (selectCaptainButton) {

        selectCaptainButton.addEventListener(
            "click",
            function () {
                selectTeamRole("captain");
            }
        );

    }


    if (selectViceCaptainButton) {

        selectViceCaptainButton.addEventListener(
            "click",
            function () {
                selectTeamRole("viceCaptain");
            }
        );

    }


    /* =====================================================
       TEAM CHAT - SCREEN 9
    ===================================================== */

    function renderChatMessages() {

        const chatBox =
            getElement("teamChatMessages");

        if (!chatBox) {
            return;
        }


        const messages = getJSON(
            STORAGE_KEYS.chat,
            []
        );


        chatBox.innerHTML =
            "<div class='chat-system-message'>" +
            "Welcome to your Team Chat" +
            "</div>";


        messages.forEach(
            function (message) {

                const messageDiv =
                    document.createElement("div");

                messageDiv.className =
                    "chat-own-message";

                messageDiv.textContent =
                    message;

                chatBox.appendChild(
                    messageDiv
                );

            }
        );


        chatBox.scrollTop =
            chatBox.scrollHeight;

    }


    function sendTeamMessage() {

        const input =
            getElement("teamChatInput");

        if (!input) {
            return;
        }


        const message =
            input.value.trim();

        if (!message) {
            return;
        }


        const messages = getJSON(
            STORAGE_KEYS.chat,
            []
        );


        messages.push(message);


        setJSON(
            STORAGE_KEYS.chat,
            messages
        );


        input.value = "";


        renderChatMessages();

    }


    const sendTeamChatButton =
        getElement("sendTeamChatButton");


    if (sendTeamChatButton) {

        sendTeamChatButton.addEventListener(
            "click",
            sendTeamMessage
        );

    }


    const teamChatInput =
        getElement("teamChatInput");


    if (teamChatInput) {

        teamChatInput.addEventListener(
            "keydown",
            function (event) {

                if (event.key === "Enter") {
                    sendTeamMessage();
                }

            }
        );

    }


    /* =====================================================
       CREATE MATCH - SCREEN 12
    ===================================================== */

    function getMatches() {

        return getJSON(
            STORAGE_KEYS.matches,
            []
        );

    }


    const createNewMatchButton =
        getElement("createNewMatchButton");


    if (createNewMatchButton) {

        createNewMatchButton.addEventListener(
            "click",
            function () {

                const teamA =
                    getElement("matchTeamA")
                    .value
                    .trim();

                const teamB =
                    getElement("matchTeamB")
                    .value
                    .trim();

                const overs =
                    getElement("matchOvers")
                    .value;

                const date =
                    getElement("matchDate")
                    .value;

                const ground =
                    getElement("matchGround")
                    .value
                    .trim();


                if (!teamA || !teamB) {

                    showMessage(
                        "Please enter both team names."
                    );

                    return;

                }


                const matches =
                    getMatches();


                matches.push({

                    id: Date.now(),

                    teamA: teamA,

                    teamB: teamB,

                    overs: overs,

                    date: date,

                    ground: ground,

                    status: "UPCOMING"

                });


                setJSON(
                    STORAGE_KEYS.matches,
                    matches
                );


                getElement("matchTeamA").value = "";
                getElement("matchTeamB").value = "";
                getElement("matchGround").value = "";
                getElement("matchDate").value = "";


                showMessage(
                    "Match created successfully!"
                );


                renderMatches();
                showScreen("matchesScreen");

            }
        );

    }


    /* =====================================================
       RENDER MATCHES
    ===================================================== */

    function renderMatches() {

        const container =
            getElement("matchListContainer");

        if (!container) {
            return;
        }


        const matches =
            getMatches();


        if (matches.length === 0) {

            container.innerHTML =
                "<div class='empty-feature-card'>" +

                "<div class='empty-feature-icon'>" +
                "<i class='fa-solid fa-baseball-bat-ball'></i>" +
                "</div>" +

                "<h3>No Matches Yet</h3>" +

                "<p>Create a match or join a tournament match.</p>" +

                "</div>";

            return;

        }


        container.innerHTML = "";


        matches
        .slice()
        .reverse()
        .forEach(
            function (match) {

                const card =
                    document.createElement("button");

                card.type = "button";

                card.className =
                    "created-match-card";

                card.innerHTML =

                    "<span class='match-status-badge'>" +
                    escapeHTML(
                        match.status || "UPCOMING"
                    ) +
                    "</span>" +

                    "<h3>" +
                    escapeHTML(match.teamA) +
                    " <span>VS</span> " +
                    escapeHTML(match.teamB) +
                    "</h3>" +

                    "<p>" +
                    (match.date || "Date not selected") +
                    " • " +
                    (match.ground || "Ground not selected") +
                    "</p>" +

                    "<small>" +
                    match.overs +
                    " Overs</small>";


                card.addEventListener(
                    "click",
                    function () {

                        localStorage.setItem(
                            "cricYuvaSelectedMatch",
                            JSON.stringify(match)
                        );

                        updateSingleMatchData();

                        showScreen(
                            "singleMatchScreen"
                        );

                    }
                );


                container.appendChild(card);

            }
        );

    }


    /* =====================================================
       SINGLE MATCH DATA
    ===================================================== */

    function updateSingleMatchData() {

        const match = getJSON(
            "cricYuvaSelectedMatch",
            null
        );


        if (!match) {
            return;
        }


        const teamNames =
            document.querySelectorAll(
                "#singleMatchScreen .single-match-teams strong"
            );


        if (teamNames[0]) {
            teamNames[0].textContent =
                match.teamA;
        }


        if (teamNames[1]) {
            teamNames[1].textContent =
                match.teamB;
        }


        const matchText =
            document.querySelector(
                "#singleMatchScreen .single-match-score-card p"
            );


        if (matchText) {

            matchText.textContent =
                (
                    match.date ||
                    "Coming Soon"
                ) +
                " • " +
                (
                    match.ground ||
                    "Ground"
                );

        }


        const liveTeamName =
            document.querySelector(
                "#liveScoreScreen .live-score-big-card > span"
            );


        if (liveTeamName) {

            liveTeamName.textContent =
                match.teamA;

        }

    }


    /* =====================================================
       LIVE SCORE - SCREEN 14
    ===================================================== */

    let scoreData = {

        runs: 0,
        wickets: 0,
        legalBalls: 0,
        extras: 0

    };


    function updateLiveScore() {

        const liveRuns =
            getElement("liveRuns");

        const liveWickets =
            getElement("liveWickets");

        const liveOvers =
            getElement("liveOvers");


        if (liveRuns) {
            liveRuns.textContent =
                scoreData.runs;
        }


        if (liveWickets) {
            liveWickets.textContent =
                scoreData.wickets;
        }


        if (liveOvers) {

            const overs =
                Math.floor(
                    scoreData.legalBalls / 6
                );

            const balls =
                scoreData.legalBalls % 6;

            liveOvers.textContent =
                overs + "." + balls;

        }

    }


    document.addEventListener(
        "click",
        function (event) {

            const scoreButton =
                event.target.closest(
                    "[data-score]"
                );

            if (!scoreButton) {
                return;
            }


            const score =
                scoreButton.dataset.score;


            if (
                ["0", "1", "2", "3", "4", "6"]
                .includes(score)
            ) {

                scoreData.runs +=
                    Number(score);

                scoreData.legalBalls += 1;

            }


            if (score === "wide") {

                scoreData.runs += 1;
                scoreData.extras += 1;

            }


            if (score === "noball") {

                scoreData.runs += 1;
                scoreData.extras += 1;

            }


            if (score === "wicket") {

                scoreData.wickets += 1;
                scoreData.legalBalls += 1;

            }


            updateLiveScore();

        }
    );


    /* =====================================================
       CREATE TOURNAMENT - SCREEN 18
    ===================================================== */

    const saveTournamentButton =
        getElement("saveTournamentButton");


    if (saveTournamentButton) {

        saveTournamentButton.addEventListener(
            "click",
            function () {

                const name =
                    getElement("tournamentName")
                    .value
                    .trim();

                const teams =
                    getElement("tournamentTeams")
                    .value;

                const format =
                    getElement("tournamentFormat")
                    .value;

                const overs =
                    getElement("tournamentOvers")
                    .value;


                if (!name) {

                    showMessage(
                        "Please enter tournament name."
                    );

                    return;

                }


                const tournament = {

                    name: name,

                    teams: teams,

                    format: format,

                    overs: overs

                };


                setJSON(
                    STORAGE_KEYS.tournament,
                    tournament
                );


                getElement("tournamentName").value = "";


                showMessage(
                    "Tournament created successfully!"
                );


                renderTournamentData();

                showScreen(
                    "tournamentScreen"
                );

            }
        );

    }


    function renderTournamentData() {

        const tournament = getJSON(
            STORAGE_KEYS.tournament,
            null
        );


        if (!tournament) {
            return;
        }


        const emptyCard =
            document.querySelector(
                "#tournamentScreen .empty-feature-card"
            );


        if (!emptyCard) {
            return;
        }


        emptyCard.innerHTML =

            "<div class='empty-feature-icon'>" +
            "<i class='fa-solid fa-trophy'></i>" +
            "</div>" +

            "<h3>" +
            escapeHTML(tournament.name) +
            "</h3>" +

            "<p>" +

            tournament.teams +
            " Teams • " +

            escapeHTML(
                tournament.format
            ) +

            " • " +

            tournament.overs +
            " Overs" +

            "</p>";

    }


    /* =====================================================
       STATISTICS - SCREEN 22
    ===================================================== */

    function updateStatistics() {

        const matches =
            getMatches();

        const statCards =
            document.querySelectorAll(
                "#statisticsScreen .stat-card strong"
            );


        if (statCards[0]) {
            statCards[0].textContent =
                matches.length;
        }


        if (statCards[1]) {
            statCards[1].textContent =
                scoreData.runs;
        }


        if (statCards[2]) {
            statCards[2].textContent =
                scoreData.wickets;
        }


        if (statCards[3]) {
            statCards[3].textContent = "0";
        }

    }


    /* =====================================================
       HOME UPCOMING MATCH
    ===================================================== */

    function updateHomeUpcomingMatch() {

        const matches =
            getMatches();

        if (matches.length === 0) {
            return;
        }


        const match =
            matches[matches.length - 1];


        const teamNames =
            document.querySelectorAll(
                "#screen5 .upcoming-match-card .team-side strong"
            );


        if (teamNames[0]) {
            teamNames[0].textContent =
                match.teamA;
        }


        if (teamNames[1]) {
            teamNames[1].textContent =
                match.teamB;
        }


        const infoItems =
            document.querySelectorAll(
                "#screen5 .match-info-row span"
            );


        if (infoItems[0]) {

            infoItems[0].textContent =
                match.date ||
                "Coming Soon";

        }


        if (infoItems[1]) {

            infoItems[1].textContent =
                match.ground ||
                "Ground";

        }

    }


    /* =====================================================
       NOTIFICATION
    ===================================================== */

    const notificationButton =
        getElement("notificationButton");


    if (notificationButton) {

        notificationButton.addEventListener(
            "click",
            function () {

                showMessage(
                    "No new notifications."
                );

            }
        );

    }


    /* =====================================================
       CONTACT FORM - SCREEN 28
    ===================================================== */

    const sendContactButton =
        getElement("sendContactButton");


    if (sendContactButton) {

        sendContactButton.addEventListener(
            "click",
            function () {

                const subject =
                    getElement("contactSubject")
                    .value
                    .trim();

                const message =
                    getElement("contactMessage")
                    .value
                    .trim();


                if (!subject || !message) {

                    showMessage(
                        "Please enter subject and message."
                    );

                    return;

                }


                showMessage(
                    "Your message has been prepared successfully!"
                );


                getElement(
                    "contactSubject"
                ).value = "";

                getElement(
                    "contactMessage"
                ).value = "";

            }
        );

    }


    /* =====================================================
       SHARE APP
    ===================================================== */

    function shareApp() {

        const shareData = {

            title:
                "CRIC YUVA V1.0",

            text:
                "Play Together, Win Together! Join CRIC YUVA.",

            url:
                window.location.href

        };


        if (
            navigator.share
        ) {

            navigator
            .share(shareData)
            .catch(function () {});

        } else {

            navigator.clipboard
            .writeText(
                window.location.href
            )
            .then(function () {

                showMessage(
                    "App link copied successfully!"
                );

            })
            .catch(function () {

                showMessage(
                    "Share this link: " +
                    window.location.href
                );

            });

        }

    }


    /* =====================================================
       OPEN GROUND
    ===================================================== */

    function openGround() {

        const match = getJSON(
            "cricYuvaSelectedMatch",
            null
        );


        if (
            match &&
            match.ground
        ) {

            const query =
                encodeURIComponent(
                    match.ground
                );


            window.open(
                "https://www.google.com/maps/search/?api=1&query=" +
                query,
                "_blank"
            );

        } else {

            showMessage(
                "Ground location not available."
            );

        }

    }


    /* =====================================================
       LOGOUT
    ===================================================== */

    const logoutButton =
        getElement("logoutButton");


    if (logoutButton) {

        logoutButton.addEventListener(
            "click",
            function () {

                const confirmLogout =
                    confirm(
                        "Are you sure you want to logout?"
                    );


                if (!confirmLogout) {
                    return;
                }


                closeMenu();


                getElement(
                    "loginPassword"
                ).value = "";


                showScreen("screen2");


                showMessage(
                    "Logged out successfully."
                );

            }
        );

    }


    /* =====================================================
       BOTTOM NAV ACTIVE
    ===================================================== */

    document.addEventListener(
        "click",
        function (event) {

            const navButton =
                event.target.closest(
                    ".bottom-nav-item"
                );

            if (!navButton) {
                return;
            }


            document
            .querySelectorAll(
                ".bottom-nav-item"
            )
            .forEach(
                function (item) {
                    item.classList.remove(
                        "active"
                    );
                }
            );


            navButton.classList.add(
                "active"
            );

        }
    );


    /* =====================================================
       HOME LIVE BUTTON
    ===================================================== */

    const watchLiveButton =
        getElement("watchLiveButton");


    if (watchLiveButton) {

        watchLiveButton.addEventListener(
            "click",
            function () {
                showScreen("liveScreen");
            }
        );

    }


    /* =====================================================
       HOME MATCH BUTTON
    ===================================================== */

    const matchDetailsButton =
        getElement("matchDetailsButton");


    if (matchDetailsButton) {

        matchDetailsButton.addEventListener(
            "click",
            function () {

                const matches =
                    getMatches();

                if (
                    matches.length > 0
                ) {

                    const match =
                        matches[
                            matches.length - 1
                        ];

                    localStorage.setItem(
                        "cricYuvaSelectedMatch",
                        JSON.stringify(match)
                    );

                    updateSingleMatchData();

                }

                showScreen(
                    "singleMatchScreen"
                );

            }
        );

    }


    /* =====================================================
       INITIAL LOAD
    ===================================================== */

    loadProfileData();

    updateHomeProfile();

    renderTeamPlayers();

    renderMatches();

    renderTournamentData();

    updateTeamRoles();

    renderChatMessages();

    updateLiveScore();

    updateStatistics();

    updateHomeUpcomingMatch();


    console.log(
        "CRIC YUVA V1.0 - Complete Script Loaded"
    );

});
