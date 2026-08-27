import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = "C:\\Users\\Lenovo\\Documents\\work\\luwi.chatbot.backend";
let require;
try {
  require = createRequire(path.join(workspace, "package.json"));
  require("mongoose");
} catch {
  require = createRequire(path.join(repo, "package.json"));
}
const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(repo, ".env.production") });
dotenv.config({ path: path.join(repo, ".env.production.local"), override: true });

const config = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(workspace, "config.clone.json"), "utf8"));
const apply = process.argv.includes("--apply");
const sourceUri = process.env.PROD_DB_URI;
const targetUri = process.env.TEST_DB_URI;
if (!sourceUri || !targetUri) throw new Error("PROD_DB_URI and TEST_DB_URI are required");
if (!config.targetCompanyId || !config.targetCompanyName) throw new Error("clone config is incomplete");

function mask(value) {
  return String(value ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/(?:\+?90|0)?5\d{9}/g, "[PHONE]")
    .replace(/\b(?:TR)?[0-9]{10,16}\b/g, "[IDENTIFIER]")
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, "[DATE]")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[DATE]");
}
function maskDeep(value) {
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
  return typeof value === "string" ? mask(value) : value;
}
function sid(value) { return value == null ? null : String(value); }
function newObjectId() { return new mongoose.Types.ObjectId(); }

const source = await mongoose.createConnection(sourceUri, { serverSelectionTimeoutMS: 30000, readPreference: "secondaryPreferred" }).asPromise();
const target = await mongoose.createConnection(targetUri, { serverSelectionTimeoutMS: 30000 }).asPromise();
const sdb = source.db;
const tdb = target.db;
const existing = await tdb.collection("companies").findOne({ globalcompanyid: config.targetCompanyId }, { projection: { _id: 1, globalcompanyid: 1, globalcompanyname: 1 } });
if (existing) throw new Error(`Target company already exists: ${config.targetCompanyId}. Refusing to overwrite.`);

const [companies, agents, conversations, dynamicRecords] = await Promise.all([
  sdb.collection("companies").find({}, { projection: { _id: 0, globalcompanyid: 1, globalcompanyname: 1, companyInstructions: 1, location: 1, address: 1, inActiveTools: 1, chatV3Settings: 1 } }).toArray(),
  sdb.collection("ai_agents").find({ active: true }).project({}).toArray(),
  sdb.collection("conversations").find({}, { projection: { _id: 1, globalcompanyid: 1, customerID: 1, customerName: 1, phoneNumber: 1, nationality: 1, provider: 1, activeCategory: 1, history: 1, timestamp: 1 } }).sort({ timestamp: 1 }).limit(Number(config.conversationLimit || 100000)).toArray(),
  sdb.collection("dynamic_agent_datas").find({}, { projection: { _id: 1, globalcompanyid: 1, conversationID: 1, aiAgentId: 1, schemaName: 1, data: 1, step: 1, confirmationRequired: 1, status: 1, startWhatsappChatID: 1, startMediaLink: 1, pendingCategoryCandidates: 1, locationID: 1, locationDetailID: 1, webhookStatus: 1, createdAt: 1, updatedAt: 1 } }).limit(Number(config.dynamicRecordLimit || 100000)).toArray(),
]);
const companyById = new Map(companies.map((c) => [String(c.globalcompanyid), c]));
const agentMap = new Map();
const conversationMap = new Map();
const clonedCompany = {
  globalcompanyid: config.targetCompanyId,
  globalcompanyname: config.targetCompanyName,
  provider: "openai",
  companyInstructions: "Benchmark company. Kaynak company bilgileri agent seviyesinde korunur.",
  location: "Antalya, Turkey",
  address: "",
  inActiveTools: "",
  chatV3Settings: { maxTurns: 20 },
  benchmarkSource: "all_test_companies",
  benchmarkSourceCompanyCount: companies.length,
  createdAt: new Date(),
};

