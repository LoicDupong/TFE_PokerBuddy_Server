import express from "express";
import { apiRouter } from "./routers/index.js";
import morgan from "morgan";
import cors from "cors";
import { authMiddleware } from "./middlewares/auth.middleware.js";
import db from "./models/index.js";

const app = express();

// Render place l'API derrière un proxy : nécessaire pour lire la vraie IP (rate limit du login)
app.set("trust proxy", 1);

// Middleware
// CORS: in production, restrict to the frontend origin via ALLOWED_ORIGIN env var.
// In local dev, ALLOWED_ORIGIN is not set → fallback to "*" (all origins allowed).
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || "*",
}));
app.use(morgan("tiny"));
app.use(express.json());

// Simple logger middleware
app.use((req, res, next) => {
  console.log("➡️", req.method, req.url);
  next();
});

// Static files (images, etc.)
app.use("/public", express.static("public"));
app.use("/uploads", express.static("uploads"));

// Routing
app.use("/api", authMiddleware(), apiRouter);

// Route API inconnue → JSON (et non la page HTML par défaut d'Express)
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Erreur non gérée → JSON, sans exposer la stack au client
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start
const PORT = process.env.PORT || 8080;
// Pas de fallback "dev" : sync({ alter }) ne doit tourner que si on le demande explicitement
const NODE_ENV = process.env.NODE_ENV || "production";

if (NODE_ENV === "dev") {
  await db.sequelize.sync({ alter: true });
}

app.listen(PORT, (error) => {
  if (error) {
    console.error("❌ Web API failed to start:", error);
    return;
  }
  console.log(`🚀 Server running on port ${PORT} (${NODE_ENV})`);
});
