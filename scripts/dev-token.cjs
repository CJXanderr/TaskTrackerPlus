// Checks a Root dev token and saves it to server/.env in the form the devhost expects.
// Used by test.cmd. Reads DEV_TOKEN from the environment, or from server/.env when
// it isn't set. Exit code 0 = saved, 1 = doesn't look like a dev token.
//   --force  save it even if it doesn't look right
//
// The Dev Portal's copy button copies "DEV_TOKEN=<token>", so a pasted
// "DEV_TOKEN=" prefix is removed. A dev token starts with the test community's ID
// and the app's ID (22 characters each, base64url). Byte 7 of a Root ID says what
// kind it is: 2 = community, 9 = app, 1 = user.
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const envFile = path.join(root, "server", ".env");
const force = process.argv.includes("--force");

let raw = process.env.DEV_TOKEN;
if (!raw) {
  try {
    const match = /^\s*DEV_TOKEN\s*=\s*(.*)$/m.exec(fs.readFileSync(envFile, "utf8"));
    raw = match ? match[1] : "";
  } catch {
    raw = "";
  }
}

let token = raw.trim();
for (;;) {
  const next = token.replace(/^["']|["']$/g, "").replace(/^DEV_TOKEN\s*=\s*/i, "").trim();
  if (next === token) break;
  token = next;
}

const kind = (id) => {
  const bytes = Buffer.from(id, "base64url");
  return bytes.length === 16 ? bytes[7] : -1;
};

let appId = "";
try {
  appId = JSON.parse(fs.readFileSync(path.join(root, "root-manifest.json"), "utf8")).id || "";
} catch {}

let problem = "";
if (!token) {
  problem = "No dev token found.";
} else if (!/^[A-Za-z0-9_-]+$/.test(token) || token.length <= 44 || kind(token.slice(0, 22)) !== 2 || ![1, 9].includes(kind(token.slice(22, 44)))) {
  problem = "That doesn't look like a dev token. Copy it from \"Generate new dev token\" on your app's Overview page in the Root Dev Portal.";
} else if (kind(token.slice(22, 44)) === 9 && appId && token.slice(22, 44) !== appId) {
  problem = "That dev token belongs to a different app. Generate one on the Overview page of Task Tracker+ (App ID " + appId + ").";
}

if (problem && !force) {
  console.log("");
  console.log(problem);
  process.exit(1);
}

fs.writeFileSync(envFile, "DEV_TOKEN=" + token + os.EOL);
console.log("Dev token saved to server\\.env");
process.exit(0);