const clonedAgents = agents.map((agent) => {
  const sourceCompany = companyById.get(String(agent.globalcompanyid));
  const oldId = sid(agent._id);
  const newId = newObjectId();
  agentMap.set(`${agent.globalcompanyid}:${oldId}`, sid(newId));
  return {
    ...agent,
    _id: newId,
    globalcompanyid: config.targetCompanyId,
    aiAgentName: `${sourceCompany?.globalcompanyname || agent.globalcompanyid} :: ${agent.aiAgentName}`,
    systemInstructions: mask(agent.systemInstructions),
    customInstructions: mask(agent.customInstructions),
    aiAgentRole: mask(agent.aiAgentRole),
    aiAgentRoutingRule: mask(agent.aiAgentRoutingRule),
    aiAgentKeywords: (agent.aiAgentKeywords || []).map(mask),
    benchmarkSourceCompanyId: agent.globalcompanyid,
    benchmarkSourceCompanyName: sourceCompany?.globalcompanyname || null,
    benchmarkSourceAgentId: oldId,
  };
});

function rewriteHistory(history, sourceCompanyId) {
  return (history || []).map((turn) => ({
    ...turn,
    parts: (turn.parts || []).map((part) => ({
      ...part,
      text: mask(part.text),
      aiAgentId: agentMap.get(`${sourceCompanyId}:${sid(part.aiAgentId)}`) || null,
    })),
  }));
}

const clonedConversations = conversations.map((conversation) => {
  const sourceId = sid(conversation._id);
  const newId = newObjectId();
  conversationMap.set(`${conversation.globalcompanyid}:${sourceId}`, sid(newId));
  return {
    ...conversation,
    _id: newId,
    globalcompanyid: config.targetCompanyId,
    customerID: `eval-customer-${crypto.createHash("sha256").update(`${conversation.globalcompanyid}:${conversation.customerID || sourceId}`).digest("hex").slice(0, 12)}`,
    customerName: "Evaluation Guest",
    phoneNumber: undefined,
    nationality: conversation.nationality ? "ANONYMIZED" : undefined,
    history: rewriteHistory(conversation.history, conversation.globalcompanyid),
    benchmarkSourceCompanyId: conversation.globalcompanyid,
    benchmarkSourceCompanyName: companyById.get(String(conversation.globalcompanyid))?.globalcompanyname || null,
    benchmarkSourceConversationId: sourceId,
  };
});

const clonedDynamicRecords = dynamicRecords.flatMap((record) => {
  const conversationId = conversationMap.get(`${record.globalcompanyid}:${sid(record.conversationID)}`);
  const agentId = agentMap.get(`${record.globalcompanyid}:${sid(record.aiAgentId)}`);
  if (!conversationId || !agentId) return [];
  return [{
    ...record,
    _id: newObjectId(),
    globalcompanyid: config.targetCompanyId,
    conversationID: new mongoose.Types.ObjectId(conversationId),
    aiAgentId: agentId,
    data: maskDeep(record.data || {}),
    startWhatsappChatID: undefined,
    phoneNumber: undefined,
    customerID: undefined,
    customerName: undefined,
    benchmarkSourceCompanyId: record.globalcompanyid,
  }];
});

const summary = {
  apply,
  sourceDbReadOnly: true,
  targetDb: tdb.databaseName,
  targetCompanyId: config.targetCompanyId,
  targetCompanyName: config.targetCompanyName,
  sourceCompanies: companies.length,
  sourceActiveAgents: agents.length,
  sourceConversations: conversations.length,
  sourceDynamicRecords: dynamicRecords.length,
  clonedAgents: clonedAgents.length,
  clonedConversations: clonedConversations.length,
  clonedDynamicRecords: clonedDynamicRecords.length,
};
console.log(JSON.stringify(summary, null, 2));
if (apply) {
  await tdb.collection("companies").insertOne(clonedCompany);
  if (clonedAgents.length) await tdb.collection("ai_agents").insertMany(clonedAgents, { ordered: false });
  if (clonedConversations.length) await tdb.collection("conversations").insertMany(clonedConversations, { ordered: false });
  if (clonedDynamicRecords.length) await tdb.collection("dynamic_agent_datas").insertMany(clonedDynamicRecords, { ordered: false });
  console.log("TEST_DB_APPLY_COMPLETE");
}
await source.close();
await target.close();
