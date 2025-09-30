import express from "express";
import { apiRouter } from "./routers/index.js";
import morgan from "morgan";
import cors from "cors";
import { authMiddleware } from "./middlewares/auth.middleware.js";

const app = express();

// Middleware
app.use(cors());
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

// Start
const PORT = process.env.PORT || 8080;
const NODE_ENV = process.env.NODE_ENV || "development";

app.listen(PORT, (error) => {
  if (error) {
    console.error("❌ Web API failed to start:", error);
    return;
  }
  console.log(`🚀 Server running on port ${PORT} (${NODE_ENV})`);
});
