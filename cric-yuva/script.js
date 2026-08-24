document.addEventListener("DOMContentLoaded", function () {

    // ==========================================
    // SCREEN CHANGE
    // ==========================================
    function showScreen(screenId) {

        document.querySelectorAll(".app-screen").forEach(function (screen) {
            screen.classList.remove("active");
        });

        const targetScreen = document.getElementById(screenId);

        if (targetScreen) {
            targetScreen.classList.add("active");
            window.scrollTo(0, 0);
        }
    }


    // ==========================================
    // SPLASH SCREEN
    // ==========================================
    setTimeout(function () {
        showScreen("screen2");
    }, 2500);


    // ==========================================
    // PASSWORD SHOW / HIDE
    // ==========================================
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


    // ==========================================
    // CREATE ACCOUNT PAGE
    // ==========================================
    const createAccountButton =
        document.getElementById("createAccountButton");

    if (createAccountButton) {
        createAccountButton.addEventListener("click", function () {
            showScreen("screen3");
        });
    }


    // ==========================================
    // BACK BUTTON - SCREEN 3
    // ==========================================
    const backButton = document.querySelector(".back-button");

    if (backButton) {
        backButton.addEventListener("click", function () {
            showScreen("screen2");
        });
    }


    // ==========================================
    // CREATE ACCOUNT - SAVE
    // ==========================================
    const saveAccountButton =
        document.getElementById("saveAccountButton");

    if (saveAccountButton) {

        saveAccountButton.addEventListener("click", function () {

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
                alert("Passwords do not match!");
                return;
            }


            localStorage.setItem("cricYuvaMobile", mobile);
            localStorage.setItem("cricYuvaPassword", password);


            const profileMobile =
                document.getElementById("profileMobile");

            if (profileMobile) {
                profileMobile.value = mobile;
            }


            showScreen("screen4");

        });

    }


    // ==========================================
    // LOGIN
    // ==========================================
    const loginButton =
        document.getElementById("loginButton");

    if (loginButton) {

        loginButton.addEventListener("click", function () {

            const mobile =
                document.getElementById("loginMobile").value.trim();

            const password =
                document.getElementById("loginPassword").value;

            const savedMobile =
                localStorage.getItem("cricYuvaMobile");

            const savedPassword =
                localStorage.getItem("cricYuvaPassword");


            if (!savedMobile || !savedPassword) {
                alert("Please create a new account first.");
                return;
            }


            if (mobile === savedMobile && password === savedPassword) {

                loadProfile();
                showScreen("screen4");

            } else {

                alert("Invalid mobile number or password!");

            }

        });

    }


    // ==========================================
    // PROFILE PHOTO
    // ==========================================
    const replacePhotoBtn =
        document.getElementById("replacePhotoBtn");

    const profilePhotoInput =
        document.getElementById("profilePhotoInput");

    const profilePhoto =
        document.getElementById("profilePhoto");

    const profileInitial =
        document.getElementById("profileInitial");


    if (replacePhotoBtn && profilePhotoInput) {

        replacePhotoBtn.addEventListener("click", function () {
            profilePhotoInput.click();
        });


        profilePhotoInput.addEventListener("change", function () {

            const file = this.files && this.files[0];

            if (!file) return;

            const reader = new FileReader();

            reader.onload = function (event) {

                const imageData = event.target.result;

                profilePhoto.style.backgroundImage =
                    "url('" + imageData + "')";

                profilePhoto.style.backgroundSize = "cover";
                profilePhoto.style.backgroundPosition = "center";

                if (profileInitial) {
                    profileInitial.style.display = "none";
                }

                localStorage.setItem(
                    "cricYuvaProfilePhoto",
                    imageData
                );
            };

            reader.readAsDataURL(file);

        });

    }


    // ==========================================
    // SAVE PROFILE
    // ==========================================
    const saveProfileButton =
        document.getElementById("saveProfileButton");

    if (saveProfileButton) {

        saveProfileButton.addEventListener("click", function () {

            const profileData = {

                name:
                    document.getElementById("profileName").value.trim(),

                mobile:
                    document.getElementById("profileMobile").value.trim(),

                email:
                    document.getElementById("profileEmail").value.trim(),

                jerseyName:
                    document.getElementById("jerseyName").value.trim(),

                jerseyNumber:
                    document.getElementById("jerseyNumber").value.trim(),

                jerseySize:
                    document.getElementById("jerseySize").value,

                pantSize:
                    document.getElementById("pantSize").value.trim(),

                dateOfBirth:
                    document.getElementById("dateOfBirth").value
            };


            if (profileData.name === "") {
                alert("Please enter your name.");
                return;
            }


            localStorage.setItem(
                "cricYuvaProfile",
                JSON.stringify(profileData)
            );

            localStorage.setItem(
                "cricYuvaMobile",
                profileData.mobile
            );


            alert("Profile saved successfully!");

        });

    }


    // ==========================================
    // LOAD PROFILE
    // ==========================================
    function loadProfile() {

        const savedProfile =
            localStorage.getItem("cricYuvaProfile");

        const savedMobile =
            localStorage.getItem("cricYuvaMobile");

        const savedPhoto =
            localStorage.getItem("cricYuvaProfilePhoto");


        if (savedMobile) {
            document.getElementById("profileMobile").value =
                savedMobile;
        }


        if (savedProfile) {

            const data = JSON.parse(savedProfile);

            document.getElementById("profileName").value =
                data.name || "";

            document.getElementById("profileMobile").value =
                data.mobile || savedMobile || "";

            document.getElementById("profileEmail").value =
                data.email || "";

            document.getElementById("jerseyName").value =
                data.jerseyName || "";

            document.getElementById("jerseyNumber").value =
                data.jerseyNumber || "";

            document.getElementById("jerseySize").value =
                data.jerseySize || "";

            document.getElementById("pantSize").value =
                data.pantSize || "";

            document.getElementById("dateOfBirth").value =
                data.dateOfBirth || "";
        }


        if (savedPhoto && profilePhoto) {

            profilePhoto.style.backgroundImage =
                "url('" + savedPhoto + "')";

            profilePhoto.style.backgroundSize = "cover";
            profilePhoto.style.backgroundPosition = "center";

            if (profileInitial) {
                profileInitial.style.display = "none";
            }
        }
    }


    // ==========================================
    // PROFILE BACK
    // ==========================================
    const profileBackButton =
        document.getElementById("profileBackButton");

    if (profileBackButton) {
        profileBackButton.addEventListener("click", function () {
            showScreen("screen2");
        });
    }


    // ==========================================
    // FORGOT PASSWORD
    // ==========================================
    const forgotPasswordButton =
        document.getElementById("forgotPasswordButton");

    if (forgotPasswordButton) {
        forgotPasswordButton.addEventListener("click", function () {
            alert("Password reset feature will be added in the next version.");
        });
    }


    // LOAD SAVED PROFILE
    loadProfile();

});
