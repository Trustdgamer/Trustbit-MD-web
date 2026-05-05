const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require("@whiskeysockets/baileys");
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const moment = require('moment-timezone');

const app = express();

// --- THE UI (HTML) ---
const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Trustbit MD</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700&family=Poppins:wght@300;600&display=swap" rel="stylesheet">
    <style>
        body { background: #050505; color: #fff; font-family: 'Poppins', sans-serif; }
        .glass { background: rgba(255, 255, 255, 0.02); backdrop-filter: blur(15px); border: 1px solid rgba(255,255,255,0.08); }
        .neon { color: #00f2ff; text-shadow: 0 0 15px #00f2ff; font-family: 'Orbitron'; }
        .btn { background: #00f2ff; color: #000; transition: 0.3s; }
        .btn:hover { background: #0062ff; color: #fff; box-shadow: 0 0 20px #0062ff; }
    </style>
</head>
<body class="min-h-screen flex flex-col items-center justify-center p-6">
    <div class="w-full max-w-sm flex gap-2 mb-6">
        <div class="glass p-4 rounded-3xl flex-1 text-center">
            <p class="text-[10px] text-gray-500 uppercase">Nigeria Time</p>
            <p id="time" class="text-xs font-bold text-cyan-400">Loading...</p>
        </div>
    </div>

    <div class="glass w-full max-w-sm p-10 rounded-[3rem] shadow-2xl text-center">
        <h1 class="text-3xl font-bold neon mb-2">TRUSTBIT MD</h1>
        <p class="text-[10px] text-gray-500 tracking-[5px] mb-10">PAIRING SERVER V3</p>

        <input type="number" id="num" placeholder="234..." class="w-full bg-white/5 border border-white/10 p-5 rounded-2xl outline-none focus:border-cyan-400 text-center text-lg mb-5">
        <button id="btn" onclick="getCode()" class="w-full btn p-5 rounded-2xl font-bold uppercase text-xs tracking-widest">Get Pairing Code</button>

        <div id="loader" class="hidden mt-8 flex justify-center"><div class="animate-spin h-6 w-6 border-2 border-cyan-400 border-t-transparent rounded-full"></div></div>

        <div id="result" class="hidden mt-10">
            <p class="text-[10px] text-cyan-400 mb-2">WHATSAPP CODE</p>
            <h2 id="pair-code" class="text-5xl font-bold tracking-[8px]"></h2>
        </div>
    </div>

    <script>
        setInterval(() => {
            const now = new Date().toLocaleString("en-US", {timeZone: "Africa/Lagos"});
            document.getElementById('time').innerText = new Date(now).toLocaleTimeString();
        }, 1000);

        async function getCode() {
            const num = document.getElementById('num').value;
            const btn = document.getElementById('btn');
            if(!num) return alert("Enter number!");

            btn.disabled = true; btn.innerText = "CONNECTING...";
            document.getElementById('loader').classList.remove('hidden');
            document.getElementById('result').classList.add('hidden');

            try {
                const res = await fetch('/code?number=' + num);
                const data = await res.json();
                document.getElementById('loader').classList.add('hidden');
                btn.disabled = false; btn.innerText = "Get Pairing Code";
                if(data.code) {
                    document.getElementById('result').classList.remove('hidden');
                    document.getElementById('pair-code').innerText = data.code;
                } else { alert("Try again."); }
            } catch(e) { alert("Timeout. Try again."); location.reload(); }
        }
    </script>
</body>
</html>
`;

// --- THE LOGIC ---

app.get('/', (req, res) => {
    res.send(html);
});

app.get('/code', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "No number" });
    num = num.replace(/[^0-9]/g, '');

    const authPath = path.join('/tmp', `session_${num}`);
    if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    try {
        const client = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            browser: ["Mac OS", "Chrome", "110.0.5481.178"]
        });

        if (!client.authState.creds.registered) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            const code = await client.requestPairingCode(num);
            
            if (!res.headersSent) {
                res.json({ code: code });
            }
        }

        client.ev.on('creds.update', saveCreds);
        client.ev.on('connection.update', async (update) => {
            if (update.connection === 'open') {
                const credsData = fs.readFileSync(path.join(authPath, 'creds.json'));
                const sessionID = Buffer.from(credsData).toString('base64');
                await client.sendMessage(client.user.id, { text: `*TRUSTBIT MD SESSION ID:*\n\n${sessionID}` });
                client.end();
            }
        });

    } catch (e) {
        if (!res.headersSent) res.status(500).json({ error: "Error" });
    }
});

module.exports = app;
