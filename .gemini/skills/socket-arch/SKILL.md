\---

name: socket-arch

description: Debugs backend Socket.io logic, Redis adapter, and message mapping.

\---

\# Instructions

\- Focus on `server/services/messagePipeline.ts` and `server/routes/socket.ts`.

\- Verify if `message:send` events correctly reach the `ticket:{ticketId}` room.

\- \*\*MANDATE\*\*: Only use `docker compose exec server` for any backend tests or logs.

