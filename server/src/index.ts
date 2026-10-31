import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireAdmin, signAdmin, verifyAdminToken, type AuthRequest } from "./auth.js";

const app = express();
const httpServer = createServer(app);
const origin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const io = new Server(httpServer, { cors: { origin, methods: ["GET", "POST"] }, pingInterval: 25000, pingTimeout: 20000 });
app.use(cors({ origin })); app.use(express.json({ limit: "1mb" }));

const questionInput = z.object({
  text: z.string().min(1).max(1000),
  timeLimitSeconds: z.number().int().min(5).max(300),
  explanation: z.string().max(2000).optional(),
  options: z.array(z.object({ text: z.string().min(1).max(300), isCorrect: z.boolean() })).min(2).max(6)
}).refine(q => q.options.filter(o => o.isCorrect).length === 1, "Exactly one option must be correct");
const quizInput = z.object({ title: z.string().min(2).max(120), description: z.string().max(1000).optional(), basePoints: z.number().int().min(1).max(10000) });

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.post("/api/auth/login", async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid credentials" });
  const admin = await prisma.admin.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!admin || !(await bcrypt.compare(parsed.data.password, admin.passwordHash))) return res.status(401).json({ error: "Invalid email or password" });
  res.json({ token: signAdmin(admin.id), email: admin.email });
});
app.get("/api/quizzes", requireAdmin, async (req: AuthRequest, res) => {
  const quizzes = await prisma.quiz.findMany({ where: { ownerId: req.adminId }, include: { _count: { select: { questions: true, sessions: true } } }, orderBy: { updatedAt: "desc" } });
  res.json(quizzes);
});
app.post("/api/quizzes", requireAdmin, async (req: AuthRequest, res) => {
  const parsed = quizInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const quiz = await prisma.quiz.create({ data: { ...parsed.data, ownerId: req.adminId! } }); res.status(201).json(quiz);
});
app.get("/api/quizzes/:id", requireAdmin, async (req: AuthRequest, res) => {
  const quiz = await prisma.quiz.findFirst({ where: { id: String(req.params.id), ownerId: req.adminId }, include: { questions: { orderBy: { order: "asc" }, include: { options: true } } } });
  if (!quiz) return res.status(404).json({ error: "Quiz not found" }); res.json(quiz);
});
app.put("/api/quizzes/:id", requireAdmin, async (req: AuthRequest, res) => {
  const parsed = quizInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const owned = await prisma.quiz.findFirst({ where: { id: String(req.params.id), ownerId: req.adminId } }); if (!owned) return res.status(404).json({ error: "Quiz not found" });
  res.json(await prisma.quiz.update({ where: { id: owned.id }, data: parsed.data }));
});
app.delete("/api/quizzes/:id", requireAdmin, async (req: AuthRequest, res) => {
  const owned = await prisma.quiz.findFirst({ where: { id: String(req.params.id), ownerId: req.adminId } }); if (!owned) return res.status(404).json({ error: "Quiz not found" });
  // Sessions have no cascade on Quiz, so remove them first (participants/answers cascade from the session).
  const sessions = await prisma.quizSession.findMany({ where: { quizId: owned.id }, select: { id: true, status: true } });
  for (const s of sessions) {
    if (s.status === "FINISHED") continue;
    clearTimer(s.id);
    io.to(room(s.id)).emit("quiz:finished", await finalResults(s.id));
  }
  await prisma.$transaction([
    prisma.quizSession.deleteMany({ where: { quizId: owned.id } }),
    prisma.quiz.delete({ where: { id: owned.id } })
  ]);
  res.status(204).end();
});
app.post("/api/quizzes/:id/duplicate", requireAdmin, async (req: AuthRequest, res) => {
  const src = await prisma.quiz.findFirst({ where: { id: String(req.params.id), ownerId: req.adminId }, include: { questions: { orderBy: { order: "asc" }, include: { options: true } } } });
  if (!src) return res.status(404).json({ error: "Quiz not found" });
  const copy = await prisma.quiz.create({
    data: {
      title: `${src.title} (Copy)`.slice(0, 120), description: src.description, basePoints: src.basePoints, ownerId: req.adminId!,
      questions: { create: src.questions.map((q, i) => ({ order: i, text: q.text, timeLimitSeconds: q.timeLimitSeconds, explanation: q.explanation, options: { create: q.options.map(o => ({ text: o.text, isCorrect: o.isCorrect })) } })) }
    },
    include: { _count: { select: { questions: true, sessions: true } } }
  });
  res.status(201).json(copy);
});
app.post("/api/quizzes/:id/questions", requireAdmin, async (req: AuthRequest, res) => {
  const parsed = questionInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const quiz = await prisma.quiz.findFirst({ where: { id: String(req.params.id), ownerId: req.adminId } }); if (!quiz) return res.status(404).json({ error: "Quiz not found" });
  const order = await prisma.question.count({ where: { quizId: quiz.id } });
  const q = await prisma.question.create({ data: { quizId: quiz.id, order, text: parsed.data.text, timeLimitSeconds: parsed.data.timeLimitSeconds, explanation: parsed.data.explanation, options: { create: parsed.data.options } }, include: { options: true } });
  res.status(201).json(q);
});
async function hasLiveSession(quizId: string) {
  return (await prisma.quizSession.count({ where: { quizId, status: { in: ["ACTIVE", "PAUSED", "BETWEEN_QUESTIONS"] } } })) > 0;
}
const LIVE_MSG = "A live session is running for this quiz. End it before changing questions.";
app.put("/api/questions/:id", requireAdmin, async (req: AuthRequest, res) => {
  const parsed = questionInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const q = await prisma.question.findFirst({ where: { id: String(req.params.id), quiz: { ownerId: req.adminId } } }); if (!q) return res.status(404).json({ error: "Question not found" });
  if (await hasLiveSession(q.quizId)) return res.status(409).json({ error: LIVE_MSG });
  const updated = await prisma.$transaction(async tx => {
    await tx.answerOption.deleteMany({ where: { questionId: q.id } });
    return tx.question.update({ where: { id: q.id }, data: { text: parsed.data.text, timeLimitSeconds: parsed.data.timeLimitSeconds, explanation: parsed.data.explanation ?? null, options: { create: parsed.data.options } }, include: { options: true } });
  });
  res.json(updated);
});
app.delete("/api/questions/:id", requireAdmin, async (req: AuthRequest, res) => {
  const q = await prisma.question.findFirst({ where: { id: String(req.params.id), quiz: { ownerId: req.adminId } } }); if (!q) return res.status(404).json({ error: "Question not found" });
  if (await hasLiveSession(q.quizId)) return res.status(409).json({ error: LIVE_MSG });
  await prisma.$transaction(async tx => {
    await tx.question.delete({ where: { id: q.id } });
    // Close the gap in "order" so new questions (order = count) never collide with the unique (quizId, order) index.
    const rest = await tx.question.findMany({ where: { quizId: q.quizId }, orderBy: { order: "asc" }, select: { id: true, order: true } });
    for (let i = 0; i < rest.length; i++) if (rest[i].order !== i) await tx.question.update({ where: { id: rest[i].id }, data: { order: i } });
  });
  res.status(204).end();
});

