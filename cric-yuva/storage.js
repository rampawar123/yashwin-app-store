/**
 * Cric Yuva - Per-User Persistent Storage & IndexedDB Engine
 * Provides complete data isolation between registered users.
 * Migrates existing single-user localStorage data safely on startup.
 */

(function () {
  "use strict";

  const DB_NAME = "CricYuvaDB";
  const DB_VERSION = 1;
  const USERS_REGISTRY_KEY = "cricYuva_users_registry";
  const ACTIVE_USER_KEY = "cricYuva_active_user_id";
  const LEGACY_MIGRATION_FLAG = "cricYuva_legacy_data_migrated_v1";

  // Default guest user ID if no session exists
  const DEFAULT_GUEST_ID = "CYU_DEFAULT_USER";

  let idbInstance = null;

  // Initialize IndexedDB
  function openDatabase() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        console.warn("[CricYuvaDB] IndexedDB not supported; using localStorage only.");
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
        request.onerror = function (err) {
          console.warn("[CricYuvaDB] Error opening IndexedDB:", err);
          resolve(null);
        };
      } catch (e) {
        console.warn("[CricYuvaDB] Exception opening IndexedDB:", e);
        resolve(null);
      }
    });
  }

  // User Registry Operations
  function getAllRegisteredUsers() {
    try {
      const raw = localStorage.getItem(USERS_REGISTRY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Error reading users registry:", e);
      return [];
    }
  }

  function saveRegisteredUsers(users) {
    try {
      localStorage.setItem(USERS_REGISTRY_KEY, JSON.stringify(users));
      // Async mirror to IndexedDB
      if (idbInstance) {
        const tx = idbInstance.transaction("users", "readwrite");
        const store = tx.objectStore("users");
        users.forEach((u) => store.put(u));
      }
    } catch (e) {
      console.error("Error saving users registry:", e);
    }
  }

  function getActiveUserId() {
    const active = localStorage.getItem(ACTIVE_USER_KEY);
    if (active && active.trim()) {
      return active.trim();
    }
    // If not set, check if a registered user exists
    const users = getAllRegisteredUsers();
    if (users.length > 0) {
      const firstId = users[0].userId;
      localStorage.setItem(ACTIVE_USER_KEY, firstId);
      return firstId;
    }
    return DEFAULT_GUEST_ID;
  }

  function setActiveUserId(userId) {
    if (!userId) return;
    localStorage.setItem(ACTIVE_USER_KEY, userId);
  }

  function clearActiveSession() {
    localStorage.setItem("cricYuvaLoggedIn", "false");
    localStorage.removeItem(ACTIVE_USER_KEY);
  }

  // Key Scoper: transforms generic key into user-scoped key
  function getScopedKey(key, userId) {
    const uid = userId || getActiveUserId();
    return `CYU_${uid}_${key}`;
  }

  // Read item with per-user isolation
  function getUserItem(key, fallback = null) {
    const uid = getActiveUserId();
    const scopedKey = getScopedKey(key, uid);
    const val = localStorage.getItem(scopedKey);
    if (val !== null) return val;

    // Fallback: If legacy un-scoped key exists and active user is the migrated user, preserve it
    const legacyVal = localStorage.getItem(key);
    if (legacyVal !== null) {
      // Auto-migrate to scoped key
      try {
        localStorage.setItem(scopedKey, legacyVal);
      } catch (e) {}
      return legacyVal;
    }

    return fallback;
  }

  // Write item with per-user isolation
  function setUserItem(key, value) {
    const uid = getActiveUserId();
    const scopedKey = getScopedKey(key, uid);
    try {
      localStorage.setItem(scopedKey, value);
    } catch (e) {
      console.error(`Error writing ${scopedKey} to localStorage:`, e);
    }

    // Mirror asynchronously to IndexedDB
    if (idbInstance) {
      try {
        const tx = idbInstance.transaction("user_data", "readwrite");
        const store = tx.objectStore("user_data");
        store.put({
          compositeKey: `${uid}:${key}`,
          userId: uid,
          key: key,
          value: value,
          updatedAt: new Date().toISOString()
        });
      } catch (e) {
        console.warn("IndexedDB mirror failed for", key, e);
      }
    }
  }

  // Remove item with per-user isolation
  function removeUserItem(key) {
    const uid = getActiveUserId();
    const scopedKey = getScopedKey(key, uid);
    try {
      localStorage.removeItem(scopedKey);
    } catch (e) {}

    if (idbInstance) {
      try {
        const tx = idbInstance.transaction("user_data", "readwrite");
        const store = tx.objectStore("user_data");
        store.delete(`${uid}:${key}`);
      } catch (e) {}
    }
  }

  // Register New User
  function registerUser(userData) {
    const users = getAllRegisteredUsers();
    const cleanMobile = (userData.mobile || "").trim().replace(/\D/g, "");

    // Check if mobile already registered
    const existing = users.find((u) => u.mobile === cleanMobile);
    if (existing) {
      return { success: false, error: "Mobile number already registered. Please log in." };
    }

    const userId = "CYU-" + (cleanMobile.length >= 4 ? cleanMobile.slice(-4) : Math.floor(1000 + Math.random() * 9000)) + "-" + Math.floor(100 + Math.random() * 900);
    const playerId = "CY2026-" + (cleanMobile.length >= 4 ? cleanMobile.slice(-4) : "1001");

    const newUser = {
      userId: userId,
      mobile: cleanMobile,
      password: userData.password,
      name: userData.name || "Cric Yuva Player",
      playerId: playerId,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveRegisteredUsers(users);

    // Switch active session to this new user
    setActiveUserId(userId);
    localStorage.setItem("cricYuvaLoggedIn", "true");

    // Initialize user profile keys in isolated storage
    setUserItem("cricYuvaMobile", cleanMobile);
    setUserItem("cricYuvaProfileMobile", cleanMobile);
    setUserItem("cricYuvaPassword", userData.password);
    setUserItem("cricYuvaProfileName", newUser.name);
    setUserItem("cricYuvaPlayerId", playerId);

    return { success: true, user: newUser };
  }

  // Authenticate User Login
  function authenticateUser(mobile, password) {
    const cleanMobile = (mobile || "").trim().replace(/\D/g, "");
    const cleanPass = (password || "").trim();
    const users = getAllRegisteredUsers();

    const matched = users.find((u) => u.mobile === cleanMobile && u.password === cleanPass);
    if (matched) {
      setActiveUserId(matched.userId);
      localStorage.setItem("cricYuvaLoggedIn", "true");
      return { success: true, user: matched };
    }

    // Check legacy single-user credential in localStorage as safety fallback
    const legMobile = (localStorage.getItem("cricYuvaMobile") || "").trim().replace(/\D/g, "");
    const legPass = (localStorage.getItem("cricYuvaPassword") || "").trim();
    if (legMobile && legMobile === cleanMobile && legPass === cleanPass) {
      // Migrate and auto-register this legacy user
      const legName = localStorage.getItem("cricYuvaProfileName") || "Player";
      const legPid = localStorage.getItem("cricYuvaPlayerId") || ("CY2026-" + legMobile.slice(-4));
      const newU = {
        userId: "CYU-" + legMobile.slice(-4) + "-LEGACY",
        mobile: legMobile,
        password: legPass,
        name: legName,
        playerId: legPid,
        createdAt: new Date().toISOString()
      };
      users.push(newU);
      saveRegisteredUsers(users);
      setActiveUserId(newU.userId);
      localStorage.setItem("cricYuvaLoggedIn", "true");
      return { success: true, user: newU };
    }

    return { success: false, error: "Invalid mobile number or password." };
  }

  // Legacy Data Migration on App Startup
  function migrateLegacyDataIfRequired() {
    try {
      const isMigrated = localStorage.getItem(LEGACY_MIGRATION_FLAG);
      if (isMigrated) return;

      const legacyMobile = localStorage.getItem("cricYuvaMobile") || localStorage.getItem("cricYuvaProfileMobile");
      const legacyPass = localStorage.getItem("cricYuvaPassword");
      const legacyName = localStorage.getItem("cricYuvaProfileName");

      if (legacyMobile && legacyPass) {
        const cleanMobile = legacyMobile.trim().replace(/\D/g, "");
        const userId = "CYU-" + cleanMobile.slice(-4) + "-ORIG";
        const playerId = localStorage.getItem("cricYuvaPlayerId") || ("CY2026-" + cleanMobile.slice(-4));

        const existingUsers = getAllRegisteredUsers();
        if (!existingUsers.some((u) => u.mobile === cleanMobile)) {
          existingUsers.push({
            userId: userId,
            mobile: cleanMobile,
            password: legacyPass,
            name: legacyName || "Cric Yuva Player",
            playerId: playerId,
            createdAt: new Date().toISOString()
          });
          saveRegisteredUsers(existingUsers);
        }

        // Migrate un-scoped keys into this user's isolated namespace
        const keysToMigrate = [
          "cricYuvaTeamData",
          "cricYuvaMatchHistory",
          "cricYuvaActiveMatch",
          "cricYuvaTournamentsList",
          "cric_yuva_custom_clubs",
          "cricYuvaProfileName",
          "cricYuvaProfileMobile",
          "cricYuvaProfileEmail",
          "cricYuvaJerseyName",
          "cricYuvaJerseyNumber",
          "cricYuvaJerseySize",
          "cricYuvaPantSize",
          "cricYuvaDateOfBirth",
          "cricYuvaProfilePhoto",
          "cricYuvaPlayerId",
          "cricYuvaMobile",
          "cricYuvaPassword"
        ];

        keysToMigrate.forEach((k) => {
          const val = localStorage.getItem(k);
          if (val !== null) {
            localStorage.setItem(`CYU_${userId}_${k}`, val);
          }
        });

        // If currently logged in, activate this user
        if (localStorage.getItem("cricYuvaLoggedIn") === "true") {
          localStorage.setItem(ACTIVE_USER_KEY, userId);
        }
      }

      localStorage.setItem(LEGACY_MIGRATION_FLAG, "true");
    } catch (e) {
      console.warn("Legacy migration notice:", e);
    }
  }

  // Run startup migration and initialize IndexedDB
  migrateLegacyDataIfRequired();
  openDatabase().then((db) => {
    if (db) {
      console.log("[CricYuvaDB] IndexedDB initialized and active.");
    }
  });

  // Export to Global Scope
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
    getScopedKey
  };
})();
