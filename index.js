const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, delay } = require("@whiskeysockets/baileys");
const pino = require('pino');
const fs = require('fs');
const moment = require('moment-timezone');

const app = express();
const PORT = process.env.PORT || 3000;

// Variables for Admin Dashboard
let pairCount = 0;
let visitCount = 0;
const startTime = Date.now();

app.use(express.static('public'));

app.get('/code', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    
    visitCount++;
    const { state, saveCreds } = await useMultiFileAuthState(`./temp/${num}`);

    try {
        let client = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            browser: ["Trustbit MD", "Chrome", "20.0.04"]
        });

        if (!client.authState.creds.registered) {
            await delay(1500);
            num = num.replace(/[^0-9]/g, '');
            const code = await client.requestPairingCode(num);
            if (!res.headersSent) res.json({ code: code });
        }

        client.ev.on('creds.update', saveCreds);
        client.ev.on('connection.update', async (s) => {
            if (s.connection === 'open') {
                pairCount++;
                // Create Session ID (Base64)
                const authFile = fs.readFileSync(`./temp/${num}/creds.json`);
                const sessionID = Buffer.from(authFile).toString('base64');
                
                await client.sendMessage(client.user.id, { 
                    text: `*TRUSTBIT MD SESSION ID*\n\n${sessionID}\n\nKeep this ID safe! Paste it in your Panel.` 
                });
                console.log(`[Trustbit] ${num} Linked!`);
            }
        });
    } catch (e) { res.status(500).json({ error: "Server Busy" }); }
});

// Admin API
app.get('/admin-data', (req, res) => {
    const uptime = moment.duration(Date.now() - startTime);
    res.json({
        slots: `${pairCount}/100`,
        visits: visitCount,
        time: moment().tz("Africa/Lagos").format("HH:mm:ss"),
        runtime: `${uptime.hours()}h ${uptime.minutes()}m ${uptime.seconds()}s`
    });
});

app.listen(PORT, () => console.log(`Website live on ${PORT}`));