type PublicQuestion = { id: string; text: string; timeLimitSeconds: number; options: { id: string; text: string }[] };
const room = (id: string) => `session:${id}`;
const timerHandles = new Map<string, NodeJS.Timeout>();
async function publicQuestion(sessionId: string, index: number): Promise<PublicQuestion | null> {
  const session = await prisma.quizSession.findUnique({ where: { id: sessionId }, include: { quiz: { include: { questions: { orderBy: { order: "asc" }, include: { options: true } } } } } });
  const q = session?.quiz.questions[index]; if (!q) return null;
  return { id: q.id, text: q.text, timeLimitSeconds: q.timeLimitSeconds, options: q.options.map(o => ({ id: o.id, text: o.text })) };
}
async function emitLobby(sessionId: string) {
  const participants = await prisma.participant.findMany({ where: { sessionId }, select: { id: true, name: true } });
  io.to(room(sessionId)).emit("lobby:update", { count: participants.length, participants });
}
async function finishQuestion(sessionId: string) {
  const session = await prisma.quizSession.findUnique({ where: { id: sessionId }, include: { quiz: true, participants: { include: { answers: true } } } });
  if (!session || session.status !== "ACTIVE") return;
  const index = session.currentQuestionIndex;
  const q = await prisma.question.findFirst({ where: { quizId: session.quizId, order: index }, include: { options: true } });
  if (!q) return;
  const ranked = session.participants
    .map(p => ({ participantId: p.id, name: p.name, answer: p.answers.find(a => a.questionId === q.id) }))
    .filter(x => x.answer?.status === "CORRECT")
    .sort((a, b) => (a.answer!.responseMs ?? Infinity) - (b.answer!.responseMs ?? Infinity))
    .slice(0, 3)
    .map((x, i) => ({ rank: i + 1, name: x.name, points: x.answer!.points }));
  const individual = session.participants.map(p => {
    const answer = p.answers.find(a => a.questionId === q.id);
    return { participantId: p.id, correct: answer?.status === "CORRECT", points: answer?.points ?? 0, totalPoints: p.answers.reduce((sum, a) => sum + a.points, 0) };
  });
  await prisma.quizSession.update({ where: { id: sessionId }, data: { status: "BETWEEN_QUESTIONS", deadline: null } });
  io.to(room(sessionId)).emit("question:results", { questionId: q.id, explanation: q.explanation, leaderboard: ranked });
  for (const result of individual) io.to(`participant:${result.participantId}`).emit("participant:result", { correct: result.correct, points: result.points, totalPoints: result.totalPoints });
}
function clearTimer(id: string) { const t = timerHandles.get(id); if (t) clearTimeout(t); timerHandles.delete(id); }
async function activateQuestion(sessionId: string, index: number) {
  clearTimer(sessionId);
  const q = await publicQuestion(sessionId, index);
  if (!q) {
    await prisma.quizSession.update({ where: { id: sessionId }, data: { status: "FINISHED", endedAt: new Date(), deadline: null } });
    const final = await finalResults(sessionId); io.to(room(sessionId)).emit("quiz:finished", final); return;
  }
  const start = new Date(); const deadline = new Date(start.getTime() + q.timeLimitSeconds * 1000);
  await prisma.quizSession.update({ where: { id: sessionId }, data: { status: "ACTIVE", currentQuestionIndex: index, questionStartedAt: start, deadline, pausedRemainingMs: null } });
  io.to(room(sessionId)).emit("question:started", { question: q, questionIndex: index, startedAt: start.toISOString(), deadline: deadline.toISOString(), serverNow: new Date().toISOString() });
  timerHandles.set(sessionId, setTimeout(() => void finishQuestion(sessionId), q.timeLimitSeconds * 1000));
}
async function finalResults(sessionId: string) {
  const session = await prisma.quizSession.findUnique({ where: { id: sessionId }, include: { quiz: { include: { questions: { orderBy: { order: "asc" } } } }, participants: { include: { answers: true } } } });
  if (!session) return { leaderboard: [], questions: [] };
  const leaderboard = session.participants.map(p => ({
    name: p.name, totalPoints: p.answers.reduce((s, a) => s + a.points, 0),
    breakdown: session.quiz.questions.map(q => p.answers.find(a => a.questionId === q.id)?.points ?? 0)
  })).sort((a, b) => b.totalPoints - a.totalPoints).map((p, i) => ({ rank: i + 1, ...p }));
  return { leaderboard, questions: session.quiz.questions.map(q => ({ id: q.id, text: q.text })) };
}
app.post("/api/quizzes/:id/sessions", requireAdmin, async (req: AuthRequest, res) => {
  const quiz = await prisma.quiz.findFirst({ where: { id: String(req.params.id), ownerId: req.adminId } });
  if (!quiz) return res.status(404).json({ error: "Quiz not found" });
  const questionCount = await prisma.question.count({ where: { quizId: quiz.id } });
  if (questionCount === 0) return res.status(400).json({ error: "Add at least one question before starting a session" });
  let pin = ""; for (let i = 0; i < 10; i++) { pin = String(Math.floor(100000 + Math.random() * 900000)); if (!(await prisma.quizSession.findUnique({ where: { pin } }))) break; }
  const session = await prisma.quizSession.create({ data: { pin, quizId: quiz.id } });
  res.status(201).json(session);
});
app.get("/api/sessions/:id/results", requireAdmin, async (req: AuthRequest, res) => {
  const session = await prisma.quizSession.findFirst({ where: { id: String(req.params.id), quiz: { ownerId: req.adminId } } }); if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(await finalResults(session.id));
});

