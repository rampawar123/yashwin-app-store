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
