document.addEventListener("DOMContentLoaded", function () {

    // ==========================================
    // GET ELEMENT
    // ==========================================

    function get(id) {
        return document.getElementById(id);
    }


    // ==========================================
    // SHOW ONLY ONE SCREEN
    // ==========================================

    function showScreen(screenId) {

        document.querySelectorAll(".app-screen").forEach(function (screen) {

            screen.classList.remove("active");

        });


        const targetScreen = get(screenId);


        if (targetScreen) {

            targetScreen.classList.add("active");

            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });

        }

    }


    // ==========================================
    // SPLASH SCREEN AUTO NEXT
    // ==========================================

    setTimeout(function () {

        showScreen("screen2");

    }, 2500);



    // ==========================================
    // PASSWORD SHOW / HIDE
    // ==========================================

    function setupPasswordEye(buttonId, inputId) {

        const button = get(buttonId);
        const passwordInput = get(inputId);


        if (!button || !passwordInput) {
            return;
        }


        button.addEventListener("click", function () {

            const icon = button.querySelector("i");


            if (passwordInput.type === "password") {

                passwordInput.type = "text";


                if (icon) {

                    icon.classList.remove("fa-eye");
                    icon.classList.add("fa-eye-slash");

                }


                button.setAttribute(
                    "aria-label",
                    "Hide password"
                );

            } else {

                passwordInput.type = "password";


                if (icon) {

                    icon.classList.remove("fa-eye-slash");
                    icon.classList.add("fa-eye");

                }


                button.setAttribute(
                    "aria-label",
                    "Show password"
                );

            }

        });

    }


    // LOGIN PASSWORD EYE

    setupPasswordEye(
        "loginEyeButton",
        "loginPassword"
    );


    // CREATE PASSWORD EYE

    setupPasswordEye(
        "newPasswordEye",
        "newPassword"
    );


    // VERIFY PASSWORD EYE

    setupPasswordEye(
        "verifyPasswordEye",
        "verifyPassword"
    );



    // ==========================================
    // CREATE ACCOUNT BUTTON
    // ==========================================

    const createAccountButton =
        get("createAccountButton");


    if (createAccountButton) {

        createAccountButton.addEventListener(
            "click",
            function () {

                showScreen("screen3");

            }
        );

    }



    // ==========================================
    // CREATE ACCOUNT BACK BUTTON
    // ==========================================

    const createBackButton =
        get("createBackButton");


    if (createBackButton) {

        createBackButton.addEventListener(
            "click",
            function () {

                showScreen("screen2");

            }
        );

    }



    // ==========================================
    // CREATE ACCOUNT SAVE
    // ==========================================

    const saveAccountButton =
        get("saveAccountButton");


    if (saveAccountButton) {

        saveAccountButton.addEventListener(
            "click",
            function () {


                const mobile =
                    get("newMobile");


                const password =
                    get("newPassword");


                const verifyPassword =
                    get("verifyPassword");


                if (
                    !mobile ||
                    !password ||
                    !verifyPassword
                ) {

                    alert("Input fields not found!");
                    return;

                }


                const mobileValue =
                    mobile.value.trim();


                const passwordValue =
                    password.value;


                const verifyPasswordValue =
                    verifyPassword.value;


                // MOBILE VALIDATION

                if (!/^[0-9]{10}$/.test(mobileValue)) {

                    alert(
                        "Please enter a valid 10 digit mobile number."
                    );

                    mobile.focus();

                    return;

                }


                // PASSWORD VALIDATION

                if (passwordValue.length < 4) {

                    alert(
                        "Password must be at least 4 characters."
                    );

                    password.focus();

                    return;

                }


                // PASSWORD MATCH

                if (
                    passwordValue !==
                    verifyPasswordValue
                ) {

                    alert(
                        "Password does not match!"
                    );

                    verifyPassword.focus();

                    return;

                }


                // SAVE ACCOUNT

                localStorage.setItem(
                    "cricYuvaMobile",
                    mobileValue
                );


                localStorage.setItem(
                    "cricYuvaPassword",
                    passwordValue
                );


                // PUT MOBILE IN PROFILE

                const profileMobile =
                    get("profileMobile");


                if (profileMobile) {

                    profileMobile.value =
                        mobileValue;

                }


                // SAVE PROFILE MOBILE

                localStorage.setItem(
                    "cricYuvaProfileMobile",
                    mobileValue
                );


                alert(
                    "Account created successfully!"
                );


                // GO TO SCREEN 4

                showScreen("screen4");

            }
        );

    }



    // ==========================================
    // LOGIN
    // ==========================================

    const loginButton =
        get("loginButton");


    if (loginButton) {

        loginButton.addEventListener(
            "click",
            function () {


                const loginMobile =
                    get("loginMobile");


                const loginPassword =
                    get("loginPassword");


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

                    showScreen("screen3");

                    return;

                }


                if (
                    loginMobile.value.trim() ===
                    savedMobile &&

                    loginPassword.value ===
                    savedPassword
                ) {

                    loadProfile();

                    showScreen("screen4");

                } else {

                    alert(
                        "Invalid mobile number or password!"
                    );

                }

            }
        );

    }



    // ==========================================
    // PROFILE PHOTO
    // ==========================================

    const replacePhotoBtn =
        get("replacePhotoBtn");


    const profilePhotoInput =
        get("profilePhotoInput");


    const profilePhoto =
        get("profilePhoto");


    const profileInitial =
        get("profileInitial");


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
                    profilePhotoInput.files[0];


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

                    return;

                }


                const reader =
                    new FileReader();


                reader.onload =
                    function (event) {


                        if (profilePhoto) {

                            profilePhoto.innerHTML = "";


                            const image =
                                document.createElement(
                                    "img"
                                );


                            image.src =
                                event.target.result;


                            image.alt =
                                "Profile Photo";


                            profilePhoto.appendChild(
                                image
                            );


                            // SAVE PHOTO

                            localStorage.setItem(
                                "cricYuvaProfilePhoto",
                                event.target.result
                            );

                        }

                    };


                reader.readAsDataURL(
                    file
                );

            }
        );

    }



    // ==========================================
    // PROFILE NAME LIVE PREVIEW
    // ==========================================

    const profileName =
        get("profileName");


    const profilePreviewName =
        get("profilePreviewName");


    if (
        profileName &&
        profilePreviewName
    ) {

        profileName.addEventListener(
            "input",
            function () {


                const name =
                    profileName.value.trim();


                if (name) {

                    profilePreviewName.textContent =
                        name;

                } else {

                    profilePreviewName.textContent =
                        "YOUR NAME";

                }


                // INITIAL ONLY IF NO PHOTO

                if (
                    profileInitial &&
                    !get(
                        "profilePhoto"
                    ).querySelector("img")
                ) {

                    profileInitial.textContent =
                        name
                            ? name.charAt(0).toUpperCase()
                            : "PLAYER";

                }

            }
        );

    }



    // ==========================================
    // SAVE PROFILE
    // ==========================================

    const saveProfileButton =
        get("saveProfileButton");


    if (saveProfileButton) {

        saveProfileButton.addEventListener(
            "click",
            function () {


                const profileData = {

                    name:
                        get("profileName").value.trim(),

                    mobile:
                        get("profileMobile").value.trim(),

                    email:
                        get("profileEmail").value.trim(),

                    jerseyName:
                        get("jerseyName").value.trim(),

                    jerseyNumber:
                        get("jerseyNumber").value.trim(),

                    jerseySize:
                        get("jerseySize").value,

                    pantSize:
                        get("pantSize").value.trim(),

                    dateOfBirth:
                        get("dateOfBirth").value

                };


                // MOBILE CHECK

                if (
                    profileData.mobile &&
                    !/^[0-9]{10}$/.test(
                        profileData.mobile
                    )
                ) {

                    alert(
                        "Please enter a valid 10 digit mobile number."
                    );

                    return;

                }


                // SAVE FULL PROFILE

                localStorage.setItem(
                    "cricYuvaProfile",
                    JSON.stringify(
                        profileData
                    )
                );


                // PANT SIZE NUMBER BHI SAVE HOGA

                localStorage.setItem(
                    "cricYuvaPantSize",
                    profileData.pantSize
                );


                alert(
                    "Profile changes saved successfully!"
                );

            }
        );

    }



    // ==========================================
    // LOAD SAVED PROFILE
    // ==========================================

    function loadProfile() {


        const savedProfile =
            localStorage.getItem(
                "cricYuvaProfile"
            );


        if (savedProfile) {

            try {

                const data =
                    JSON.parse(
                        savedProfile
                    );


                get("profileName").value =
                    data.name || "";


                get("profileMobile").value =
                    data.mobile ||
                    localStorage.getItem(
                        "cricYuvaMobile"
                    ) ||
                    "";


                get("profileEmail").value =
                    data.email || "";


                get("jerseyName").value =
                    data.jerseyName || "";


                get("jerseyNumber").value =
                    data.jerseyNumber || "";


                get("jerseySize").value =
                    data.jerseySize || "";


                // PANT SIZE NUMBER LOAD

                get("pantSize").value =
                    data.pantSize || "";


                get("dateOfBirth").value =
                    data.dateOfBirth || "";


                if (
                    data.name &&
                    profilePreviewName
                ) {

                    profilePreviewName.textContent =
                        data.name;

                }


            } catch (error) {

                console.log(
                    "Profile load error",
                    error
                );

            }

        } else {


            const savedMobile =
                localStorage.getItem(
                    "cricYuvaMobile"
                );


            if (
                savedMobile &&
                get("profileMobile")
            ) {

                get("profileMobile").value =
                    savedMobile;

            }

        }


        // LOAD PHOTO

        const savedPhoto =
            localStorage.getItem(
                "cricYuvaProfilePhoto"
            );


        if (
            savedPhoto &&
            profilePhoto
        ) {

            profilePhoto.innerHTML = "";


            const image =
                document.createElement(
                    "img"
                );


            image.src =
                savedPhoto;


            image.alt =
                "Profile Photo";


            profilePhoto.appendChild(
                image
            );

        }

    }



    // ==========================================
    // PROFILE BACK
    // ==========================================

    const profileBackButton =
        get("profileBackButton");


    if (profileBackButton) {

        profileBackButton.addEventListener(
            "click",
            function () {

                showScreen("screen2");

            }
        );

    }



    // ==========================================
    // FORGOT PASSWORD
    // ==========================================

    const forgotPasswordButton =
        get("forgotPasswordButton");


    if (forgotPasswordButton) {

        forgotPasswordButton.addEventListener(
            "click",
            function () {


                const savedMobile =
                    localStorage.getItem(
                        "cricYuvaMobile"
                    );


                if (savedMobile) {

                    alert(
                        "Your registered mobile number is " +
                        savedMobile +
                        ". Please create a new account to set a new password."
                    );

                } else {

                    alert(
                        "No account found. Please create a new account first."
                    );

                }

            }
        );

    }



    // ==========================================
    // ONLY NUMBERS IN MOBILE FIELDS
    // ==========================================

    [
        get("loginMobile"),
        get("newMobile"),
        get("profileMobile")
    ].forEach(function (input) {

        if (!input) {
            return;
        }


        input.addEventListener(
            "input",
            function () {

                this.value =
                    this.value.replace(
                        /[^0-9]/g,
                        ""
                    );

            }
        );

    });



    // ==========================================
    // START LOAD PROFILE
    // ==========================================

    loadProfile();

});