io.on("connection", socket => {
  socket.on("host:join", async ({ sessionId, token }) => {
    try {
      const adminId = verifyAdminToken(String(token ?? ""));
      if (!adminId) return socket.emit("error:message", "Authentication failed. Please sign in again.");
      const session = await prisma.quizSession.findFirst({ where: { id: String(sessionId), quiz: { ownerId: adminId } } });
      if (!session) return socket.emit("error:message", "Session not found or access denied");
      socket.join(room(session.id)); socket.data.hostSessionId = session.id;
      const count = await prisma.participant.count({ where: { sessionId: session.id } });
      socket.emit("host:state", { session, participantCount: count });
      await emitLobby(session.id);
    } catch { socket.emit("error:message", "Could not join host session"); }
  });
  socket.on("participant:join", async ({ pin, name }) => {
    try {
      const cleanName = String(name ?? "").trim().slice(0, 32);
      if (!/^\d{6}$/.test(String(pin)) || cleanName.length < 2) return socket.emit("join:error", "Enter a valid six-digit PIN and a name of at least 2 characters");
      const session = await prisma.quizSession.findUnique({ where: { pin: String(pin) }, include: { quiz: true } });
      if (!session || session.status === "FINISHED") return socket.emit("join:error", "This game PIN is invalid or the quiz has ended");
      const count = await prisma.participant.count({ where: { sessionId: session.id } });
      if (count >= 150) return socket.emit("join:error", "This session has reached its 150 participant limit");
      const token = randomUUID();
      const participant = await prisma.participant.create({ data: { sessionId: session.id, name: cleanName, token } });
      socket.data.participantId = participant.id; socket.data.sessionId = session.id;
      socket.join(room(session.id)); socket.join(`participant:${participant.id}`);
      socket.emit("join:success", { participantId: participant.id, participantToken: token, name: participant.name, quizTitle: session.quiz.title, status: session.status });
      await emitLobby(session.id);
      if (session.status === "ACTIVE") {
        const q = await publicQuestion(session.id, session.currentQuestionIndex);
        if (q) socket.emit("question:started", { question: q, questionIndex: session.currentQuestionIndex, deadline: session.deadline?.toISOString(), serverNow: new Date().toISOString() });
      }
    } catch (e: any) {
      socket.emit("join:error", e?.code === "P2002" ? "That name is already taken in this room. Try another name." : "Could not join the game. Please try again.");
    }
  });
  socket.on("participant:resume", async ({ participantToken }) => {
    try {
      const p = await prisma.participant.findUnique({ where: { token: String(participantToken ?? "") }, include: { session: { include: { quiz: true } } } });
      if (!p) return socket.emit("join:error", "Your saved session could not be found");
      socket.data.participantId = p.id; socket.data.sessionId = p.sessionId;
      socket.join(room(p.sessionId)); socket.join(`participant:${p.id}`);
      socket.emit("join:success", { participantId: p.id, participantToken, name: p.name, quizTitle: p.session.quiz.title, status: p.session.status });
      if (p.session.status === "ACTIVE") {
        const q = await publicQuestion(p.sessionId, p.session.currentQuestionIndex);
        if (q) socket.emit("question:started", { question: q, questionIndex: p.session.currentQuestionIndex, deadline: p.session.deadline?.toISOString(), serverNow: new Date().toISOString() });
      }
    } catch { socket.emit("join:error", "Could not restore your session"); }
  });
  socket.on("participant:answer", async ({ participantToken, optionId }) => {
    try {
      const p = await prisma.participant.findUnique({ where: { token: participantToken }, include: { session: { include: { quiz: true } } } });
      if (!p || p.session.status !== "ACTIVE" || !p.session.deadline || !p.session.questionStartedAt) return socket.emit("answer:error", "This question is no longer accepting answers");
      const receivedAt = new Date();
      if (receivedAt.getTime() > p.session.deadline.getTime()) return socket.emit("answer:error", "Time is up");
      const q = await prisma.question.findFirst({ where: { quizId: p.session.quizId, order: p.session.currentQuestionIndex }, include: { options: true } });
      if (!q || !q.options.some(o => o.id === optionId)) return socket.emit("answer:error", "Invalid answer option");
      const correct = q.options.some(o => o.id === optionId && o.isCorrect);
      const totalMs = q.timeLimitSeconds * 1000;
      // Use the server-owned deadline so paused time does not consume answer time.
      const remainingMs = Math.max(0, Math.min(totalMs, p.session.deadline.getTime() - receivedAt.getTime()));
      const elapsedMs = totalMs - remainingMs;
      const points = correct ? Math.max(0, Math.floor(p.session.quiz.basePoints * remainingMs / totalMs)) : 0;
      await prisma.participantAnswer.create({ data: { participantId: p.id, questionId: q.id, optionId, status: correct ? "CORRECT" : "INCORRECT", points, submittedAt: receivedAt, responseMs: elapsedMs } });
      socket.emit("answer:accepted", { submitted: true });
      const answered = await prisma.participantAnswer.count({ where: { questionId: q.id, participant: { sessionId: p.sessionId } } });
      const total = await prisma.participant.count({ where: { sessionId: p.sessionId } });
      io.to(room(p.sessionId)).emit("host:progress", { answered, total });
    } catch (e: any) {
      if (e?.code === "P2002") socket.emit("answer:error", "You have already submitted an answer");
      else socket.emit("answer:error", "Unable to submit answer");
    }
  });
  socket.on("host:start", async ({ sessionId }) => {
    if (socket.data.hostSessionId !== sessionId) return;
    const session = await prisma.quizSession.findUnique({ where: { id: sessionId }, include: { quiz: { include: { owner: true, questions: true } } } });
    if (!session || session.status !== "LOBBY" || !session.quiz.questions.length) return;
    await activateQuestion(sessionId, 0);
  });
  socket.on("host:next", async ({ sessionId }) => {
    if (socket.data.hostSessionId !== sessionId) return;
    const session = await prisma.quizSession.findUnique({ where: { id: sessionId } }); if (!session || session.status !== "BETWEEN_QUESTIONS") return;
    await activateQuestion(sessionId, session.currentQuestionIndex + 1);
  });
  socket.on("host:pause", async ({ sessionId }) => {
    if (socket.data.hostSessionId !== sessionId) return;
    const s = await prisma.quizSession.findUnique({ where: { id: sessionId } }); if (!s || s.status !== "ACTIVE" || !s.deadline) return;
    const remaining = Math.max(0, s.deadline.getTime() - Date.now()); clearTimer(sessionId);
    await prisma.quizSession.update({ where: { id: sessionId }, data: { status: "PAUSED", pausedRemainingMs: remaining } });
    io.to(room(sessionId)).emit("quiz:paused", { remainingMs: remaining });
  });
  socket.on("host:resume", async ({ sessionId }) => {
    if (socket.data.hostSessionId !== sessionId) return;
    const s = await prisma.quizSession.findUnique({ where: { id: sessionId } }); if (!s || s.status !== "PAUSED" || s.pausedRemainingMs === null) return;
    const deadline = new Date(Date.now() + s.pausedRemainingMs);
    await prisma.quizSession.update({ where: { id: sessionId }, data: { status: "ACTIVE", deadline } });
    timerHandles.set(sessionId, setTimeout(() => void finishQuestion(sessionId), s.pausedRemainingMs));
    io.to(room(sessionId)).emit("quiz:resumed", { deadline: deadline.toISOString(), serverNow: new Date().toISOString() });
  });
  socket.on("host:end", async ({ sessionId }) => {
    if (socket.data.hostSessionId !== sessionId) return;
    clearTimer(sessionId); await prisma.quizSession.update({ where: { id: sessionId }, data: { status: "FINISHED", endedAt: new Date(), deadline: null } });
    io.to(room(sessionId)).emit("quiz:finished", await finalResults(sessionId));
  });
});

const port = Number(process.env.PORT ?? 4000);
httpServer.listen(port, () => console.log(`Quiz API listening on :${port}`));
process.on("SIGINT", async () => { for (const id of timerHandles.keys()) clearTimer(id); await prisma.$disconnect(); process.exit(0); });