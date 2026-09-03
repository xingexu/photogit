#!/usr/bin/env node

const expression = process.argv[2];
if (!expression) throw new Error("Pass a JavaScript expression to evaluate in the PhotoGit panel.");

const targets = await fetch("http://127.0.0.1:9229/json").then((response) => response.json());
const debuggerTarget = targets.find((candidate) => candidate.title?.startsWith("PhotoGit - Adobe Photoshop") && candidate.url?.includes("devtools_app.html"));
if (!debuggerTarget) throw new Error("Start PhotoGit Debug from UXP Developer Tools first.");
const pluginAddress = new URL(debuggerTarget.url).searchParams.get("ws");
if (!pluginAddress) throw new Error("The PhotoGit debug target did not expose its local socket.");

const socket = new WebSocket(`ws://${pluginAddress}`);
const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Timed out waiting for the PhotoGit panel.")), 10000);
  let runtimeEnabled = false;
  let contextId;
  let evaluationSent = false;
  const evaluate = () => {
    if (!runtimeEnabled || contextId === undefined || evaluationSent) return;
    evaluationSent = true;
    socket.send(JSON.stringify({
      id: 2,
      method: "Runtime.evaluate",
      params: { expression, contextId, awaitPromise: true, returnByValue: true }
    }));
  };
  socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Runtime.enable" })));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.executionContextCreated" && contextId === undefined) {
      contextId = message.params?.context?.id;
      evaluate();
      return;
    }
    if (message.id === 1) {
      if (message.error) return reject(new Error(message.error.message));
      runtimeEnabled = true;
      evaluate();
      return;
    }
    if (message.id !== 2) return;
    clearTimeout(timeout);
    if (message.error) reject(new Error(message.error.message));
    else if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text));
    else resolve(message.result?.result?.value);
  });
  socket.addEventListener("error", () => reject(new Error("Could not connect to the PhotoGit panel debug socket.")));
});

socket.close();
if (typeof result === "string") process.stdout.write(`${result}\n`);
else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
