/**
 * Cric Yuva - Fresh Mobile-Based Player Storage
 * ------------------------------------------------
 * Rules:
 * 1. A player exists only after registration with a valid mobile number.
 * 2. One mobile number = one Cric Yuva Player ID.
 * 3. No guest/dummy player is created.
 * 4. Tournament/player data is isolated by registered user ID.
 *
 * NOTE: This browser storage is the offline/local layer. For production/Play
 * Store use, the server must be the final authority for authentication and IDs.
 */

(function () {
  "use strict";

  const DB_NAME = "CricYuvaDB";
  const DB_VERSION = 2;
  const USERS_REGISTRY_KEY = "cricYuva_users_registry";
  const ACTIVE_USER_KEY = "cricYuva_active_user_id";
  const LOGIN_KEY = "cricYuvaLoggedIn";

  let idbInstance = null;

  function normalizeMobile(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function isValidMobile(mobile) {
    // India-first validation. Accepts a 10-digit mobile beginning 6-9.
    return /^[6-9]\d{9}$/.test(mobile);
  }

  function makePlayerId(mobile) {
    // Stable ID: the registered mobile is the source of truth.
    return "CY-" + mobile;
  }

  function makeUserId(mobile) {
    return "CYU-" + mobile;
  }

  function openDatabase() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = function (event) {
          const db = event.target.result;

          if (!db.objectStoreNames.contains("users")) {
            db.createObjectStore("users", { keyPath: "userId" });
          }

          if (!db.objectStoreNames.contains("user_data")) {
            const store = db.createObjectStore("user_data", { keyPath: "compositeKey" });
            store.createIndex("userId", "userId", { unique: false });
          }
        };

        request.onsuccess = function (event) {
          idbInstance = event.target.result;
          resolve(idbInstance);
        };

        request.onerror = function () {
          resolve(null);
        };
      } catch (e) {
        resolve(null);
      }
    });
  }

  function getAllRegisteredUsers() {
    try {
      const raw = localStorage.getItem(USERS_REGISTRY_KEY);
      const users = raw ? JSON.parse(raw) : [];
      return Array.isArray(users) ? users : [];
    } catch (e) {
      return [];
    }
  }

  function saveRegisteredUsers(users) {
    try {
      localStorage.setItem(USERS_REGISTRY_KEY, JSON.stringify(users));

      if (idbInstance) {
        const tx = idbInstance.transaction("users", "readwrite");
        const store = tx.objectStore("users");
        users.forEach((user) => store.put(user));
      }
    } catch (e) {
      console.error("[CricYuvaStorage] Could not save users:", e);
    }
  }

  function getActiveUserId() {
    const active = String(localStorage.getItem(ACTIVE_USER_KEY) || "").trim();

    if (active) {
      const users = getAllRegisteredUsers();
      if (users.some((u) => u && u.userId === active)) {
        return active;
      }
      localStorage.removeItem(ACTIVE_USER_KEY);
    }

    // Fresh app: no automatic guest/first-user session.
    return "";
  }

  function setActiveUserId(userId) {
    if (!userId) return false;

    const users = getAllRegisteredUsers();
    const exists = users.some((u) => u && u.userId === userId);

    if (!exists) return false;

    localStorage.setItem(ACTIVE_USER_KEY, userId);
    localStorage.setItem(LOGIN_KEY, "true");
    return true;
  }

  function clearActiveSession() {
    localStorage.setItem(LOGIN_KEY, "false");
    localStorage.removeItem(ACTIVE_USER_KEY);
  }

  function getScopedKey(key, userId) {
    const uid = userId || getActiveUserId();
    if (!uid) return null;
    return `CYU_${uid}_${key}`;
  }

  function getUserItem(key, fallback = null) {
    const scopedKey = getScopedKey(key);
    if (!scopedKey) return fallback;

    try {
      const value = localStorage.getItem(scopedKey);
      return value !== null ? value : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function setUserItem(key, value) {
    const uid = getActiveUserId();
    const scopedKey = getScopedKey(key, uid);

    if (!uid || !scopedKey) {
      console.warn("[CricYuvaStorage] No registered player is active.");
      return false;
    }

    try {
      localStorage.setItem(scopedKey, value);
    } catch (e) {
      console.error("[CricYuvaStorage] Could not save:", key, e);
      return false;
    }

    if (idbInstance) {
      try {
        const tx = idbInstance.transaction("user_data", "readwrite");
        tx.objectStore("user_data").put({
          compositeKey: `${uid}:${key}`,
          userId: uid,
          key,
          value,
          updatedAt: new Date().toISOString()
        });
      } catch (e) {
        // localStorage remains the offline fallback.
      }
    }

    return true;
  }

  function removeUserItem(key) {
    const uid = getActiveUserId();
    const scopedKey = getScopedKey(key, uid);

    if (!uid || !scopedKey) return false;

    try {
      localStorage.removeItem(scopedKey);
    } catch (e) {}

    if (idbInstance) {
      try {
        idbInstance
          .transaction("user_data", "readwrite")
          .objectStore("user_data")
          .delete(`${uid}:${key}`);
      } catch (e) {}
    }

    return true;
  }

  function registerUser(userData) {
    const cleanMobile = normalizeMobile(userData && userData.mobile);

    if (!isValidMobile(cleanMobile)) {
      return {
        success: false,
        error: "Enter a valid 10-digit Indian mobile number."
      };
    }

    const name = String((userData && userData.name) || "").trim();
    const password = String((userData && userData.password) || "");

    if (!name) {
      return { success: false, error: "Player name is required." };
    }

    if (password.length < 4) {
      return { success: false, error: "Password must be at least 4 characters." };
    }

    const users = getAllRegisteredUsers();
    const existing = users.find((u) => u && u.mobile === cleanMobile);

    if (existing) {
      return {
        success: false,
        error: "This mobile number is already registered. Please log in."
      };
    }

    const userId = makeUserId(cleanMobile);
    const playerId = makePlayerId(cleanMobile);

    const newUser = {
      userId,
      playerId,
      mobile: cleanMobile,
      name,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveRegisteredUsers(users);

    setActiveUserId(userId);

    // Credentials stay in this local offline layer only. The production server
    // should authenticate/hash them and become the authoritative account store.
    try {
      localStorage.setItem(`CYU_${userId}_cricYuvaPassword`, password);
      localStorage.setItem(`CYU_${userId}_cricYuvaMobile`, cleanMobile);
    } catch (e) {}

    setUserItem("cricYuvaProfileName", name);
    setUserItem("cricYuvaProfileMobile", cleanMobile);
    setUserItem("cricYuvaPlayerId", playerId);

    return { success: true, user: newUser };
  }

  function authenticateUser(mobile, password) {
    const cleanMobile = normalizeMobile(mobile);
    const cleanPass = String(password || "");
    const users = getAllRegisteredUsers();

    if (!isValidMobile(cleanMobile)) {
      return { success: false, error: "Enter a valid 10-digit mobile number." };
    }

    const matched = users.find((u) => u && u.mobile === cleanMobile);

    if (!matched) {
      return {
        success: false,
        error: "No Cric Yuva player is registered with this mobile number."
      };
    }

    let storedPassword = "";
    try {
      storedPassword = localStorage.getItem(`CYU_${matched.userId}_cricYuvaPassword`) || "";
    } catch (e) {}

    if (storedPassword !== cleanPass) {
      return { success: false, error: "Invalid mobile number or password." };
    }

    setActiveUserId(matched.userId);
    return { success: true, user: matched };
  }

  function getCurrentUser() {
    const uid = getActiveUserId();
    if (!uid) return null;

    return getAllRegisteredUsers().find((u) => u && u.userId === uid) || null;
  }

  openDatabase().then(() => {});

  window.CricYuvaStorage = {
    getActiveUserId,
    setActiveUserId,
    clearActiveSession,
    getUserItem,
    setUserItem,
    removeUserItem,
    getAllRegisteredUsers,
    registerUser,
    authenticateUser,
    getScopedKey,
    getCurrentUser,
    normalizeMobile,
    isValidMobile,
    makePlayerId
  };
})();
