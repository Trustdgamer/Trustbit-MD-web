const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    Browsers, 
    makeCacheableSignalKeyStore 
} = require("@whiskeysockets/baileys");
const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
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
    
    num = num.replace(/[^0-9]/g, '');
    visitCount++;

    // Create a specific folder for this attempt
    const authPath = path.join(__dirname, 'sessions', `pair_${num}`);
    await fs.ensureDir(authPath);
    
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    try {
        const Trustbit = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            // Identity fix: Using Chrome on MacOS is currently more stable for pairing
            browser: ["Chrome (MacOS)", "Safari", "11.0.0"],
            syncFullHistory: false
        });

        if (!Trustbit.authState.creds.registered) {
            // Give the socket 3 seconds to stabilize
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            try {
                const code = await Trustbit.requestPairingCode(num);
                if (!res.headersSent) {
                    res.json({ code: code });
                }
            } catch (pairErr) {
                console.log("Pairing Request Error:", pairErr);
                if (!res.headersSent) res.status(500).json({ error: "WA Server Refused. Try again." });
            }
        }

        Trustbit.ev.on('creds.update', saveCreds);

        Trustbit.ev.on('connection.update', async (update) => {
            const { connection } = update;

            if (connection === 'open') {
                pairCount++;
                // Convert session to Base64 Session ID
                const credsFile = path.join(authPath, 'creds.json');
                const sessionData = await fs.readJson(credsFile);
                const sessionID = Buffer.from(JSON.stringify(sessionData)).toString('base64');

                await Trustbit.sendMessage(Trustbit.user.id, { 
                    text: `*TRUSTBIT MD SESSION ID*\n\n${sessionID}\n\nCopy this and paste it in your Panel variables.` 
                });

                // Cleanup session folder after 10 seconds
                setTimeout(() => { fs.remove(authPath).catch(e => {}); }, 10000);
            }
        });

        // KEEP ALIVE: Prevent Render from killing the process for 2 minutes
        setTimeout(() => {
            if (Trustbit.authState.creds.registered) return;
            Trustbit.end();
            fs.remove(authPath).catch(e => {});
        }, 120000);

    } catch (e) {
        console.log("Global Error:", e);
        if (!res.headersSent) res.status(500).json({ error: "Internal Server Error" });
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

app.listen(PORT, () => console.log(`Trustbit MD Web Server Active on ${PORT}`));
