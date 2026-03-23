import { io } from "socket.io-client";

const SERVER = "http://localhost:3001";
const agent = io(SERVER, { transports: ["websocket"] });
const support = io(SERVER, { transports: ["websocket"] });

let ticketId: string;
let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

const timeout = setTimeout(() => {
  console.log(`\nTIMEOUT — stuck waiting. ${pass} passed, ${fail} failed`);
  process.exit(1);
}, 12000);

agent.on("connect", () => {
  console.log("\n=== Chat Flow E2E Test ===\n");
  console.log("Phase 1: Connection & Identification");
  assert("Agent connected", !!agent.id);
  agent.emit("socket:identify", { userId: "agent_jan", role: "agent", name: "Agent Jan", partnerId: "tessera-main" });

  support.emit("socket:identify", { userId: "expert_piet", role: "support", name: "Expert Piet", partnerId: "tessera-main" });

  setTimeout(() => {
    console.log("\nPhase 2: Ticket Creation");
    agent.emit("ticket:new", {
      agentId: "agent_jan", agentLang: "nl", dept: "DSC",
      references: [{ label: "Test Ref", value: "TEST-" + Date.now() }],
      text: "Mijn internet werkt niet meer sinds gisteren"
    });
  }, 500);
});

agent.on("ticket:created:self", ({ ticket, message }: any) => {
  ticketId = ticket.id;
  assert("Ticket created with id", !!ticketId);
  assert("Ticket status is 'open'", ticket.status === "open");
  assert("First message present", !!message);
  assert("First msg has originalText", message?.originalText === "Mijn internet werkt niet meer sinds gisteren");
  assert("First msg has processedText", !!message?.processedText);
  assert("First msg senderRole = 'agent'", message?.senderRole === "agent");
  assert("First msg senderLang = 'nl'", message?.senderLang === "nl");
  assert("First msg has createdAt", !!message?.createdAt);

  console.log("\nPhase 3: Support Joins Ticket");
  setTimeout(() => {
    support.emit("support:join", { ticketId, supportId: "expert_piet", supportName: "Expert Piet", supportLang: "fr" });
  }, 300);
});

// Support: receives ticket:created broadcast
support.on("ticket:created", ({ ticket }: any) => {
  assert("Support received ticket:created broadcast", !!ticket?.id);
});

// Agent: support joined notification
agent.on("support:joined", ({ ticketId: tid, supportName }: any) => {
  assert("Agent notified of support:joined", tid === ticketId);
  assert("Support name correct", supportName === "Expert Piet");
});

// Support: history loaded
support.on("ticket:history", ({ ticketId: tid, messages }: any) => {
  assert("Support received ticket:history", tid === ticketId);
  assert("History has 1 message", messages?.length === 1, `got ${messages?.length}`);
  const m = messages?.[0];
  assert("History msg has originalText", !!m?.originalText);
  assert("History msg has processedText", !!m?.processedText);
  assert("History msg has text field", !!m?.text);
  assert("History msg senderRole = 'agent'", m?.senderRole === "agent");

  console.log("\nPhase 4: Bidirectional Messaging");
  support.emit("message:send", { ticketId, senderId: "expert_piet", text: "Ik ga dit voor u bekijken" });
});

// Agent: receives support's message
agent.on("message:new", (msg: any) => {
  if (msg.senderId === "expert_piet") {
    assert("Agent received support message", !!msg.id);
    assert("Msg has originalText", msg.originalText === "Ik ga dit voor u bekijken");
    assert("Msg has processedText", !!msg.processedText);
    assert("Msg senderRole = 'support'", msg.senderRole === "support");
    assert("Msg senderLang = 'nl'", msg.senderLang === "nl");
    assert("Msg has createdAt", !!msg.createdAt);
    assert("Msg has timestamp", !!msg.timestamp);
    assert("Msg has reactions obj", typeof msg.reactions === "object");

    // Agent replies
    agent.emit("message:send", { ticketId, senderId: "agent_jan", text: "Dank u, ik wacht af" });
  }

  // Agent sees own reply confirmed
  if (msg.senderId === "agent_jan" && msg.originalText === "Dank u, ik wacht af") {
    assert("Agent sees own reply via message:new", true);
  }
});

// Support: receives agent's reply
let agentReplyReceived = false;
support.on("message:new", (msg: any) => {
  if (msg.senderId === "agent_jan" && msg.originalText === "Dank u, ik wacht af" && !agentReplyReceived) {
    agentReplyReceived = true;
    assert("Support received agent reply", true);
    assert("Reply senderRole = 'agent'", msg.senderRole === "agent");

    console.log("\nPhase 5: Typing Indicators");
    agent.emit("typing:start", { ticketId, senderName: "Agent Jan" });
  }
});

// Support: typing update
let typingStartReceived = false;
support.on("typing:update", ({ senderName, typing }: any) => {
  if (typing && !typingStartReceived) {
    typingStartReceived = true;
    assert("Support sees typing:start", senderName === "Agent Jan" && typing === true);
    agent.emit("typing:stop", { ticketId, senderName: "Agent Jan" });
  }
  if (!typing && typingStartReceived) {
    assert("Support sees typing:stop", senderName === "Agent Jan" && typing === false);

    console.log("\nPhase 6: Delivery Receipts");
    // Get the last message ID from support's perspective
    support.emit("message:delivered", { ticketId, messageId: "nonexistent-ok" });

    // Test ticket close
    setTimeout(() => {
      console.log("\nPhase 7: Ticket Close");
      support.emit("ticket:close", { ticketId, closedBy: "expert_piet" });
    }, 300);
  }
});

// Both: ticket closed
agent.on("ticket:closed", ({ ticketId: tid, status }: any) => {
  assert("Agent received ticket:closed", tid === ticketId);
  assert("Ticket status = 'closed'", status === "closed");

  // Final summary
  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  clearTimeout(timeout);
  agent.disconnect();
  support.disconnect();
  process.exit(fail > 0 ? 1 : 0);
});

// Error handlers
agent.on("hours:closed", () => { console.log("ERROR: hours:closed"); process.exit(1); });
agent.on("error", (err: any) => console.log("AGENT ERROR:", JSON.stringify(err)));
support.on("error", (err: any) => console.log("SUPPORT ERROR:", JSON.stringify(err)));
