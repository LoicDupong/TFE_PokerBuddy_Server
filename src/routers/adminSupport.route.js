import { Router } from "express";
import { requireAdmin } from "../middlewares/auth.middleware.js";
import { uuidParam } from "../middlewares/validate.middleware.js";
import adminSupportController from "../controllers/adminSupport.controller.js";

// Support côté back-office : /api/admin/support/… (requireAdmin propre, indépendant du routeur admin général)
const adminSupportRouter = Router();

adminSupportRouter.use(requireAdmin());
adminSupportRouter.param("id", uuidParam);

adminSupportRouter.get("/tickets", adminSupportController.listTickets);
adminSupportRouter.get("/tickets/:id", adminSupportController.getTicket);
adminSupportRouter.post("/tickets/:id/messages", adminSupportController.addMessage);
adminSupportRouter.patch("/tickets/:id", adminSupportController.updateTicket);

export default adminSupportRouter;
