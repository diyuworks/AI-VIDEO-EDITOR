const fs = require('fs');
let content = fs.readFileSync('src/pages/ReelGeneratorPage.tsx', 'utf-8');
content = content.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, '')).replace(/\/\/.*$/gm, '');
let inString = false;
let stringChar = '';
const stack = [];
for (let i = 0; i < content.length; i++) {
  const c = content[i];
  if (inString) {
    if (c === stringChar && content[i-1] !== '\\') inString = false;
    continue;
  }
  if (c === "'" || c === '"' || c === '`') {
    inString = true;
    stringChar = c;
    continue;
  }
  if (c === '{' || c === '(' || c === '[') stack.push({char: c, line: content.slice(0, i).split('\n').length});
  else if (c === '}' || c === ')' || c === ']') {
    if (stack.length === 0) { console.log('Extra closing bracket ' + c + ' at line ' + content.slice(0, i).split('\n').length); break; }
    const last = stack.pop();
    const map = {'}':'{', ')':'(', ']':'['};
    if (last.char !== map[c]) {
      console.log('Mismatch at line ' + content.slice(0, i).split('\n').length + ': expected closing for ' + last.char + ' from line ' + last.line + ' but found ' + c);
      break;
    }
  }
}
console.log('Stack remaining: ', stack.length > 0 ? stack.slice(-5) : '[]');
