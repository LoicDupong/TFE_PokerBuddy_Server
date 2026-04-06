import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import leaderboardController from "../controllers/leaderboard.controller.js";

const leaderboardRouter = Router();

leaderboardRouter.get("/", authorizeMiddleware(), leaderboardController.getLeaderboard);

export default leaderboardRouter;
