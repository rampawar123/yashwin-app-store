const STORE_VERSION = "1.0.0";

const defaultApps = [];

function $(id) {
  return document.getElementById(id);
}

function toggleMenu() {
  const menu = $("menu");

  if (!menu) return;

  menu.style.display =
    menu.style.display === "block" ? "none" : "block";
}

function closeMenu() {
  const menu = $("menu");
  if (menu) menu.style.display = "none";
}

function goHome() {
  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

  closeMenu();
}

function showAbout() {
  alert(
    "YASHWIN APP STORE\n\n" +
    "Discover, Download and Enjoy Apps.\n\n" +
    "Store Version: " + STORE_VERSION
  );

  closeMenu();
}

function showUpdates() {
  const updateBox = $("updateBox");

  if (updateBox) {
    updateBox.style.display = "block";

    updateBox.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }

  closeMenu();
}

function checkStoreUpdate() {
  const savedVersion =
    localStorage.getItem("yashwin_store_version");

  if (savedVersion !== STORE_VERSION) {
    const updateBox = $("updateBox");

    if (updateBox) {
      updateBox.style.display = "block";
    }
  }
}

function updateStore() {
  localStorage.setItem(
    "yashwin_store_version",
    STORE_VERSION
  );

  const updateBox = $("updateBox");

  if (updateBox) {
    updateBox.style.display = "none";
  }

  alert(
    "YASHWIN APP STORE updated successfully.\n\n" +
    "Version " + STORE_VERSION
  );
}

function closeUpdate() {
  const updateBox = $("updateBox");

  if (updateBox) {
    updateBox.style.display = "none";
  }
}

function getApps() {
  try {
    const saved =
      localStorage.getItem("yashwin_apps");

    if (!saved) {
      return [...defaultApps];
    }

    const apps = JSON.parse(saved);

    return Array.isArray(apps) ? apps : [];
  } catch (error) {
    console.error(
      "Unable to load apps:",
      error
    );

    return [];
  }
}

function saveApps(apps) {
  localStorage.setItem(
    "yashwin_apps",
    JSON.stringify(apps)
  );
}

function searchApps() {
  const searchBox = $("searchBox");

  if (!searchBox) return;

  const text =
    searchBox.value.trim().toLowerCase();

  const cards =
    document.querySelectorAll(".app-card");

  let visible = 0;

  cards.forEach(card => {
    const name =
      (card.dataset.name || "").toLowerCase();

    const description =
      (card.dataset.description || "").toLowerCase();

    const match =
      text === "" ||
      name.includes(text) ||
      description.includes(text);

    card.style.display =
      match ? "block" : "none";

    if (match) {
      visible++;
    }
  });

  const emptySearch = $("emptySearch");

  if (emptySearch) {
    emptySearch.style.display =
      text !== "" && visible === 0
        ? "block"
        : "none";
  }
}

function openAddApp() {
  const modal = $("addModal");

  if (modal) {
    modal.style.display = "block";
  }

  closeMenu();
}

function closeAddApp() {
  const modal = $("addModal");

  if (modal) {
    modal.style.display = "none";
  }
}

function clearAppForm() {
  const fields = [
    "appName",
    "appVersion",
    "appLogo",
    "appOpen",
    "appDownload",
    "appDescription"
  ];

  fields.forEach(id => {
    const field = $(id);

    if (field) {
      field.value = "";
    }
  });
}

function saveApp() {
  const name =
    $("appName")?.value.trim();

  const version =
    $("appVersion")?.value.trim() || "1.0.0";

  const logo =
    $("appLogo")?.value.trim();

  const open =
    $("appOpen")?.value.trim();

  const download =
    $("appDownload")?.value.trim();

  const description =
    $("appDescription")?.value.trim() ||
    "New app from YASHWIN APP STORE.";

  if (!name) {
    alert("Please enter the App Name.");
    return;
  }

  const app = {
    id: Date.now().toString(),

    name: name,

    version: version,

    logo: logo,

    open: open,

    download: download,

    description: description
  };

  const apps = getApps();

  apps.push(app);

  saveApps(apps);

  clearAppForm();

  closeAddApp();

  renderApps();

  alert(
    name +
    " has been added to YASHWIN APP STORE."
  );
}

function deleteApp(id) {
  const confirmed =
    confirm(
      "Remove this app from YASHWIN APP STORE?"
    );

  if (!confirmed) return;

  const apps =
    getApps().filter(
      app => app.id !== id
    );

  saveApps(apps);

  renderApps();
}

function createAppCard(app) {
  const card =
    document.createElement("div");

  card.className = "app-card";

  card.dataset.name =
    app.name || "";

  card.dataset.description =
    app.description || "";

  const logo =
    app.logo ||
    "icon-192.png";

  const openLink =
    app.open || "#";

  const downloadLink =
    app.download || "#";

  card.innerHTML = `
    <div class="app-logo">
      <img
        src="${escapeHTML(logo)}"
        alt="${escapeHTML(app.name || "App")}"
        onerror="this.src='icon-192.png'"
        style="
          width:100%;
          height:100%;
          object-fit:cover;
          border-radius:22px;
        "
      >
    </div>

    <h2>
      ${escapeHTML(app.name || "Unnamed App")}
    </h2>

    <div class="version">
      Version ${escapeHTML(app.version || "1.0.0")}
    </div>

    <p class="description">
      ${escapeHTML(
        app.description ||
        "New app from YASHWIN APP STORE."
      )}
    </p>

    <div class="buttons">

      <a
        class="btn btn-open"
        href="${escapeHTML(openLink)}"
      >
        ▶️ OPEN APP
      </a>

      <a
        class="btn btn-download"
        href="${escapeHTML(downloadLink)}"
        download
      >
        ⬇️ DOWNLOAD APK
      </a>

      <a
        class="btn btn-install"
        href="${escapeHTML(downloadLink)}"
      >
        📲 INSTALL
      </a>

      <button
        class="btn"
        style="
          background:#333;
          color:#ff9800;
          border:1px solid #555;
        "
        onclick="deleteApp('${escapeHTML(app.id || "")}')"
      >
        🗑️ REMOVE APP
      </button>

    </div>
  `;

  return card;
}

function renderApps() {
  const container =
    $("appsContainer");

  if (!container) return;

  const oldCards =
    container.querySelectorAll(".app-card");

  oldCards.forEach(card => {
    card.remove();
  });

  const apps = getApps();

  const emptyBox =
    $("emptyBox");

  if (apps.length === 0) {
    if (emptyBox) {
      emptyBox.style.display = "block";
    }

    return;
  }

  if (emptyBox) {
    emptyBox.style.display = "none";
  }

  apps.forEach(app => {
    const card =
      createAppCard(app);

    container.appendChild(card);
  });

  searchApps();
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

window.addEventListener(
  "click",
  function(event) {
    const modal = $("addModal");

    if (
      modal &&
      event.target === modal
    ) {
      closeAddApp();
    }
  }
);

window.addEventListener(
  "load",
  function() {
    renderApps();
    checkStoreUpdate();
  }
);
