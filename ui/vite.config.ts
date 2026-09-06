/// <reference types="vitest/config" />

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import path from "path"
import { defineConfig, loadEnv } from "vite"

import { generateTranslations } from "./scripts/generate-translations"

interface RewriteComfyImportsOptions {
  isDev: boolean
}

// Plugin to correctly handle the ComfyUI scripts in development mode
const rewriteComfyImports = ({ isDev }: RewriteComfyImportsOptions) => {
  return {
    name: "rewrite-comfy-imports",
    resolveId(source: string) {
      if (!isDev) {
        return
      }
      if (source === "/scripts/app.js") {
        return "http://127.0.0.1:8188/scripts/app.js"
      }
      if (source === "/scripts/api.js") {
        return "http://127.0.0.1:8188/scripts/api.js"
      }
      return null
    },
  }
}

generateTranslations()

const envDir = path.resolve(__dirname, "../")
const env = loadEnv("", envDir, "")

const USE_STANDALONE_BACKEND = env.USE_STANDALONE_BACKEND === "true"
let backendBaseUrl = "/"

if (USE_STANDALONE_BACKEND) {
  const port = env.BACKEND_STANDALONE_PORT
  if (!port) {
    throw new Error(
      "BACKEND_STANDALONE_PORT environment variable is not set. Please set it to the port of the standalone backend server.",
    )
  }
  backendBaseUrl = `http://127.0.0.1:${port}/`
  console.log(`Using standalone backend at ${backendBaseUrl}`)
}

export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), react(), rewriteComfyImports({ isDev: mode === "development" })],
  define: {
    __DEV__: mode === "development" || process.argv.includes("--watch"),
    __USE_STANDALONE_BACKEND__: USE_STANDALONE_BACKEND,
    __BACKEND_BASE_URL__: JSON.stringify(backendBaseUrl),
  },
  envDir,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    setupFiles: ["./test/setup.ts"],
  },
  server: {
    proxy: {
      "/api/image-shelf": "http://127.0.0.1:8188",
    },
  },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      // Don't bundle ComfyUI scripts - they will be loaded from the ComfyUI server
      external: ["/scripts/app.js", "/scripts/api.js"],
      input: {
        main: path.resolve(__dirname, "src/main.tsx"),
      },
      output: {
        dir: "../dist",
        entryFileNames: "[name].js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: "[name][extname]",
        // Split React into a separate vendor chunk for better caching
        manualChunks(id) {
          if (["react", "react-dom"].some((pkg) => id.includes(`/node_modules/${pkg}/`))) {
            return "vendor"
          }
          return null
        },
      },
    },
  },
}))
