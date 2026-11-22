import { spawn } from 'child_process';
const url = process.argv[2]; const setup = process.argv[3] || '';
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=9333','--user-data-dir=/tmp/cdp/prof'+Date.now(),'about:blank'], {stdio:'ignore'});
await new Promise(r=>setTimeout(r,4500));
const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
let id=0; const pend={};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend[m.id]){pend[m.id](m.result);} 
 if(m.method==='Runtime.consoleAPICalled'&&['error','warning'].includes(m.params.type)) console.log('CONSOLE',m.params.type, m.params.args.map(a=>a.value??a.description).join(' ').slice(0,600));
 if(m.method==='Runtime.exceptionThrown') console.log('EXC', JSON.stringify(m.params.exceptionDetails).slice(0,1200));};
await new Promise(r=>ws.onopen=r);
await send('Runtime.enable'); await send('Page.enable');
if (setup) await send('Page.addScriptToEvaluateOnNewDocument',{source:setup});
await send('Page.navigate',{url});
for(let k=0;k<90;k++){await new Promise(r=>setTimeout(r,1000)); const q=await send('Runtime.evaluate',{expression:'typeof window.RESULT',returnByValue:true}); if(q.result.value!=='undefined') break;}
const r = await send('Runtime.evaluate',{expression:'String(window.RESULT)+"|||"+String(window.REG)',returnByValue:true});
console.log('ROOT TEXT:', JSON.stringify(r.result.value));
chrome.kill(); process.exit(0);
