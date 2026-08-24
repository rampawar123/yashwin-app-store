document.addEventListener("DOMContentLoaded", function () {

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
        }
    }


    // ==========================================
    // PASSWORD SHOW / HIDE
    // ==========================================
    function setupPasswordEye(button, inputId) {

        if (!button) return;

        button.addEventListener("click", function () {

            const passwordInput = document.getElementById(inputId);

            if (!passwordInput) return;

            if (passwordInput.type === "password") {
                passwordInput.type = "text";

                const icon = button.querySelector("i");
                if (icon) {
                    icon.classList.remove("fa-eye");
                    icon.classList.add("fa-eye-slash");
                }

            } else {

                passwordInput.type = "password";

                const icon = button.querySelector("i");
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
    // CREATE ACCOUNT BUTTON
    // ==========================================
    const createAccountButton =
        document.getElementById("createAccountButton");

    if (createAccountButton) {
        createAccountButton.addEventListener("click", function () {
            showScreen("screen3");
        });
    }


    // ==========================================
    // BACK BUTTON
    // ==========================================
    document.querySelectorAll(".back-button").forEach(function (button) {

        button.addEventListener("click", function () {

            showScreen("screen2");

        });

    });


    // ==========================================
    // CREATE NEW ACCOUNT - SAVE
    // ==========================================
    const saveAccountButton =
        document.getElementById("saveAccountButton");

    if (saveAccountButton) {

        saveAccountButton.addEventListener("click", function () {

            const mobile =
                document.getElementById("newMobile");

            const password =
                document.getElementById("newPassword");

            const verifyPassword =
                document.getElementById("verifyPassword");


            if (!mobile || !password || !verifyPassword) {
                alert("Input fields not found. Please check index.html IDs.");
                return;
            }


            const mobileValue = mobile.value.trim();
            const passwordValue = password.value.trim();
            const verifyPasswordValue =
                verifyPassword.value.trim();


            // MOBILE VALIDATION
            if (mobileValue.length !== 10) {
                alert("Please enter a valid 10 digit mobile number.");
                return;
            }


            // PASSWORD VALIDATION
            if (passwordValue.length < 4) {
                alert("Password must be at least 4 characters.");
                return;
            }


            // PASSWORD MATCH
            if (passwordValue !== verifyPasswordValue) {
                alert("Password does not match!");
                return;
            }


            // SAVE ACCOUNT
            localStorage.setItem("cricYuvaMobile", mobileValue);
            localStorage.setItem("cricYuvaPassword", passwordValue);


            // PUT MOBILE IN PROFILE
            const profileMobile =
                document.getElementById("profileMobile");

            if (profileMobile) {
                profileMobile.value = mobileValue;
            }


            alert("Account created successfully!");

            // GO TO PROFILE SCREEN
            showScreen("screen4");

        });

    }


    // ==========================================
    // LOGIN BUTTON
    // ==========================================
    const loginButton =
        document.getElementById("loginButton");

    if (loginButton) {

        loginButton.addEventListener("click", function () {

            const loginMobile =
                document.getElementById("loginMobile");

            const loginPassword =
                document.getElementById("loginPassword");


            if (!loginMobile || !loginPassword) return;


            const savedMobile =
                localStorage.getItem("cricYuvaMobile");

            const savedPassword =
                localStorage.getItem("cricYuvaPassword");


            if (!savedMobile || !savedPassword) {
                alert("Please create a new account first.");
                return;
            }


            if (
                loginMobile.value.trim() === savedMobile &&
                loginPassword.value === savedPassword
            ) {

                showScreen("screen4");

            } else {

                alert("Invalid mobile number or password!");

            }

        });

    }


    // ==========================================
    // PROFILE SAVE CHANGES
    // ==========================================
    const saveProfileButton =
        document.getElementById("saveProfileButton");

    if (saveProfileButton) {

        saveProfileButton.addEventListener("click", function () {

            alert("Profile changes saved successfully!");

        });

    }


    // ==========================================
    // FORGOT PASSWORD
    // ==========================================
    const forgotPasswordButton =
        document.getElementById("forgotPasswordButton");

    if (forgotPasswordButton) {

        forgotPasswordButton.addEventListener("click", function () {

            alert(
                "Please create a new account or use your registered mobile number."
            );

        });

    }

});
