import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      // Truth Agent (claim verification service, src/a2a/claimAgent.js)
      "/claims": {
        target: "http://127.0.0.1:8105",
        changeOrigin: true,
      },
      // Sui testnet (wallet reads, zk-signed tx submission).
      // Public fullnodes dropped JSON-RPC; publicnode still serves it.
      "/suirpc": {
        target: "https://sui-testnet-rpc.publicnode.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/suirpc/, ""),
      },
    },
  },
});
