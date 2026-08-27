"use strict";

document.addEventListener("DOMContentLoaded", function () {

    /* =========================================
       SCREEN FUNCTION
    ========================================== */

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


    /* =========================================
       SPLASH SCREEN AUTO NEXT
    ========================================== */

    setTimeout(function () {

        const screen1 = document.getElementById("screen1");
        const screen2 = document.getElementById("screen2");

        if (screen1 && screen2) {
            screen1.classList.remove("active");
            screen2.classList.add("active");
        }

    }, 2500);


    /* =========================================
       PASSWORD SHOW / HIDE
       Works with current HTML eye buttons
    ========================================== */

    function setupPasswordEye(inputId) {

        const passwordInput = document.getElementById(inputId);

        if (!passwordInput) {
            return;
        }

        const inputBox = passwordInput.closest(".input-box, .form-input");

        if (!inputBox) {
            return;
        }

        const button = inputBox.querySelector(".eye-button");

        if (!button) {
            return;
        }

        button.addEventListener("click", function () {

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


    setupPasswordEye("loginPassword");
    setupPasswordEye("newPassword");
    setupPasswordEye("verifyPassword");


    /* =========================================
       CREATE ACCOUNT BUTTON
       SCREEN 2 -> SCREEN 3
    ========================================== */

    const createAccountButton =
        document.getElementById("createAccountButton");

    if (createAccountButton) {

        createAccountButton.addEventListener("click", function (event) {

            event.preventDefault();

            showScreen("screen3");

        });
    }


    /* =========================================
       BACK BUTTON
       SCREEN 3 -> SCREEN 2
    ========================================== */

    document.querySelectorAll(".back-button").forEach(function (button) {

        button.addEventListener("click", function (event) {

            event.preventDefault();

            showScreen("screen2");

        });

    });


    /* =========================================
       CREATE NEW ACCOUNT - SAVE
       SCREEN 3 -> SCREEN 4
    ========================================== */

    const saveAccountButton =
        document.getElementById("saveAccountButton");

    if (saveAccountButton) {

        saveAccountButton.addEventListener("click", function (event) {

            event.preventDefault();

            const mobile =
                document.getElementById("newMobile");

            const password =
                document.getElementById("newPassword");

            const verifyPassword =
                document.getElementById("verifyPassword");


            if (!mobile || !password || !verifyPassword) {

                alert(
                    "Input fields not found. Please check index.html IDs."
                );

                return;
            }


            const mobileValue =
                mobile.value.trim();

            const passwordValue =
                password.value.trim();

            const verifyPasswordValue =
                verifyPassword.value.trim();


            if (!/^\d{10}$/.test(mobileValue)) {

                alert(
                    "Please enter a valid 10 digit mobile number."
                );

                return;
            }


            if (passwordValue.length < 4) {

                alert(
                    "Password must be at least 4 characters."
                );

                return;
            }


            if (
                passwordValue !== verifyPasswordValue
            ) {

                alert(
                    "Password does not match!"
                );

                return;
            }


            /* SAVE ACCOUNT */

            localStorage.setItem(
                "cricYuvaMobile",
                mobileValue
            );

            localStorage.setItem(
                "cricYuvaPassword",
                passwordValue
            );


            /* PROFILE MOBILE AUTO FILL */

            const profileMobile =
                document.getElementById("profileMobile");

            if (profileMobile) {
                profileMobile.value = mobileValue;
            }


            alert(
                "Account created successfully!"
            );


            showScreen("screen4");

        });
    }


    /* =========================================
       LOGIN BUTTON
       SCREEN 2 -> SCREEN 4
    ========================================== */

    const loginButton =
        document.getElementById("loginButton");

    if (loginButton) {

        loginButton.addEventListener("click", function (event) {

            event.preventDefault();

            const loginMobile =
                document.getElementById("loginMobile");

            const loginPassword =
                document.getElementById("loginPassword");


            if (!loginMobile || !loginPassword) {
                return;
            }


            const savedMobile =
                localStorage.getItem("cricYuvaMobile");

            const savedPassword =
                localStorage.getItem("cricYuvaPassword");


            if (!savedMobile || !savedPassword) {

                alert(
                    "Please create a new account first."
                );

                return;
            }


            if (
                loginMobile.value.trim() === savedMobile &&
                loginPassword.value === savedPassword
            ) {

                /* AUTO FILL PROFILE MOBILE */

                const profileMobile =
                    document.getElementById("profileMobile");

                if (profileMobile) {
                    profileMobile.value = savedMobile;
                }


                showScreen("screen4");

            } else {

                alert(
                    "Invalid mobile number or password!"
                );
            }

        });
    }


    /* =========================================
       ENTER KEY LOGIN
    ========================================== */

    const loginPasswordInput =
        document.getElementById("loginPassword");

    if (loginPasswordInput) {

        loginPasswordInput.addEventListener(
            "keydown",
            function (event) {

                if (event.key === "Enter") {

                    event.preventDefault();

                    if (loginButton) {
                        loginButton.click();
                    }
                }

            }
        );
    }


    /* =========================================
       PROFILE PHOTO
    ========================================== */

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
    }


    if (profilePhotoInput && profilePhoto) {

        profilePhotoInput.addEventListener(
            "change",
            function () {

                const file =
                    profilePhotoInput.files[0];

                if (!file) {
                    return;
                }


                if (
                    !file.type ||
                    !file.type.startsWith("image/")
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

                        profilePhoto.style.backgroundImage =
                            'url("' +
                            event.target.result +
                            '")';

                        profilePhoto.style.backgroundSize =
                            "cover";

                        profilePhoto.style.backgroundPosition =
                            "center";


                        if (profileInitial) {
                            profileInitial.style.display =
                                "none";
                        }


                        localStorage.setItem(
                            "cricYuvaProfilePhoto",
                            event.target.result
                        );
                    };


                reader.readAsDataURL(file);

            }
        );
    }


    /* =========================================
       LOAD SAVED PROFILE DATA
    ========================================== */

    function loadSavedProfile() {

        const savedPhoto =
            localStorage.getItem(
                "cricYuvaProfilePhoto"
            );

        if (savedPhoto && profilePhoto) {

            profilePhoto.style.backgroundImage =
                'url("' + savedPhoto + '")';

            profilePhoto.style.backgroundSize =
                "cover";

            profilePhoto.style.backgroundPosition =
                "center";

            if (profileInitial) {
                profileInitial.style.display = "none";
            }
        }


        const profileDataText =
            localStorage.getItem(
                "cricYuvaProfileData"
            );

        if (!profileDataText) {
            return;
        }


        try {

            const data =
                JSON.parse(profileDataText);


            const fields = [
                "profileName",
                "profileMobile",
                "profileEmail",
                "jerseyName",
                "jerseyNumber",
                "jerseySize",
                "pantSize",
                "dateOfBirth"
            ];


            fields.forEach(function (id) {

                const field =
                    document.getElementById(id);

                if (
                    field &&
                    data[id] !== undefined
                ) {

                    field.value = data[id];

                }

            });

        } catch (error) {

            console.error(
                "Profile data load error:",
                error
            );

        }
    }


    loadSavedProfile();


    /* =========================================
       AUTO FILL MOBILE IF ACCOUNT EXISTS
    ========================================== */

    const savedAccountMobile =
        localStorage.getItem(
            "cricYuvaMobile"
        );

    const profileMobileField =
        document.getElementById(
            "profileMobile"
        );

    if (
        savedAccountMobile &&
        profileMobileField &&
        !profileMobileField.value
    ) {

        profileMobileField.value =
            savedAccountMobile;
    }


    /* =========================================
       PROFILE SAVE CHANGES
    ========================================== */

    const saveProfileButton =
        document.getElementById(
            "saveProfileButton"
        );

    if (saveProfileButton) {

        saveProfileButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();


                const profileData = {

                    profileName:
                        (
                            document.getElementById(
                                "profileName"
                            ) || {}
                        ).value || "",

                    profileMobile:
                        (
                            document.getElementById(
                                "profileMobile"
                            ) || {}
                        ).value || "",

                    profileEmail:
                        (
                            document.getElementById(
                                "profileEmail"
                            ) || {}
                        ).value || "",

                    jerseyName:
                        (
                            document.getElementById(
                                "jerseyName"
                            ) || {}
                        ).value || "",

                    jerseyNumber:
                        (
                            document.getElementById(
                                "jerseyNumber"
                            ) || {}
                        ).value || "",

                    jerseySize:
                        (
                            document.getElementById(
                                "jerseySize"
                            ) || {}
                        ).value || "",

                    pantSize:
                        (
                            document.getElementById(
                                "pantSize"
                            ) || {}
                        ).value || "",

                    dateOfBirth:
                        (
                            document.getElementById(
                                "dateOfBirth"
                            ) || {}
                        ).value || ""

                };


                localStorage.setItem(
                    "cricYuvaProfileData",
                    JSON.stringify(profileData)
                );


                if (
                    profileData.profileMobile &&
                    /^\d{10}$/.test(
                        profileData.profileMobile
                    )
                ) {

                    localStorage.setItem(
                        "cricYuvaMobile",
                        profileData.profileMobile
                    );
                }


                if (
                    profileData.profileName &&
                    profileInitial
                ) {

                    profileInitial.textContent =
                        profileData.profileName
                            .trim()
                            .charAt(0)
                            .toUpperCase();
                }


                alert(
                    "Profile changes saved successfully!"
                );

            }
        );
    }


    /* =========================================
       FORGOT PASSWORD
    ========================================== */

    const forgotPasswordButton =
        document.getElementById(
            "forgotPasswordButton"
        );

    if (forgotPasswordButton) {

        forgotPasswordButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                const savedMobile =
                    localStorage.getItem(
                        "cricYuvaMobile"
                    );


                if (savedMobile) {

                    alert(
                        "Password reset system will be added next."
                    );

                } else {

                    alert(
                        "Please create a new account first."
                    );
                }

            }
        );
    }


    /* =========================================
       MOBILE NUMBER ONLY
    ========================================== */

    [
        "loginMobile",
        "newMobile",
        "profileMobile"
    ].forEach(function (id) {

        const input =
            document.getElementById(id);

        if (!input) {
            return;
        }


        input.addEventListener(
            "input",
            function () {

                input.value =
                    input.value
                        .replace(/\D/g, "")
                        .slice(0, 10);

            }
        );

    });


    console.log(
        "CRIC YUVA SCREEN 1-4 JS READY"
    );

});
