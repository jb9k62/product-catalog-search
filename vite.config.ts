import { defineConfig } from "vite";

const API_PORT = process.env.PORT ?? "3000";
const CLIENT_PORT = Number(process.env.VITE_PORT) || 5173;

export default defineConfig({
  root: "client",
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
  server: {
    port: CLIENT_PORT,
    strictPort: true,
    proxy: {
      "/api": `http://localhost:${API_PORT}`,
    },
  },
});
