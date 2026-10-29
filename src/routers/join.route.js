import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import joinController from "../controllers/join.controller.js";
import { uuidParam } from "../middlewares/validate.middleware.js";
import { guestAnswerLimiter } from "../middlewares/rateLimit.middleware.js";

const joinRouter = Router();

// Les codes d'invitation sont des UUID (randomUUID)
joinRouter.param("token", uuidParam);

// Routes publiques (sans compte) ; "/guest" déclaré avant "/:token"
joinRouter.patch("/guest", guestAnswerLimiter, joinController.updateGuestAnswer);
joinRouter.get("/:token", joinController.getJoinInfo);
joinRouter.get("/:token/ics", joinController.getJoinIcs);
joinRouter.post("/:token/guest", guestAnswerLimiter, joinController.answerAsGuest);

joinRouter.route("/:token").post(authorizeMiddleware(), joinController.joinByToken);

export default joinRouter;
