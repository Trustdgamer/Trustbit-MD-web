const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers } = require("@whiskeysockets/baileys");
const pino = require('pino');
const fs = require('fs');
const moment = require('moment-timezone');

const app = express();
const PORT = process.env.PORT || 3000;

let pairCount = 0;
let visitCount = 0;
const startTime = Date.now();

app.use(express.static('public'));

app.get('/code', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    
    visitCount++;
    // Clean number
    num = num.replace(/[^0-9]/g, '');

    // Create a fresh temp folder for this attempt
    const authPath = `./temp/${num}_${Date.now()}`;
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    try {
        let client = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            // FIX: Using official Chrome/Ubuntu identity to prevent "Couldn't Link"
            browser: ["Ubuntu", "Chrome", "20.0.04"], 
            syncFullHistory: false
        });

        if (!client.authState.creds.registered) {
            await delay(2000); // Wait for socket to stabilize
            const code = await client.requestPairingCode(num);
            if (!res.headersSent) res.json({ code: code });
        }

        client.ev.on('creds.update', saveCreds);

        client.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect } = s;
            
            if (connection === 'open') {
                pairCount++;
                console.log(`[Trustbit] ${num} Connected!`);

                // Create Session ID
                const authFile = JSON.parse(fs.readFileSync(`${authPath}/creds.json`));
                const sessionID = Buffer.from(JSON.stringify(authFile)).toString('base64');
                
                await client.sendMessage(client.user.id, { 
                    text: `*TRUSTBIT MD SESSION ID*\n\n${sessionID}\n\nCopy this ID and put it in your Panel variables.` 
                });
                
                // Small delay then cleanup
                setTimeout(() => { 
                    try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (e) {}
                }, 10000);
            }

            if (connection === 'close') {
                // If it closes before connecting, cleanup
                const code = lastDisconnect?.error?.output?.statusCode;
                if (code !== 401) { /* handle reconnect if needed */ }
            }
        });
    } catch (e) { 
        console.log("Error:", e);
        if (!res.headersSent) res.status(500).json({ error: "System Busy. Try again." }); 
    }
});

app.get('/admin-data', (req, res) => {
    const diff = Date.now() - startTime;
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    res.json({
        slots: `${pairCount}/100`,
        visits: visitCount,
        time: moment().tz("Africa/Lagos").format("HH:mm:ss"),
        runtime: `${hours}h ${mins}m`
    });
});

app.listen(PORT, () => console.log(`Trustbit MD Live on ${PORT}`));
