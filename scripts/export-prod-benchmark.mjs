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
const allCompanies = config.allCompanies === true || companyId.toUpperCase() === "ALL";
if (!companyId && !allCompanies) throw new Error("config.companyId or config.allCompanies is required");
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
const companyFilter = allCompanies ? {} : { globalcompanyid: companyId };

const [companies, agents, conversations, dynamicRecords] = await Promise.all([
  db.collection("companies").find(
    companyFilter,
    { projection: { _id: 0, globalcompanyid: 1, globalcompanyname: 1, companyInstructions: 1, location: 1, address: 1, chatV3Settings: 1 } },
  ).sort({ globalcompanyname: 1 }).toArray(),
  db.collection("ai_agents").find({ ...companyFilter, active: true }).project({
    _id: 1, aiAgentName: 1, aiAgentType: 1, aiAgentIntent: 1, aiAgentRoutingRule: 1,
    aiAgentKeywords: 1, aiAgentCategory: 1, outputFormat: 1, outputSchema: 1,
    isServiceAgent: 1, messageDirection: 1, files: 1, urlList: 1,
  }).sort({ wizardOrder: 1, aiAgentName: 1 }).toArray(),
  db.collection("conversations").find(companyFilter, {
    projection: { _id: 1, globalcompanyid: 1, history: 1, timestamp: 1, provider: 1, activeCategory: 1 },
  }).sort({ timestamp: -1 }).limit(Number(config.conversationLimit || 500)).toArray(),
  db.collection("dynamic_agent_datas").find(companyFilter, {
    projection: {
      _id: 1, globalcompanyid: 1, conversationID: 1, aiAgentId: 1, schemaName: 1, data: 1,
      step: 1, confirmationRequired: 1, status: 1, locationID: 1,
      locationDetailID: 1, webhookStatus: 1, createdAt: 1, updatedAt: 1,
    },
  }).sort({ createdAt: -1 }).limit(Number(config.dynamicRecordLimit || 2000)).toArray(),
]);
const companyById = new Map(companies.map((item) => [String(item.globalcompanyid), item]));

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
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskDeep(item)]));
  }
  return typeof value === "string" ? mask(value) : value;
}

function id(value) { return value == null ? null : String(value); }
const dynamicByConversation = new Map();
for (const record of dynamicRecords) {
  const key = `${record.globalcompanyid}:${id(record.conversationID)}`;
  if (!key) continue;
  const sanitized = {
    record_id: id(record._id),
    ai_agent_id: id(record.aiAgentId),
    schema_name: record.schemaName || null,
    data: maskDeep(record.data || {}),
    step: record.step || null,
    confirmation_required: record.confirmationRequired ?? null,
    status: record.status || null,
    location_id: record.locationID ?? null,
    location_detail_id: record.locationDetailID ?? null,
    webhook_status: record.webhookStatus || null,
  };
  const list = dynamicByConversation.get(key) || [];
  list.push(sanitized);
  dynamicByConversation.set(key, list);
}

const toolCatalog = [
  { name: "get_current_weather", legacyName: "weather", kind: "external", flowTargets: ["v1", "v3"], expected: "Tool is used for current weather, rain, wind, humidity and temperature questions." },
  { name: "get_sea_temperature", legacyName: "sea_temperature", kind: "external", flowTargets: ["v3"], expected: "Tool is used for current sea-water temperature questions." },
  { name: "get_map_directions", legacyName: "map", kind: "external", flowTargets: ["v1", "v3"], expected: "Tool is used for maps, directions, distance, routes and nearby places." },
  { name: "list_hotel_inventory", legacyName: null, kind: "info", flowTargets: ["v3"], expected: "Tool returns the deterministic hotel/property inventory." },
  { name: "list_hotel_map_inventory", legacyName: null, kind: "info", flowTargets: ["v3"], expected: "Tool returns hotels with an active map entry." },
  { name: "lookup_info_agents", legacyName: null, kind: "info", flowTargets: ["v3"], expected: "Tool finds relevant informational agents before factual answering." },
  { name: "get_info_agent_context", legacyName: null, kind: "info", flowTargets: ["v3"], expected: "Tool fetches read-only context for selected informational agents." },
  { name: "fallback_with_company_instructions", legacyName: null, kind: "fallback", flowTargets: ["v3"], expected: "Tool applies safe fallback when no reliable agent context can answer." },
  { name: "dynamic_runtime", legacyName: null, kind: "dynamic", flowTargets: ["v3"], expected: "Dynamic agent collects schema fields, handles confirmation and may submit a webhook." },
];

function schemaFields(schema) {
  if (typeof schema === "string") {
    try { return schemaFields(JSON.parse(schema)); } catch { return []; }
  }
  if (!schema || typeof schema !== "object") return [];
  if (Array.isArray(schema.properties)) {
    return schema.properties.map((item) => ({
      name: item?.key || item?.name || null,
      type: item?.type || "string",
      required: item?.required !== false,
      description: item?.description || "",
    })).filter((item) => item.name);
  }
  if (schema.properties && typeof schema.properties === "object") {
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    return Object.entries(schema.properties).map(([name, item]) => ({
      name,
      type: item?.type || "string",
      required: required.has(name),
      description: item?.description || "",
    }));
  }
  return [];
}
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
    source_company_id: conversation.globalcompanyid,
    source_company_name: companyById.get(String(conversation.globalcompanyid))?.globalcompanyname || null,
    dynamic_records: dynamicByConversation.get(`${conversation.globalcompanyid}:${id(conversation._id)}`) || [],
    expected_intent: null,
    expected_agent: null,
    expected_answer: null,
    source_documents: [],
    should_escalate: null,
    human_review_required: true,
  }));
});

