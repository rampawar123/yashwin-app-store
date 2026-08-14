let current = "0";
let firstNumber = null;
let operator = null;
let waitingForSecond = false;

const display = document.getElementById("display");
const historyBox = document.getElementById("history");
const totalValue = document.getElementById("totalValue");

function showDisplay() {
    let text = current;

    if (firstNumber !== null && operator !== null) {
        text = format(firstNumber) + " " + symbol(operator);

        if (!waitingForSecond) {
            text += " " + current;
        }
    }

    display.textContent = text;
    display.scrollLeft = display.scrollWidth;
}

function pressNumber(n) {
    if (waitingForSecond) {
        current = n === "00" ? "0" : n;
        waitingForSecond = false;
    } else {
        if (current === "0") {
            current = n === "00" ? "0" : n;
        } else {
            current += n;
        }
    }

    showDisplay();
}

function pressDecimal() {
    if (waitingForSecond) {
        current = "0.";
        waitingForSecond = false;
    } else if (!current.includes(".")) {
        current += ".";
    }

    showDisplay();
}

function pressOperator(op) {
    const num = Number(current);

    if (firstNumber === null) {
        firstNumber = num;
    } else if (!waitingForSecond) {
        firstNumber = calculateResult(
            firstNumber,
            num,
            operator
        );

        current = format(firstNumber);
    }

    operator = op;
    waitingForSecond = true;

    showDisplay();
}

function calculate() {
    if (
        firstNumber === null ||
        operator === null ||
        waitingForSecond
    ) {
        return;
    }

    const second = Number(current);

    const result = calculateResult(
        firstNumber,
        second,
        operator
    );

    const expression =
        format(firstNumber) +
        " " +
        symbol(operator) +
        " " +
        format(second);

    addHistory(expression, result);

    current = format(result);

    firstNumber = null;
    operator = null;
    waitingForSecond = false;

    showDisplay();
}

function calculateResult(a, b, op) {
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "*") return a * b;

    if (op === "/") {
        if (b === 0) return NaN;
        return a / b;
    }

    return b;
}

function percent() {
    current = format(Number(current) / 100);
    showDisplay();
}

function backspace() {
    if (waitingForSecond) return;

    if (current.length <= 1) {
        current = "0";
    } else {
        current = current.slice(0, -1);
    }

    showDisplay();
}

function clearAll() {
    current = "0";
    firstNumber = null;
    operator = null;
    waitingForSecond = false;

    showDisplay();
}

function symbol(op) {
    if (op === "*") return "×";
    if (op === "/") return "÷";
    if (op === "-") return "−";
    return op;
}

function format(n) {
    if (!Number.isFinite(n)) return "Error";

    if (Number.isInteger(n)) {
        return String(n);
    }

    return String(
        Number(n.toFixed(10))
    );
}

function addHistory(expression, answer) {
    const item = document.createElement("div");

    item.className = "history-item";

    const text = document.createElement("div");

    text.className = "history-text";

    text.textContent =
        expression +
        " = " +
        format(answer);

    const del = document.createElement("button");

    del.className = "delete-history";

    del.textContent = "🗑️";

    del.onclick = function () {
        item.remove();
        updateTotal();
    };

    item.appendChild(text);
    item.appendChild(del);

    historyBox.prepend(item);

    updateTotal();
}

function updateTotal() {
    let total = 0;

    document
        .querySelectorAll(".history-item")
        .forEach(item => {

            const text =
                item.querySelector(
                    ".history-text"
                ).textContent;

            const parts = text.split("=");

            const answer =
                Number(
                    parts[parts.length - 1]
                );

            if (!isNaN(answer)) {
                total += answer;
            }
        });

    totalValue.textContent =
        format(total);
}

function clearHistory() {
    historyBox.innerHTML = "";
    updateTotal();
}

showDisplay();
