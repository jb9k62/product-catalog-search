import { createApp } from "./app.ts";

const PORT = Number(process.env.PORT || 3000);

// listen() throws on a bad port before the "error" handler below is attached.
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  console.error(
    `PORT must be a whole number from 0 to 65535, not "${process.env.PORT}".`,
  );
  process.exit(1);
}

// Express 5 also calls this on failure, with the error. The "error" handler
// below reports that, so only log here on success.
const server = createApp({ logRequests: true }).listen(PORT, (err) => {
  if (err) return;
  console.log(`Server listening on http://localhost:${PORT}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Set PORT to a free one, e.g. PORT=3001 npm start.`,
    );
  } else {
    console.error("Server failed to start:", err.message);
  }
  process.exit(1);
});
