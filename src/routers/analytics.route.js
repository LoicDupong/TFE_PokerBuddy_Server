import { Router } from "express";
import { analyticsLimiter } from "../middlewares/rateLimit.middleware.js";
import analyticsController, { parseBeaconBody } from "../controllers/analytics.controller.js";

// Mesure d'audience publique, sans cookie : /api/analytics/…
const analyticsRouter = Router();

analyticsRouter.post("/pageview", analyticsLimiter, parseBeaconBody, analyticsController.pageview);

export default analyticsRouter;
