import { Router } from "express";
import { requireAdmin } from "../middlewares/auth.middleware.js";
import adminAnalyticsController from "../controllers/adminAnalytics.controller.js";

// Analytics côté back-office : /api/admin/analytics/… (requireAdmin propre, indépendant du routeur admin général)
const adminAnalyticsRouter = Router();

adminAnalyticsRouter.use(requireAdmin());
adminAnalyticsRouter.get("/overview", adminAnalyticsController.overview);

export default adminAnalyticsRouter;
