const state = {
  nifty: 25000,
  bank: 55000,
  pnl: 0,
  signal: "NEUTRAL",
  confidence: 50
};

const pageTitles = {
  dashboard: ["Dashboard", "AI-powered market monitoring"],
  scanner: ["Market Scanner", "Scan market conditions"],
  analysis: ["AI Analysis", "Market intelligence and signals"],
  strategy: ["Strategy", "Build and test trading rules"],
  paper: ["Paper Trading", "Virtual trading environment"],
  positions: ["Positions", "Open paper positions"],
  orders: ["Orders", "Paper order history"],
  risk: ["Risk Controls", "Protect the trading account"],
  history: ["Trade History", "Historical paper trades"]
};

function money(value) {
  return "₹" + Number(value).toFixed(2);
}

function updateDashboard() {
  document.getElementById("niftyValue").textContent =
    state.nifty.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  document.getElementById("bankValue").textContent =
    state.bank.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  document.getElementById("pnl").textContent = money(state.pnl);
  document.getElementById("signal").textContent = state.signal;
  document.getElementById("bigSignal").textContent = state.signal;
  document.getElementById("confidence").textContent =
    state.confidence + "%";

  document.getElementById("meterFill").style.width =
    state.confidence + "%";
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item")
      .forEach(item => item.classList.remove("active"));

    button.classList.add("active");

    const page = button.dataset.page;
    const info = pageTitles[page];

    document.getElementById("pageTitle").textContent = info[0];
    document.getElementById("pageSubtitle").textContent = info[1];

    if (page !== "dashboard") {
      showToast(info[0] + " module selected");
    }
  });
});

document.getElementById("emergencyBtn").addEventListener("click", () => {
  showToast("Emergency Stop activated — live trading is disabled.");
});

document.getElementById("timeframe").addEventListener("change", event => {
  showToast("Timeframe changed to " + event.target.value);
});

function simulateMarket() {
  const niftyMove = (Math.random() - 0.5) * 35;
  const bankMove = (Math.random() - 0.5) * 80;

  state.nifty += niftyMove;
  state.bank += bankMove;

  state.confidence =
    Math.floor(45 + Math.random() * 20);

  const signals = ["NEUTRAL", "BULLISH", "BEARISH"];
  state.signal = signals[Math.floor(Math.random() * signals.length)];

  const trend =
    state.signal === "BULLISH"
      ? "Uptrend"
      : state.signal === "BEARISH"
        ? "Downtrend"
        : "Sideways";

  document.getElementById("trend").textContent = trend;

  updateDashboard();
}

updateDashboard();

setInterval(simulateMarket, 4000);
