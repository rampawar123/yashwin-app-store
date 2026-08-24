document.addEventListener("DOMContentLoaded", function () {

    // ==========================================
    // SCREEN CHANGE FUNCTION
    // ==========================================
    function showScreen(screenId) {
        document.querySelectorAll(".app-screen").forEach(function (screen) {
            screen.classList.remove("active");
        });

        const targetScreen = document.getElementById(screenId);

        if (targetScreen) {
            targetScreen.classList.add("active");
            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });
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
        const passwordInput = document.getElementById(inputId);

        if (!button || !passwordInput) return;

        button.addEventListener("click", function (e) {
            e.preventDefault();

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


    setupPasswordEye("loginEyeButton", "loginPassword");
    setupPasswordEye("newPasswordEye", "newPassword");
    setupPasswordEye("verifyPasswordEye", "verifyPassword");


    // ==========================================
    // CREATE ACCOUNT SCREEN
    // ==========================================
    const createAccountButton = document.getElementById("createAccountButton");

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
    // CREATE ACCOUNT
    // ==========================================
    const saveAccountButton = document.getElementById("saveAccountButton");

    if (saveAccountButton) {

        saveAccountButton.addEventListener("click", function () {

            const mobile = document.getElementById("newMobile");
            const password = document.getElementById("newPassword");
            const verifyPassword = document.getElementById("verifyPassword");

            const mobileValue = mobile.value.trim();
            const passwordValue = password.value.trim();
            const verifyPasswordValue = verifyPassword.value.trim();


            if (!/^[0-9]{10}$/.test(mobileValue)) {
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


            localStorage.setItem("cricYuvaMobile", mobileValue);
            localStorage.setItem("cricYuvaPassword", passwordValue);

            const profileMobile = document.getElementById("profileMobile");

            if (profileMobile) {
                profileMobile.value = mobileValue;
            }

            alert("Account created successfully!");

            showScreen("screen4");
        });
    }


    // ==========================================
    // LOGIN
    // ==========================================
    const loginButton = document.getElementById("loginButton");

    if (loginButton) {

        loginButton.addEventListener("click", function () {

            const loginMobile = document.getElementById("loginMobile");
            const loginPassword = document.getElementById("loginPassword");

            const savedMobile = localStorage.getItem("cricYuvaMobile");
            const savedPassword = localStorage.getItem("cricYuvaPassword");


            if (!savedMobile || !savedPassword) {
                alert("Please create a new account first.");
                return;
            }


            if (
                loginMobile.value.trim() === savedMobile &&
                loginPassword.value === savedPassword
            ) {

                const profileMobile = document.getElementById("profileMobile");

                if (profileMobile) {
                    profileMobile.value = savedMobile;
                }

                showScreen("screen4");

            } else {
                alert("Invalid mobile number or password!");
            }
        });
    }


    // ==========================================
    // PROFILE PHOTO UPLOAD
    // ==========================================
    const replacePhotoBtn = document.getElementById("replacePhotoBtn");
    const profilePhotoInput = document.getElementById("profilePhotoInput");
    const profilePhoto = document.getElementById("profilePhoto");
    const profileInitial = document.getElementById("profileInitial");


    if (replacePhotoBtn && profilePhotoInput) {

        replacePhotoBtn.addEventListener("click", function () {
            profilePhotoInput.click();
        });


        profilePhotoInput.addEventListener("change", function () {

            const file = this.files[0];

            if (!file) return;

            if (!file.type.startsWith("image/")) {
                alert("Please select an image file.");
                return;
            }

            const reader = new FileReader();

            reader.onload = function (event) {

                profilePhoto.innerHTML = "";

                const image = document.createElement("img");

                image.src = event.target.result;
                image.alt = "Profile Photo";

                profilePhoto.appendChild(image);

                localStorage.setItem(
                    "cricYuvaProfilePhoto",
                    event.target.result
                );
            };

            reader.readAsDataURL(file);
        });
    }


    // ==========================================
    // LOAD SAVED PROFILE PHOTO
    // ==========================================
    const savedPhoto = localStorage.getItem("cricYuvaProfilePhoto");

    if (savedPhoto && profilePhoto) {

        profilePhoto.innerHTML = "";

        const image = document.createElement("img");
        image.src = savedPhoto;

        profilePhoto.appendChild(image);
    }


    // ==========================================
    // SAVE PROFILE
    // ==========================================
    const saveProfileButton = document.getElementById("saveProfileButton");

    if (saveProfileButton) {

        saveProfileButton.addEventListener("click", function () {

            const profileData = {
                name: document.getElementById("profileName").value.trim(),
                mobile: document.getElementById("profileMobile").value.trim(),
                email: document.getElementById("profileEmail").value.trim(),
                jerseyName: document.getElementById("jerseyName").value.trim(),
                jerseyNumber: document.getElementById("jerseyNumber").value.trim(),
                jerseySize: document.getElementById("jerseySize").value,
                pantSize: document.getElementById("pantSize").value,
                dateOfBirth: document.getElementById("dateOfBirth").value
            };


            localStorage.setItem(
                "cricYuvaProfile",
                JSON.stringify(profileData)
            );

            alert("Profile changes saved successfully!");
        });
    }


    // ==========================================
    // LOAD SAVED PROFILE
    // ==========================================
    const savedProfile = localStorage.getItem("cricYuvaProfile");

    if (savedProfile) {

        const data = JSON.parse(savedProfile);

        document.getElementById("profileName").value = data.name || "";
        document.getElementById("profileMobile").value = data.mobile || "";
        document.getElementById("profileEmail").value = data.email || "";
        document.getElementById("jerseyName").value = data.jerseyName || "";
        document.getElementById("jerseyNumber").value = data.jerseyNumber || "";
        document.getElementById("jerseySize").value = data.jerseySize || "";
        document.getElementById("pantSize").value = data.pantSize || "";
        document.getElementById("dateOfBirth").value = data.dateOfBirth || "";
    }


    // ==========================================
    // FORGOT PASSWORD
    // ==========================================
    const forgotPasswordButton = document.getElementById("forgotPasswordButton");

    if (forgotPasswordButton) {

        forgotPasswordButton.addEventListener("click", function () {

            const savedMobile = localStorage.getItem("cricYuvaMobile");

            if (savedMobile) {
                alert(
                    "Registered mobile: " +
                    savedMobile +
                    "\nPassword reset feature will be added next."
                );
            } else {
                alert("Please create a new account first.");
            }
        });
    }

});
