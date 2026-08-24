document.addEventListener("DOMContentLoaded", function () {

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
       SCREEN SYSTEM
    ===================================================== */

    function showScreen(screenId, addHistory = true) {

        const target = document.getElementById(screenId);

        if (!target) {
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
        closeQuickModal();
    }


    function goBack() {

        if (navigationHistory.length > 0) {

            const previousScreen = navigationHistory.pop();

            showScreen(previousScreen, false);

        } else if (currentScreen !== "screen5") {

            showScreen("screen5", false);
        }
    }


    /* =====================================================
       PASSWORD EYE
    ===================================================== */

    function setupPasswordEye(buttonId, inputId) {

        const button = document.getElementById(buttonId);
        const input = document.getElementById(inputId);

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
       SPLASH
    ===================================================== */

    setTimeout(function () {

        const savedMobile =
            localStorage.getItem("cricYuvaMobile");

        const profileSaved =
            localStorage.getItem("cricYuvaProfileComplete");

        if (savedMobile && profileSaved === "true") {
            loadProfileToScreen4();
            loadHomeProfile();
            showScreen("screen2", false);
        } else {
            showScreen("screen2", false);
        }

    }, 2500);


    /* =====================================================
       CREATE ACCOUNT
    ===================================================== */

    const createAccountButton =
        document.getElementById("createAccountButton");

    if (createAccountButton) {
        createAccountButton.addEventListener("click", function () {
            showScreen("screen3");
        });
    }


    document
        .getElementById("createBackButton")
        .addEventListener("click", function () {

            showScreen("screen2", false);
        });


    document
        .getElementById("saveAccountButton")
        .addEventListener("click", function () {

            const mobile =
                document.getElementById("newMobile").value.trim();

            const password =
                document.getElementById("newPassword").value;

            const verifyPassword =
                document.getElementById("verifyPassword").value;


            if (!/^[0-9]{10}$/.test(mobile)) {
                alert("Please enter a valid 10 digit mobile number.");
                return;
            }

            if (password.length < 4) {
                alert("Password must be at least 4 characters.");
                return;
            }

            if (password !== verifyPassword) {
                alert("Password does not match!");
                return;
            }

            localStorage.setItem("cricYuvaMobile", mobile);
            localStorage.setItem("cricYuvaPassword", password);
            localStorage.setItem(
                "cricYuvaProfileComplete",
                "false"
            );

            document.getElementById("profileMobile").value = mobile;

            alert("Account created successfully!");

            showScreen("screen4");
        });


    /* =====================================================
       LOGIN
    ===================================================== */

    document
        .getElementById("loginButton")
        .addEventListener("click", function () {

            const mobile =
                document.getElementById("loginMobile")
                .value.trim();

            const password =
                document.getElementById("loginPassword")
                .value;

            const savedMobile =
                localStorage.getItem("cricYuvaMobile");

            const savedPassword =
                localStorage.getItem("cricYuvaPassword");


            if (!savedMobile || !savedPassword) {
                alert("Please create a new account first.");
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

                if (profileComplete === "true") {
                    navigationHistory = [];
                    showScreen("screen5", false);
                } else {
                    showScreen("screen4");
                }

            } else {

                alert("Invalid mobile number or password!");
            }
        });


    /* =====================================================
       FORGOT PASSWORD
    ===================================================== */

    document
        .getElementById("forgotPasswordButton")
        .addEventListener("click", function () {

            const mobile =
                localStorage.getItem("cricYuvaMobile");

            if (!mobile) {
                alert(
                    "No account found. Please create a new account."
                );
                return;
            }

            alert(
                "Password reset system will be added in the next version."
            );
        });


    /* =====================================================
       PLAYER ID
    ===================================================== */

    function getPlayerId() {

        let id =
            localStorage.getItem("cricYuvaPlayerId");

        if (!id) {

            const mobile =
                localStorage.getItem("cricYuvaMobile") || "0000";

            id =
                "CY" +
                mobile.slice(-4) +
                "001";

            localStorage.setItem(
                "cricYuvaPlayerId",
                id
            );
        }

        return id;
    }


    /* =====================================================
       PROFILE PHOTO
    ===================================================== */

    const replacePhotoBtn =
        document.getElementById("replacePhotoBtn");

    const profilePhotoInput =
        document.getElementById("profilePhotoInput");

    if (replacePhotoBtn && profilePhotoInput) {

        replacePhotoBtn.addEventListener("click", function () {
            profilePhotoInput.click();
        });

        profilePhotoInput.addEventListener(
            "change",
            function () {

                const file = this.files[0];

                if (!file) return;

                if (!file.type.startsWith("image/")) {
                    alert("Please select an image file.");
                    return;
                }

                const reader = new FileReader();

                reader.onload = function (event) {

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

                reader.readAsDataURL(file);
            }
        );
    }


    function setProfileImage(imageData) {

        const profilePhoto =
            document.getElementById("profilePhoto");

        if (!profilePhoto) return;

        profilePhoto.innerHTML =
            '<img src="' +
            imageData +
            '" alt="Profile Photo">';
    }


    function updateAllProfilePhotos(imageData) {

        const homePhoto =
            document.getElementById("homeProfilePhoto");

        const menuPhoto =
            document.getElementById("menuProfilePhoto");

        if (imageData) {

            if (homePhoto) {
                homePhoto.innerHTML =
                    '<img src="' +
                    imageData +
                    '" alt="Profile Photo">';
            }

            if (menuPhoto) {
                menuPhoto.innerHTML =
                    '<img src="' +
                    imageData +
                    '" alt="Profile Photo">';
            }
        }
    }


    /* =====================================================
       PROFILE SAVE
    ===================================================== */

    document
        .getElementById("saveProfileButton")
        .addEventListener("click", function () {

            const name =
                document.getElementById("profileName")
                .value.trim();

            const mobile =
                document.getElementById("profileMobile")
                .value.trim();

            const email =
                document.getElementById("profileEmail")
                .value.trim();

            const jerseyName =
                document.getElementById("jerseyName")
                .value.trim();

            const jerseyNumber =
                document.getElementById("jerseyNumber")
                .value.trim();

            const jerseySize =
                document.getElementById("jerseySize")
                .value;

            const pantSize =
                document.getElementById("pantSize")
                .value.trim();

            const dateOfBirth =
                document.getElementById("dateOfBirth")
                .value;


            if (!name) {
                alert("Please enter your name.");
                return;
            }

            if (!mobile) {
                alert("Mobile number is required.");
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
                JSON.stringify(profileData)
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

            alert("Profile saved successfully!");

            navigationHistory = [];

            showScreen("screen5", false);
        });


    /* =====================================================
       LOAD PROFILE
    ===================================================== */

    function loadProfileToScreen4() {

        const savedMobile =
            localStorage.getItem("cricYuvaMobile");

        const profileMobile =
            document.getElementById("profileMobile");

        if (savedMobile && profileMobile) {
            profileMobile.value = savedMobile;
        }

        document.getElementById("playerId").textContent =
            getPlayerId();


        const savedProfile =
            localStorage.getItem("cricYuvaProfile");

        if (!savedProfile) {

            loadSavedPhoto();
            return;
        }

        try {

            const profile =
                JSON.parse(savedProfile);

            document.getElementById("profileName").value =
                profile.name || "";

            document.getElementById("profileMobile").value =
                profile.mobile || savedMobile || "";

            document.getElementById("profileEmail").value =
                profile.email || "";

            document.getElementById("jerseyName").value =
                profile.jerseyName || "";

            document.getElementById("jerseyNumber").value =
                profile.jerseyNumber || "";

            document.getElementById("jerseySize").value =
                profile.jerseySize || "";

            document.getElementById("pantSize").value =
                profile.pantSize || "";

            document.getElementById("dateOfBirth").value =
                profile.dateOfBirth || "";

        } catch (error) {
            console.error(error);
        }

        loadSavedPhoto();
    }


    function loadSavedPhoto() {

        const photo =
            localStorage.getItem(
                "cricYuvaProfilePhoto"
            );

        if (photo) {
            setProfileImage(photo);
        }
    }


    /* =====================================================
       LOAD HOME PROFILE
    ===================================================== */

    function loadHomeProfile() {

        const savedProfile =
            localStorage.getItem("cricYuvaProfile");

        const savedName =
            localStorage.getItem("cricYuvaPlayerName");

        const playerId =
            getPlayerId();

        let name =
            savedName || "CRIC YUVA PLAYER";

        if (savedProfile) {

            try {

                const profile =
                    JSON.parse(savedProfile);

                if (profile.name) {
                    name = profile.name;
                }

            } catch (error) {
                console.error(error);
            }
        }


        document.getElementById("homePlayerName")
            .textContent = name;

        document.getElementById("menuPlayerName")
            .textContent = name;

        document.getElementById("homePlayerId")
            .textContent = "ID: " + playerId;

        document.getElementById("menuPlayerId")
            .textContent = playerId;


        const initial =
            name.charAt(0).toUpperCase() || "P";

        document.getElementById("homeInitial")
            .textContent = initial;

        document.getElementById("menuInitial")
            .textContent = initial;


        const photo =
            localStorage.getItem(
                "cricYuvaProfilePhoto"
            );

        if (photo) {
            updateAllProfilePhotos(photo);
        }
    }


    /* =====================================================
       PROFILE BACK
    ===================================================== */

    document
        .getElementById("profileBackButton")
        .addEventListener("click", function () {

            if (
                localStorage.getItem(
                    "cricYuvaProfileComplete"
                ) === "true"
            ) {
                goBack();
            } else {
                showScreen("screen2", false);
            }
        });


    /* =====================================================
       SIDE MENU
    ===================================================== */

    const sideMenu =
        document.getElementById("sideMenu");

    const menuOverlay =
        document.getElementById("menuOverlay");


    function openMenu() {
        sideMenu.classList.add("open");
        menuOverlay.classList.add("open");
    }


    function closeMenu() {
        sideMenu.classList.remove("open");
        menuOverlay.classList.remove("open");
    }


    document
        .getElementById("menuButton")
        .addEventListener("click", openMenu);

    document
        .getElementById("closeMenuButton")
        .addEventListener("click", closeMenu);

    menuOverlay.addEventListener("click", closeMenu);


    /* =====================================================
       QUICK MODAL
    ===================================================== */

    const quickModalOverlay =
        document.getElementById("quickModalOverlay");


    function openQuickModal() {
        quickModalOverlay.classList.add("open");
    }


    function closeQuickModal() {
        quickModalOverlay.classList.remove("open");
    }


    document
        .getElementById("centerActionButton")
        .addEventListener("click", openQuickModal);

    document
        .getElementById("quickModalClose")
        .addEventListener("click", closeQuickModal);

    quickModalOverlay.addEventListener(
        "click",
        function (event) {

            if (event.target === quickModalOverlay) {
                closeQuickModal();
            }
        }
    );


    /* =====================================================
       FEATURE PAGES
    ===================================================== */

    function openFeature(action) {

        closeMenu();
        closeQuickModal();

        if (action === "home") {
            navigationHistory = [];
            showScreen("screen5", false);
            return;
        }

        if (action === "profile") {
            loadProfileToScreen4();
            showScreen("screen4");
            return;
        }

        if (action === "share") {
            shareApp();
            return;
        }

        const feature =
            featureNames[action];

        if (!feature) return;

        const title = feature[0];
        const iconClass = feature[1];

        document.getElementById("featureTitle")
            .textContent = title;

        document.getElementById("featureMainTitle")
            .textContent = title;

        document.getElementById("featureText")
            .textContent =
            title +
            " page is ready for the next development step.";

        document.getElementById("featureIcon")
            .innerHTML =
            '<i class="fa-solid ' +
            iconClass +
            '"></i>';

        showScreen("featureScreen");
    }


    document.querySelectorAll("[data-action]")
        .forEach(function (button) {

            button.addEventListener(
                "click",
                function () {

                    const action =
                        button.dataset.action;

                    openFeature(action);
                }
            );
        });


    /* =====================================================
       HOME SPECIAL BUTTONS
    ===================================================== */

    document
        .getElementById("openProfileFromHome")
        .addEventListener("click", function () {

            loadProfileToScreen4();
            showScreen("screen4");
        });


    document
        .getElementById("watchLiveButton")
        .addEventListener("click", function () {

            openFeature("live");
        });


    document
        .getElementById("matchDetailsButton")
        .addEventListener("click", function () {

            openFeature("matches");
        });


    document
        .getElementById("notificationButton")
        .addEventListener("click", function () {

            openFeature("updates");
        });


    /* =====================================================
       FEATURE BACK BUTTON
    ===================================================== */

    document
        .getElementById("featureBackButton")
        .addEventListener("click", goBack);


    document
        .getElementById("featureHomeButton")
        .addEventListener("click", function () {

            navigationHistory = [];
            showScreen("screen5", false);
        });


    /* =====================================================
       SHARE APP
    ===================================================== */

    function shareApp() {

        const shareText =
            "Join me on CRIC YUVA - Play Together, Win Together!";

        if (navigator.share) {

            navigator.share({
                title: "CRIC YUVA",
                text: shareText
            }).catch(function () {});

        } else {

            navigator.clipboard
                .writeText(shareText)
                .then(function () {
                    alert("CRIC YUVA share message copied!");
                })
                .catch(function () {
                    alert(shareText);
                });
        }
    }


    /* =====================================================
       LOGOUT
    ===================================================== */

    document
        .getElementById("logoutButton")
        .addEventListener("click", function () {

            closeMenu();

            document.getElementById("loginMobile").value =
                "";

            document.getElementById("loginPassword").value =
                "";

            navigationHistory = [];

            showScreen("screen2", false);
        });


    /* =====================================================
       INITIAL PROFILE LOAD
    ===================================================== */

    loadProfileToScreen4();
    loadHomeProfile();

});
