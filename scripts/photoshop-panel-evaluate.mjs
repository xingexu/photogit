#!/usr/bin/env node

import { readFile } from "node:fs/promises";

let expression = process.argv[2];
const holdIndex = process.argv.indexOf("--hold-ms");
const holdMs = holdIndex === -1 ? 0 : Number(process.argv[holdIndex + 1]);
if (!Number.isFinite(holdMs) || holdMs < 0) throw new Error("--hold-ms must be followed by a non-negative number.");
const timeoutIndex = process.argv.indexOf("--timeout-ms");
const timeoutMs = timeoutIndex === -1 ? 10000 : Number(process.argv[timeoutIndex + 1]);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout-ms must be followed by a positive number.");
if (expression === "--file") {
  const filePath = process.argv[3];
  if (!filePath) throw new Error("Pass a JavaScript file after --file.");
  expression = await readFile(filePath, "utf8");
}
if (!expression) throw new Error("Pass a JavaScript expression to evaluate in the PhotoGit panel.");

const targets = await fetch("http://127.0.0.1:9229/json").then((response) => response.json());
const debuggerTarget = targets.find((candidate) => candidate.title?.startsWith("PhotoGit - Adobe Photoshop") && candidate.url?.includes("devtools_app.html"));
if (!debuggerTarget) throw new Error("Start PhotoGit Debug from UXP Developer Tools first.");
const pluginAddress = new URL(debuggerTarget.url).searchParams.get("ws");
if (!pluginAddress) throw new Error("The PhotoGit debug target did not expose its local socket.");

const socket = new WebSocket(`ws://${pluginAddress}`);
const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Timed out waiting for the PhotoGit panel.")), timeoutMs);
  let runtimeEnabled = false;
  let contextId;
  let evaluationSent = false;
  let nextProbeId = 100;
  const pendingContexts = [];
  const probeContexts = new Map();
  const probeAttempts = new Map();
  const probeContext = (candidateId) => {
    if (contextId !== undefined) return;
    const attempts = (probeAttempts.get(candidateId) || 0) + 1;
    probeAttempts.set(candidateId, attempts);
    const probeId = nextProbeId++;
    probeContexts.set(probeId, candidateId);
    socket.send(JSON.stringify({
      id: probeId,
      method: "Runtime.evaluate",
      params: {
        expression: 'Boolean(globalThis.document && document.getElementById("workspace"))',
        contextId: candidateId,
        returnByValue: true
      }
    }));
  };
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
    if (message.method === "Runtime.executionContextCreated") {
      const candidateId = message.params?.context?.id;
      if (candidateId === undefined) return;
      if (runtimeEnabled) probeContext(candidateId);
      else pendingContexts.push(candidateId);
      return;
    }
    if (message.id === 1) {
      if (message.error) return reject(new Error(message.error.message));
      runtimeEnabled = true;
      pendingContexts.splice(0).forEach(probeContext);
      return;
    }
    if (probeContexts.has(message.id)) {
      const candidateId = probeContexts.get(message.id);
      probeContexts.delete(message.id);
      if (!message.error && message.result?.result?.value === true && contextId === undefined) {
        contextId = candidateId;
        evaluate();
      } else if (contextId === undefined && (probeAttempts.get(candidateId) || 0) < 40) {
        setTimeout(() => probeContext(candidateId), 250);
      }
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

if (holdMs) {
  process.stdout.write("PhotoGit visible panel connected.\n");
  await new Promise((resolve) => setTimeout(resolve, holdMs));
}
socket.close();
if (typeof result === "string") process.stdout.write(`${result}\n`);
else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
