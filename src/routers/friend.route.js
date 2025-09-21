import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import friendController from "../controllers/friend.controller.js";

const friendRouter = Router();

// Envoyer une demande d'ami
friendRouter.post("/invite", authorizeMiddleware(), friendController.sendInvite);

// Répondre à une demande (accept/decline)
friendRouter.patch("/invite/:inviteId", authorizeMiddleware(), friendController.respondInvite);

// Lister ses amis
friendRouter.get("/", authorizeMiddleware(), friendController.getFriends);

export default friendRouter;