const dynamicCaseTemplates = agents
  .filter((agent) => agent.outputFormat === "json" && agent.outputSchema)
  .map((agent) => ({
    case_id: `dynamic_template_${agent.globalcompanyid}_${id(agent._id)}`,
    source: "synthetic_dynamic_template",
    source_company_id: agent.globalcompanyid,
    source_company_name: companyById.get(String(agent.globalcompanyid))?.globalcompanyname || null,
    flow_targets: ["v3"],
    user_message: `${agent.aiAgentName} akışını başlat ve gerekli bilgileri sırayla topla.`,
    expected_intent: agent.aiAgentIntent || null,
    expected_agent: agent.aiAgentName || null,
    expected_tool: "dynamic_runtime",
    required_fields: schemaFields(agent.outputSchema),
    expected_steps: ["collecting", "confirmation", "completed"],
    confirmation_required: true,
    expected_webhook: true,
    human_review_required: true,
  }));

const toolCaseTemplates = [
  { case_id: "tool_weather_001", user_message: "Bugün Antalya'da hava nasıl?", expected_tool: "get_current_weather", expected_legacy_tool: "weather" },
  { case_id: "tool_sea_001", user_message: "Deniz suyu sıcaklığı kaç derece?", expected_tool: "get_sea_temperature", expected_legacy_tool: "sea_temperature" },
  { case_id: "tool_map_001", user_message: "Otele nasıl ulaşabilirim, harita bağlantısı var mı?", expected_tool: "get_map_directions", expected_legacy_tool: "map" },
  { case_id: "tool_inventory_001", user_message: "Hangi oteller hakkında bilgi verebilirsiniz?", expected_tool: "list_hotel_inventory", expected_legacy_tool: null },
  { case_id: "tool_map_inventory_001", user_message: "Haritası bulunan oteller hangileri?", expected_tool: "list_hotel_map_inventory", expected_legacy_tool: null },
  { case_id: "tool_info_lookup_001", user_message: "Spa hizmetleri hakkında bilgi verir misiniz?", expected_tool: "lookup_info_agents", expected_legacy_tool: null },
  { case_id: "tool_fallback_001", user_message: "Bilgi tabanında olmayan bir konuda yardımcı olabilir misiniz?", expected_tool: "fallback_with_company_instructions", expected_legacy_tool: null },
].map((item) => ({
  ...item,
  source: "synthetic_tool_template",
  flow_targets: ["v3"],
  expected_answer: null,
  tool_response_fixture_required: true,
  human_review_required: true,
}));

const summary = {
  companyId: allCompanies ? "ALL" : companyId,
  companyName: allCompanies ? "All companies" : companyById.get(companyId)?.globalcompanyname || null,
  companiesScanned: companies.length,
  dryRun: !write,
  productionReadOnly: true,
  activeAgents: agents.length,
  conversationsScanned: conversations.length,
  userCasesExtracted: rows.length,
  piiMasking: "email, phone, identifier, date",
  dynamicRecordsScanned: dynamicRecords.length,
  dynamicAgentTemplates: dynamicCaseTemplates.length,
  toolCatalogEntries: toolCatalog.length,
  note: "expected_* alanlari RuneLab benchmark kullanimi oncesi insan tarafindan doldurulmalidir",
};

console.log(JSON.stringify(summary, null, 2));
if (write) {
  await fs.writeFile(path.join(root, "company-profile.json"), JSON.stringify({ companies, companyId: allCompanies ? "ALL" : companyId }, null, 2));
  await fs.writeFile(path.join(root, "tool-catalog.json"), JSON.stringify({
    companyId: allCompanies ? "ALL" : companyId,
    inactiveToolIdsByCompany: Object.fromEntries(companies.map((item) => [item.globalcompanyid, item.inActiveTools || ""])),
    tools: toolCatalog,
    note: "Tool execution requires mocked responses for offline benchmark runs; do not call live external tools from benchmark tests.",
  }, null, 2));
  await fs.writeFile(path.join(root, "dynamic-agent-data.jsonl"), dynamicRecords.map((record) => JSON.stringify({
    record_id: id(record._id),
    source_company_id: record.globalcompanyid,
    source_company_name: companyById.get(String(record.globalcompanyid))?.globalcompanyname || null,
    conversation_id: id(record.conversationID),
    ai_agent_id: id(record.aiAgentId),
    schema_name: record.schemaName || null,
    data: maskDeep(record.data || {}),
    step: record.step || null,
    confirmation_required: record.confirmationRequired ?? null,
    status: record.status || null,
    location_id: record.locationID ?? null,
    location_detail_id: record.locationDetailID ?? null,
    webhook_status: record.webhookStatus || null,
  })).join("\n") + (dynamicRecords.length ? "\n" : ""));
  await fs.writeFile(path.join(root, "eval", "dynamic-agent-cases.jsonl"), dynamicCaseTemplates.map(JSON.stringify).join("\n") + (dynamicCaseTemplates.length ? "\n" : ""));
  await fs.writeFile(path.join(root, "eval", "tool-cases.jsonl"), toolCaseTemplates.map(JSON.stringify).join("\n") + "\n");
  await fs.writeFile(path.join(root, "agents-and-routing.jsonl"), agents.map((agent) => JSON.stringify({
    agent_id: id(agent._id),
    source_company_id: agent.globalcompanyid,
    source_company_name: companyById.get(String(agent.globalcompanyid))?.globalcompanyname || null,
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
