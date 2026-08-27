import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = "C:\\Users\\Lenovo\\Documents\\work\\luwi.chatbot.backend";
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let require;
try {
  require = createRequire(path.join(workspace, "package.json"));
  require("dotenv");
} catch {
  require = createRequire(path.join(repo, "package.json"));
}
const dotenv = require("dotenv");
const mongoose = require("mongoose");
dotenv.config({ path: path.join(repo, ".env.production") });
dotenv.config({ path: path.join(repo, ".env.production.local"), override: true });

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] || fallback : fallback;
}

const configPath = path.resolve(arg("config", path.join(workspace, "config.json")));
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const write = process.argv.includes("--write") || config.writeOutput === true;
const companyId = String(config.companyId || "").trim();
if (!companyId) throw new Error("config.companyId is required");
if (write && !process.argv.includes("--write")) {
  throw new Error("Writing requires an explicit --write flag");
}
if (!process.env.PROD_DB_URI) throw new Error("PROD_DB_URI is missing");

const root = path.resolve(workspace);
const dirs = [path.join(root, "eval"), path.join(root, "reports")];
if (write) await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));

const connection = await mongoose.createConnection(process.env.PROD_DB_URI, {
  serverSelectionTimeoutMS: 30000,
  readPreference: "secondaryPreferred",
}).asPromise();
const db = connection.db;

const [company, agents, conversations] = await Promise.all([
  db.collection("companies").findOne(
    { globalcompanyid: companyId },
    { projection: { _id: 0, globalcompanyid: 1, globalcompanyname: 1, companyInstructions: 1, location: 1, address: 1, chatV3Settings: 1 } },
  ),
  db.collection("ai_agents").find({ globalcompanyid: companyId, active: true }).project({
    _id: 1, aiAgentName: 1, aiAgentType: 1, aiAgentIntent: 1, aiAgentRoutingRule: 1,
    aiAgentKeywords: 1, aiAgentCategory: 1, outputFormat: 1, outputSchema: 1,
    isServiceAgent: 1, messageDirection: 1, files: 1, urlList: 1,
  }).sort({ wizardOrder: 1, aiAgentName: 1 }).toArray(),
  db.collection("conversations").find({ globalcompanyid: companyId }, {
    projection: { _id: 1, history: 1, timestamp: 1, provider: 1, activeCategory: 1 },
  }).sort({ timestamp: -1 }).limit(Number(config.conversationLimit || 500)).toArray(),
]);

function mask(value) {
  return String(value ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/(?:\+?90|0)?5\d{9}/g, "[PHONE]")
    .replace(/\b(?:TR)?[0-9]{10,16}\b/g, "[IDENTIFIER]")
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, "[DATE]");
}

function id(value) { return value == null ? null : String(value); }
function historyTurns(conversation) {
  return (conversation.history || []).flatMap((turn) => (turn.parts || []).map((part) => ({
    role: turn.role === "model" ? "assistant" : turn.role,
    text: mask(part.text),
    language: part.spokenLanguage?.isoCode || part.responseLanguage?.isoCode || null,
    category: part.category || null,
    modelCategory: part.modelCategory || null,
    isAnswered: part.isAnswered ?? null,
    agentId: id(part.aiAgentId),
  })));
}

const rows = conversations.flatMap((conversation) => {
  const turns = historyTurns(conversation);
  return turns.filter((turn) => turn.role === "user").map((turn, index) => ({
    case_id: `prod_${id(conversation._id)}_${index + 1}`,
    source: "production_anonymized",
    flow_targets: ["v1", "v3"],
    user_message: turn.text,
    context: turns.slice(0, turns.indexOf(turn)),
    observed_intent: turn.category,
    observed_agent_id: turn.agentId,
    observed_answered: turn.isAnswered,
    expected_intent: null,
    expected_agent: null,
    expected_answer: null,
    source_documents: [],
    should_escalate: null,
    human_review_required: true,
  }));
});

const summary = {
  companyId,
  companyName: company?.globalcompanyname || null,
  dryRun: !write,
  productionReadOnly: true,
  activeAgents: agents.length,
  conversationsScanned: conversations.length,
  userCasesExtracted: rows.length,
  piiMasking: "email, phone, identifier, date",
  note: "expected_* alanlari RuneLab benchmark kullanimi oncesi insan tarafindan doldurulmalidir",
};

console.log(JSON.stringify(summary, null, 2));
if (write) {
  await fs.writeFile(path.join(root, "company-profile.json"), JSON.stringify({ company, companyId }, null, 2));
  await fs.writeFile(path.join(root, "agents-and-routing.jsonl"), agents.map((agent) => JSON.stringify({
    agent_id: id(agent._id),
    name: agent.aiAgentName,
    type: agent.aiAgentType,
    intent: agent.aiAgentIntent || null,
    routing_rule: mask(agent.aiAgentRoutingRule),
    keywords: (agent.aiAgentKeywords || []).map(mask),
    category: agent.aiAgentCategory || null,
    output_format: agent.outputFormat || null,
    output_schema: agent.outputSchema || null,
    service_agent: agent.isServiceAgent === true,
    message_direction: agent.messageDirection || null,
    files: (agent.files || []).map((file) => file.fileName),
  })).join("\n") + "\n");
  const splitAt = Math.max(1, Math.floor(rows.length * (1 - Number(config.holdoutRatio || 0.2))));
  await fs.writeFile(path.join(root, "eval", "benchmark.jsonl"), rows.slice(0, splitAt).map(JSON.stringify).join("\n") + "\n");
  await fs.writeFile(path.join(root, "eval", "hidden-test.jsonl"), rows.slice(splitAt).map(JSON.stringify).join("\n") + "\n");
  await fs.writeFile(path.join(root, "reports", "export-summary.json"), JSON.stringify(summary, null, 2));
}
await connection.close();
