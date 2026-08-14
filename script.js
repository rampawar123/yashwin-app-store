let current = "0";
let expression = "";
let justCalculated = false;

const display = document.getElementById("display");

function updateDisplay(){
  display.textContent = current;
}

function press(value){

  if(justCalculated){
    current = "0";
    expression = "";
    justCalculated = false;
  }

  if("0123456789.".includes(value)){

    if(current === "0" && value !== "."){
      current = value;
    }
    else if(value === "." && current.includes(".")){
      return;
    }
    else{
      current += value;
    }

  }else{

    if(current === "0"){
      expression = "0";
    }else{
      expression += current;
    }

    expression += value;
    current = "0";
  }

  updateDisplay();
}

function calculate(){

  if(current !== "0"){
    expression += current;
  }

  if(!expression){
    return;
  }

  try{

    let safeExpression = expression
      .replace(/÷/g,"/")
      .replace(/×/g,"*")
      .replace(/−/g,"-");

    if(!/^[0-9+\-*/().\s]+$/.test(safeExpression)){
      throw new Error("Invalid");
    }

    let result = Function(
      '"use strict"; return (' + safeExpression + ')'
    )();

    if(!Number.isFinite(result)){
      throw new Error("Invalid");
    }

    let text =
      expression.replace(/\*/g,"×")
      + " = "
      + result;

    addHistory(text);

    current = String(result);
    expression = "";
    justCalculated = true;

    updateDisplay();

  }catch(error){

    current = "Error";
    expression = "";
    justCalculated = true;

    updateDisplay();
  }
}

function clearAll(){

  current = "0";
  expression = "";
  justCalculated = false;

  updateDisplay();
}

function backspace(){

  if(justCalculated){
    clearAll();
    return;
  }

  if(current.length > 1){
    current = current.slice(0,-1);
  }else{
    current = "0";
  }

  updateDisplay();
}

function percent(){

  let number = parseFloat(current);

  if(isNaN(number)){
    return;
  }

  current = String(number / 100);

  updateDisplay();
}

function addHistory(text){

  let history =
    JSON.parse(localStorage.getItem("vanshHistory")) || [];

  history.unshift(text);

  if(history.length > 20){
    history = history.slice(0,20);
  }

  localStorage.setItem(
    "vanshHistory",
    JSON.stringify(history)
  );

  showHistory();
}

function showHistory(){

  const box = document.getElementById("history");

  let history =
    JSON.parse(localStorage.getItem("vanshHistory")) || [];

  box.innerHTML = "";

  history.forEach(item=>{

    const div = document.createElement("div");

    div.className = "history-item";

    div.textContent = item;

    box.appendChild(div);

  });
}

function clearHistory(){

  localStorage.removeItem("vanshHistory");

  showHistory();
}

showHistory();
updateDisplay();
