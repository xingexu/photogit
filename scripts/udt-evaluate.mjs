#!/usr/bin/env node

const expression = process.argv[2];
if (!expression) throw new Error("Pass a JavaScript expression to evaluate in UXP Developer Tools.");

const targets = await fetch("http://127.0.0.1:9229/json").then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page" && candidate.url?.includes("/dist/index.html") && candidate.webSocketDebuggerUrl);
if (!target) throw new Error("No UXP Developer Tools page is available on port 9229.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Timed out waiting for UXP Developer Tools.")), 10000);
  socket.addEventListener("open", () => socket.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true }
  })));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== 1) return;
    clearTimeout(timeout);
    if (message.error) reject(new Error(message.error.message));
    else if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.text));
    else resolve(message.result?.result?.value);
  });
  socket.addEventListener("error", () => reject(new Error("Could not connect to UXP Developer Tools.")));
});

socket.close();
if (typeof result === "string") process.stdout.write(`${result}\n`);
else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
