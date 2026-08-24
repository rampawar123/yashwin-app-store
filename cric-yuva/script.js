/* =========================================
   CRIC YUVA APP V1.0
   JAVASCRIPT
   SCREEN 1 TO SCREEN 4
========================================= */


/* =========================================
   SCREEN ELEMENTS
========================================= */

const screen1 = document.getElementById("screen1");
const screen2 = document.getElementById("screen2");
const screen3 = document.getElementById("screen3");
const screen4 = document.getElementById("screen4");


/* =========================================
   SHOW SCREEN FUNCTION
========================================= */

function showScreen(screen) {

    // Sabhi screens band
    screen1.classList.remove("active");
    screen2.classList.remove("active");
    screen3.classList.remove("active");
    screen4.classList.remove("active");

    // Selected screen open
    screen.classList.add("active");

    // Top par le jao
    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


/* =========================================
   SCREEN 1
   SPLASH → LOGIN
   2 SECOND BAAD
========================================= */

setTimeout(function () {

    showScreen(screen2);

}, 2000);


/* =========================================
   SCREEN 2 → SCREEN 3
   CREATE NEW ACCOUNT
========================================= */

const createAccountButton =
    document.getElementById("createAccountButton");

createAccountButton.addEventListener("click", function () {

    showScreen(screen3);

});


/* =========================================
   SCREEN 3 BACK → LOGIN
========================================= */

const createBackButton =
    screen3.querySelector(".back-button");

createBackButton.addEventListener("click", function () {

    showScreen(screen2);

});


/* =========================================
   SCREEN 4 BACK
========================================= */

const profileBackButton =
    screen4.querySelector(".header-back");

profileBackButton.addEventListener("click", function () {

    showScreen(screen2);

});


/* =========================================
   PASSWORD SHOW / HIDE
========================================= */

const eyeButtons =
    document.querySelectorAll(".eye-button");

eyeButtons.forEach(function (button) {

    button.addEventListener("click", function () {

        const passwordInput =
            button.parentElement.querySelector("input");

        const icon =
            button.querySelector("i");


        if (passwordInput.type === "password") {

            passwordInput.type = "text";

            icon.classList.remove("fa-eye");
            icon.classList.add("fa-eye-slash");

        } else {

            passwordInput.type = "password";

            icon.classList.remove("fa-eye-slash");
            icon.classList.add("fa-eye");

        }

    });

});

document.addEventListener("DOMContentLoaded", function () {

    const saveButton = document.getElementById("saveAccountButton");

    if (saveButton) {
        saveButton.addEventListener("click", function () {

            const mobile = document.getElementById("newMobile").value.trim();
            const password = document.getElementById("newPassword").value;
            const verifyPassword = document.getElementById("verifyPassword").value;

            if (mobile === "" || password === "" || verifyPassword === "") {
                alert("Please fill all fields");
                return;
            }

            if (password !== verifyPassword) {
                alert("Passwords do not match");
                return;
            }

            localStorage.setItem("cricYuvaMobile", mobile);
            localStorage.setItem("cricYuvaPassword", password);

            document.getElementById("screen3").classList.remove("active");
            document.getElementById("screen4").classList.add("active");
        });
    }

});

/* =========================================
   CRIC YUVA - SCREEN 4 PROFILE
========================================= */

document.addEventListener("DOMContentLoaded", function () {

    const replacePhotoBtn = document.getElementById("replacePhotoBtn");
    const profilePhotoInput = document.getElementById("profilePhotoInput");
    const profilePhoto = document.getElementById("profilePhoto");

    /* REPLACE PHOTO */
    if (replacePhotoBtn && profilePhotoInput) {

        replacePhotoBtn.addEventListener("click", function () {
            profilePhotoInput.click();
        });

        profilePhotoInput.addEventListener("change", function () {

            const file = this.files[0];

            if (!file) return;

            const reader = new FileReader();

            reader.onload = function (event) {

                profilePhoto.innerHTML = "";

                profilePhoto.style.backgroundImage =
                    "url('" + event.target.result + "')";

                profilePhoto.style.backgroundSize = "cover";
                profilePhoto.style.backgroundPosition = "center";

                localStorage.setItem(
                    "cricYuvaProfilePhoto",
                    event.target.result
                );
            };

            reader.readAsDataURL(file);
        });
    }


    /* LOAD SAVED PHOTO */
    const savedPhoto = localStorage.getItem("cricYuvaProfilePhoto");

    if (savedPhoto && profilePhoto) {

        profilePhoto.innerHTML = "";

        profilePhoto.style.backgroundImage =
            "url('" + savedPhoto + "')";

        profilePhoto.style.backgroundSize = "cover";
        profilePhoto.style.backgroundPosition = "center";
    }


    /* SAVE PROFILE */
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
                    document.getElementById("pantSize").value,

                dateOfBirth:
                    document.getElementById("dateOfBirth").value
            };


            if (profileData.name === "") {
                alert("Please enter your name");
                return;
            }

            localStorage.setItem(
                "cricYuvaProfile",
                JSON.stringify(profileData)
            );

            alert("Profile Saved Successfully!");
        });

    }

    /* LOAD SAVED PROFILE */
    const savedProfile =
        localStorage.getItem("cricYuvaProfile");

    if (savedProfile) {

        const data = JSON.parse(savedProfile);

        document.getElementById("profileName").value =
            data.name || "";

        document.getElementById("profileMobile").value =
            data.mobile || "";

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

});
