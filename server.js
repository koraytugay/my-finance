const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 7990;
const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".csv": "text/csv; charset=utf-8",
    ".enc": "application/json; charset=utf-8"
};

const server = http.createServer((req, res) => {
    let reqPath = req.url.split("?")[0];
    if (reqPath === "/") reqPath = "/index.html";

    const safePath = path.normalize(decodeURIComponent(reqPath)).replace(/^[\.\/\\]+/, "");
    const filePath = path.join(__dirname, safePath);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("404 Not Found");
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext];
        if (!contentType) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("404 Not Found");
            return;
        }

        res.writeHead(200, {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache, must-revalidate"
        });

        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`My Finance server running at http://localhost:${PORT}/`);
});
