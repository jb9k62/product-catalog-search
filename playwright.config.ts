import { defineConfig, devices } from "@playwright/test";

const API_PORT = Number(process.env.PORT) || 3000;
const CLIENT_PORT = Number(process.env.VITE_PORT) || 5173;
const BASE_URL = `http://localhost:${CLIENT_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Two servers, each with its own readiness URL. Waiting on Vite alone (via
  // `npm run dev`) could let the first test reach the proxy before the API is listening.
  webServer: [
    {
      command: "npm run dev:server",
      url: `http://localhost:${API_PORT}/api/categories`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npm run dev:client",
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
