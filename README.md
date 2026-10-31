# Real-Time Multiplayer Quiz Platform

A full-stack quiz application designed for sessions of up to 150 participants.

## Stack
- React + Vite + TypeScript + Tailwind CSS + Framer Motion
- Node.js + Express + TypeScript
- Socket.IO for real-time events
- PostgreSQL + Prisma
- JWT admin authentication; participants join with a game PIN and display name

## Requirements
- Node.js 20+
- PostgreSQL 14+

## Setup
1. Create a PostgreSQL database.
2. Copy `server/.env.example` to `server/.env` and set `DATABASE_URL` and a long random `JWT_SECRET`.
3. Install dependencies from the repository root:
   ```bash
   npm install
   ```
4. Generate Prisma client and run migrations:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```
5. Create the first admin:
   ```bash
   npm run seed -w server
   ```
   Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `server/.env` first.
6. Start both apps:
   ```bash
   npm run dev
   ```
   Client: http://localhost:5173  
   API: http://localhost:4000

## Production notes
- Deploy the client and server separately, configure `VITE_API_URL` and `VITE_SOCKET_URL`.
- Use a managed PostgreSQL instance and HTTPS/WSS.
- For horizontal scaling, add the Socket.IO Redis adapter and a shared job/clock strategy.
- The included in-process timer is suitable for a single server instance. For multi-instance deployment, move timer scheduling to a durable worker (e.g. BullMQ) and use Redis adapter.
- Configure CORS to the exact production client origin.
- Back up the database and rotate JWT secrets.

## Functional behavior
- Admin can login, create/duplicate/delete quizzes, add/edit/delete questions, launch sessions, pause/resume, advance, and end.
- Questions cannot be edited or deleted while a session of that quiz is running (active, paused or between questions).
- Participants join by PIN, receive synchronized question state, and submit once per question.
- The server calculates points using `floor(basePoints * remainingMs / totalMs)`.
- Question leaderboard ranks correct submissions by server receipt timestamp, but never sends response times to clients.
- Cumulative score and current-question score are distinct.
- Session capacity is enforced at 150.

## Important limitations
This is a working single-server implementation foundation, not a claim of production load certification. Before a public event, run a 150-client load test in the target hosting environment, configure rate limits and monitoring, and use Redis-backed Socket.IO/timers if deploying multiple server instances.