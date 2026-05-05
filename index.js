const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    Browsers, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    DisconnectReason
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

    const authPath = path.join(__dirname, 'sessions', `pair_${num}_${Date.now()}`);
    await fs.ensureDir(authPath);
    
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    try {
        const Trustbit = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            // Identity: Safari on MacOS (Highest Trust Level)
            browser: ["Mac OS", "Safari", "10.15.7"],
            syncFullHistory: false
        });

        // 1. REQUEST CODE
        if (!Trustbit.authState.creds.registered) {
            await new Promise(resolve => setTimeout(resolve, 4000)); // Crucial "Warm-up"
            const code = await Trustbit.requestPairingCode(num);
            if (!res.headersSent) res.json({ code: code });
        }

        Trustbit.ev.on('creds.update', saveCreds);

        // 2. ANTI-HANG LOGIC (Keeps the socket active)
        const keepAlive = setInterval(() => {
            Trustbit.sendPresenceUpdate('available');
        }, 10000);

        Trustbit.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                clearInterval(keepAlive);
                pairCount++;
                console.log(`[Trustbit] User ${num} Connected Successfully!`);

                const credsData = await fs.readJson(path.join(authPath, 'creds.json'));
                const sessionID = Buffer.from(JSON.stringify(credsData)).toString('base64');
                
                await Trustbit.sendMessage(Trustbit.user.id, { 
                    text: `*TRUSTBIT MD CONNECTED!* ✅\n\n*SESSION ID:*\n${sessionID}\n\nPaste this into your Panel variables.` 
                });

                setTimeout(() => { fs.remove(authPath).catch(() => {}); }, 5000);
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason !== DisconnectReason.loggedOut) {
                    // Only restart if not logged out
                } else {
                    clearInterval(keepAlive);
                    fs.remove(authPath).catch(() => {});
                }
            }
        });

    } catch (e) {
        console.log("Global Error:", e);
        if (!res.headersSent) res.status(500).json({ error: "Connection Reset. Try again." });
    }
});

app.get('/admin-data', (req, res) => {
    const diff = Date.now() - startTime;
    res.json({
        slots: `${pairCount}/100`,
        visits: visitCount,
        time: moment().tz("Africa/Lagos").format("HH:mm:ss"),
        runtime: `${Math.floor(diff/3600000)}h ${Math.floor((diff%3600000)/60000)}m`
    });
});

app.listen(PORT, () => console.log(`Trustbit Web Active`));
