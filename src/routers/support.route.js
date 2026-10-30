import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import { uuidParam } from "../middlewares/validate.middleware.js";
import { supportMessageLimiter, supportTicketLimiter } from "../middlewares/rateLimit.middleware.js";
import supportController from "../controllers/support.controller.js";

// Support côté utilisateur : /api/support/… (chacun ne voit que ses tickets)
const supportRouter = Router();

supportRouter.param("id", uuidParam);

supportRouter.post("/tickets", authorizeMiddleware(), supportTicketLimiter, supportController.createTicket);
supportRouter.get("/tickets", authorizeMiddleware(), supportController.listMyTickets);
supportRouter.get("/tickets/:id", authorizeMiddleware(), supportController.getMyTicket);
supportRouter.post("/tickets/:id/messages", authorizeMiddleware(), supportMessageLimiter, supportController.addMyMessage);

export default supportRouter;
