import express from "express";
import http from "http";
import https from "https";

const app = express();
const PORT = process.env.PORT || 8000;

let REAL_URL = process.env.KOYEB_PUBLIC_URL || null;
let BOT_HEALTHY = false;

let localTimer = null;
let externalTimer = null;

// Start both pingers only when REAL_URL exists
function enablePingersIfReady() {
    if (!REAL_URL) return;
    startLocalPinger();
    startExternalPinger();
}

// Local pinger (only after REAL_URL is known)
function startLocalPinger() {
    if (localTimer) return;

    const localURL = `http://127.0.0.1:${PORT}/health`;

    localTimer = setInterval(() => {
        http.get(localURL, res => res.resume());
    }, 120000);
}

// External pinger (only after REAL_URL is known)
function startExternalPinger() {
    if (externalTimer) clearInterval(externalTimer);
    if (!REAL_URL) return;

    const url = REAL_URL + "/health";
    const proto = REAL_URL.startsWith("https") ? https : http;

    externalTimer = setInterval(() => {
        try {
            proto.get(url, res => {
                res.on("data", () => {});
            }).on("error", () => {});
        } catch {}
    }, 240000);
}

// Detect REAL_URL from Koyeb proxy headers
app.use((req, res, next) => {
    const proto = req.headers["x-forwarded-proto"];
    const host = req.headers["x-forwarded-host"] || req.headers.host;

    if (proto && host) {
        const newURL = `${proto}://${host}`;
        if (REAL_URL !== newURL) {
            REAL_URL = newURL;
            enablePingersIfReady();
        }
    }

    next();
});

// UI
app.get("/", (req, res) => {
    const up = process.uptime();
    const h = Math.floor(up / 3600);
    const m = Math.floor((up % 3600) / 60);
    const s = Math.floor(up % 60);

    res.send(`
        <html>
<head>
    <title>HyperWa Bot</title>
    <meta http-equiv="refresh" content="10">
    <style>
        body {
            margin: 0;
            background: linear-gradient(135deg, #0f0f0f, #1b1b1b);
            font-family: Arial, sans-serif;
            color: #eee;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
        }
        .card {
            background: #181818;
            padding: 30px 40px;
            border-radius: 18px;
            width: 420px;
            text-align: center;
        }
        h1 {
            margin-top: 0;
            margin-bottom: 20px;
            color: #00e676;
        }
        table {
            width: 100%;
            margin-top: 20px;
            border-collapse: collapse;
        }
        td {
            padding: 8px 0;
            border-bottom: 1px solid #333;
            font-size: 14px;
            color: #ddd;
        }
        .badge {
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 12px;
            color: #fff;
        }
        .ok { background: #00c853; }
    </style>
</head>

<body>
    <div class="card">
        <h1>HyperWa Bot</h1>
        <table>
            <tr>
                <td>Status</td>
                <td><span class="badge ok">Running</span></td>
            </tr>
            <tr>
                <td>Uptime</td>
                <td>${h}h ${m}m ${s}s</td>
            </tr>
        </table>
    </div>
</body>
</html>
    `);
});

// Health endpoint
app.get("/health", (req, res) => {
    res.json({
        ok: true,
        uptime: process.uptime(),
        detected: REAL_URL,
        bot: BOT_HEALTHY,
        ts: new Date().toISOString()
    });
});

// Whoami
app.get("/whoami", (req, res) => {
    res.json({
        detected_url: REAL_URL,
        headers: {
            "x-forwarded-proto": req.headers["x-forwarded-proto"],
            "x-forwarded-host": req.headers["x-forwarded-host"],
            host: req.headers.host
        }
    });
});

// Bot status
app.post("/bot-status", (req, res) => {
    BOT_HEALTHY = req.body?.healthy !== false;
    res.json({ ok: true });
});

// Domain verification (silent)
setInterval(() => {
    if (!REAL_URL) return;

    const checkURL = REAL_URL + "/health";
    const proto = REAL_URL.startsWith("https") ? https : http;

    proto.request(checkURL, { method: "HEAD", timeout: 3000 }, () => {})
         .on("error", () => {})
         .end();

}, 600000);

// Start server silently
const server = app.listen(PORT, "0.0.0.0", () => {
    enablePingersIfReady();
});

// Safe exit
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));

export { server, app };
